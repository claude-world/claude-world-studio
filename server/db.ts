import Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import { fileURLToPath } from "url";
import type { Session, Message, PublishRecord, SocialAccount, ScheduledTask, TaskExecution, TaskExecutionStatus, TaskTrigger } from "./types.js";

import { existsSync, mkdirSync, copyFileSync } from "fs";
import { homedir } from "os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In packaged Electron app, store DB in user data dir (survives reinstalls).
// In dev mode, use project-local data/.
function resolveDbPath(): string {
  const localPath = path.join(__dirname, "../data/studio.db");

  // Detect Electron packaged app (asar in path)
  if (__dirname.includes("app.asar")) {
    const userDataDir = path.join(homedir(), "Library", "Application Support", "Claude World Studio");
    if (!existsSync(userDataDir)) mkdirSync(userDataDir, { recursive: true });
    const userDbPath = path.join(userDataDir, "studio.db");

    // Migrate: copy bundled DB to user dir on first launch (but don't overwrite existing)
    if (!existsSync(userDbPath)) {
      const bundledDb = localPath.replace("app.asar", "app.asar.unpacked");
      if (existsSync(bundledDb)) {
        copyFileSync(bundledDb, userDbPath);
        console.log(`[DB] Migrated bundled DB to ${userDbPath}`);
      }
    }
    console.log(`[DB] Using user data: ${userDbPath}`);
    return userDbPath;
  }

  return localPath;
}

const DB_PATH = resolveDbPath();

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma("journal_mode = WAL");

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT 'New Session',
    workspace_path TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    status TEXT DEFAULT 'active'
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT,
    tool_name TEXT,
    tool_id TEXT,
    tool_input TEXT,
    cost_usd REAL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS publish_history (
    id TEXT PRIMARY KEY,
    session_id TEXT REFERENCES sessions(id),
    platform TEXT NOT NULL,
    account TEXT NOT NULL,
    content TEXT NOT NULL,
    post_id TEXT,
    post_url TEXT,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS social_accounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    handle TEXT NOT NULL,
    platform TEXT NOT NULL,
    token TEXT NOT NULL DEFAULT '',
    user_id TEXT NOT NULL DEFAULT '',
    style TEXT NOT NULL DEFAULT '',
    persona_prompt TEXT NOT NULL DEFAULT '',
    auto_publish INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS scheduled_tasks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    account_id TEXT NOT NULL REFERENCES social_accounts(id),
    prompt_template TEXT NOT NULL,
    schedule TEXT NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'Asia/Taipei',
    enabled INTEGER NOT NULL DEFAULT 1,
    min_score INTEGER NOT NULL DEFAULT 80,
    max_retries INTEGER NOT NULL DEFAULT 2,
    timeout_ms INTEGER NOT NULL DEFAULT 300000,
    auto_publish INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS task_executions (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    prompt TEXT NOT NULL,
    content TEXT,
    score REAL,
    score_breakdown TEXT,
    cost_usd REAL,
    duration_ms INTEGER,
    publish_record_id TEXT,
    error TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    triggered_by TEXT NOT NULL DEFAULT 'schedule',
    started_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT
  );
`);

// Performance indices for scheduled tasks
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_enabled ON scheduled_tasks(enabled);
  CREATE INDEX IF NOT EXISTS idx_task_executions_task_id ON task_executions(task_id);
  CREATE INDEX IF NOT EXISTS idx_task_executions_status ON task_executions(status);
`);

// Migrations for existing databases
try { db.exec(`ALTER TABLE social_accounts ADD COLUMN auto_publish INTEGER NOT NULL DEFAULT 0`); } catch { /* column already exists */ }
try { db.exec(`ALTER TABLE publish_history ADD COLUMN image_url TEXT`); } catch { /* column already exists */ }

// Performance indices
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_social_accounts_platform ON social_accounts(platform);
  CREATE INDEX IF NOT EXISTS idx_publish_history_account ON publish_history(account);
  CREATE INDEX IF NOT EXISTS idx_publish_history_status ON publish_history(status);
