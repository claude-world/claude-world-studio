/**
 * Agent Orchestrator — Phase 2 state machine for long-lived goal execution (v2.0).
 *
 * Lifecycle: PLAN → EXECUTE → REFLECT → COMPLETE (or FAILED/PAUSED)
 *
 * Design:
 * - Single singleton per server process (registerCleanup pattern)
 * - Maintains in-memory run registry with 72-hour TTL (stale runs GC'd on startup)
 * - Emits events via EventEmitter for WebSocket broadcasting
 * - Calls memoryService to load past failures before execution
 * - Saves outcome as a memory after each run
 */

import { EventEmitter } from "events";
import store from "../db.js";
import { memoryService } from "./memory-service.js";
import { registerCleanup } from "../cleanup-registry.js";
import { logger } from "../logger.js";
import type { OrchestratorGoalRun, OrchestratorState, AgentGoalStatus } from "../types.js";

// Max age for in-memory run tracking before GC
const RUN_TTL_MS = 72 * 60 * 60 * 1000; // 72 hours
// Max concurrent goal runs
const MAX_CONCURRENT = 5;

class AgentOrchestrator extends EventEmitter {
  /** goalId → run record */
  private runs = new Map<string, OrchestratorGoalRun>();
  private gcInterval: ReturnType<typeof setInterval> | null = null;

  /** Exposed so route handlers can reference the same cap without hardcoding it. */
  readonly maxConcurrent = MAX_CONCURRENT;

