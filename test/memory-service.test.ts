/**
 * memory-service.test.ts
 *
 * Real integration coverage for server/services/memory-service.ts (singleton
 * `memoryService`) and its underlying store methods in server/db.ts.
 *
 * These tests import the REAL modules — no harness reimplementation. The DB is
 * isolated to a fresh temp dir via STUDIO_USER_DATA_PATH, which runtime-paths.ts
 * resolves into <dir>/studio.db. The env var MUST be set before db.js is imported,
 * so db-touching modules are loaded dynamically inside before() (static ESM
 * imports are hoisted and would run before the assignment below).
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";

// Isolate the DB to a throwaway temp dir BEFORE any module opens it.
const TMP_DIR = mkdtempSync(path.join(tmpdir(), "studio-memtest-"));
process.env.STUDIO_USER_DATA_PATH = TMP_DIR;
const DB_PATH = path.join(TMP_DIR, "studio.db");

// agent_memories.account_id is a FK to social_accounts(id) and db.ts enables
// foreign_keys, so any accountId we attach to a memory must exist as an account.
const ACCOUNT_IDS = [
  "acc-A4",
  "acc-B4",
  "acc-typeA",
  "acc-typeB",
  "acc-regr-x",
  "acc-scoped-other",
  "acc-refl",
];

let memoryService: typeof import("../server/services/memory-service.js").memoryService;
let store: typeof import("../server/db.js").default;
let seedDb: Database.Database;

before(async () => {
  ({ memoryService } = await import("../server/services/memory-service.js"));
  store = (await import("../server/db.js")).default; // creates tables at DB_PATH

  // Seed the referenced social accounts via a second connection (WAL makes these
  // committed rows visible to db.js's own connection for FK checks).
  const DatabaseCtor = (await import("better-sqlite3")).default;
  seedDb = new DatabaseCtor(DB_PATH);
  const insertAccount = seedDb.prepare(
    `INSERT INTO social_accounts (id, name, handle, platform) VALUES (?, ?, ?, 'threads')`
  );
  for (const id of ACCOUNT_IDS) insertAccount.run(id, `Account ${id}`, `@${id}`);
});

after(() => {
  if (seedDb) seedDb.close();
  rmSync(TMP_DIR, { recursive: true, force: true });
});

describe("memoryService.saveMemory + searchMemory (FTS5 insert trigger)", () => {
  it("saveMemory persists a memory with defaults", () => {
    const mem = memoryService.saveMemory({ content: "savebasic token content here" });
    assert.ok(mem.id, "saved memory should have an id");
    assert.strictEqual(mem.content, "savebasic token content here");
    assert.strictEqual(mem.memory_type, "general", "default memory_type should be 'general'");
    assert.strictEqual(mem.access_count, 0);
  });

  it("searchMemory finds a memory the FTS5 insert trigger indexed", () => {
    const mem = memoryService.saveMemory({
      content: "ftsinserttoken viral thread hook lesson",
    });
    const results = memoryService.searchMemory("ftsinserttoken");
    const ids = results.map((m) => m.id);
    assert.ok(ids.includes(mem.id), "search should surface the just-saved memory via FTS5");
  });

  it("searchMemory supports multi-word phrase queries", () => {
    const mem = memoryService.saveMemory({
      content: "phrasetokenz alpha beta gamma sequence",
    });
    const results = memoryService.searchMemory("phrasetokenz alpha");
    assert.ok(results.some((m) => m.id === mem.id));
  });
});

describe("memoryService.searchMemory — filters", () => {
  it("memoryType filter returns only matching type", () => {
    const success = memoryService.saveMemory({
      content: "typefiltertok success entry",
      memoryType: "success",
    });
    const failure = memoryService.saveMemory({
      content: "typefiltertok failure entry",
      memoryType: "failure",
    });

    const results = memoryService.searchMemory("typefiltertok", { memoryType: "success" });
    const ids = results.map((m) => m.id);
    assert.ok(ids.includes(success.id), "success-typed memory should be returned");
    assert.ok(!ids.includes(failure.id), "failure-typed memory should be filtered out");
    assert.ok(
      results.every((m) => m.memory_type === "success"),
      "every returned memory must be of the requested type"
    );
  });

  it("accountId filter surfaces the account's memories AND global (NULL) memories, but not other accounts", () => {
    const a = memoryService.saveMemory({ content: "accfiltertok alpha", accountId: "acc-A4" });
    const b = memoryService.saveMemory({ content: "accfiltertok beta", accountId: "acc-B4" });
    const global = memoryService.saveMemory({ content: "accfiltertok gamma" }); // no accountId → NULL

    const results = memoryService.searchMemory("accfiltertok", { accountId: "acc-A4" });
    const ids = results.map((m) => m.id);
    assert.ok(ids.includes(a.id), "own-account memory should be returned");
    assert.ok(ids.includes(global.id), "global (account-agnostic) memory should be returned");
    assert.ok(!ids.includes(b.id), "other account's memory must NOT leak through");
    assert.ok(
      results.every((m) => m.account_id === null || m.account_id === "acc-A4"),
      "results must be limited to the queried account plus globals"
    );
  });
});

describe("store.getMemoriesByType — DB-level WHERE filter", () => {
  it("filters by memory_type at the DB level", () => {
    const pref = memoryService.saveMemory({
      content: "getbytype preference row unique1",
      memoryType: "preference",
    });
    memoryService.saveMemory({
      content: "getbytype general row unique2",
      memoryType: "general",
    });

    const prefs = store.getMemoriesByType("preference", undefined, 200);
    assert.ok(
      prefs.every((m) => m.memory_type === "preference"),
      "getMemoriesByType must return only rows of the requested type"
    );
    assert.ok(prefs.some((m) => m.id === pref.id));
  });

  it("account filter excludes other accounts; undefined accountId spans all accounts", () => {
    const ta = memoryService.saveMemory({
      content: "getbytypeacct row A",
      memoryType: "success",
      accountId: "acc-typeA",
    });
    const tb = memoryService.saveMemory({
      content: "getbytypeacct row B",
      memoryType: "success",
      accountId: "acc-typeB",
    });

    const scoped = store.getMemoriesByType("success", "acc-typeA", 500);
    const scopedIds = scoped.map((m) => m.id);
    assert.ok(scopedIds.includes(ta.id), "own-account success memory returned");
    assert.ok(!scopedIds.includes(tb.id), "other account's memory excluded");
    assert.ok(scoped.every((m) => m.account_id === null || m.account_id === "acc-typeA"));

    // undefined accountId must NOT collapse to global-only (dedicated all-accounts stmt)
    const all = store.getMemoriesByType("success", undefined, 500);
    const allIds = all.map((m) => m.id);
    assert.ok(allIds.includes(ta.id) && allIds.includes(tb.id), "all-accounts query spans both");
  });
});

describe("memoryService.searchMemory — FTS query sanitization", () => {
  it("special-character queries never throw and always return an array", () => {
    const trickyQueries = [
      '"',
      "*",
      "AND",
      "OR",
      "NOT",
      "foo AND bar",
      "(test)",
      "-viral",
      '"unterminated',
      "a:b^c*",
    ];
    for (const q of trickyQueries) {
      assert.doesNotThrow(
        () => {
          const r = memoryService.searchMemory(q);
          assert.ok(Array.isArray(r), `query ${JSON.stringify(q)} should return an array`);
        },
        `query ${JSON.stringify(q)} must not throw`
      );
    }
  });

  it("a query that sanitizes to empty returns [] without hitting the DB", () => {
    assert.deepStrictEqual(memoryService.searchMemory('""'), []);
    assert.deepStrictEqual(memoryService.searchMemory("***"), []);
  });
});

describe("loadContextMemories — undefined accountId regression (NULL-binding fix)", () => {
  it("loadContextMemories(undefined) returns ALL memories, including per-account ones", () => {
    const perAccount = memoryService.saveMemory({
      content: "ctxregr per-account entry",
      accountId: "acc-regr-x",
    });
    const global = memoryService.saveMemory({ content: "ctxregr global entry" });

    const all = memoryService.loadContextMemories(undefined, 1000);
    const ids = all.map((m) => m.id);
    assert.ok(
      ids.includes(perAccount.id),
      "undefined accountId must NOT collapse to global-only — per-account memory must appear"
    );
    assert.ok(ids.includes(global.id));
  });

  it("loadContextMemories(accountId) returns that account + globals only", () => {
    const other = memoryService.saveMemory({
      content: "ctxscoped other-account entry",
      accountId: "acc-scoped-other",
    });
    const results = memoryService.loadContextMemories("acc-some-account", 1000);
    assert.ok(
      results.every((m) => m.account_id === null || m.account_id === "acc-some-account"),
      "scoped context load must not surface a different account's memory"
    );
    assert.ok(!results.map((m) => m.id).includes(other.id));
  });

  it("buildMemoryBlock renders saved memory content into a markdown block", () => {
    memoryService.saveMemory({ content: "buildblocktoken remember this lesson" });
    const block = memoryService.buildMemoryBlock(undefined, 1000);
    assert.ok(block.includes("Long-Term Memory"), "block should carry the section header");
    assert.ok(block.includes("buildblocktoken remember this lesson"));
  });
});

describe("FTS5 delete trigger sync", () => {
  it("deleting a memory removes it from the FTS5 index (search stops finding it)", () => {
    const mem = memoryService.saveMemory({ content: "uniquedeletetoken solitary phrase" });

    const before = memoryService.searchMemory("uniquedeletetoken");
    assert.strictEqual(before.length, 1, "exactly one memory should match the unique token");
    assert.strictEqual(before[0].id, mem.id);

    const deleted = store.deleteMemory(mem.id);
    assert.ok(deleted, "deleteMemory should report success");

    const after = memoryService.searchMemory("uniquedeletetoken");
    assert.strictEqual(after.length, 0, "FTS5 delete trigger should drop the row from the index");
  });
});

describe("memoryService.saveReflection", () => {
  it("persists the reflection and auto-saves improvement notes as a 'reflection' memory", () => {
    const reflection = memoryService.saveReflection({
      sessionId: "sess-refl-1",
      trigger: "turn_end",
      reflectionContent: "Reviewed the draft and found it too long.",
      improvementNotes: "reflimprovetoken keep posts under 3 sentences",
      accountId: "acc-refl",
    });
    assert.ok(reflection.id);
    assert.strictEqual(reflection.session_id, "sess-refl-1");

    const reflections = memoryService.getReflections("sess-refl-1");
    assert.ok(
      reflections.some((r) => r.id === reflection.id),
      "getReflections should return it"
    );

    // improvementNotes auto-persist as a 'reflection'-typed memory for the account
    const mems = store.getMemoriesByType("reflection", "acc-refl", 200);
    assert.ok(
      mems.some((m) => m.content.includes("reflimprovetoken")),
      "improvement notes should be saved as a reflection memory"
    );
  });

  it("does not create an improvement memory when improvementNotes are omitted", () => {
    const before = store.getMemoriesByType("reflection", undefined, 1000).length;
    memoryService.saveReflection({
      sessionId: "sess-refl-2",
      trigger: "tool_result",
      reflectionContent: "Nothing notable.",
    });
    const after = store.getMemoriesByType("reflection", undefined, 1000).length;
    assert.strictEqual(after, before, "no improvement note → no new reflection memory");
  });
});
