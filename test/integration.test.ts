/**
 * integration.test.ts
 *
 * Integration tests covering:
 *  3a. In-memory SQLite store operations (CRUD roundtrips)
 *  3b. Logger + rate limiter independence
 *  3c. Validation schema edge cases not covered by validation.test.ts
 *
 * The store tests use an in-memory Database instance to keep tests isolated
 * and fast, mirroring the exact schema and SQL from server/db.ts.
 */

import { describe, it, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";

// ---------------------------------------------------------------------------
// 3a. In-memory store helpers
// ---------------------------------------------------------------------------

/** Build a fresh in-memory database with the same schema as server/db.ts. */
function buildTestDb() {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");

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

    CREATE TABLE IF NOT EXISTS publish_history (
      id TEXT PRIMARY KEY,
      session_id TEXT REFERENCES sessions(id),
      platform TEXT NOT NULL,
      account TEXT NOT NULL,
      content TEXT NOT NULL,
      score REAL,
      image_url TEXT,
      post_id TEXT,
      post_url TEXT,
      status TEXT DEFAULT 'pending',
      link_comment TEXT,
      source_url TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

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
  `);

  // Prepared statements
  const stmts = {
    createSession: db.prepare(`INSERT INTO sessions (id, title, workspace_path) VALUES (?, ?, ?)`),
    getSession: db.prepare(`SELECT * FROM sessions WHERE id = ? AND status = 'active'`),
    deleteSession: db.prepare(
      `UPDATE sessions SET status = 'deleted', updated_at = datetime('now') WHERE id = ?`
    ),
    addMessage: db.prepare(
      `INSERT INTO messages (id, session_id, role, content, tool_name, tool_id, tool_input, cost_usd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ),
    getMessages: db.prepare(`SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC`),
    createAccount: db.prepare(
      `INSERT INTO social_accounts (id, name, handle, platform, token, user_id, style, persona_prompt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ),
    getAccount: db.prepare(`SELECT * FROM social_accounts WHERE id = ?`),
    getAllAccounts: db.prepare(`SELECT * FROM social_accounts ORDER BY created_at ASC`),
    updateAccount: db.prepare(
      `UPDATE social_accounts SET name = ?, handle = ?, platform = ?, user_id = ?, style = ?, persona_prompt = ?, auto_publish = ? WHERE id = ?`
    ),
    deleteAccount: db.prepare(`DELETE FROM social_accounts WHERE id = ?`),
    addPublish: db.prepare(
      `INSERT INTO publish_history (id, session_id, platform, account, content, score, image_url, post_id, post_url, status, link_comment, source_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ),
    getPublishHistory: db.prepare(`SELECT * FROM publish_history ORDER BY created_at DESC LIMIT ?`),
    createTask: db.prepare(
      `INSERT INTO scheduled_tasks (id, name, account_id, prompt_template, schedule, timezone, enabled, min_score, max_retries, timeout_ms, auto_publish)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ),
    getTask: db.prepare(`SELECT * FROM scheduled_tasks WHERE id = ?`),
    getAllTasks: db.prepare(`SELECT * FROM scheduled_tasks ORDER BY created_at DESC`),
    updateTask: db.prepare(
      `UPDATE scheduled_tasks SET name = ?, enabled = ?, updated_at = datetime('now') WHERE id = ?`
    ),
    deleteTask: db.prepare(`DELETE FROM scheduled_tasks WHERE id = ?`),
  };

  // Store interface that mirrors server/db.ts behaviour
  const store = {
    createSession(title?: string, workspacePath?: string) {
      const id = uuidv4();
      stmts.createSession.run(id, title || "New Session", workspacePath || "/tmp");
      return stmts.getSession.get(id) as any;
    },
    getSession(id: string) {
      return stmts.getSession.get(id) as any;
    },
    deleteSession(id: string) {
      const result = stmts.deleteSession.run(id);
      return result.changes > 0;
    },
    addMessage(sessionId: string, msg: { role: string; content?: string | null }) {
      const id = uuidv4();
      stmts.addMessage.run(id, sessionId, msg.role, msg.content ?? null, null, null, null, null);
      return { id, session_id: sessionId, role: msg.role, content: msg.content ?? null };
    },
    getMessages(sessionId: string) {
      return stmts.getMessages.all(sessionId) as any[];
    },
    createAccount(data: { name: string; handle: string; platform: string; token?: string }) {
      const id = uuidv4();
      stmts.createAccount.run(
        id,
        data.name,
        data.handle,
        data.platform,
        data.token || "",
        "",
        "",
        ""
      );
      return stmts.getAccount.get(id) as any;
    },
    getAccount(id: string) {
      return stmts.getAccount.get(id) as any;
    },
    getAllAccounts() {
      return stmts.getAllAccounts.all() as any[];
    },
    updateAccount(
      id: string,
      data: { name: string; handle: string; platform: string; auto_publish?: number }
    ) {
      stmts.updateAccount.run(
        data.name,
        data.handle,
        data.platform,
        "",
        "",
        "",
        data.auto_publish ?? 0,
        id
      );
    },
    deleteAccount(id: string) {
      const result = stmts.deleteAccount.run(id);
      return result.changes > 0;
    },
    addPublish(record: {
      session_id?: string | null;
      platform: string;
      account: string;
      content: string;
      score?: number | null;
      status: string;
    }) {
      const id = uuidv4();
      stmts.addPublish.run(
        id,
        record.session_id ?? null,
        record.platform,
        record.account,
        record.content,
        record.score ?? null,
        null,
        null,
        null,
        record.status,
        null,
        null
      );
      return { id, ...record, created_at: new Date().toISOString() };
    },
    getPublishHistory(limit = 50) {
      return stmts.getPublishHistory.all(limit) as any[];
    },
    createTask(data: {
      name: string;
      account_id: string;
      prompt_template: string;
      schedule: string;
    }) {
      const id = uuidv4();
      stmts.createTask.run(
        id,
        data.name,
        data.account_id,
        data.prompt_template,
        data.schedule,
        "Asia/Taipei",
        1,
        80,
        2,
        300000,
        1
      );
      return stmts.getTask.get(id) as any;
    },
    getTask(id: string) {
      return stmts.getTask.get(id) as any;
    },
    getAllTasks() {
      return stmts.getAllTasks.all() as any[];
    },
    updateTask(id: string, data: { name: string; enabled: number }) {
      stmts.updateTask.run(data.name, data.enabled, id);
    },
    deleteTask(id: string) {
      const result = stmts.deleteTask.run(id);
      return result.changes > 0;
    },
  };

  return { db, store };
}

// ---------------------------------------------------------------------------
// 3a. Session CRUD
// ---------------------------------------------------------------------------

describe("DB store: session CRUD", () => {
  it("createSession + getSession roundtrip", () => {
    const { store } = buildTestDb();

    const session = store.createSession("Test Session", "/workspace/test");
    assert.ok(session, "createSession should return the new session");
    assert.ok(session.id, "session should have an id");
    assert.strictEqual(session.title, "Test Session");
    assert.strictEqual(session.workspace_path, "/workspace/test");
    assert.strictEqual(session.status, "active");

    const fetched = store.getSession(session.id);
    assert.ok(fetched, "getSession should find the session");
    assert.strictEqual(fetched.id, session.id);
    assert.strictEqual(fetched.title, "Test Session");
  });

  it("createSession with defaults when title and workspacePath omitted", () => {
    const { store } = buildTestDb();

    const session = store.createSession();
    assert.strictEqual(session.title, "New Session", "default title should be 'New Session'");
    assert.ok(session.workspace_path, "workspace_path should have a fallback value");
  });

  it("getSession returns undefined for non-existent id", () => {
    const { store } = buildTestDb();
    const result = store.getSession("does-not-exist");
    assert.strictEqual(result, undefined);
  });

  it("deleteSession soft-deletes: getSession returns undefined afterwards", () => {
    const { store } = buildTestDb();

    const session = store.createSession("To Delete");
    const deleted = store.deleteSession(session.id);
    assert.ok(deleted, "deleteSession should return true on success");

    const fetched = store.getSession(session.id);
    assert.strictEqual(fetched, undefined, "getSession should return undefined after soft-delete");
  });

  it("deleteSession returns false for non-existent id", () => {
    const { store } = buildTestDb();
    const result = store.deleteSession("non-existent-id");
    assert.strictEqual(result, false);
  });
});

// ---------------------------------------------------------------------------
// 3a. Message CRUD
// ---------------------------------------------------------------------------

describe("DB store: message CRUD", () => {
  it("addMessage + getMessages roundtrip", () => {
    const { store } = buildTestDb();

    const session = store.createSession("Msg Session");
    const msg = store.addMessage(session.id, { role: "user", content: "Hello" });

    assert.ok(msg.id, "addMessage should return a message with an id");
    assert.strictEqual(msg.session_id, session.id);
    assert.strictEqual(msg.role, "user");
    assert.strictEqual(msg.content, "Hello");

    const messages = store.getMessages(session.id);
    assert.strictEqual(messages.length, 1);
    assert.strictEqual(messages[0].content, "Hello");
  });

  it("getMessages returns messages in insertion order for same session", () => {
    const { store } = buildTestDb();

    const session = store.createSession();
    store.addMessage(session.id, { role: "user", content: "First" });
    store.addMessage(session.id, { role: "assistant", content: "Second" });
    store.addMessage(session.id, { role: "user", content: "Third" });

    const messages = store.getMessages(session.id);
    assert.strictEqual(messages.length, 3);
    assert.strictEqual(messages[0].content, "First");
    assert.strictEqual(messages[1].content, "Second");
    assert.strictEqual(messages[2].content, "Third");
  });

  it("getMessages returns empty array for session with no messages", () => {
    const { store } = buildTestDb();
    const session = store.createSession();
    const messages = store.getMessages(session.id);
    assert.deepStrictEqual(messages, []);
  });

  it("addMessage with null content stores null", () => {
    const { store } = buildTestDb();
    const session = store.createSession();
    const msg = store.addMessage(session.id, { role: "tool_use", content: null });
    assert.strictEqual(msg.content, null);
  });

  it("messages from different sessions are isolated", () => {
    const { store } = buildTestDb();
    const s1 = store.createSession("Session 1");
    const s2 = store.createSession("Session 2");

    store.addMessage(s1.id, { role: "user", content: "From S1" });
    store.addMessage(s2.id, { role: "user", content: "From S2" });

    assert.strictEqual(store.getMessages(s1.id).length, 1);
    assert.strictEqual(store.getMessages(s2.id).length, 1);
    assert.strictEqual(store.getMessages(s1.id)[0].content, "From S1");
    assert.strictEqual(store.getMessages(s2.id)[0].content, "From S2");
  });
});

// ---------------------------------------------------------------------------
// 3a. Account CRUD
// ---------------------------------------------------------------------------

describe("DB store: account CRUD", () => {
  it("createAccount + getAccount roundtrip", () => {
    const { store } = buildTestDb();

    const account = store.createAccount({
      name: "Test Account",
      handle: "@test",
      platform: "threads",
      token: "tok-123",
    });

    assert.ok(account.id, "account should have an id");
    assert.strictEqual(account.name, "Test Account");
    assert.strictEqual(account.handle, "@test");
    assert.strictEqual(account.platform, "threads");
    assert.strictEqual(account.token, "tok-123");

    const fetched = store.getAccount(account.id);
    assert.ok(fetched);
    assert.strictEqual(fetched.id, account.id);
    assert.strictEqual(fetched.name, "Test Account");
  });

  it("getAllAccounts returns all created accounts", () => {
    const { store } = buildTestDb();

    store.createAccount({ name: "Acct A", handle: "@a", platform: "threads" });
    store.createAccount({ name: "Acct B", handle: "@b", platform: "instagram" });

    const all = store.getAllAccounts();
    assert.strictEqual(all.length, 2);
    const names = all.map((a: any) => a.name).sort();
    assert.deepStrictEqual(names, ["Acct A", "Acct B"]);
  });

  it("updateAccount modifies the stored record", () => {
    const { store } = buildTestDb();

    const account = store.createAccount({ name: "Original", handle: "@orig", platform: "threads" });
    store.updateAccount(account.id, {
      name: "Updated",
      handle: "@updated",
      platform: "instagram",
      auto_publish: 1,
    });

    const updated = store.getAccount(account.id);
    assert.strictEqual(updated.name, "Updated");
    assert.strictEqual(updated.handle, "@updated");
    assert.strictEqual(updated.platform, "instagram");
    assert.strictEqual(updated.auto_publish, 1);
  });

  it("deleteAccount removes the record", () => {
    const { store } = buildTestDb();

    const account = store.createAccount({ name: "To Delete", handle: "@del", platform: "threads" });
    const deleted = store.deleteAccount(account.id);
    assert.ok(deleted, "deleteAccount should return true");

    const fetched = store.getAccount(account.id);
    assert.strictEqual(fetched, undefined, "account should not be findable after deletion");
  });

  it("deleteAccount returns false for non-existent id", () => {
    const { store } = buildTestDb();
    const result = store.deleteAccount("no-such-id");
    assert.strictEqual(result, false);
  });

  it("getAllAccounts returns empty array when no accounts exist", () => {
    const { store } = buildTestDb();
    assert.deepStrictEqual(store.getAllAccounts(), []);
  });
});

// ---------------------------------------------------------------------------
// 3a. Publish history CRUD
// ---------------------------------------------------------------------------

describe("DB store: publish history CRUD", () => {
  it("addPublish + getPublishHistory roundtrip", () => {
    const { store } = buildTestDb();

    const record = store.addPublish({
      platform: "threads",
      account: "acc-1",
      content: "My first post",
      score: 88,
      status: "published",
    });

    assert.ok(record.id, "addPublish should return a record with an id");
    assert.strictEqual(record.content, "My first post");
    assert.strictEqual(record.score, 88);
    assert.strictEqual(record.status, "published");

    const history = store.getPublishHistory(50);
    assert.strictEqual(history.length, 1);
    assert.strictEqual(history[0].content, "My first post");
    assert.strictEqual(history[0].score, 88);
  });

  it("getPublishHistory respects the limit parameter", () => {
    const { store } = buildTestDb();

    for (let i = 0; i < 5; i++) {
      store.addPublish({
        platform: "threads",
        account: "acc-1",
        content: `Post ${i}`,
        status: "published",
      });
    }

    const limited = store.getPublishHistory(3);
    assert.strictEqual(limited.length, 3, "should return at most `limit` records");
  });

  it("addPublish with session_id stores the association", () => {
    const { store } = buildTestDb();
    const session = store.createSession("Linked Session");

    const record = store.addPublish({
      session_id: session.id,
      platform: "threads",
      account: "acc-2",
      content: "Linked post",
      status: "draft",
    });

    const history = store.getPublishHistory(1);
    assert.strictEqual(history[0].session_id, session.id);
    assert.strictEqual(record.session_id, session.id);
  });

  it("getPublishHistory returns empty array when no records exist", () => {
    const { store } = buildTestDb();
    assert.deepStrictEqual(store.getPublishHistory(50), []);
  });
});

// ---------------------------------------------------------------------------
// 3a. Task CRUD
// ---------------------------------------------------------------------------

describe("DB store: task CRUD", () => {
  it("createTask + getTask roundtrip", () => {
    const { store } = buildTestDb();
    const account = store.createAccount({ name: "A", handle: "@a", platform: "threads" });

    const task = store.createTask({
      name: "Daily Post",
      account_id: account.id,
      prompt_template: "Write about {{topic}}",
      schedule: "0 9 * * *",
    });

    assert.ok(task.id, "task should have an id");
    assert.strictEqual(task.name, "Daily Post");
    assert.strictEqual(task.account_id, account.id);
    assert.strictEqual(task.schedule, "0 9 * * *");
    assert.strictEqual(task.enabled, 1, "default enabled should be 1");

    const fetched = store.getTask(task.id);
    assert.ok(fetched);
    assert.strictEqual(fetched.id, task.id);
  });

  it("getAllTasks returns all created tasks", () => {
    const { store } = buildTestDb();
    const account = store.createAccount({ name: "A", handle: "@a", platform: "threads" });

    store.createTask({
      name: "Task 1",
      account_id: account.id,
      prompt_template: "Prompt 1",
      schedule: "0 9 * * *",
    });
    store.createTask({
      name: "Task 2",
      account_id: account.id,
      prompt_template: "Prompt 2",
      schedule: "0 18 * * *",
    });

    const tasks = store.getAllTasks();
    assert.strictEqual(tasks.length, 2);
  });

  it("updateTask modifies name and enabled flag", () => {
    const { store } = buildTestDb();
    const account = store.createAccount({ name: "A", handle: "@a", platform: "threads" });

    const task = store.createTask({
      name: "Original",
      account_id: account.id,
      prompt_template: "p",
      schedule: "0 9 * * *",
    });
    assert.strictEqual(task.enabled, 1);

    store.updateTask(task.id, { name: "Renamed", enabled: 0 });

    const updated = store.getTask(task.id);
    assert.strictEqual(updated.name, "Renamed");
    assert.strictEqual(updated.enabled, 0);
  });

  it("deleteTask removes the record", () => {
    const { store } = buildTestDb();
    const account = store.createAccount({ name: "A", handle: "@a", platform: "threads" });

    const task = store.createTask({
      name: "Temp",
      account_id: account.id,
      prompt_template: "p",
      schedule: "0 9 * * *",
    });
    const deleted = store.deleteTask(task.id);
    assert.ok(deleted, "deleteTask should return true");
    assert.strictEqual(store.getTask(task.id), undefined);
  });

  it("getAllTasks returns empty array when no tasks exist", () => {
    const { store } = buildTestDb();
    assert.deepStrictEqual(store.getAllTasks(), []);
  });
});

// ---------------------------------------------------------------------------
// 3b. Logger + rate limiter independence
// ---------------------------------------------------------------------------

describe("Logger + rate limiter independence", () => {
  it("rate limiter does not call console (logger) methods", async () => {
    const { rateLimiter } = await import("../server/middleware/rate-limiter.js");

    const consoleMethods = ["log", "error", "warn", "debug"] as const;
    const callCounts: Record<string, number> = {};
    const originals: Record<string, (...args: unknown[]) => void> = {};

    for (const method of consoleMethods) {
      callCounts[method] = 0;
      originals[method] = console[method];
      console[method] = (..._args: unknown[]) => {
        callCounts[method]++;
      };
    }

    try {
      const req = { ip: "192.0.2.1" } as any;
      const res = {
        setHeader: () => res,
        status: () => res,
        json: () => res,
      } as any;
      rateLimiter(req, res, () => {});
    } finally {
      for (const method of consoleMethods) {
        console[method] = originals[method] as any;
      }
    }

    const totalConsoleCalls = Object.values(callCounts).reduce((a, b) => a + b, 0);
    assert.strictEqual(
      totalConsoleCalls,
      0,
      "rate limiter should not invoke any console methods (it is pure middleware)"
    );
  });

  it("logger handles rapid sequential calls without throwing", async () => {
    const { logger } = await import("../server/logger.js");

    const origLog = console.log;
    const origWarn = console.warn;
    const origError = console.error;
    console.log = () => {};
    console.warn = () => {};
    console.error = () => {};

    try {
      assert.doesNotThrow(() => {
        for (let i = 0; i < 1000; i++) {
          logger.info("RapidTag", `message ${i}`);
          logger.warn("RapidTag", `warning ${i}`);
          logger.error("RapidTag", `error ${i}`, new Error("test"));
        }
      }, "logger should handle 1000 rapid calls without throwing");
    } finally {
      console.log = origLog;
      console.warn = origWarn;
      console.error = origError;
    }
  });

  it("logger info and warn produce different level labels", async () => {
    const { logger } = await import("../server/logger.js");

    const captured: string[] = [];
    const origLog = console.log;
    const origWarn = console.warn;
    console.log = (...args: unknown[]) => captured.push(args[0] as string);
    console.warn = (...args: unknown[]) => captured.push(args[0] as string);

    try {
      logger.info("T", "info-msg");
      logger.warn("T", "warn-msg");
    } finally {
      console.log = origLog;
      console.warn = origWarn;
    }

    assert.strictEqual(captured.length, 2);
    assert.ok(captured[0].includes("[INFO]"), "first entry should be INFO");
    assert.ok(captured[1].includes("[WARN]"), "second entry should be WARN");
    assert.ok(!captured[0].includes("[WARN]"), "INFO entry should not contain WARN label");
    assert.ok(!captured[1].includes("[INFO]"), "WARN entry should not contain INFO label");
  });
});

// ---------------------------------------------------------------------------
// 3c. Validation edge cases
// ---------------------------------------------------------------------------

import {
  PublishSchema,
  CreateTaskSchema,
  CreateAccountSchema,
  UpdateAccountSchema,
  BatchPublishSchema,
  BatchRefreshInsightsSchema,
  ToggleAutoPublishSchema,
  SendMessageSchema,
} from "../server/validation.js";

describe("PublishSchema — additional edge cases", () => {
  const base = { accountId: "acc-1", text: "Hello" };

  it("videoUrl accepts empty string (same pattern as imageUrl)", () => {
    const result = PublishSchema.safeParse({ ...base, videoUrl: "" });
    assert.ok(result.success, "empty videoUrl should be accepted");
  });

  it("videoUrl accepts a valid URL", () => {
    const result = PublishSchema.safeParse({
      ...base,
      videoUrl: "https://example.com/vid.mp4",
    });
    assert.ok(result.success);
  });

  it("videoUrl rejects an invalid non-empty string", () => {
    const result = PublishSchema.safeParse({ ...base, videoUrl: "not-a-url" });
    assert.strictEqual(result.success, false);
  });

  it("linkComment accepts empty string", () => {
    const result = PublishSchema.safeParse({ ...base, linkComment: "" });
    assert.ok(result.success);
  });

  it("linkAttachment accepts empty string", () => {
    const result = PublishSchema.safeParse({ ...base, linkAttachment: "" });
    assert.ok(result.success);
  });

  it("sourceUrl accepts empty string", () => {
    const result = PublishSchema.safeParse({ ...base, sourceUrl: "" });
    assert.ok(result.success);
  });

  it("text at exactly 500 characters passes", () => {
    const result = PublishSchema.safeParse({ ...base, text: "x".repeat(500) });
    assert.ok(result.success);
  });

  it("text at 499 characters passes", () => {
    const result = PublishSchema.safeParse({ ...base, text: "x".repeat(499) });
    assert.ok(result.success);
  });

  it("carouselUrls at exactly 2 items (minimum) passes", () => {
    const result = PublishSchema.safeParse({
      ...base,
      carouselUrls: ["https://a.com/1.png", "https://a.com/2.png"],
    });
    assert.ok(result.success);
  });

  it("carouselUrls at exactly 20 items (maximum) passes", () => {
    const urls = Array.from({ length: 20 }, (_, i) => `https://a.com/${i}.png`);
    const result = PublishSchema.safeParse({ ...base, carouselUrls: urls });
    assert.ok(result.success);
  });

  it("carouselUrls with 21 items (over maximum) fails", () => {
    const urls = Array.from({ length: 21 }, (_, i) => `https://a.com/${i}.png`);
    const result = PublishSchema.safeParse({ ...base, carouselUrls: urls });
    assert.strictEqual(result.success, false);
  });

  it("score at boundary 0 passes", () => {
    const result = PublishSchema.safeParse({ ...base, score: 0 });
    assert.ok(result.success);
  });

  it("score at boundary 100 passes", () => {
    const result = PublishSchema.safeParse({ ...base, score: 100 });
    assert.ok(result.success);
  });

  it("replyControl 'everyone' passes", () => {
    const result = PublishSchema.safeParse({ ...base, replyControl: "everyone" });
    assert.ok(result.success);
  });

  it("replyControl 'accounts_you_follow' passes", () => {
    const result = PublishSchema.safeParse({ ...base, replyControl: "accounts_you_follow" });
    assert.ok(result.success);
  });

  it("replyControl 'mentioned_only' passes", () => {
    const result = PublishSchema.safeParse({ ...base, replyControl: "mentioned_only" });
    assert.ok(result.success);
  });

  it("replyControl invalid value fails", () => {
    const result = PublishSchema.safeParse({ ...base, replyControl: "friends_only" });
    assert.strictEqual(result.success, false);
  });

  it("spoilerText with up to 10 items passes", () => {
    const result = PublishSchema.safeParse({
      ...base,
      spoilerText: Array.from({ length: 10 }, (_, i) => `tag${i}`),
    });
    assert.ok(result.success);
  });

  it("spoilerText with 11 items (over max) fails", () => {
    const result = PublishSchema.safeParse({
      ...base,
      spoilerText: Array.from({ length: 11 }, (_, i) => `tag${i}`),
    });
    assert.strictEqual(result.success, false);
  });

  it("spoilerText item over 100 characters fails", () => {
    const result = PublishSchema.safeParse({
      ...base,
      spoilerText: ["x".repeat(101)],
    });
    assert.strictEqual(result.success, false);
  });

  it("spoilerMedia boolean passes", () => {
    const result = PublishSchema.safeParse({ ...base, spoilerMedia: true });
    assert.ok(result.success);
  });

  it("ghost boolean passes", () => {
    const result = PublishSchema.safeParse({ ...base, ghost: false });
    assert.ok(result.success);
  });

  it("full object with ALL optional fields passes", () => {
    const result = PublishSchema.safeParse({
      accountId: "acc-full",
      text: "Full post",
      sessionId: "sess-1",
      score: 95,
      imageUrl: "https://example.com/img.jpg",
      videoUrl: "",
      carouselUrls: ["https://a.com/1.jpg", "https://a.com/2.jpg"],
      pollOptions: "Yes|No|Maybe",
      gifId: "gif-abc",
      linkComment: "https://link.com",
      linkAttachment: "",
      textAttachment: "See the article",
      sourceUrl: "https://source.com",
      spoilerMedia: false,
      spoilerText: ["spoiler1"],
      ghost: true,
      quotePostId: "q-123",
      replyControl: "everyone",
      topicTag: "technology",
      altText: "An image of something",
    });
    assert.ok(
      result.success,
      `Full PublishSchema should pass, got: ${JSON.stringify(!result.success && (result as any).error?.issues)}`
    );
  });
});

describe("CreateTaskSchema — boundary tests", () => {
  const validTask = {
    name: "Task",
    account_id: "acc-1",
    prompt_template: "Write about {{topic}}",
    schedule: "0 9 * * *",
  };

  it("max_retries at 0 (minimum boundary) passes", () => {
    const result = CreateTaskSchema.safeParse({ ...validTask, max_retries: 0 });
    assert.ok(result.success);
  });

  it("max_retries at 10 (maximum boundary) passes", () => {
    const result = CreateTaskSchema.safeParse({ ...validTask, max_retries: 10 });
    assert.ok(result.success);
  });

  it("max_retries at 11 (over maximum) fails", () => {
    const result = CreateTaskSchema.safeParse({ ...validTask, max_retries: 11 });
    assert.strictEqual(result.success, false);
  });

  it("max_retries at -1 (below minimum) fails", () => {
    const result = CreateTaskSchema.safeParse({ ...validTask, max_retries: -1 });
    assert.strictEqual(result.success, false);
  });

  it("timeout_ms at 9999 (below minimum) fails", () => {
    const result = CreateTaskSchema.safeParse({ ...validTask, timeout_ms: 9999 });
    assert.strictEqual(result.success, false);
  });

  it("timeout_ms at 10000 (minimum boundary) passes", () => {
    const result = CreateTaskSchema.safeParse({ ...validTask, timeout_ms: 10000 });
    assert.ok(result.success);
  });

  it("timeout_ms at 600000 (maximum boundary) passes", () => {
    const result = CreateTaskSchema.safeParse({ ...validTask, timeout_ms: 600000 });
    assert.ok(result.success);
  });

  it("timeout_ms at 600001 (over maximum) fails", () => {
    const result = CreateTaskSchema.safeParse({ ...validTask, timeout_ms: 600001 });
    assert.strictEqual(result.success, false);
  });

  it("schedule at exactly 5 characters (minimum) passes", () => {
    const result = CreateTaskSchema.safeParse({
      ...validTask,
      schedule: "* * * " /* 6 chars but trim test */,
    });
    // schedule min is 5 chars — "* * *" is 5
    const result2 = CreateTaskSchema.safeParse({ ...validTask, schedule: "* * *" });
    assert.ok(result2.success);
  });

  it("schedule at 4 characters (below minimum) fails", () => {
    const result = CreateTaskSchema.safeParse({ ...validTask, schedule: "* * " }); // 4 chars
    // "* * " is 4 chars if counting space — let's use strict 4-char string
    const result2 = CreateTaskSchema.safeParse({ ...validTask, schedule: "abcd" });
    assert.strictEqual(result2.success, false);
  });

  it("enabled accepts 0 and 1 as integers", () => {
    const r0 = CreateTaskSchema.safeParse({ ...validTask, enabled: 0 });
    const r1 = CreateTaskSchema.safeParse({ ...validTask, enabled: 1 });
    assert.ok(r0.success);
    assert.ok(r1.success);
  });

  it("enabled rejects 2 (outside 0-1 range)", () => {
    const result = CreateTaskSchema.safeParse({ ...validTask, enabled: 2 });
    assert.strictEqual(result.success, false);
  });

  it("min_score at 0 passes", () => {
    const result = CreateTaskSchema.safeParse({ ...validTask, min_score: 0 });
    assert.ok(result.success);
  });

  it("min_score at 100 passes", () => {
    const result = CreateTaskSchema.safeParse({ ...validTask, min_score: 100 });
    assert.ok(result.success);
  });

  it("min_score at 101 fails", () => {
    const result = CreateTaskSchema.safeParse({ ...validTask, min_score: 101 });
    assert.strictEqual(result.success, false);
  });
});

describe("CreateAccountSchema — additional edge cases", () => {
  const base = { name: "Acct", handle: "@h", platform: "threads" as const };

  it("token as empty string passes (optional field)", () => {
    const result = CreateAccountSchema.safeParse({ ...base, token: "" });
    assert.ok(result.success, "empty string token should be accepted (optional)");
  });

  it("user_id as empty string passes (optional field)", () => {
    const result = CreateAccountSchema.safeParse({ ...base, user_id: "" });
    assert.ok(result.success);
  });

  it("handle at exactly 100 characters passes", () => {
    const result = CreateAccountSchema.safeParse({ ...base, handle: "h".repeat(100) });
    assert.ok(result.success);
  });

  it("handle at 101 characters fails", () => {
    const result = CreateAccountSchema.safeParse({ ...base, handle: "h".repeat(101) });
    assert.strictEqual(result.success, false);
  });

  it("style with 500 characters passes", () => {
    const result = CreateAccountSchema.safeParse({ ...base, style: "x".repeat(500) });
    assert.ok(result.success);
  });

  it("style with 501 characters fails", () => {
    const result = CreateAccountSchema.safeParse({ ...base, style: "x".repeat(501) });
    assert.strictEqual(result.success, false);
  });

  it("persona_prompt with 2000 characters passes", () => {
    const result = CreateAccountSchema.safeParse({ ...base, persona_prompt: "p".repeat(2000) });
    assert.ok(result.success);
  });

  it("persona_prompt with 2001 characters fails", () => {
    const result = CreateAccountSchema.safeParse({ ...base, persona_prompt: "p".repeat(2001) });
    assert.strictEqual(result.success, false);
  });

  it("name at exactly 100 characters passes", () => {
    const result = CreateAccountSchema.safeParse({ ...base, name: "n".repeat(100) });
    assert.ok(result.success);
  });
});

describe("UpdateAccountSchema — partial schema", () => {
  it("accepts empty object (all fields optional)", () => {
    const result = UpdateAccountSchema.safeParse({});
    assert.ok(result.success);
  });

  it("accepts partial update with only name", () => {
    const result = UpdateAccountSchema.safeParse({ name: "New Name" });
    assert.ok(result.success);
    assert.strictEqual(result.data.name, "New Name");
  });

  it("rejects empty name string (min 1)", () => {
    const result = UpdateAccountSchema.safeParse({ name: "" });
    assert.strictEqual(result.success, false);
  });

  it("accepts partial update with only token", () => {
    const result = UpdateAccountSchema.safeParse({ token: "new-token" });
    assert.ok(result.success);
  });
});

describe("BatchPublishSchema", () => {
  it("accepts array with 1 id (minimum)", () => {
    const result = BatchPublishSchema.safeParse({ ids: ["id-1"] });
    assert.ok(result.success);
  });

  it("accepts array with 50 ids (maximum)", () => {
    const ids = Array.from({ length: 50 }, (_, i) => `id-${i}`);
    const result = BatchPublishSchema.safeParse({ ids });
    assert.ok(result.success);
  });

  it("rejects empty array", () => {
    const result = BatchPublishSchema.safeParse({ ids: [] });
    assert.strictEqual(result.success, false);
  });

  it("rejects array with 51 ids (over maximum)", () => {
    const ids = Array.from({ length: 51 }, (_, i) => `id-${i}`);
    const result = BatchPublishSchema.safeParse({ ids });
    assert.strictEqual(result.success, false);
  });

  it("rejects ids containing empty string", () => {
    const result = BatchPublishSchema.safeParse({ ids: ["valid-id", ""] });
    assert.strictEqual(result.success, false);
  });

  it("rejects missing ids field", () => {
    const result = BatchPublishSchema.safeParse({});
    assert.strictEqual(result.success, false);
  });
});

describe("BatchRefreshInsightsSchema", () => {
  it("accepts array with 1 id (minimum)", () => {
    const result = BatchRefreshInsightsSchema.safeParse({ ids: ["id-1"] });
    assert.ok(result.success);
  });

  it("accepts array with 20 ids (maximum)", () => {
    const ids = Array.from({ length: 20 }, (_, i) => `id-${i}`);
    const result = BatchRefreshInsightsSchema.safeParse({ ids });
    assert.ok(result.success);
  });

  it("rejects array with 21 ids (over maximum)", () => {
    const ids = Array.from({ length: 21 }, (_, i) => `id-${i}`);
    const result = BatchRefreshInsightsSchema.safeParse({ ids });
    assert.strictEqual(result.success, false);
  });

  it("rejects empty array", () => {
    const result = BatchRefreshInsightsSchema.safeParse({ ids: [] });
    assert.strictEqual(result.success, false);
  });
});

describe("ToggleAutoPublishSchema", () => {
  it("accepts boolean true", () => {
    const result = ToggleAutoPublishSchema.safeParse({ auto_publish: true });
    assert.ok(result.success);
  });

  it("accepts boolean false", () => {
    const result = ToggleAutoPublishSchema.safeParse({ auto_publish: false });
    assert.ok(result.success);
  });

  it("accepts integer 0", () => {
    const result = ToggleAutoPublishSchema.safeParse({ auto_publish: 0 });
    assert.ok(result.success);
  });

  it("accepts integer 1", () => {
    const result = ToggleAutoPublishSchema.safeParse({ auto_publish: 1 });
    assert.ok(result.success);
  });

  it("rejects integer 2 (out of 0-1 range)", () => {
    const result = ToggleAutoPublishSchema.safeParse({ auto_publish: 2 });
    assert.strictEqual(result.success, false);
  });

  it("rejects integer -1 (negative)", () => {
    const result = ToggleAutoPublishSchema.safeParse({ auto_publish: -1 });
    assert.strictEqual(result.success, false);
  });

  it("rejects missing auto_publish field", () => {
    const result = ToggleAutoPublishSchema.safeParse({});
    assert.strictEqual(result.success, false);
  });

  it("rejects string value", () => {
    const result = ToggleAutoPublishSchema.safeParse({ auto_publish: "1" });
    assert.strictEqual(result.success, false);
  });
});

describe("SendMessageSchema", () => {
  it("accepts minimal 1-character content", () => {
    const result = SendMessageSchema.safeParse({ content: "x" });
    assert.ok(result.success);
  });

  it("accepts content at exactly 50000 characters (maximum)", () => {
    const result = SendMessageSchema.safeParse({ content: "x".repeat(50000) });
    assert.ok(result.success);
  });

  it("rejects content exceeding 50000 characters", () => {
    const result = SendMessageSchema.safeParse({ content: "x".repeat(50001) });
    assert.strictEqual(result.success, false);
  });

  it("rejects empty string", () => {
    const result = SendMessageSchema.safeParse({ content: "" });
    assert.strictEqual(result.success, false);
  });

  it("rejects missing content field", () => {
    const result = SendMessageSchema.safeParse({});
    assert.strictEqual(result.success, false);
  });
});
