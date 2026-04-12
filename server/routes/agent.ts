/**
 * Agent routes — Goals, Memories, Reflections, Strategy (v2.0).
 *
 * All endpoints read/write via the store (db.ts) or memoryService.
 * No business logic here — just validation, delegation, and response shaping.
 */

import { Router } from "express";
import store from "../db.js";
import { memoryService } from "../services/memory-service.js";
import { orchestrator } from "../services/agent-orchestrator.js";
import type { AgentGoalStatus, AgentMemoryType } from "../types.js";

const router = Router();

// ── Goals ──────────────────────────────────────────────────────────────────

const VALID_GOAL_STATUSES: AgentGoalStatus[] = ["active", "completed", "failed", "paused"];

/** GET /api/agent/goals?status=active&limit=50 */
router.get("/goals", (req, res) => {
  const rawStatus = (req.query.status as string) || "active";
  if (!VALID_GOAL_STATUSES.includes(rawStatus as AgentGoalStatus)) {
    res
      .status(400)
      .json({ error: `Invalid status: must be one of ${VALID_GOAL_STATUSES.join(", ")}` });
    return;
  }
  const limit = Math.min(parseInt(String(req.query.limit || "50"), 10) || 50, 200);
  try {
    const goals = store.getGoalsByStatus(rawStatus as AgentGoalStatus, limit);
    res.json(goals);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch goals" });
  }
});

/** POST /api/agent/goals */
router.post("/goals", (req, res) => {
  const { description, sessionId, accountId } = req.body || {};
  if (!description || typeof description !== "string") {
    res.status(400).json({ error: "description is required" });
    return;
  }
  const goal = store.createGoal({ description, sessionId, accountId });
  res.status(201).json(goal);
});

/** GET /api/agent/goals/:id */
router.get("/goals/:id", (req, res) => {
  const goal = store.getGoal(req.params.id);
  if (!goal) {
    res.status(404).json({ error: "Goal not found" });
    return;
  }
  res.json(goal);
});

/** PATCH /api/agent/goals/:id/progress */
router.patch("/goals/:id/progress", (req, res) => {
  const goal = store.getGoal(req.params.id);
  if (!goal) {
    res.status(404).json({ error: "Goal not found" });
    return;
  }
  const { progress, subTasks, status } = req.body || {};
  const VALID_STATUSES: AgentGoalStatus[] = ["active", "completed", "failed", "paused"];
  if (typeof progress === "number") {
    store.updateGoalProgress(req.params.id, Math.min(100, Math.max(0, progress)), subTasks ?? null);
  }
  if (status !== undefined) {
    if (!VALID_STATUSES.includes(status as AgentGoalStatus)) {
      res
        .status(400)
        .json({ error: `Invalid status: must be one of ${VALID_STATUSES.join(", ")}` });
      return;
    }
    store.updateGoalStatus(req.params.id, status as AgentGoalStatus);
  }
  res.json(store.getGoal(req.params.id));
});

/** DELETE /api/agent/goals/:id */
router.delete("/goals/:id", (req, res) => {
  const deleted = store.deleteGoal(req.params.id);
  res.json({ deleted });
});

// ── Memories ───────────────────────────────────────────────────────────────

/** GET /api/agent/memories?q=query&accountId=x&type=reflection&limit=20 */
router.get("/memories", (req, res) => {
  const q = String(req.query.q || "").trim();
  const accountId = req.query.accountId ? String(req.query.accountId) : undefined;
  const memoryType = req.query.type as AgentMemoryType | undefined;
  const limit = Math.min(parseInt(String(req.query.limit || "20"), 10) || 20, 100);

  if (q) {
    const results = memoryService.searchMemory(q, { accountId, memoryType, limit });
    res.json(results);
  } else {
    const results = store.getContextMemories(accountId, limit);
    res.json(results);
  }
});

/** POST /api/agent/memories */
router.post("/memories", (req, res) => {
  const { content, goalId, accountId, tags, memoryType } = req.body || {};
  if (!content || typeof content !== "string") {
    res.status(400).json({ error: "content is required" });
    return;
  }
  const memory = memoryService.saveMemory({ content, goalId, accountId, tags, memoryType });
  res.status(201).json(memory);
});

/** DELETE /api/agent/memories/:id */
router.delete("/memories/:id", (req, res) => {
  const deleted = store.deleteMemory(req.params.id);
  res.json({ deleted });
});

// ── Reflections ────────────────────────────────────────────────────────────

/** GET /api/agent/reflections/:sessionId?limit=20 */
router.get("/reflections/:sessionId", (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit || "20"), 10) || 20, 100);
  const reflections = memoryService.getReflections(req.params.sessionId, limit);
  res.json(reflections);
});

// ── Strategy Analytics ─────────────────────────────────────────────────────

/**
 * GET /api/agent/analytics/strategy?days=30&accountId=x
 *
 * Derives content strategy recommendations from publish history + insights.
 * Returns top formats, best posting hours, and average score by content type.
 */
