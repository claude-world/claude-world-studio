import Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import { fileURLToPath } from "url";
import type {
  Session,
  Message,
  PublishRecord,
  SocialAccount,
  ScheduledTask,
  TaskExecution,
  TaskExecutionStatus,
  TaskTrigger,
  InsightsCache,
  AgentGoal,
  AgentGoalStatus,
  AgentMemory,
  AgentMemoryType,
  AgentReflection,
  ReflectionTrigger,
  AgentWorkflow,
} from "./types.js";

import { existsSync, mkdirSync, copyFileSync } from "fs";
import { homedir } from "os";
import { logger } from "./logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In packaged Electron app, store DB in user data dir (survives reinstalls).
// In dev mode, use project-local data/.
function resolveDbPath(): string {
  const localPath = path.join(__dirname, "../data/studio.db");

  // Detect Electron packaged app (asar in path)
  if (__dirname.includes("app.asar")) {
    const userDataDir = path.join(
      homedir(),
      "Library",
      "Application Support",
      "Claude World Studio"
    );
    if (!existsSync(userDataDir)) mkdirSync(userDataDir, { recursive: true });
    const userDbPath = path.join(userDataDir, "studio.db");

    // Migrate: copy bundled DB to user dir on first launch (but don't overwrite existing)
    if (!existsSync(userDbPath)) {
      const bundledDb = localPath.replace("app.asar", "app.asar.unpacked");
      if (existsSync(bundledDb)) {
        copyFileSync(bundledDb, userDbPath);
        logger.info("DB", `Migrated bundled DB to ${userDbPath}`);
      }
    }
    logger.info("DB", `Using user data: ${userDbPath}`);
    return userDbPath;
  }

  return localPath;
}

const DB_PATH = resolveDbPath();

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma("journal_mode = WAL");

/**
 * Run a function inside a SQLite transaction.
 * Inspired by Claude Code's atomic operation patterns — ensures multi-step
 * DB operations either fully commit or fully rollback.
 *
 * Usage:
 *   const result = transaction(() => {
 *     store.createSession(...);
 *     store.addMessage(...);
 *     return someValue;
 *   });
 */
export function transaction<T>(fn: () => T): T {
  return db.transaction(fn)();
}

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

// Insights cache table
db.exec(`
  CREATE TABLE IF NOT EXISTS post_insights_cache (
    publish_id TEXT PRIMARY KEY REFERENCES publish_history(id),
    views INTEGER NOT NULL DEFAULT 0,
    likes INTEGER NOT NULL DEFAULT 0,
    replies INTEGER NOT NULL DEFAULT 0,
    reposts INTEGER NOT NULL DEFAULT 0,
    quotes INTEGER NOT NULL DEFAULT 0,
    fetched_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_insights_fetched ON post_insights_cache(fetched_at);
`);

// Migrations for existing databases — only suppress "duplicate column" errors
function runMigration(sql: string): void {
  try {
    db.exec(sql);
  } catch (e: any) {
    if (!String(e?.message).includes("duplicate column")) throw e;
  }
}

runMigration(`ALTER TABLE social_accounts ADD COLUMN auto_publish INTEGER NOT NULL DEFAULT 0`);
runMigration(`ALTER TABLE publish_history ADD COLUMN image_url TEXT`);
runMigration(`ALTER TABLE publish_history ADD COLUMN link_comment TEXT`);
runMigration(`ALTER TABLE publish_history ADD COLUMN source_url TEXT`);

// Agentic tables (v2.0)
db.exec(`
  CREATE TABLE IF NOT EXISTS agent_goals (
    id TEXT PRIMARY KEY,
    session_id TEXT REFERENCES sessions(id),
    account_id TEXT REFERENCES social_accounts(id),
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    sub_tasks TEXT,
    progress INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS agent_memories (
    id TEXT PRIMARY KEY,
    goal_id TEXT REFERENCES agent_goals(id),
    account_id TEXT REFERENCES social_accounts(id),
    content TEXT NOT NULL,
    tags TEXT,
    memory_type TEXT NOT NULL DEFAULT 'general',
    relevance_score REAL NOT NULL DEFAULT 1.0,
    created_at TEXT DEFAULT (datetime('now')),
    last_accessed_at TEXT,
    access_count INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS agent_reflections (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    goal_id TEXT REFERENCES agent_goals(id),
    trigger TEXT NOT NULL DEFAULT 'tool_result',
    reflection_content TEXT NOT NULL,
    improvement_notes TEXT,
    score_before REAL,
    score_after REAL,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// FTS5 virtual table for memory full-text search
db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS agent_memories_fts
  USING fts5(content, tags, content='agent_memories', content_rowid='rowid');
`);

