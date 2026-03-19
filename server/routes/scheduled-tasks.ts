import { Router } from "express";
import cron from "node-cron";
import store from "../db.js";
import type { TaskScheduler } from "../services/scheduler.js";

let scheduler: TaskScheduler | null = null;

/** Must be called once from server.ts to inject the scheduler instance */
export function setScheduler(s: TaskScheduler) {
  scheduler = s;
}

const router = Router();

// Get all recent executions (must be before /:id to avoid param capture)
router.get("/executions/recent", (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const executions = store.getRecentExecutions(limit);
  res.json(executions);
});

// List all scheduled tasks
router.get("/", (_req, res) => {
  const tasks = store.getAllScheduledTasks();
  res.json(tasks);
});

// Create a new scheduled task
router.post("/", (req, res) => {
  const { name, account_id, prompt_template, schedule, timezone, enabled, min_score, max_retries, timeout_ms, auto_publish } = req.body || {};

  if (!name || !account_id || !prompt_template || !schedule) {
    return res.status(400).json({ error: "name, account_id, prompt_template, and schedule are required" });
  }

  if (!cron.validate(schedule)) {
    return res.status(400).json({ error: `Invalid cron expression: ${schedule}` });
  }

  const account = store.getAccount(account_id);
  if (!account) {
    return res.status(400).json({ error: `Account ${account_id} not found` });
  }

  const task = store.createScheduledTask({
    name, account_id, prompt_template, schedule,
    timezone, enabled, min_score, max_retries, timeout_ms, auto_publish,
  });

  // Register cron job if enabled
  if (scheduler && task.enabled) {
    scheduler.registerJob(task);
  }

  res.status(201).json(task);
});

// Get single task
router.get("/:id", (req, res) => {
  const task = store.getScheduledTask(req.params.id);
  if (!task) {
    return res.status(404).json({ error: "Task not found" });
  }
  res.json(task);
});

// Update task
router.put("/:id", (req, res) => {
  const existing = store.getScheduledTask(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: "Task not found" });
  }

  const { name, account_id, prompt_template, schedule, timezone, enabled, min_score, max_retries, timeout_ms, auto_publish } = req.body || {};

  const newSchedule = schedule ?? existing.schedule;
  if (!cron.validate(newSchedule)) {
    return res.status(400).json({ error: `Invalid cron expression: ${newSchedule}` });
  }

  if (account_id && !store.getAccount(account_id)) {
    return res.status(400).json({ error: `Account ${account_id} not found` });
  }

  store.updateScheduledTask(req.params.id, {
    name: name ?? existing.name,
    account_id: account_id ?? existing.account_id,
    prompt_template: prompt_template ?? existing.prompt_template,
    schedule: newSchedule,
    timezone: timezone ?? existing.timezone,
    enabled: enabled !== undefined ? (enabled ? 1 : 0) : existing.enabled,
    min_score: min_score ?? existing.min_score,
    max_retries: max_retries ?? existing.max_retries,
    timeout_ms: timeout_ms ?? existing.timeout_ms,
    auto_publish: auto_publish !== undefined ? (auto_publish ? 1 : 0) : existing.auto_publish,
  });

  const updated = store.getScheduledTask(req.params.id)!;

  // Re-register cron job
  if (scheduler) {
    scheduler.registerJob(updated);
  }

  res.json(updated);
});

// Delete task
router.delete("/:id", (req, res) => {
  if (scheduler) {
    scheduler.unregisterJob(req.params.id);
  }
  const deleted = store.deleteScheduledTask(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: "Task not found" });
  }
  res.json({ success: true });
});

// Toggle enabled/disabled
router.patch("/:id/toggle", (req, res) => {
  const existing = store.getScheduledTask(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: "Task not found" });
  }

  const newEnabled = existing.enabled ? 0 : 1;
  store.toggleScheduledTask(req.params.id, newEnabled);

  const updated = store.getScheduledTask(req.params.id)!;

  if (scheduler) {
    if (updated.enabled) {
      scheduler.registerJob(updated);
    } else {
      scheduler.unregisterJob(req.params.id);
    }
  }

  res.json(updated);
});

// Manual trigger — run now
router.post("/:id/run", async (req, res) => {
  const task = store.getScheduledTask(req.params.id);
  if (!task) {
    return res.status(404).json({ error: "Task not found" });
  }

  if (!scheduler) {
    return res.status(503).json({ error: "Scheduler not initialized" });
  }

  if (scheduler.isTaskRunning(task.id)) {
    return res.status(409).json({ error: "Task is already running" });
  }

  // Start execution in background, return immediately
  const account = store.getAccount(task.account_id);
  if (!account) {
    return res.status(400).json({ error: `Account ${task.account_id} not found` });
  }

  // Return quickly with a pending execution
  res.json({ message: "Task execution started", task_id: task.id });

  // Execute in background
  scheduler.executeTask(task.id, "manual").catch((err) => {
    console.error(`[Scheduler] Manual run failed for task ${task.id}:`, err);
  });
});

// Get executions for a specific task
router.get("/:id/executions", (req, res) => {
  const task = store.getScheduledTask(req.params.id);
  if (!task) {
    return res.status(404).json({ error: "Task not found" });
  }
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const executions = store.getExecutionsByTask(req.params.id, limit);
  res.json(executions);
});

export default router;