router.get("/analytics/strategy", (req, res) => {
  const days = Math.min(parseInt(String(req.query.days || "30"), 10) || 30, 365);
  const accountId = req.query.accountId ? String(req.query.accountId) : undefined;

  try {
    const overview = store.getAnalyticsOverview(days, accountId);
    const contentAnalysis = store.getContentAnalysis(days);

    // Derive top formats from image_vs_text performance (spread to avoid mutating cached object)
    const topFormats = [...(contentAnalysis.image_vs_text || [])]
      .sort((a: any, b: any) => b.avg_views - a.avg_views)
      .map((f: any) => ({ type: f.type, avg_views: Math.round(f.avg_views), count: f.count }));

    // Best posting hours (top 3 by avg engagement)
    const bestHours = [...(contentAnalysis.hour_performance || [])]
      .sort((a: any, b: any) => b.avg_engagement - a.avg_engagement)
      .slice(0, 3)
      .map((h: any) => ({
        hour: h.hour,
        avg_engagement: Math.round(h.avg_engagement * 100) / 100,
      }));

    // Top performing posts as topic seeds
    const topTopics = (overview.top_posts || []).map((p: any) => ({
      content_preview: p.content?.slice(0, 80),
      views: p.views,
      account: p.handle,
    }));

    res.json({
      period_days: days,
      total_posts: overview.total_posts,
      published_posts: overview.published_posts,
      engagement_rate: Math.round((overview.engagement_rate || 0) * 10000) / 100,
      top_formats: topFormats,
      best_hours: bestHours,
      top_topics: topTopics,
      link_vs_no_link: contentAnalysis.link_vs_no_link,
      day_performance: contentAnalysis.day_performance,
    });
  } catch (err) {
    res.status(500).json({ error: "Analytics query failed" });
  }
});

// ── Recent Reflections (no sessionId filter) ───────────────────────────────

/** GET /api/agent/reflections?limit=20 — recent reflections as memories (across sessions) */
router.get("/reflections", (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit || "20"), 10) || 20, 100);
  // Return reflection-type memories as a cross-session summary
  const recentMems = store
    .getContextMemories(undefined, limit)
    .filter((m) => m.memory_type === "reflection");
  res.json(recentMems);
});

// ── Workflow Templates ─────────────────────────────────────────────────────

/** GET /api/agent/workflows?limit=50&public=true */
router.get("/workflows", (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit || "50"), 10) || 50, 200);
  const publicOnly = req.query.public === "true";
  const workflows = publicOnly ? store.getPublicWorkflows(limit) : store.getAllWorkflows(limit);
  res.json(workflows);
});

/** POST /api/agent/workflows */
router.post("/workflows", (req, res) => {
  const { name, description, template, accountId, tags, isPublic } = req.body || {};
  if (!name || typeof name !== "string") {
    res.status(400).json({ error: "name is required" });
    return;
  }
  if (!template || typeof template !== "string") {
    res.status(400).json({ error: "template is required (JSON string)" });
    return;
  }
  const workflow = store.createWorkflow({
    name,
    description,
    template,
    accountId,
    tags: Array.isArray(tags) ? tags : undefined,
    isPublic: Boolean(isPublic),
  });
  res.status(201).json(workflow);
});

/** GET /api/agent/workflows/:id */
router.get("/workflows/:id", (req, res) => {
  const workflow = store.getWorkflow(req.params.id);
  if (!workflow) {
    res.status(404).json({ error: "Workflow not found" });
    return;
  }
  res.json(workflow);
});

/** PUT /api/agent/workflows/:id */
router.put("/workflows/:id", (req, res) => {
  const existing = store.getWorkflow(req.params.id);
  if (!existing) {
    res.status(404).json({ error: "Workflow not found" });
    return;
  }
  const { name, description, template, accountId, tags, isPublic } = req.body || {};
  if (!name || typeof name !== "string") {
    res.status(400).json({ error: "name is required" });
    return;
  }
  if (!template || typeof template !== "string") {
    res.status(400).json({ error: "template is required" });
    return;
  }
  store.updateWorkflow(req.params.id, {
    name,
    description,
    template,
    accountId,
    tags: Array.isArray(tags) ? tags : undefined,
    isPublic: Boolean(isPublic),
  });
  res.json(store.getWorkflow(req.params.id));
});

/** DELETE /api/agent/workflows/:id */
router.delete("/workflows/:id", (req, res) => {
  const deleted = store.deleteWorkflow(req.params.id);
  res.json({ deleted });
});

// ── Matrix Run — parallel multi-account goal execution ─────────────────────

/**
 * POST /api/agent/matrix-run
 *
 * Forks a goal description across multiple accounts, creating one orchestrator
 * run per account. Returns the list of goal IDs so clients can track progress.
 *
 * Body: { description: string, accountIds?: string[] }
 */
router.post("/matrix-run", async (req, res) => {
  const { description, accountIds } = req.body || {};
  if (!description || typeof description !== "string") {
    res.status(400).json({ error: "description is required" });
    return;
  }

  // If no accountIds provided, use all accounts
  const accounts = store.getAllAccounts();
  const allTargets: string[] =
    Array.isArray(accountIds) && accountIds.length > 0
      ? (accountIds as string[]).filter((id) => accounts.some((a) => a.id === id))
      : accounts.map((a) => a.id);

  if (allTargets.length === 0) {
    res.status(400).json({ error: "No valid accounts found for matrix run" });
    return;
  }

  // Cap at available orchestrator slots to avoid MAX_CONCURRENT race
  const activeRuns = orchestrator.getActiveRuns().length;
  const MAX_CONCURRENT = 5;
  const available = Math.max(0, MAX_CONCURRENT - activeRuns);
  const targets = allTargets.slice(0, available);

  if (targets.length === 0) {
    res.status(429).json({ error: "Orchestrator at capacity — all slots occupied" });
    return;
  }

  const results: { accountId: string; goalId: string }[] = [];
  const errors: { accountId: string; error: string }[] = [];

  // Sequential launch to avoid TOCTOU race on MAX_CONCURRENT slot check
  for (const accountId of targets) {
    try {
      const goalId = await orchestrator.runGoal({
        description: `[Matrix] ${description}`,
        accountId,
      });
      results.push({ accountId, goalId });
    } catch (err) {
      errors.push({ accountId, error: (err as Error).message });
    }
  }

  res.status(202).json({
    launched: results.length,
    errors: errors.length,
    goals: results,
    ...(errors.length > 0 ? { failures: errors } : {}),
  });
});

export default router;
