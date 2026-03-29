/**
 * session-truncate.test.ts
 *
 * Tests for the truncateResult function in server/session.ts.
 * The function caps tool results at 100KB to prevent database bloat.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { truncateResult } from "../server/session.js";

const MAX_SIZE = 100_000;

describe("truncateResult", () => {
  it("content under 100KB is unchanged", () => {
    const content = "Hello, world!";
    const result = truncateResult(content);
    assert.strictEqual(result, content);
  });

  it("content at exactly 100KB is unchanged", () => {
    const content = "x".repeat(MAX_SIZE);
    const result = truncateResult(content);
    assert.strictEqual(result, content);
    assert.strictEqual(result.length, MAX_SIZE);
  });

  it("content over 100KB is truncated with ...[truncated] suffix", () => {
    // Use content significantly over the limit so the truncated result is shorter
    const content = "x".repeat(MAX_SIZE + 1000);
    const result = truncateResult(content);

    assert.ok(result.length < content.length, "result should be shorter than input");
    assert.ok(result.endsWith("\n...[truncated]"), "should end with truncation marker");
    // The truncated content should be exactly MAX_SIZE chars + the suffix
    const expectedPrefix = "x".repeat(MAX_SIZE);
    assert.ok(result.startsWith(expectedPrefix), "should preserve the first 100KB");
    assert.strictEqual(result, expectedPrefix + "\n...[truncated]");
  });

  it("content significantly over 100KB is still properly truncated", () => {
    const content = "abcdefg".repeat(50_000); // ~350KB
    const result = truncateResult(content);

    assert.ok(result.endsWith("\n...[truncated]"));
    // First 100K chars should match
    assert.strictEqual(result.slice(0, MAX_SIZE), content.slice(0, MAX_SIZE));
  });

  it("empty string returns empty string", () => {
    const result = truncateResult("");
    assert.strictEqual(result, "");
  });

  it("single character string is unchanged", () => {
    const result = truncateResult("a");
    assert.strictEqual(result, "a");
  });

  it("content at MAX_SIZE - 1 is unchanged", () => {
    const content = "z".repeat(MAX_SIZE - 1);
    const result = truncateResult(content);
    assert.strictEqual(result, content);
  });

  it("content at MAX_SIZE + 1 is truncated", () => {
    const content = "z".repeat(MAX_SIZE + 1);
    const result = truncateResult(content);
    assert.notStrictEqual(result, content);
    assert.ok(result.endsWith("\n...[truncated]"));
  });
});
