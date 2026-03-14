import Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import { fileURLToPath } from "url";
import type { Session, Message, PublishRecord, SocialAccount } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, "../data/studio.db");

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
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// --- Migrate legacy hardcoded accounts → social_accounts ---
(function migrateLegacyAccounts() {
  const count = (db.prepare("SELECT COUNT(*) as n FROM social_accounts").get() as { n: number }).n;
  if (count > 0) return;

  const get = (key: string) => {
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value || "";
  };

  const cwToken = get("threadsTokenCw");
  const lfToken = get("threadsTokenLf");

  if (cwToken) {
    db.prepare(
      "INSERT INTO social_accounts (id, name, handle, platform, token, user_id, style, persona_prompt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run("cw", "Claude World Taiwan", "@claude.world.taiwan", "threads", cwToken, get("threadsUserIdCw"), "tech-educator", "You are a knowledgeable tech educator focused on Claude Code and AI development tools. Write in Traditional Chinese (Taiwan). Tone: professional yet approachable, data-driven, with practical insights.");
  }

  if (lfToken) {
    db.prepare(
      "INSERT INTO social_accounts (id, name, handle, platform, token, user_id, style, persona_prompt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run("lf", "Lucas Futures", "@lucasfutures", "threads", lfToken, get("threadsUserIdLf"), "futurist", "You are a forward-thinking futurist who explores emerging tech trends. Write in Traditional Chinese (Taiwan). Tone: visionary, thought-provoking, concise.");
  }

  // Also migrate IG accounts if tokens exist
  const cwIg = get("igTokenCw");
  const lfIg = get("igTokenLf");
  if (cwIg) {
    db.prepare(
      "INSERT INTO social_accounts (id, name, handle, platform, token, user_id, style, persona_prompt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run("cw-ig", "Claude World Taiwan (IG)", "@claude.world.taiwan", "instagram", cwIg, "", "tech-visual", "Create visually-oriented tech content about Claude Code and AI tools. Focus on infographics, quick tips, and visual guides.");
  }
  if (lfIg) {
    db.prepare(
      "INSERT INTO social_accounts (id, name, handle, platform, token, user_id, style, persona_prompt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run("lf-ig", "Lucas Futures (IG)", "@lucasfutures", "instagram", lfIg, "", "futurist-visual", "Create visually striking content about future tech trends. Focus on bold statements and eye-catching visuals.");
  }

  if (cwToken || lfToken || cwIg || lfIg) {
    console.log("[DB] Migrated legacy accounts to social_accounts table");
  }
})();

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
    `INSERT INTO publish_history (id, session_id, platform, account, content, post_id, post_url, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ),
  getPublishHistory: db.prepare(
    `SELECT * FROM publish_history ORDER BY created_at DESC LIMIT ?`
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
    `UPDATE social_accounts SET name = ?, handle = ?, platform = ?, user_id = ?, style = ?, persona_prompt = ? WHERE id = ?`
  ),
  updateAccountToken: db.prepare(
    `UPDATE social_accounts SET token = ? WHERE id = ?`
  ),
  deleteAccount: db.prepare(`DELETE FROM social_accounts WHERE id = ?`),
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
      record.content, record.post_id, record.post_url, record.status
    );
    return { id, created_at: new Date().toISOString(), ...record };
  },

  getPublishHistory(limit = 50): PublishRecord[] {
    return stmts.getPublishHistory.all(limit) as PublishRecord[];
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
  }) {
    stmts.updateAccount.run(
      data.name, data.handle, data.platform,
      data.user_id, data.style, data.persona_prompt, id
    );
  },

  updateAccountToken(id: string, token: string) {
    stmts.updateAccountToken.run(token, id);
  },

  deleteAccount(id: string): boolean {
    const result = stmts.deleteAccount.run(id);
    return result.changes > 0;
  },
};

export default store;
