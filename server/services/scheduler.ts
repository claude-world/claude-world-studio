import * as cron from "node-cron";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { buildMcpServers, getSettings } from "../mcp-config.js";
import { createStudioMcpServer } from "./studio-mcp.js";
import { memoryService } from "./memory-service.js";
import store from "../db.js";
import { logger } from "../logger.js";
import type {
  ScheduledTask,
  TaskExecution,
  SocialAccount,
  Language,
  TaskTrigger,
} from "../types.js";

// ---------------------------------------------------------------------------
// Template variable resolution
// ---------------------------------------------------------------------------

function resolveTemplate(template: string, account: SocialAccount, task: ScheduledTask): string {
  const now = new Date();
  const localDate = now.toLocaleDateString("en-CA", { timeZone: task.timezone }); // YYYY-MM-DD
  const dayOfWeek = now.toLocaleDateString("en-US", { timeZone: task.timezone, weekday: "long" });

  return template
    .replace(/\{\{account_name\}\}/g, account.name)
    .replace(/\{\{account_handle\}\}/g, account.handle)
    .replace(/\{\{date\}\}/g, now.toISOString().split("T")[0])
    .replace(/\{\{date_local\}\}/g, localDate)
    .replace(/\{\{day_of_week\}\}/g, dayOfWeek)
    .replace(/\{\{language\}\}/g, getSettings().language || "zh-TW")
    .replace(/\{\{platform\}\}/g, account.platform);
}

// ---------------------------------------------------------------------------
// Task-specific system prompt (streamlined for unattended execution)
// ---------------------------------------------------------------------------

function buildTaskSystemPrompt(
  account: SocialAccount,
  task: ScheduledTask,
  pastLessons?: string
): string {
  const settings = getSettings();
  const lang = (settings.language || "zh-TW") as Language;

  const LANG_RULES: Record<Language, string> = {
    "zh-TW":
      "你必須使用繁體中文（台灣用語）產出所有內容。禁止簡體中文和 AI 套話（在當今/隨著/值得注意）。",
    en: "You must produce all content in English.",
    ja: "すべてのコンテンツを日本語で作成してください。",
  };

  const pastLessonsBlock = pastLessons
    ? `\n## Past Lessons (from memory)\n${pastLessons}\n\nApply these lessons to improve your output.\n`
    : "";

  return `${LANG_RULES[lang]}
${pastLessonsBlock}
You are an automated content pipeline executing a scheduled task. Work autonomously — no user interaction.

## MCP Tools Available
- **trend-pulse**: get_trending(sources="", geo, count=20), search_trends, get_content_brief, get_scoring_guide, get_review_checklist, get_platform_specs
- **cf-browser**: browser_markdown(url) for deep-reading sources
- **studio**: publish_to_threads(text, account_id, score, image_url?, poll_options?, link_comment?, tag?)

## Target Account
- ID: ${account.id}
- Name: ${account.name}
- Handle: ${account.handle}
- Platform: ${account.platform}
- Style: ${account.style || "none"}
- Persona: ${account.persona_prompt || "none"}

## Quality Requirements
- Min score: ${task.min_score}
- Conversation Durability >= ${settings.minConversationScore || 55}
- All facts must have verified timestamps (discard >48h old)
- Read at least 1 primary source via browser_markdown before writing
- Hook: 10-45 chars with number or contrast
- CTA: clear question or poll

## Meta Patent-Based Scoring (5 dimensions)
1. Hook Power (25%) — first line has number or contrast
2. Engagement Trigger (25%) — CTA anyone can answer
3. Conversation Durability (20%) — has contrast/both sides
4. Velocity Potential (15%) — timely + short (50-300 chars)
5. Format Score (15%) — mobile-scannable, no text walls

## Output Format
After completing the pipeline, output a JSON block between markers:

---TASK_RESULT---
{
  "content": "the final post content",
  "score": 85,
  "score_breakdown": {
    "hook_power": 22,
    "engagement_trigger": 20,
    "conversation_durability": 18,
    "velocity_potential": 13,
    "format_score": 12
  },
  "published": true,
  "publish_url": "https://...",
  "topic": "topic summary"
}
---END_TASK_RESULT---

## Pipeline
1. Discover trends: get_trending(sources="", geo="TW", count=20)
2. Pick best topic for this account's style
3. Read source: browser_markdown(url) — MANDATORY
4. Get brief: get_content_brief(topic)
5. Write content following Meta patent dimensions
6. Self-score using get_scoring_guide
7. If score >= ${task.min_score}: ${task.auto_publish ? "publish via studio tool" : "output as draft (do NOT publish)"}
8. If score < ${task.min_score}: note rejection, do NOT publish
9. Output the ---TASK_RESULT--- JSON block

Current date: ${new Date().toISOString().split("T")[0]}
`;
}

