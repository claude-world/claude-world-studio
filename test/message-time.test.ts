// Regression test for the WS-reconnect history-merge timezone bug (v2.2.1):
// SQLite `created_at` ("YYYY-MM-DD HH:MM:SS", naive UTC) must compare equal to a
// local message's ISO-UTC `timestamp` for the same instant, in ANY timezone.
// Force a non-UTC zone so a naive `new Date(str)` (the old buggy behavior) would
// visibly skew — Node re-reads process.env.TZ on the next Date operation.
process.env.TZ = "Asia/Taipei"; // UTC+8, no DST

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { messageEpoch } from "../client/lib/messageTime.js";

describe("messageEpoch", () => {
  it("parses SQLite naive-UTC created_at as UTC, not local time", () => {
    // Same instant, two representations: a history row vs a live message.
    const sqliteNaive = "2026-07-08 04:00:00"; // SQLite datetime('now')
    const isoUtc = "2026-07-08T04:00:00.000Z"; // new Date().toISOString()
    assert.equal(messageEpoch(sqliteNaive), Date.parse(isoUtc));
    // Explicit UTC epoch (Jul 8 2026 04:00:00 UTC) — independent of the test's TZ.
    assert.equal(messageEpoch(sqliteNaive), Date.UTC(2026, 6, 8, 4, 0, 0));
  });

  it("does NOT skew by the local UTC offset (the bug being guarded)", () => {
    // The old code did `new Date("2026-07-08 04:00:00")`, parsed as Asia/Taipei
    // local => 8h earlier in UTC. Assert we are NOT off by the offset.
    const naive = "2026-07-08 04:00:00";
    const buggyLocalParse = new Date(naive.replace(" ", "T")).getTime(); // local-parsed
    assert.notEqual(messageEpoch(naive), buggyLocalParse); // proves normalization ran
    assert.equal(messageEpoch(naive) - buggyLocalParse, 8 * 60 * 60 * 1000); // exactly +8h
  });

  it("passes ISO-UTC timestamps through unchanged", () => {
    const iso = "2026-07-08T12:34:56.789Z";
    assert.equal(messageEpoch(iso), Date.parse(iso));
  });

  it("returns 0 for missing timestamps", () => {
    assert.equal(messageEpoch(undefined), 0);
    assert.equal(messageEpoch(null), 0);
    assert.equal(messageEpoch(""), 0);
  });

  it("keeps history and a strictly-newer local message correctly ordered", () => {
    // Mirrors App.tsx's merge comparison: a local message 1s after the last
    // history row must sort as newer regardless of format mismatch.
    const lastHistory = messageEpoch("2026-07-08 04:00:00"); // naive UTC
    const localNewer = messageEpoch("2026-07-08T04:00:01.000Z"); // ISO UTC, +1s
    assert.ok(localNewer > lastHistory);
    // And a local message BEFORE the last history row must NOT be treated as newer.
    const localOlder = messageEpoch("2026-07-08T03:59:59.000Z");
    assert.ok(localOlder < lastHistory);
  });
});