`);

// Social accounts are configured via the Settings UI — no hardcoded accounts.

// Prepared statements
const stmts = {
  // Sessions
  createSession: db.prepare(
    `INSERT INTO sessions (id, title, workspace_path) VALUES (?, ?, ?)`
  ),
  getSession: db.prepare(`SELECT * FROM sessions WHERE id = ? AND status = 'active'`),
  getAllSessions: db.prepare(
    `SELECT * FROM sessions WHERE status = 'active' ORDER BY updated_at DESC`
  ),
  updateSessionTitle: db.prepare(
    `UPDATE sessions SET title = ?, updated_at = datetime('now') WHERE id = ?`
  ),
  updateSessionTimestamp: db.prepare(
    `UPDATE sessions SET updated_at = datetime('now') WHERE id = ?`
  ),
  deleteSession: db.prepare(
    `UPDATE sessions SET status = 'deleted', updated_at = datetime('now') WHERE id = ?`
  ),

  // Messages
  addMessage: db.prepare(
    `INSERT INTO messages (id, session_id, role, content, tool_name, tool_id, tool_input, cost_usd)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  getMessages: db.prepare(
    `SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC`
  ),

  // Settings
  getSetting: db.prepare(`SELECT value FROM settings WHERE key = ?`),
  setSetting: db.prepare(
    `INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`
  ),
  getAllSettings: db.prepare(`SELECT * FROM settings`),

  // Publish History
  addPublish: db.prepare(
    `INSERT INTO publish_history (id, session_id, platform, account, content, image_url, post_id, post_url, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  getPublishHistory: db.prepare(
    `SELECT * FROM publish_history ORDER BY created_at DESC LIMIT ?`
  ),
  getPublishByAccount: db.prepare(
    `SELECT * FROM publish_history WHERE account = ? ORDER BY created_at DESC LIMIT ?`
  ),
  getPublishById: db.prepare(
    `SELECT * FROM publish_history WHERE id = ?`
  ),
  getPendingPosts: db.prepare(
    `SELECT * FROM publish_history WHERE status = 'draft' ORDER BY created_at ASC`
  ),
  updatePublishStatus: db.prepare(
    `UPDATE publish_history SET status = ?, post_id = ?, post_url = ? WHERE id = ?`
  ),

  // Social Accounts
  createAccount: db.prepare(
    `INSERT INTO social_accounts (id, name, handle, platform, token, user_id, style, persona_prompt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  getAccount: db.prepare(`SELECT * FROM social_accounts WHERE id = ?`),
  getAllAccounts: db.prepare(`SELECT * FROM social_accounts ORDER BY created_at ASC`),
  getAccountsByPlatform: db.prepare(`SELECT * FROM social_accounts WHERE platform = ? ORDER BY created_at ASC`),
  updateAccount: db.prepare(
    `UPDATE social_accounts SET name = ?, handle = ?, platform = ?, user_id = ?, style = ?, persona_prompt = ?, auto_publish = ? WHERE id = ?`
  ),
  updateAccountToken: db.prepare(
    `UPDATE social_accounts SET token = ? WHERE id = ?`
  ),
  deleteAccount: db.prepare(`DELETE FROM social_accounts WHERE id = ?`),

  // Scheduled Tasks
  createScheduledTask: db.prepare(
    `INSERT INTO scheduled_tasks (id, name, account_id, prompt_template, schedule, timezone, enabled, min_score, max_retries, timeout_ms, auto_publish)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  getScheduledTask: db.prepare(`SELECT * FROM scheduled_tasks WHERE id = ?`),
  getAllScheduledTasks: db.prepare(`SELECT * FROM scheduled_tasks ORDER BY created_at DESC`),
  getEnabledScheduledTasks: db.prepare(`SELECT * FROM scheduled_tasks WHERE enabled = 1 ORDER BY created_at ASC`),
  updateScheduledTask: db.prepare(
    `UPDATE scheduled_tasks SET name = ?, account_id = ?, prompt_template = ?, schedule = ?, timezone = ?, enabled = ?, min_score = ?, max_retries = ?, timeout_ms = ?, auto_publish = ?, updated_at = datetime('now') WHERE id = ?`
  ),
  toggleScheduledTask: db.prepare(
    `UPDATE scheduled_tasks SET enabled = ?, updated_at = datetime('now') WHERE id = ?`
  ),
  deleteScheduledTask: db.prepare(`DELETE FROM scheduled_tasks WHERE id = ?`),

  // Task Executions
  createExecution: db.prepare(
    `INSERT INTO task_executions (id, task_id, account_id, status, prompt, triggered_by)
     VALUES (?, ?, ?, 'running', ?, ?)`
  ),
  getExecution: db.prepare(`SELECT * FROM task_executions WHERE id = ?`),
  getExecutionsByTask: db.prepare(
    `SELECT * FROM task_executions WHERE task_id = ? ORDER BY started_at DESC LIMIT ?`
  ),
  getRecentExecutions: db.prepare(
    `SELECT * FROM task_executions ORDER BY started_at DESC LIMIT ?`
  ),
  getRunningExecutions: db.prepare(
    `SELECT * FROM task_executions WHERE status = 'running'`
  ),
  getRunningExecutionsByTask: db.prepare(
    `SELECT * FROM task_executions WHERE task_id = ? AND status = 'running'`
  ),
  updateExecutionStatus: db.prepare(
    `UPDATE task_executions SET status = ?, completed_at = datetime('now') WHERE id = ?`
  ),
  updateExecutionResult: db.prepare(
    `UPDATE task_executions SET status = ?, content = ?, score = ?, score_breakdown = ?, cost_usd = ?, duration_ms = ?, publish_record_id = ?, error = ?, retry_count = ?, completed_at = datetime('now') WHERE id = ?`
  ),
  markStaleExecutionsFailed: db.prepare(
    `UPDATE task_executions SET status = 'failed', error = 'Server restarted while execution was running', completed_at = datetime('now') WHERE status = 'running'`
  ),
};

export const store = {
  // Sessions
  createSession(title?: string, workspacePath?: string): Session {
    const id = uuidv4();
    const ws = workspacePath || process.env.DEFAULT_WORKSPACE || process.cwd();
    stmts.createSession.run(id, title || "New Session", ws);
    return stmts.getSession.get(id) as Session;
  },

  getSession(id: string): Session | undefined {
    return stmts.getSession.get(id) as Session | undefined;
  },

  getAllSessions(): Session[] {
    return stmts.getAllSessions.all() as Session[];
  },

  updateSessionTitle(id: string, title: string) {
    stmts.updateSessionTitle.run(title, id);
  },

  deleteSession(id: string): boolean {
    const result = stmts.deleteSession.run(id);
    return result.changes > 0;
  },

  // Messages
  addMessage(
    sessionId: string,
    msg: {
      role: string;
      content?: string | null;
      tool_name?: string | null;
      tool_id?: string | null;
      tool_input?: string | null;
      cost_usd?: number | null;
    }
  ): Message {
    const id = uuidv4();
    stmts.addMessage.run(
      id, sessionId, msg.role,
      msg.content ?? null, msg.tool_name ?? null,
      msg.tool_id ?? null, msg.tool_input ?? null,
      msg.cost_usd ?? null
    );
    stmts.updateSessionTimestamp.run(sessionId);

    // Auto-generate title from first user message
    const session = stmts.getSession.get(sessionId) as Session | undefined;
    if (session && session.title === "New Session" && msg.role === "user" && msg.content) {
      const title = msg.content.slice(0, 50) + (msg.content.length > 50 ? "..." : "");
      stmts.updateSessionTitle.run(title, sessionId);
    }

    return {
      id,
      session_id: sessionId,
      role: msg.role as Message["role"],
      content: msg.content ?? null,
      tool_name: msg.tool_name ?? null,
      tool_id: msg.tool_id ?? null,
      tool_input: msg.tool_input ?? null,
      cost_usd: msg.cost_usd ?? null,
      created_at: new Date().toISOString(),
    };
  },

  getMessages(sessionId: string): Message[] {
    return stmts.getMessages.all(sessionId) as Message[];
  },

  // Settings
  getSetting(key: string): string | undefined {
    const row = stmts.getSetting.get(key) as { value: string } | undefined;
    return row?.value;
  },

  setSetting(key: string, value: string) {
    stmts.setSetting.run(key, value);
  },

  getAllSettings(): Record<string, string> {
    const rows = stmts.getAllSettings.all() as { key: string; value: string }[];
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  },

  // Publish History
  addPublish(record: Omit<PublishRecord, "id" | "created_at">): PublishRecord {
    const id = uuidv4();
    stmts.addPublish.run(
      id, record.session_id, record.platform, record.account,
      record.content, record.image_url ?? null, record.post_id, record.post_url, record.status
    );
    return { id, created_at: new Date().toISOString(), ...record };
  },

  getPublishHistory(limit = 50): PublishRecord[] {
    return stmts.getPublishHistory.all(limit) as PublishRecord[];
  },

  getPublishByAccount(accountId: string, limit = 100): PublishRecord[] {
    return stmts.getPublishByAccount.all(accountId, limit) as PublishRecord[];
  },

  getPublishById(id: string): PublishRecord | undefined {
    return stmts.getPublishById.get(id) as PublishRecord | undefined;
  },

  getPendingPosts(): PublishRecord[] {
    return stmts.getPendingPosts.all() as PublishRecord[];
  },

  updatePublishStatus(id: string, status: string, postId?: string, postUrl?: string) {
    stmts.updatePublishStatus.run(status, postId ?? null, postUrl ?? null, id);
  },

  // Social Accounts
  createAccount(data: {
    name: string;
    handle: string;
    platform: string;
    token?: string;
    user_id?: string;
    style?: string;
    persona_prompt?: string;
  }): SocialAccount {
    const id = uuidv4();
    stmts.createAccount.run(
      id, data.name, data.handle, data.platform,
      data.token || "", data.user_id || "",
      data.style || "", data.persona_prompt || ""
    );
    return stmts.getAccount.get(id) as SocialAccount;
  },

  getAccount(id: string): SocialAccount | undefined {
    return stmts.getAccount.get(id) as SocialAccount | undefined;
  },

  getAllAccounts(): SocialAccount[] {
    return stmts.getAllAccounts.all() as SocialAccount[];
  },

  getAccountsByPlatform(platform: string): SocialAccount[] {
    return stmts.getAccountsByPlatform.all(platform) as SocialAccount[];
  },

  updateAccount(id: string, data: {
    name: string;
    handle: string;
    platform: string;
    user_id: string;
    style: string;
    persona_prompt: string;
    auto_publish: number;
  }) {
    stmts.updateAccount.run(
      data.name, data.handle, data.platform,
      data.user_id, data.style, data.persona_prompt,
      data.auto_publish, id
    );
  },

  updateAccountToken(id: string, token: string) {
    stmts.updateAccountToken.run(token, id);
  },

  deleteAccount(id: string): boolean {
    const result = stmts.deleteAccount.run(id);
    return result.changes > 0;
  },

  // Scheduled Tasks
  createScheduledTask(data: {
    name: string;
    account_id: string;
    prompt_template: string;
    schedule: string;
    timezone?: string;
    enabled?: number;
    min_score?: number;
    max_retries?: number;
    timeout_ms?: number;
    auto_publish?: number;
  }): ScheduledTask {
    const id = uuidv4();
    stmts.createScheduledTask.run(
      id, data.name, data.account_id, data.prompt_template, data.schedule,
      data.timezone ?? "Asia/Taipei", data.enabled ?? 1, data.min_score ?? 80,
      data.max_retries ?? 2, data.timeout_ms ?? 300000, data.auto_publish ?? 1
    );
    return stmts.getScheduledTask.get(id) as ScheduledTask;
  },

  getScheduledTask(id: string): ScheduledTask | undefined {
    return stmts.getScheduledTask.get(id) as ScheduledTask | undefined;
  },

  getAllScheduledTasks(): ScheduledTask[] {
    return stmts.getAllScheduledTasks.all() as ScheduledTask[];
  },

  getEnabledScheduledTasks(): ScheduledTask[] {
    return stmts.getEnabledScheduledTasks.all() as ScheduledTask[];
  },

  updateScheduledTask(id: string, data: {
    name: string;
    account_id: string;
    prompt_template: string;
    schedule: string;
    timezone: string;
    enabled: number;
    min_score: number;
    max_retries: number;
    timeout_ms: number;
    auto_publish: number;
  }) {
    stmts.updateScheduledTask.run(
      data.name, data.account_id, data.prompt_template, data.schedule,
      data.timezone, data.enabled, data.min_score, data.max_retries,
      data.timeout_ms, data.auto_publish, id
    );
  },

  toggleScheduledTask(id: string, enabled: number) {
    stmts.toggleScheduledTask.run(enabled, id);
  },

  deleteScheduledTask(id: string): boolean {
    const result = stmts.deleteScheduledTask.run(id);
    return result.changes > 0;
  },

  // Task Executions
  createExecution(data: {
    task_id: string;
    account_id: string;
    prompt: string;
    triggered_by: TaskTrigger;
  }): TaskExecution {
    const id = uuidv4();
    stmts.createExecution.run(id, data.task_id, data.account_id, data.prompt, data.triggered_by);
    return stmts.getExecution.get(id) as TaskExecution;
  },

  getExecution(id: string): TaskExecution | undefined {
    return stmts.getExecution.get(id) as TaskExecution | undefined;
  },

  getExecutionsByTask(taskId: string, limit = 50): TaskExecution[] {
    return stmts.getExecutionsByTask.all(taskId, limit) as TaskExecution[];
  },

  getRecentExecutions(limit = 50): TaskExecution[] {
    return stmts.getRecentExecutions.all(limit) as TaskExecution[];
  },

  getRunningExecutions(): TaskExecution[] {
    return stmts.getRunningExecutions.all() as TaskExecution[];
  },

  getRunningExecutionsByTask(taskId: string): TaskExecution[] {
    return stmts.getRunningExecutionsByTask.all(taskId) as TaskExecution[];
  },

  updateExecutionResult(id: string, data: {
    status: TaskExecutionStatus;
    content?: string | null;
    score?: number | null;
    score_breakdown?: string | null;
    cost_usd?: number | null;
    duration_ms?: number | null;
    publish_record_id?: string | null;
    error?: string | null;
    retry_count?: number;
  }) {
    stmts.updateExecutionResult.run(
      data.status, data.content ?? null, data.score ?? null,
      data.score_breakdown ?? null, data.cost_usd ?? null,
      data.duration_ms ?? null, data.publish_record_id ?? null,
      data.error ?? null, data.retry_count ?? 0, id
    );
  },

  markStaleExecutionsFailed() {
    return stmts.markStaleExecutionsFailed.run();
  },
};

export default store;