// ---------------------------------------------------------------------------
// Parse structured output from agent response
// ---------------------------------------------------------------------------

interface TaskResult {
  content?: string;
  score?: number;
  score_breakdown?: Record<string, number>;
  published?: boolean;
  publish_url?: string;
  topic?: string;
}

function parseTaskResult(fullOutput: string): TaskResult | null {
  const match = fullOutput.match(/---TASK_RESULT---\s*([\s\S]*?)\s*---END_TASK_RESULT---/);
  if (!match) {
    logger.warn("Scheduler", "No ---TASK_RESULT--- block found in agent output", {
      outputLength: String(fullOutput.length),
      tail: fullOutput.slice(-200),
    });
    return null;
  }
  try {
    return JSON.parse(match[1]);
  } catch (err) {
    logger.error("Scheduler", "Failed to parse TASK_RESULT JSON", err);
    logger.debug("Scheduler", "Raw JSON block", { raw: match[1].slice(0, 500) });
    return null;
  }
}

// ---------------------------------------------------------------------------
// TaskScheduler — core scheduling engine
// ---------------------------------------------------------------------------

export class TaskScheduler {
  private jobs = new Map<string, cron.ScheduledTask>();
  private runningTasks = new Set<string>(); // overlap guard by task_id
  private runningAbortControllers = new Map<string, AbortController>();
  private runningQueryHandles = new Map<string, ReturnType<typeof query>>();
  private stopped = false;

  constructor() {
    // Mark stale executions from previous server run
    const result = store.markStaleExecutionsFailed();
    if (result.changes > 0) {
      logger.info("Scheduler", `Marked ${result.changes} stale execution(s) as failed`);
    }
  }

  /** Load all enabled tasks and register cron jobs */
  start() {
    const tasks = store.getEnabledScheduledTasks();
    for (const task of tasks) {
      this.registerJob(task);
    }
    logger.info("Scheduler", `Started with ${tasks.length} enabled task(s)`);
  }

  /** Stop all cron jobs and abort running tasks */
  stop() {
    this.stopped = true;
    for (const [id, job] of this.jobs) {
      job.stop();
    }
    this.jobs.clear();
    // Abort all running agent sessions and close query handles
    for (const [id, controller] of this.runningAbortControllers) {
      controller.abort();
    }
    this.runningAbortControllers.clear();
    for (const [id, handle] of this.runningQueryHandles) {
      handle.close();
    }
    this.runningQueryHandles.clear();
    logger.info("Scheduler", "Stopped all jobs and aborted running tasks");
  }

  /** Register or re-register a cron job for a task */
  registerJob(task: ScheduledTask) {
    // Remove existing job if any
    this.unregisterJob(task.id);

    if (!task.enabled) return;

    if (!cron.validate(task.schedule)) {
      logger.error("Scheduler", `Invalid cron expression for task ${task.id}: ${task.schedule}`);
      return;
    }

    const job = cron.schedule(
      task.schedule,
      () => {
        this.executeTask(task.id, "schedule").catch((err) => {
          logger.error("Scheduler", `Error executing task ${task.id}`, err);
        });
      },
      {
        timezone: task.timezone,
      }
    );

    this.jobs.set(task.id, job);
    logger.info(
      "Scheduler",
      `Registered job for "${task.name}" (${task.schedule} ${task.timezone})`
    );
  }

  /** Unregister a cron job */
  unregisterJob(taskId: string) {
    const existing = this.jobs.get(taskId);
    if (existing) {
      existing.stop();
      this.jobs.delete(taskId);
    }
  }

