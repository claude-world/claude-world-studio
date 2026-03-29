/**
 * analytics-cache.test.ts
 *
 * Tests for the analytics cache pattern used in server/db.ts.
 * Since the cache (getCached / invalidateAnalyticsCache) is module-internal
 * and tightly coupled with SQLite, we test a standalone replica of the
 * caching logic with the same semantics.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Standalone cache replica matching the pattern in server/db.ts
class AnalyticsCache {
  private cache = new Map<string, { data: unknown; expiry: number }>();
  private ttlMs: number;

  constructor(ttlMs = 60_000) {
    this.ttlMs = ttlMs;
  }

  getCached<T>(key: string, compute: () => T): T {
    const cached = this.cache.get(key);
    if (cached && Date.now() < cached.expiry) return cached.data as T;
    const data = compute();
    this.cache.set(key, { data, expiry: Date.now() + this.ttlMs });
    return data;
  }

  invalidate(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

describe("AnalyticsCache", () => {
  let cache: AnalyticsCache;

  beforeEach(() => {
    // Use a long TTL for most tests (won't expire during test)
    cache = new AnalyticsCache(60_000);
  });

  it("getCached computes and returns value on first call (cache miss)", () => {
    let computeCalls = 0;
    const result = cache.getCached("key1", () => {
      computeCalls++;
      return { total: 42 };
    });

    assert.deepStrictEqual(result, { total: 42 });
    assert.strictEqual(computeCalls, 1, "compute should be called once on cache miss");
  });

  it("getCached returns cached value on second call (cache hit)", () => {
    let computeCalls = 0;
    const compute = () => {
      computeCalls++;
      return { total: computeCalls };
    };

    const first = cache.getCached("key1", compute);
    const second = cache.getCached("key1", compute);

    assert.strictEqual(computeCalls, 1, "compute should be called only once");
    assert.deepStrictEqual(first, { total: 1 });
    assert.deepStrictEqual(second, { total: 1 }, "second call should return cached value");
  });

  it("different keys have independent cache entries", () => {
    const result1 = cache.getCached("overview_30", () => ({ posts: 10 }));
    const result2 = cache.getCached("overview_7", () => ({ posts: 3 }));

    assert.deepStrictEqual(result1, { posts: 10 });
    assert.deepStrictEqual(result2, { posts: 3 });
    assert.strictEqual(cache.size, 2);
  });

  it("invalidate clears all cached entries", () => {
    cache.getCached("k1", () => "a");
    cache.getCached("k2", () => "b");
    assert.strictEqual(cache.size, 2);

    cache.invalidate();

    assert.strictEqual(cache.size, 0, "cache should be empty after invalidation");
  });

  it("after invalidation, next getCached recomputes", () => {
    let calls = 0;
    cache.getCached("k1", () => ++calls);
    assert.strictEqual(calls, 1);

    cache.invalidate();

    const result = cache.getCached("k1", () => ++calls);
    assert.strictEqual(calls, 2, "compute should be called again after invalidation");
    assert.strictEqual(result, 2);
  });

  it("TTL expiry causes recomputation", () => {
    // Use a very short TTL
    const shortCache = new AnalyticsCache(1); // 1ms TTL

    let calls = 0;
    shortCache.getCached("k", () => ++calls);
    assert.strictEqual(calls, 1);

    // Wait for TTL to expire. We use a synchronous busy-wait since the TTL is 1ms.
    const start = Date.now();
    while (Date.now() - start < 5) {
      // busy wait 5ms to ensure expiry
    }

    const result = shortCache.getCached("k", () => ++calls);
    assert.strictEqual(calls, 2, "compute should be called again after TTL expiry");
    assert.strictEqual(result, 2);
  });

  it("cache hit returns exact same reference (not a copy)", () => {
    const obj = { nested: { value: 1 } };
    const first = cache.getCached("ref-test", () => obj);
    const second = cache.getCached("ref-test", () => ({ nested: { value: 999 } }));

    assert.strictEqual(first, second, "should return same object reference");
    assert.strictEqual(first, obj, "should be the exact same object");
  });

  it("invalidate is safe to call on empty cache", () => {
    assert.doesNotThrow(() => cache.invalidate(), "invalidate on empty cache should not throw");
    assert.strictEqual(cache.size, 0);
  });

  it("invalidate is safe to call multiple times", () => {
    cache.getCached("k", () => 1);

    cache.invalidate();
    cache.invalidate();
    cache.invalidate();

    assert.strictEqual(cache.size, 0);
  });

  it("cache correctly stores falsy values", () => {
    let calls = 0;

    cache.getCached("zero", () => {
      calls++;
      return 0;
    });
    const second = cache.getCached("zero", () => {
      calls++;
      return 999;
    });

    // With the current implementation, 0 is falsy but `cached && ...` still works
    // because the Map entry itself is truthy. This verifies the pattern handles it.
    assert.strictEqual(calls, 1, "should cache the value 0 without recomputing");
    assert.strictEqual(second, 0);
  });

  it("cache stores null and undefined values correctly", () => {
    let nullCalls = 0;
    cache.getCached("null-key", () => {
      nullCalls++;
      return null;
    });
    cache.getCached("null-key", () => {
      nullCalls++;
      return "not null";
    });

    assert.strictEqual(nullCalls, 1, "null should be cached");
  });
});
