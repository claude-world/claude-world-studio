/**
 * strategy-agent.test.ts
 *
 * Real coverage for server/services/strategy-agent.ts (singleton `strategyAgent`).
 *
 * We seed publish_history + post_insights_cache rows with known timestamps and
 * engagement into the isolated temp DB, then assert runStrategy() derives the
 * expected best-posting hours (using SQLite's 'localtime' conversion) and that
 * `persistMemory:false` does NOT write an agent_memories row while the default
 * DOES (regression for the idempotent-GET fix).
 *
 * Seeding uses a SECOND better-sqlite3 connection to the same DB file so we can
 * set explicit created_at values (store.addPublish would stamp datetime('now')).
 * WAL mode makes those committed writes visible to db.js's own connection.
 * Nothing here touches the network or the Claude Agent SDK — strategy-agent is
 * pure DB + memory analysis.
 *
 * DB isolation: STUDIO_USER_DATA_PATH is set before db.js is imported (dynamic
 * import in before()).
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";

const TMP_DIR = mkdtempSync(path.join(tmpdir(), "studio-strattest-"));
process.env.STUDIO_USER_DATA_PATH = TMP_DIR;
const DB_PATH = path.join(TMP_DIR, "studio.db");

const ACCOUNT_ID = "acct-strategy-test";

let strategyAgent: typeof import("../server/services/strategy-agent.js").strategyAgent;
let store: typeof import("../server/db.js").default;
let seedDb: Database.Database;

// Build two UTC timestamps a few days ago so they always fall inside the lookback
// window regardless of the machine's real clock. Post 1 (03:00 UTC) has far higher
// engagement than Post 2 (15:00 UTC), so its local hour must rank first.
function utcAtHour(daysAgo: number, hourUtc: number): string {
  const base = new Date(Date.now() - daysAgo * 86_400_000);
  const dt = new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), hourUtc, 0, 0)
  );
  return dt.toISOString().replace("T", " ").slice(0, 19); // "YYYY-MM-DD HH:MM:SS"
}

const TS_HIGH = utcAtHour(5, 3); // 03:00 UTC, high engagement
const TS_LOW = utcAtHour(5, 15); // 15:00 UTC, low engagement
// Expected local hours — computed with the SAME OS timezone SQLite's 'localtime' uses.
const LOCAL_HOUR_HIGH = new Date(TS_HIGH.replace(" ", "T") + "Z").getHours();
const LOCAL_HOUR_LOW = new Date(TS_LOW.replace(" ", "T") + "Z").getHours();

before(async () => {
  ({ strategyAgent } = await import("../server/services/strategy-agent.js"));
  store = (await import("../server/db.js")).default; // creates tables at DB_PATH

  const DatabaseCtor = (await import("better-sqlite3")).default;
  seedDb = new DatabaseCtor(DB_PATH);
  seedDb.pragma("foreign_keys = ON");

  // agent_memories.account_id is a FK to social_accounts(id); the default (persist)
  // strategy run saves a memory tagged to ACCOUNT_ID, so the account must exist.
  seedDb
    .prepare(`INSERT INTO social_accounts (id, name, handle, platform) VALUES (?, ?, ?, 'threads')`)
    .run(ACCOUNT_ID, "Strategy Test", "@strategytest");

  const insertPost = seedDb.prepare(
    `INSERT INTO publish_history (id, session_id, platform, account, content, score, status, created_at)
     VALUES (?, NULL, 'threads', ?, ?, ?, 'published', ?)`
  );
  const insertInsights = seedDb.prepare(
    `INSERT INTO post_insights_cache (publish_id, views, likes, replies, reposts, quotes)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  // Post 1 — high engagement (300), 1000 views
  insertPost.run("post-high", ACCOUNT_ID, "Top performing thread about AI agents", 92, TS_HIGH);
  insertInsights.run("post-high", 1000, 200, 50, 30, 20);

  // Post 2 — low engagement (18), 500 views
  insertPost.run("post-low", ACCOUNT_ID, "A quieter follow-up post", 81, TS_LOW);
  insertInsights.run("post-low", 500, 10, 5, 2, 1);
});

after(() => {
  if (seedDb) seedDb.close();
  rmSync(TMP_DIR, { recursive: true, force: true });
});

describe("strategyAgent.runStrategy — analytics-derived report", () => {
  it("reports the correct published count and engagement rate", () => {
    const report = strategyAgent.runStrategy({
      accountId: ACCOUNT_ID,
      days: 365,
      persistMemory: false,
    });
    assert.strictEqual(report.total_published, 2);

    // totalEngagement = 300 + 18 = 318; totalViews = 1500 → rounded pct
    const expectedEngRate = Math.round((318 / 1500) * 10000) / 100;
    assert.strictEqual(report.engagement_rate_pct, expectedEngRate);
  });

  it("ranks best posting hours by engagement and converts to LOCAL time", () => {
    const report = strategyAgent.runStrategy({
      accountId: ACCOUNT_ID,
      days: 365,
      persistMemory: false,
    });
    assert.ok(report.best_hours.length >= 2, "both hour buckets should be present");
    assert.strictEqual(
      report.best_hours[0],
      LOCAL_HOUR_HIGH,
      "highest-engagement hour must rank first and be in local wall-clock time"
    );
    assert.ok(
      report.best_hours.includes(LOCAL_HOUR_LOW),
      "the lower-engagement hour should still be listed"
    );
    // Sanity: local conversion actually shifted (or matched) the stored UTC hour,
    // and the two buckets are distinct.
    assert.notStrictEqual(LOCAL_HOUR_HIGH, LOCAL_HOUR_LOW);
  });

  it("derives top formats and a content calendar aligned to the best hour", () => {
    const report = strategyAgent.runStrategy({
      accountId: ACCOUNT_ID,
      days: 365,
      persistMemory: false,
    });
    // Neither post has an image → both bucket as 'text_only'
    assert.ok(report.top_formats.length >= 1);
    assert.strictEqual(report.top_formats[0].format, "text_only");
    assert.strictEqual(report.top_formats[0].posts, 2);

    assert.ok(report.content_calendar.length > 0, "calendar should have at least one slot");
    assert.strictEqual(
      report.content_calendar[0].hour,
      LOCAL_HOUR_HIGH,
      "first calendar slot should use the top-ranked local hour"
    );

    assert.ok(report.recommendations.length > 0);
    assert.ok(
      report.recommendations.some((r) => r.includes(`${LOCAL_HOUR_HIGH}:00`)),
      "recommendations should mention the best posting time in local hours"
    );
  });

  it("honours includeCalendar:false", () => {
    const report = strategyAgent.runStrategy({
      accountId: ACCOUNT_ID,
      days: 365,
      includeCalendar: false,
      persistMemory: false,
    });
    assert.deepStrictEqual(report.content_calendar, []);
  });
});

describe("strategyAgent.runStrategy — persistMemory regression", () => {
  it("persistMemory:false writes NO memory row; the default DOES", () => {
    const countMemories = () => store.getContextMemories(undefined, 10_000).length;

    const baseline = countMemories();

    // Read-only run (mirrors the idempotent GET route) — must not persist.
    strategyAgent.runStrategy({ accountId: ACCOUNT_ID, days: 365, persistMemory: false });
    assert.strictEqual(
      countMemories(),
      baseline,
      "persistMemory:false must not create an agent_memories row"
    );

    // Default run (explicit MCP path) — persists exactly one strategy memory.
    strategyAgent.runStrategy({ accountId: ACCOUNT_ID, days: 365 });
    assert.strictEqual(
      countMemories(),
      baseline + 1,
      "default run must persist exactly one strategy memory"
    );

    // The persisted memory is a tagged 'success' strategy note for this account.
    const saved = store
      .getMemoriesByType("success", ACCOUNT_ID, 10_000)
      .find((m) => m.content.includes("Content strategy"));
    assert.ok(saved, "a 'Content strategy' success memory should have been saved");
    assert.ok(saved!.tags && saved!.tags.includes("strategy"));
  });
});