  /** Execute a task (called by cron tick or manual trigger) */
  async executeTask(
    taskId: string,
    triggeredBy: TaskTrigger,
    retryCount = 0
  ): Promise<TaskExecution> {
    if (this.stopped) throw new Error("Scheduler is stopped");

    const task = store.getScheduledTask(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    const account = store.getAccount(task.account_id);
    if (!account) throw new Error(`Account ${task.account_id} not found for task ${taskId}`);

    // Overlap guard
    if (this.runningTasks.has(taskId)) {
      throw new Error(`Task ${taskId} is already running — skipping`);
    }

    this.runningTasks.add(taskId);
    const startTime = Date.now();

    // Resolve template
    const prompt = resolveTemplate(task.prompt_template, account, task);

    // Create execution record
    const execution = store.createExecution({
      task_id: taskId,
      account_id: task.account_id,
      prompt,
      triggered_by: triggeredBy,
    });

    logger.info(
      "Scheduler",
      `Starting execution ${execution.id} for task "${task.name}" (${triggeredBy})`
    );

    // Load past memories for this task to inject as "Past Lessons"
    const pastMemories = memoryService.searchMemory(task.name, {
      accountId: task.account_id,
      limit: 5,
      skipTouch: true, // automated scheduler call — don't inflate access_count
    });
    const pastLessons =
      pastMemories.length > 0
        ? pastMemories.map((m) => `[${m.memory_type}] ${m.content}`).join("\n")
        : undefined;

    if (pastLessons) {
      logger.info(
        "Scheduler",
        `Task "${task.name}": loaded ${pastMemories.length} past memories for context`
      );
    }

    try {
      const result = await this.runAgentSession(prompt, account, task, pastLessons);
      const durationMs = Date.now() - startTime;

      const taskResult = parseTaskResult(result.fullOutput);
      const score = taskResult?.score ?? null;
      const content = taskResult?.content ?? null;
      const scoreBreakdown = taskResult?.score_breakdown
        ? JSON.stringify(taskResult.score_breakdown)
        : null;

      // Determine status — parsing failure is now "failed", not silently "completed"
      let status: "completed" | "published" | "rejected" | "failed";
      let publishRecordId: string | null = null;

      if (!taskResult) {
        // Agent didn't produce valid ---TASK_RESULT--- block
        status = "failed";
        logger.warn("Scheduler", `Task "${task.name}" failed: no valid TASK_RESULT block`);
      } else if (score !== null && score < task.min_score) {
        status = "rejected";
        logger.info(
          "Scheduler",
          `Task "${task.name}" rejected: score ${score} < min ${task.min_score}`
        );
      } else if (taskResult.published && !task.auto_publish) {
        // Agent published when auto_publish is off — flag as anomaly
        status = "published";
        logger.warn(
          "Scheduler",
          `Task "${task.name}" published despite auto_publish=off (score ${score})`
        );
      } else if (taskResult.published) {
        status = "published";
        logger.info("Scheduler", `Task "${task.name}" published with score ${score}`);
      } else {
        status = "completed";
        logger.info("Scheduler", `Task "${task.name}" completed with score ${score}`);
      }

      store.updateExecutionResult(execution.id, {
        status,
        // Store parsed content if available, otherwise truncated raw output for audit
        content: content || result.fullOutput.slice(0, 10_000),
        score,
        score_breakdown: scoreBreakdown,
        cost_usd: result.costUsd,
        duration_ms: durationMs,
        publish_record_id: publishRecordId,
        error: !taskResult ? "No valid TASK_RESULT block in agent output" : undefined,
      });

      // Save outcome as memory for future self-improvement
      // Policy violations (published despite auto_publish=off) count as failure to prevent reinforcement
      const isAnomaly = taskResult?.published && !task.auto_publish;
      const memType =
        status === "failed" || status === "rejected" || isAnomaly ? "failure" : "success";
      memoryService.saveMemory({
        accountId: task.account_id,
        content: `Task "${task.name}" ${status}: score ${score ?? "n/a"}. Topic: ${taskResult?.topic || "unknown"}. Duration: ${Math.round(durationMs / 1000)}s.`,
        tags: ["scheduler", status, task.name],
        memoryType: memType,
      });

      return store.getExecution(execution.id) as TaskExecution;
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error("Scheduler", `Task "${task.name}" failed (attempt ${retryCount + 1})`, err);

      // Retry logic (skip if scheduler is stopping)
      if (!this.stopped && retryCount < task.max_retries) {
        logger.info(
          "Scheduler",
          `Retrying task "${task.name}" in 30s (${retryCount + 1}/${task.max_retries})`
        );
        store.updateExecutionResult(execution.id, {
          status: "failed",
          error: `${errorMsg} (retrying...)`,
          duration_ms: durationMs,
          retry_count: retryCount + 1,
        });
        // Keep taskId in runningTasks during backoff to prevent concurrent execution
        await new Promise((r) => setTimeout(r, 30000));
        // Re-check after sleep — stop() may have been called during the 30s wait
        if (this.stopped) {
          store.updateExecutionResult(execution.id, {
            status: "failed",
            error: "Scheduler stopped during retry wait",
            duration_ms: Date.now() - startTime,
            retry_count: retryCount + 1,
          });
          return store.getExecution(execution.id) as TaskExecution;
        }
        // Release before recursive call (which re-acquires the guard)
        this.runningTasks.delete(taskId);
        return this.executeTask(taskId, triggeredBy, retryCount + 1);
      }

      store.updateExecutionResult(execution.id, {
        status: "failed",
        error: errorMsg,
        duration_ms: durationMs,
        retry_count: retryCount,
      });

      return store.getExecution(execution.id) as TaskExecution;
    } finally {
      this.runningTasks.delete(taskId);
    }
  }

  /** Run an ephemeral AgentSession and collect output */
  private async runAgentSession(
    prompt: string,
    account: SocialAccount,
    task: ScheduledTask,
    pastLessons?: string
  ): Promise<{ fullOutput: string; costUsd: number | null }> {
    const settings = getSettings();
    const mcpServers = buildMcpServers(settings);
    const cwd = settings.defaultWorkspace || process.cwd();
    const studioServer = createStudioMcpServer();

    const allMcpServers: Record<string, any> = { ...mcpServers, studio: studioServer };
    const allowedTools = ["WebSearch", "WebFetch"];
    for (const name of Object.keys(allMcpServers)) {
      allowedTools.push(`mcp__${name}`);
    }

    const abortController = new AbortController();
    this.runningAbortControllers.set(task.id, abortController);

    // Timeout
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, task.timeout_ms);

    const systemPrompt = buildTaskSystemPrompt(account, task, pastLessons);

    try {
      let fullOutput = "";
      let costUsd: number | null = null;

      const outputStream = query({
        prompt: prompt,
        options: {
          maxTurns: 50,
          model: "sonnet",
          permissionMode: "bypassPermissions",
          // SDK 0.2 requires this flag alongside permissionMode: "bypassPermissions"
          allowDangerouslySkipPermissions: true,
          abortController,
          systemPrompt,
          cwd,
          allowedTools,
          disallowedTools: [
            "mcp__trend-pulse__publish_to_threads",
            "mcp__trend-pulse__get_publish_history",
          ],
          mcpServers: allMcpServers,
          executable: (process.env.STUDIO_NODE_PATH || process.execPath) as any,
        },
      });
      // Store query handle so stop() can call .close() to terminate the subprocess
      this.runningQueryHandles.set(task.id, outputStream);

      for await (const message of outputStream) {
        if (message.type === "assistant") {
          const content = message.message?.content;
          if (typeof content === "string") {
            fullOutput += content + "\n";
          } else if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === "text" && block.text) {
                fullOutput += block.text + "\n";
              }
            }
          }
        } else if (message.type === "result") {
          costUsd = message.total_cost_usd ?? null;
        }
      }

      return { fullOutput, costUsd };
    } finally {
      clearTimeout(timeoutId);
      this.runningAbortControllers.delete(task.id);
      this.runningQueryHandles.delete(task.id);
    }
  }

  /** Check if a task is currently running */
  isTaskRunning(taskId: string): boolean {
    return this.runningTasks.has(taskId);
  }
}