  constructor() {
    super();
    // Mark any active goals from a previous server run as failed (they have no in-memory run)
    const stale = store.markStaleGoalsFailed();
    if (stale.changes > 0) {
      logger.info(
        "Orchestrator",
        `Marked ${stale.changes} stale active goal(s) as failed on startup`
      );
    }
    // GC stale runs every 30 minutes
    this.gcInterval = setInterval(() => this.gcStaleRuns(), 30 * 60 * 1000);
    registerCleanup(() => this.shutdown());
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Start orchestrating a goal. Creates a DB record if needed and transitions
   * through PLAN → EXECUTE → REFLECT → COMPLETE.
   *
   * Returns the goal ID.
   */
  async runGoal(params: {
    description: string;
    sessionId?: string;
    accountId?: string;
    onState?: (state: OrchestratorState) => void;
  }): Promise<string> {
    if (this.runs.size >= MAX_CONCURRENT) {
      throw new Error(`Max concurrent goal runs (${MAX_CONCURRENT}) reached`);
    }

    // Create persistent goal record
    const goal = store.createGoal({
      description: params.description,
      sessionId: params.sessionId,
      accountId: params.accountId,
    });

    const run: OrchestratorGoalRun = {
      goalId: goal.id,
      sessionId: params.sessionId ?? null,
      state: "planning",
      startedAt: Date.now(),
      lastUpdatedAt: Date.now(),
      retries: 0,
    };
    this.runs.set(goal.id, run);

    logger.info("Orchestrator", `Goal ${goal.id} started — "${params.description}"`);

    // Run state machine asynchronously (non-blocking)
    this.executeStateMachine(run, params.accountId, params.onState).catch((err) => {
      logger.error("Orchestrator", `Goal ${goal.id} fatal error: ${err.message}`);
      this.transition(run, "failed");
    });

    return goal.id;
  }

  /** Pause a running goal */
  pauseGoal(goalId: string): boolean {
    const run = this.runs.get(goalId);
    if (!run || run.state === "complete" || run.state === "failed") return false;
    this.transition(run, "paused");
    store.updateGoalStatus(goalId, "paused");
    return true;
  }

  /** Resume a paused goal */
  resumeGoal(goalId: string): boolean {
    const run = this.runs.get(goalId);
    if (!run || run.state !== "paused") return false;
    this.transition(run, "executing");
    store.updateGoalStatus(goalId, "active");
    return true;
  }

  /** Abort a goal — marks as failed */
  abortGoal(goalId: string): boolean {
    const run = this.runs.get(goalId);
    if (!run) return false;
    this.transition(run, "failed");
    store.updateGoalStatus(goalId, "failed");
    memoryService.saveMemory({
      goalId,
      content: `Goal "${store.getGoal(goalId)?.description}" was aborted by user.`,
      tags: ["abort", "goal"],
      memoryType: "failure",
    });
    return true;
  }

  /** Get current state of a goal run */
  getRunState(goalId: string): OrchestratorGoalRun | undefined {
    return this.runs.get(goalId);
  }

  /** List all active runs */
  getActiveRuns(): OrchestratorGoalRun[] {
    return Array.from(this.runs.values()).filter(
      (r) => r.state !== "complete" && r.state !== "failed"
    );
  }

  // ── State Machine ──────────────────────────────────────────────────────────

  private async executeStateMachine(
    run: OrchestratorGoalRun,
    accountId?: string,
    onState?: (state: OrchestratorState) => void
  ): Promise<void> {
    const goal = store.getGoal(run.goalId);
    if (!goal) {
      this.transition(run, "failed");
      return;
    }

    // ── PLAN phase ────────────────────────────────────────────────────────
    this.transition(run, "planning", onState);

    // Load relevant past memories to inform planning
    const pastMemories = memoryService.searchMemory(goal.description, {
      accountId,
      limit: 5,
    });
    const pastLessons =
      pastMemories.length > 0
        ? `Past lessons:\n${pastMemories.map((m) => `- ${m.content}`).join("\n")}`
        : "";

    if (pastLessons) {
      logger.info(
        "Orchestrator",
        `Goal ${run.goalId}: loaded ${pastMemories.length} past memories`
      );
    }

    // ── EXECUTE phase ─────────────────────────────────────────────────────
    this.transition(run, "executing", onState);
    store.updateGoalStatus(run.goalId, "active");
    store.updateGoalProgress(run.goalId, 25);

    // Simulate execution progress (actual work happens via Claude sessions)
    // The orchestrator tracks state; the real execution is done by AgentSession
    await this.sleep(100);
    store.updateGoalProgress(run.goalId, 50);

    // ── REFLECT phase ─────────────────────────────────────────────────────
    this.transition(run, "reflecting", onState);
    store.updateGoalProgress(run.goalId, 75);

    // Save a "goal started" memory for future sessions
    memoryService.saveMemory({
      goalId: run.goalId,
      accountId,
      content: `Started goal: "${goal.description}". ${pastLessons}`,
      tags: ["goal-start", "orchestrator"],
      memoryType: "general",
    });

    // ── COMPLETE phase ────────────────────────────────────────────────────
    this.transition(run, "complete", onState);
    store.updateGoalStatus(run.goalId, "completed");
    store.updateGoalProgress(run.goalId, 100);

    memoryService.saveMemory({
      goalId: run.goalId,
      accountId,
      content: `Completed goal: "${goal.description}"`,
      tags: ["goal-complete", "orchestrator"],
      memoryType: "success",
    });

    logger.info("Orchestrator", `Goal ${run.goalId} completed`);
  }

  private transition(
    run: OrchestratorGoalRun,
    state: OrchestratorState,
    onState?: (s: OrchestratorState) => void
  ) {
    run.state = state;
    run.lastUpdatedAt = Date.now();
    this.emit("state", { goalId: run.goalId, state });
    onState?.(state);
    // Evict terminal runs after 10 minutes so completed/failed runs don't accumulate for 72h.
    // Guard with evictionScheduled to prevent duplicate timers on double-transition.
    if ((state === "complete" || state === "failed") && !run.evictionScheduled) {
      run.evictionScheduled = true;
      setTimeout(() => this.runs.delete(run.goalId), 10 * 60 * 1000);
    }
  }

  private gcStaleRuns() {
    const now = Date.now();
    for (const [id, run] of this.runs) {
      if (now - run.lastUpdatedAt > RUN_TTL_MS) {
        this.runs.delete(id);
        logger.info("Orchestrator", `GC'd stale run for goal ${id}`);
      }
    }
  }

  private sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }

  shutdown() {
    if (this.gcInterval) {
      clearInterval(this.gcInterval);
      this.gcInterval = null;
    }
    this.runs.clear();
    logger.info("Orchestrator", "Shutdown complete");
  }
}

export const orchestrator = new AgentOrchestrator();
export type { AgentOrchestrator };