// FTS5 sync triggers — keep virtual table in sync with agent_memories
db.exec(`
  CREATE TRIGGER IF NOT EXISTS agent_memories_ai AFTER INSERT ON agent_memories BEGIN
    INSERT INTO agent_memories_fts(rowid, content, tags) VALUES (new.rowid, new.content, COALESCE(new.tags, ''));
  END;
  CREATE TRIGGER IF NOT EXISTS agent_memories_ad AFTER DELETE ON agent_memories BEGIN
    INSERT INTO agent_memories_fts(agent_memories_fts, rowid, content, tags) VALUES ('delete', old.rowid, old.content, COALESCE(old.tags, ''));
  END;
  CREATE TRIGGER IF NOT EXISTS agent_memories_au AFTER UPDATE ON agent_memories BEGIN
    INSERT INTO agent_memories_fts(agent_memories_fts, rowid, content, tags) VALUES ('delete', old.rowid, old.content, COALESCE(old.tags, ''));
    INSERT INTO agent_memories_fts(rowid, content, tags) VALUES (new.rowid, new.content, COALESCE(new.tags, ''));
  END;
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_agent_goals_session ON agent_goals(session_id);
  CREATE INDEX IF NOT EXISTS idx_agent_goals_status ON agent_goals(status);
  CREATE INDEX IF NOT EXISTS idx_agent_memories_account ON agent_memories(account_id);
  CREATE INDEX IF NOT EXISTS idx_agent_memories_type ON agent_memories(memory_type);
  CREATE INDEX IF NOT EXISTS idx_agent_reflections_session ON agent_reflections(session_id);
`);

// Workflow templates (Phase 2+3)
db.exec(`
  CREATE TABLE IF NOT EXISTS agent_workflows (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    template TEXT NOT NULL,
    account_id TEXT REFERENCES social_accounts(id),
    tags TEXT,
    is_public INTEGER NOT NULL DEFAULT 0,
    run_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_agent_workflows_public ON agent_workflows(is_public);
`);

