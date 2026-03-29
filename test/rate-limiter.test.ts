/**
 * rate-limiter.test.ts
 *
 * Tests for the rate limiter middleware (server/middleware/rate-limiter.ts).
 * Uses mock req/res/next objects to avoid needing a running Express server.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { rateLimiter } from "../server/middleware/rate-limiter.js";

// Mock factories

function createMockReq(ip: string) {
  return { ip } as any;
}

function createMockRes() {
  const headers: Record<string, string | number> = {};
  let statusCode = 200;
  let jsonBody: unknown = undefined;

  const res = {
    setHeader(name: string, value: string | number) {
      headers[name] = value;
      return res;
    },
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(body: unknown) {
      jsonBody = body;
      return res;
    },
    // Accessors for assertions
    get _headers() {
      return headers;
    },
    get _statusCode() {
      return statusCode;
    },
    get _jsonBody() {
      return jsonBody;
    },
  };

  return res as any;
}

// Since the rate limiter uses a module-level Map, we need unique IPs per test
// to avoid cross-test contamination.
let ipCounter = 0;
function uniqueIp(): string {
  return `10.0.0.${++ipCounter}`;
}

describe("rateLimiter middleware", () => {
  it("request within limit calls next()", () => {
    const ip = uniqueIp();
    const req = createMockReq(ip);
    const res = createMockRes();
    let nextCalled = false;

    rateLimiter(req, res, () => {
      nextCalled = true;
    });

    assert.ok(nextCalled, "next() should be called for requests within limit");
    assert.strictEqual(res._jsonBody, undefined, "should not return a JSON error body");
  });

  it("request at exactly MAX_REQUESTS (120) passes", () => {
    const ip = uniqueIp();

    // Send 120 requests (the max)
    for (let i = 0; i < 120; i++) {
      const req = createMockReq(ip);
      const res = createMockRes();
      let nextCalled = false;

      rateLimiter(req, res, () => {
        nextCalled = true;
      });

      assert.ok(nextCalled, `request ${i + 1} should pass`);
    }
  });

  it("request exceeding MAX_REQUESTS returns 429", () => {
    const ip = uniqueIp();

    // Exhaust the limit (120 requests)
    for (let i = 0; i < 120; i++) {
      const req = createMockReq(ip);
      const res = createMockRes();
      rateLimiter(req, res, () => {});
    }

    // 121st request should be rejected
    const req = createMockReq(ip);
    const res = createMockRes();
    let nextCalled = false;

    rateLimiter(req, res, () => {
      nextCalled = true;
    });

    assert.strictEqual(nextCalled, false, "next() should NOT be called when rate limited");
    assert.strictEqual(res._statusCode, 429, "should return 429 status");
    assert.deepStrictEqual(res._jsonBody, {
      error: "Too many requests. Please try again later.",
    });
  });

  it("rate limit headers are set correctly", () => {
    const ip = uniqueIp();
    const req = createMockReq(ip);
    const res = createMockRes();

    rateLimiter(req, res, () => {});

    assert.strictEqual(res._headers["X-RateLimit-Limit"], 120, "limit header should be 120");
    assert.strictEqual(
      res._headers["X-RateLimit-Remaining"],
      119,
      "remaining should be 119 after first request"
    );
    assert.ok(
      typeof res._headers["X-RateLimit-Reset"] === "number",
      "reset header should be a number"
    );
    // Reset should be roughly now + 60 seconds (in epoch seconds)
    const resetTime = res._headers["X-RateLimit-Reset"] as number;
    const nowSeconds = Math.ceil(Date.now() / 1000);
    assert.ok(resetTime >= nowSeconds, "reset time should be in the future");
    assert.ok(resetTime <= nowSeconds + 61, "reset time should be within ~60s from now");
  });

  it("remaining header decreases with each request", () => {
    const ip = uniqueIp();

    for (let i = 0; i < 5; i++) {
      const req = createMockReq(ip);
      const res = createMockRes();
      rateLimiter(req, res, () => {});

      assert.strictEqual(
        res._headers["X-RateLimit-Remaining"],
        120 - (i + 1),
        `remaining should be ${120 - (i + 1)} after request ${i + 1}`
      );
    }
  });

  it("remaining header floors at 0 when limit exceeded", () => {
    const ip = uniqueIp();

    // Send 121 requests
    let lastRes: any;
    for (let i = 0; i < 121; i++) {
      const req = createMockReq(ip);
      lastRes = createMockRes();
      rateLimiter(req, lastRes, () => {});
    }

    assert.strictEqual(
      lastRes._headers["X-RateLimit-Remaining"],
      0,
      "remaining should be 0, not negative"
    );
  });

  it("different IPs have independent counters", () => {
    const ip1 = uniqueIp();
    const ip2 = uniqueIp();

    // Send 120 requests from ip1 (exhaust limit)
    for (let i = 0; i < 120; i++) {
      rateLimiter(createMockReq(ip1), createMockRes(), () => {});
    }

    // ip1's 121st should fail
    const res1 = createMockRes();
    let next1Called = false;
    rateLimiter(createMockReq(ip1), res1, () => {
      next1Called = true;
    });
    assert.strictEqual(next1Called, false, "ip1 should be rate limited");
    assert.strictEqual(res1._statusCode, 429);

    // ip2's first request should succeed
    const res2 = createMockRes();
    let next2Called = false;
    rateLimiter(createMockReq(ip2), res2, () => {
      next2Called = true;
    });
    assert.ok(next2Called, "ip2 should NOT be rate limited");
  });

  it("fallback IP is used when req.ip is undefined", () => {
    const req = { ip: undefined } as any;
    const res = createMockRes();
    let nextCalled = false;

    rateLimiter(req, res, () => {
      nextCalled = true;
    });

    // Should not throw, and should use fallback "127.0.0.1"
    assert.ok(nextCalled, "should call next() even without req.ip");
    assert.strictEqual(res._headers["X-RateLimit-Limit"], 120);
  });
});