// Performance indices
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_social_accounts_platform ON social_accounts(platform);
  CREATE INDEX IF NOT EXISTS idx_publish_history_account ON publish_history(account);
  CREATE INDEX IF NOT EXISTS idx_publish_history_status ON publish_history(status);
  CREATE INDEX IF NOT EXISTS idx_messages_session_created ON messages(session_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_publish_history_created ON publish_history(created_at);
  CREATE INDEX IF NOT EXISTS idx_publish_history_account_created ON publish_history(account, created_at DESC);
`);

// Social accounts are configured via the Settings UI — no hardcoded accounts.

/**
 * Bounded analytics cache with TTL + LRU eviction.
 *
 * Inspired by Claude Code's LRU cache patterns (memoize.ts, WebFetchTool/utils.ts):
 * - max: 64 entries prevents unbounded growth
 * - TTL: 60s staleness tolerance
 * - Explicit invalidation on writes
 */
const ANALYTICS_CACHE_MAX = 64;
const ANALYTICS_CACHE_TTL = 60_000; // 1 minute

const analyticsCache = new Map<string, { data: unknown; expiry: number }>();

function getCached<T>(key: string, compute: () => T): T {
  const cached = analyticsCache.get(key);
  if (cached && Date.now() < cached.expiry) {
    // Move to end (LRU touch)
    analyticsCache.delete(key);
    analyticsCache.set(key, cached);
    return cached.data as T;
  }
  const data = compute();
  analyticsCache.set(key, { data, expiry: Date.now() + ANALYTICS_CACHE_TTL });
  // Evict oldest if over capacity
  if (analyticsCache.size > ANALYTICS_CACHE_MAX) {
    const oldest = analyticsCache.keys().next().value;
    if (oldest !== undefined) analyticsCache.delete(oldest);
  }
  return data;
}

function invalidateAnalyticsCache(): void {
  analyticsCache.clear();
}

// Prepared statements
const stmts = {
  // Sessions
  createSession: db.prepare(`INSERT INTO sessions (id, title, workspace_path) VALUES (?, ?, ?)`),
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
  getMessages: db.prepare(`SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC`),

  // Settings
  getSetting: db.prepare(`SELECT value FROM settings WHERE key = ?`),
  setSetting: db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`),
  getAllSettings: db.prepare(`SELECT * FROM settings`),

  // Publish History
  addPublish: db.prepare(
    `INSERT INTO publish_history (id, session_id, platform, account, content, image_url, post_id, post_url, status, link_comment, source_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  getPublishHistory: db.prepare(`SELECT * FROM publish_history ORDER BY created_at DESC LIMIT ?`),
  getPublishByAccount: db.prepare(
    `SELECT * FROM publish_history WHERE account = ? ORDER BY created_at DESC LIMIT ?`
  ),
  getPublishById: db.prepare(`SELECT * FROM publish_history WHERE id = ?`),
  getPendingPosts: db.prepare(
    `SELECT * FROM publish_history WHERE status IN ('draft', 'pending') ORDER BY created_at ASC`
  ),
  updatePublishStatus: db.prepare(
    `UPDATE publish_history SET status = ?, post_id = ?, post_url = ? WHERE id = ?`
  ),
  getPostsWithInsights: db.prepare(
    `SELECT p.*, c.views, c.likes, c.replies, c.reposts, c.quotes, c.fetched_at as insights_fetched_at
     FROM publish_history p
     LEFT JOIN post_insights_cache c ON p.id = c.publish_id
     WHERE p.account = ?
     ORDER BY p.created_at DESC LIMIT ?`
  ),
  getAllPostsWithInsights: db.prepare(
    `SELECT p.*, c.views, c.likes, c.replies, c.reposts, c.quotes, c.fetched_at as insights_fetched_at
     FROM publish_history p
     LEFT JOIN post_insights_cache c ON p.id = c.publish_id
     ORDER BY p.created_at DESC LIMIT ?`
  ),

  // Insights Cache
  upsertInsightsCache: db.prepare(
    `INSERT OR REPLACE INTO post_insights_cache (publish_id, views, likes, replies, reposts, quotes, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
  ),
  getInsightsCache: db.prepare(`SELECT * FROM post_insights_cache WHERE publish_id = ?`),

  // Social Accounts
  createAccount: db.prepare(
    `INSERT INTO social_accounts (id, name, handle, platform, token, user_id, style, persona_prompt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  getAccount: db.prepare(`SELECT * FROM social_accounts WHERE id = ?`),
  getAllAccounts: db.prepare(`SELECT * FROM social_accounts ORDER BY created_at ASC`),
  getAccountsByPlatform: db.prepare(
    `SELECT * FROM social_accounts WHERE platform = ? ORDER BY created_at ASC`
  ),
  updateAccount: db.prepare(
    `UPDATE social_accounts SET name = ?, handle = ?, platform = ?, user_id = ?, style = ?, persona_prompt = ?, auto_publish = ? WHERE id = ?`
  ),
  updateAccountToken: db.prepare(`UPDATE social_accounts SET token = ? WHERE id = ?`),
  deleteAccount: db.prepare(`DELETE FROM social_accounts WHERE id = ?`),

  // Scheduled Tasks
  createScheduledTask: db.prepare(
    `INSERT INTO scheduled_tasks (id, name, account_id, prompt_template, schedule, timezone, enabled, min_score, max_retries, timeout_ms, auto_publish)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  getScheduledTask: db.prepare(`SELECT * FROM scheduled_tasks WHERE id = ?`),
  getAllScheduledTasks: db.prepare(`SELECT * FROM scheduled_tasks ORDER BY created_at DESC`),
  getEnabledScheduledTasks: db.prepare(
    `SELECT * FROM scheduled_tasks WHERE enabled = 1 ORDER BY created_at ASC`
  ),
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
  getRecentExecutions: db.prepare(`SELECT * FROM task_executions ORDER BY started_at DESC LIMIT ?`),
  getRunningExecutions: db.prepare(`SELECT * FROM task_executions WHERE status = 'running'`),
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
  markStaleGoalsFailed: db.prepare(
    `UPDATE agent_goals SET status = 'failed', updated_at = datetime('now') WHERE status = 'active'`
  ),

  // Agent Goals
  createGoal: db.prepare(
    `INSERT INTO agent_goals (id, session_id, account_id, description, sub_tasks, progress) VALUES (?, ?, ?, ?, ?, 0)`
  ),
  getGoal: db.prepare(`SELECT * FROM agent_goals WHERE id = ?`),
  getGoalsBySession: db.prepare(
    `SELECT * FROM agent_goals WHERE session_id = ? ORDER BY created_at DESC`
  ),
  getGoalsByStatus: db.prepare(
    `SELECT * FROM agent_goals WHERE status = ? ORDER BY created_at DESC LIMIT ?`
  ),
  updateGoalProgress: db.prepare(
    `UPDATE agent_goals SET progress = ?, sub_tasks = ?, updated_at = datetime('now') WHERE id = ?`
  ),
  updateGoalStatus: db.prepare(
    `UPDATE agent_goals SET status = ?, updated_at = datetime('now'), completed_at = CASE WHEN ? IN ('completed','failed') THEN datetime('now') ELSE NULL END WHERE id = ?`
  ),
  deleteGoal: db.prepare(`DELETE FROM agent_goals WHERE id = ?`),

  // Agent Memories
  createMemory: db.prepare(
    `INSERT INTO agent_memories (id, goal_id, account_id, content, tags, memory_type, relevance_score) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ),
  getMemory: db.prepare(`SELECT * FROM agent_memories WHERE id = ?`),
  getContextMemories: db.prepare(
    `SELECT * FROM agent_memories WHERE (account_id = ? OR account_id IS NULL) ORDER BY access_count DESC, created_at DESC LIMIT ?`
  ),
  getMemoriesByType: db.prepare(
    `SELECT * FROM agent_memories WHERE memory_type = ? AND (account_id = ? OR account_id IS NULL) ORDER BY access_count DESC, created_at DESC LIMIT ?`
  ),
  touchMemory: db.prepare(
    `UPDATE agent_memories SET access_count = access_count + 1, last_accessed_at = datetime('now') WHERE id = ?`
  ),
  deleteMemory: db.prepare(`DELETE FROM agent_memories WHERE id = ?`),
  deleteOldMemories: db.prepare(
    `DELETE FROM agent_memories WHERE created_at < datetime('now', ?) AND access_count < 3`
  ),

  // Agent Workflows
  createWorkflow: db.prepare(
    `INSERT INTO agent_workflows (id, name, description, template, account_id, tags, is_public) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ),
  getWorkflow: db.prepare(`SELECT * FROM agent_workflows WHERE id = ?`),
  getAllWorkflows: db.prepare(`SELECT * FROM agent_workflows ORDER BY created_at DESC LIMIT ?`),
  getPublicWorkflows: db.prepare(
    `SELECT * FROM agent_workflows WHERE is_public = 1 ORDER BY run_count DESC LIMIT ?`
  ),
  updateWorkflow: db.prepare(
    `UPDATE agent_workflows SET name = ?, description = ?, template = ?, account_id = ?, tags = ?, is_public = ?, updated_at = datetime('now') WHERE id = ?`
  ),
  incrementWorkflowRunCount: db.prepare(
    `UPDATE agent_workflows SET run_count = run_count + 1 WHERE id = ?`
  ),
  deleteWorkflow: db.prepare(`DELETE FROM agent_workflows WHERE id = ?`),

  // Agent Reflections
  createReflection: db.prepare(
    `INSERT INTO agent_reflections (id, session_id, goal_id, trigger, reflection_content, improvement_notes, score_before, score_after) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  getReflectionsBySession: db.prepare(
    `SELECT * FROM agent_reflections WHERE session_id = ? ORDER BY created_at DESC LIMIT ?`
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
      id,
      sessionId,
      msg.role,
      msg.content ?? null,
      msg.tool_name ?? null,
      msg.tool_id ?? null,
      msg.tool_input ?? null,
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
      id,
      record.session_id,
      record.platform,
      record.account,
      record.content,
      record.image_url ?? null,
      record.post_id,
      record.post_url,
      record.status,
      record.link_comment ?? null,
      record.source_url ?? null
    );
    invalidateAnalyticsCache();
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
    invalidateAnalyticsCache();
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
      id,
      data.name,
      data.handle,
      data.platform,
      data.token || "",
      data.user_id || "",
      data.style || "",
      data.persona_prompt || ""
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

  updateAccount(
    id: string,
    data: {
      name: string;
      handle: string;
      platform: string;
      user_id: string;
      style: string;
      persona_prompt: string;
      auto_publish: number;
    }
  ) {
    stmts.updateAccount.run(
      data.name,
      data.handle,
      data.platform,
      data.user_id,
      data.style,
      data.persona_prompt,
      data.auto_publish,
      id
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
      id,
      data.name,
      data.account_id,
      data.prompt_template,
      data.schedule,
      data.timezone ?? "Asia/Taipei",
      data.enabled ?? 1,
      data.min_score ?? 80,
      data.max_retries ?? 2,
      data.timeout_ms ?? 300000,
      data.auto_publish ?? 1
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

  updateScheduledTask(
    id: string,
    data: {
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
    }
  ) {
    stmts.updateScheduledTask.run(
      data.name,
      data.account_id,
      data.prompt_template,
      data.schedule,
      data.timezone,
      data.enabled,
      data.min_score,
      data.max_retries,
      data.timeout_ms,
      data.auto_publish,
      id
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

  updateExecutionResult(
    id: string,
    data: {
      status: TaskExecutionStatus;
      content?: string | null;
      score?: number | null;
      score_breakdown?: string | null;
      cost_usd?: number | null;
      duration_ms?: number | null;
      publish_record_id?: string | null;
      error?: string | null;
      retry_count?: number;
    }
  ) {
    stmts.updateExecutionResult.run(
      data.status,
      data.content ?? null,
      data.score ?? null,
      data.score_breakdown ?? null,
      data.cost_usd ?? null,
      data.duration_ms ?? null,
      data.publish_record_id ?? null,
      data.error ?? null,
      data.retry_count ?? 0,
      id
    );
  },

  markStaleExecutionsFailed() {
    return stmts.markStaleExecutionsFailed.run();
  },

  markStaleGoalsFailed() {
    return stmts.markStaleGoalsFailed.run();
  },

  // Insights Cache
  upsertInsightsCache(
    publishId: string,
    insights: { views: number; likes: number; replies: number; reposts: number; quotes: number }
  ) {
    stmts.upsertInsightsCache.run(
      publishId,
      insights.views,
      insights.likes,
      insights.replies,
      insights.reposts,
      insights.quotes
    );
    invalidateAnalyticsCache();
  },

  getInsightsCache(publishId: string): InsightsCache | undefined {
    return stmts.getInsightsCache.get(publishId) as InsightsCache | undefined;
  },

  getPostsWithInsights(accountId: string, limit = 50): any[] {
    return stmts.getPostsWithInsights.all(accountId, limit) as any[];
  },

  getAllPostsWithInsights(limit = 100): any[] {
    return stmts.getAllPostsWithInsights.all(limit) as any[];
  },

  // Analytics
  getAnalyticsOverview(days = 30, accountId?: string, offset = 0) {
    const cacheKey = `analytics_${days}_${offset}_${accountId ?? "all"}`;
    return getCached(cacheKey, () => {
      const now = Date.now();
      const endMs = now - offset * 86400000;
      const startMs = endMs - days * 86400000;
      const since = new Date(startMs).toISOString().replace("T", " ").slice(0, 19);
      const until =
        offset > 0 ? new Date(endMs).toISOString().replace("T", " ").slice(0, 19) : null;

      // Build WHERE conditions dynamically
      const conditions: string[] = [`p.created_at >= ?`];
      const params: (string | number)[] = [since];
      if (until) {
        conditions.push(`p.created_at < ?`);
        params.push(until);
      }
      if (accountId) {
        conditions.push(`p.account = ?`);
        params.push(accountId);
      }
      const baseWhere = `WHERE ${conditions.join(" AND ")}`;

      const stats = db
        .prepare(
          `
        SELECT
          COUNT(*) as total_posts,
          SUM(CASE WHEN p.status = 'published' THEN 1 ELSE 0 END) as published_posts,
          SUM(CASE WHEN p.link_comment IS NOT NULL AND p.link_comment != '' THEN 1 ELSE 0 END) as posts_with_link,
          SUM(CASE WHEN p.link_comment IS NULL OR p.link_comment = '' THEN 1 ELSE 0 END) as posts_without_link,
          COALESCE(SUM(c.views), 0) as total_views,
          COALESCE(SUM(c.likes), 0) as total_likes,
          COALESCE(SUM(c.replies), 0) as total_replies,
          COALESCE(SUM(c.reposts), 0) as total_reposts,
          COALESCE(SUM(c.quotes), 0) as total_quotes
        FROM publish_history p
        LEFT JOIN post_insights_cache c ON p.id = c.publish_id
        ${baseWhere}
      `
        )
        .get(...params) as any;

      const perAccount = db
        .prepare(
          `
        SELECT
          p.account as account_id,
          a.name, a.handle,
          COUNT(*) as post_count,
          COALESCE(SUM(c.views), 0) as total_views,
          COALESCE(SUM(c.likes + c.replies + c.reposts + c.quotes), 0) as total_engagement
        FROM publish_history p
        LEFT JOIN post_insights_cache c ON p.id = c.publish_id
        LEFT JOIN social_accounts a ON p.account = a.id
        ${baseWhere} AND p.status = 'published'
        GROUP BY p.account
        ORDER BY total_views DESC
      `
        )
        .all(...params) as any[];

      const topPosts = db
        .prepare(
          `
        SELECT p.id, p.content, p.account, p.created_at, a.handle,
          c.views, c.likes, c.replies, c.reposts, c.quotes
        FROM publish_history p
        JOIN post_insights_cache c ON p.id = c.publish_id
        LEFT JOIN social_accounts a ON p.account = a.id
        ${baseWhere} AND p.status = 'published'
        ORDER BY c.views DESC LIMIT 5
      `
        )
        .all(...params) as any[];

      const dailyCounts = db
        .prepare(
          `
        SELECT date(p.created_at) as date, COUNT(*) as post_count,
          COALESCE(SUM(c.views), 0) as total_views
        FROM publish_history p
        LEFT JOIN post_insights_cache c ON p.id = c.publish_id
        ${baseWhere}
        GROUP BY date(p.created_at)
        ORDER BY date ASC
      `
        )
        .all(...params) as any[];

      const totalEngagement =
        (stats.total_likes || 0) +
        (stats.total_replies || 0) +
        (stats.total_reposts || 0) +
        (stats.total_quotes || 0);
      const engagementRate = stats.total_views > 0 ? totalEngagement / stats.total_views : 0;

      return {
        ...stats,
        engagement_rate: engagementRate,
        per_account: perAccount,
        top_posts: topPosts,
        daily_counts: dailyCounts,
      };
    });
  },

  getContentAnalysis(days = 30) {
    return getCached(`content_analysis_${days}`, () => {
      const since = new Date(Date.now() - days * 86400000)
        .toISOString()
        .replace("T", " ")
        .slice(0, 19);

      const imageVsText = db
        .prepare(
          `
        SELECT
          CASE WHEN p.image_url IS NOT NULL AND p.image_url != '' THEN 'with_image' ELSE 'text_only' END as type,
          COUNT(*) as count,
          COALESCE(AVG(c.views), 0) as avg_views,
          COALESCE(AVG(c.likes), 0) as avg_likes,
          COALESCE(AVG(c.replies), 0) as avg_replies
        FROM publish_history p
        LEFT JOIN post_insights_cache c ON p.id = c.publish_id
        WHERE p.created_at >= ? AND p.status = 'published'
        GROUP BY type
      `
        )
        .all(since) as any[];

      const linkVsNoLink = db
        .prepare(
          `
        SELECT
          CASE WHEN p.link_comment IS NOT NULL AND p.link_comment != '' THEN 'with_link' ELSE 'no_link' END as type,
          COUNT(*) as count,
          COALESCE(AVG(c.views), 0) as avg_views,
          COALESCE(AVG(c.likes), 0) as avg_likes,
          COALESCE(AVG(c.replies), 0) as avg_replies
        FROM publish_history p
        LEFT JOIN post_insights_cache c ON p.id = c.publish_id
        WHERE p.created_at >= ? AND p.status = 'published'
        GROUP BY type
      `
        )
        .all(since) as any[];

      const hourPerformance = db
        .prepare(
          `
        SELECT
          CAST(strftime('%H', p.created_at) AS INTEGER) as hour,
          COUNT(*) as count,
          COALESCE(AVG(c.views), 0) as avg_views,
          COALESCE(AVG(c.likes + c.replies + c.reposts + c.quotes), 0) as avg_engagement
        FROM publish_history p
        LEFT JOIN post_insights_cache c ON p.id = c.publish_id
        WHERE p.created_at >= ? AND p.status = 'published'
        GROUP BY hour ORDER BY hour
      `
        )
        .all(since) as any[];

      const dayPerformance = db
        .prepare(
          `
        SELECT
          CAST(strftime('%w', p.created_at) AS INTEGER) as day,
          COUNT(*) as count,
          COALESCE(AVG(c.views), 0) as avg_views,
          COALESCE(AVG(c.likes + c.replies + c.reposts + c.quotes), 0) as avg_engagement
        FROM publish_history p
        LEFT JOIN post_insights_cache c ON p.id = c.publish_id
        WHERE p.created_at >= ? AND p.status = 'published'
        GROUP BY day ORDER BY day
      `
        )
        .all(since) as any[];

      return {
        image_vs_text: imageVsText,
        link_vs_no_link: linkVsNoLink,
        hour_performance: hourPerformance,
        day_performance: dayPerformance,
      };
    });
  },

  // ── Agent Goals ────────────────────────────────────────────────────────────

  createGoal(data: { sessionId?: string; accountId?: string; description: string }): AgentGoal {
    const id = uuidv4();
    stmts.createGoal.run(
      id,
      data.sessionId ?? null,
      data.accountId ?? null,
      data.description,
      null
    );
    return stmts.getGoal.get(id) as AgentGoal;
  },

  getGoal(id: string): AgentGoal | undefined {
    return stmts.getGoal.get(id) as AgentGoal | undefined;
  },

  getGoalsBySession(sessionId: string): AgentGoal[] {
    return stmts.getGoalsBySession.all(sessionId) as AgentGoal[];
  },

  getGoalsByStatus(status: AgentGoalStatus, limit = 50): AgentGoal[] {
    return stmts.getGoalsByStatus.all(status, limit) as AgentGoal[];
  },

  updateGoalProgress(id: string, progress: number, subTasks?: string | null) {
    stmts.updateGoalProgress.run(progress, subTasks ?? null, id);
  },

  updateGoalStatus(id: string, status: AgentGoalStatus) {
    stmts.updateGoalStatus.run(status, status, id);
  },

  deleteGoal(id: string): boolean {
    return stmts.deleteGoal.run(id).changes > 0;
  },

  // ── Agent Memories ─────────────────────────────────────────────────────────

  createMemory(data: {
    goalId?: string;
    accountId?: string;
    content: string;
    tags?: string[];
    memoryType?: AgentMemoryType;
    relevanceScore?: number;
  }): AgentMemory {
    const id = uuidv4();
    stmts.createMemory.run(
      id,
      data.goalId ?? null,
      data.accountId ?? null,
      data.content,
      data.tags ? JSON.stringify(data.tags) : null,
      data.memoryType ?? "general",
      data.relevanceScore ?? 1.0
    );
    return stmts.getMemory.get(id) as AgentMemory;
  },

  getMemory(id: string): AgentMemory | undefined {
    return stmts.getMemory.get(id) as AgentMemory | undefined;
  },

  getContextMemories(accountId?: string, limit = 10): AgentMemory[] {
    return stmts.getContextMemories.all(accountId ?? null, limit) as AgentMemory[];
  },

  getMemoriesByType(memoryType: AgentMemoryType, accountId?: string, limit = 20): AgentMemory[] {
    return stmts.getMemoriesByType.all(memoryType, accountId ?? null, limit) as AgentMemory[];
  },

  searchMemories(
    query: string,
    options?: {
      goalId?: string;
      accountId?: string;
      memoryType?: AgentMemoryType;
      limit?: number;
    }
  ): AgentMemory[] {
    const limit = options?.limit ?? 10;
    // FTS5 MATCH search — returns rowid, then fetch full rows
    let sql = `
      SELECT m.* FROM agent_memories m
      JOIN agent_memories_fts f ON m.rowid = f.rowid
      WHERE agent_memories_fts MATCH ?
    `;
    const params: (string | number | null)[] = [query];
    if (options?.goalId) {
      sql += ` AND m.goal_id = ?`;
      params.push(options.goalId);
    }
    if (options?.accountId) {
      sql += ` AND m.account_id = ?`;
      params.push(options.accountId);
    }
    if (options?.memoryType) {
      sql += ` AND m.memory_type = ?`;
      params.push(options.memoryType);
    }
    sql += ` ORDER BY f.rank LIMIT ?`;
    params.push(limit);
    return db.prepare(sql).all(...params) as AgentMemory[];
  },

  touchMemory(id: string) {
    stmts.touchMemory.run(id);
  },

  deleteMemory(id: string): boolean {
    return stmts.deleteMemory.run(id).changes > 0;
  },

  cleanOldMemories(daysOld = 90): number {
    const result = stmts.deleteOldMemories.run(`-${daysOld} days`);
    return result.changes;
  },

  // ── Agent Reflections ──────────────────────────────────────────────────────

  createReflection(data: {
    sessionId: string;
    goalId?: string;
    trigger: ReflectionTrigger;
    reflectionContent: string;
    improvementNotes?: string;
    scoreBefore?: number;
    scoreAfter?: number;
  }): AgentReflection {
    const id = uuidv4();
    stmts.createReflection.run(
      id,
      data.sessionId,
      data.goalId ?? null,
      data.trigger,
      data.reflectionContent,
      data.improvementNotes ?? null,
      data.scoreBefore ?? null,
      data.scoreAfter ?? null
    );
    return {
      id,
      session_id: data.sessionId,
      goal_id: data.goalId ?? null,
      trigger: data.trigger,
      reflection_content: data.reflectionContent,
      improvement_notes: data.improvementNotes ?? null,
      score_before: data.scoreBefore ?? null,
      score_after: data.scoreAfter ?? null,
      created_at: new Date().toISOString(),
    } as AgentReflection;
  },

  getReflectionsBySession(sessionId: string, limit = 20): AgentReflection[] {
    return stmts.getReflectionsBySession.all(sessionId, limit) as AgentReflection[];
  },

  // ── Agent Workflows ────────────────────────────────────────────────────────

  createWorkflow(data: {
    name: string;
    description?: string;
    template: string;
    accountId?: string;
    tags?: string[];
    isPublic?: boolean;
  }): AgentWorkflow {
    const id = uuidv4();
    stmts.createWorkflow.run(
      id,
      data.name,
      data.description ?? null,
      data.template,
      data.accountId ?? null,
      data.tags ? JSON.stringify(data.tags) : null,
      data.isPublic ? 1 : 0
    );
    return stmts.getWorkflow.get(id) as AgentWorkflow;
  },

  getWorkflow(id: string): AgentWorkflow | undefined {
    return stmts.getWorkflow.get(id) as AgentWorkflow | undefined;
  },

  getAllWorkflows(limit = 100): AgentWorkflow[] {
    return stmts.getAllWorkflows.all(limit) as AgentWorkflow[];
  },

  getPublicWorkflows(limit = 50): AgentWorkflow[] {
    return stmts.getPublicWorkflows.all(limit) as AgentWorkflow[];
  },

  updateWorkflow(
    id: string,
    data: {
      name: string;
      description?: string;
      template: string;
      accountId?: string;
      tags?: string[];
      isPublic?: boolean;
    }
  ): boolean {
    const result = stmts.updateWorkflow.run(
      data.name,
      data.description ?? null,
      data.template,
      data.accountId ?? null,
      data.tags ? JSON.stringify(data.tags) : null,
      data.isPublic ? 1 : 0,
      id
    );
    return result.changes > 0;
  },

  incrementWorkflowRunCount(id: string) {
    stmts.incrementWorkflowRunCount.run(id);
  },

  deleteWorkflow(id: string): boolean {
    return stmts.deleteWorkflow.run(id).changes > 0;
  },
};

export default store;
