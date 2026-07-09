import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import { publishToThreads, PublishAmbiguousError } from "../server/services/social-publisher.js";

type MockResponseInit = {
  ok: boolean;
  status: number;
  json?: unknown;
  text?: string;
};

function makeResponse(init: MockResponseInit) {
  const text = init.text ?? JSON.stringify(init.json ?? {});
  return {
    ok: init.ok,
    status: init.status,
    async json() {
      return init.json ?? JSON.parse(text);
    },
    async text() {
      return text;
    },
  };
}

const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.setTimeout = originalSetTimeout;
});

describe("publishToThreads", () => {
  it("requires a quality score before publishing", async () => {
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error("fetch should not be called");
    }) as typeof fetch;

    await assert.rejects(
      () =>
        publishToThreads({
          text: "hello threads",
          token: "token-123",
        } as unknown as Parameters<typeof publishToThreads>[0]),
      /Quality score is required/
    );
    assert.equal(fetchCalls, 0);
  });

  it("rejects a score below the default minimum (70)", async () => {
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error("fetch should not be called");
    }) as typeof fetch;

    await assert.rejects(
      () =>
        publishToThreads({
          text: "hello threads",
          token: "token-123",
          score: 65,
        }),
      /Score 65 below minimum 70/
    );
    assert.equal(fetchCalls, 0);
  });

  it("enforces a configurable minScore gate (settings.minOverallScore)", async () => {
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error("fetch should not be called");
    }) as typeof fetch;

    // Score 75 passes the default gate (70) but must fail a configured gate of 80
    await assert.rejects(
      () =>
        publishToThreads({
          text: "hello threads",
          token: "token-123",
          score: 75,
          minScore: 80,
        }),
      /Score 75 below minimum 80/
    );
    assert.equal(fetchCalls, 0);
  });

  it("throws PublishAmbiguousError when aborted during the final publish step", async () => {
    const controller = new AbortController();

    globalThis.setTimeout = ((callback: TimerHandler) => {
      if (typeof callback === "function") {
        callback();
      }
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout;

    globalThis.fetch = (async (url: string | URL) => {
      const href = String(url);
      if (href.includes("/me?")) {
        return makeResponse({ ok: true, status: 200, json: { id: "user-123" } }) as Response;
      }
      if (href.includes("/user-123/threads_publish?")) {
        // Simulate the caller's timeout firing mid publish request — the post
        // may or may not be live, so the outcome is ambiguous, not "failed".
        controller.abort();
        throw new Error("This operation was aborted");
      }
      if (href.includes("/user-123/threads?")) {
        return makeResponse({ ok: true, status: 200, json: { id: "container-789" } }) as Response;
      }
      throw new Error(`Unexpected fetch call: ${href}`);
    }) as typeof fetch;

    await assert.rejects(
      () =>
        publishToThreads({
          text: "hello threads",
          token: "token-123",
          score: 80,
          signal: controller.signal,
        }),
      (err: unknown) => err instanceof PublishAmbiguousError
    );
  });

  it("treats a timeout (no caller signal) during the final publish as ambiguous", async () => {
    globalThis.setTimeout = ((callback: TimerHandler) => {
      if (typeof callback === "function") callback();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout;

    globalThis.fetch = (async (url: string | URL) => {
      const href = String(url);
      if (href.includes("/me?")) {
        return makeResponse({ ok: true, status: 200, json: { id: "user-123" } }) as Response;
      }
      if (href.includes("/user-123/threads_publish?")) {
        // The per-request 30s timeout (not a caller signal) fires mid publish —
        // still ambiguous because the POST was already dispatched.
        throw new Error("The operation timed out");
      }
      if (href.includes("/user-123/threads?")) {
        return makeResponse({ ok: true, status: 200, json: { id: "container-789" } }) as Response;
      }
      throw new Error(`Unexpected fetch call: ${href}`);
    }) as typeof fetch;

    await assert.rejects(
      () => publishToThreads({ text: "hello", token: "t", score: 80 }),
      (err: unknown) => err instanceof PublishAmbiguousError
    );
  });

  it("treats a definitive HTTP rejection on the final publish as a clean failure, not ambiguous", async () => {
    globalThis.setTimeout = ((callback: TimerHandler) => {
      if (typeof callback === "function") callback();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout;

    globalThis.fetch = (async (url: string | URL) => {
      const href = String(url);
      if (href.includes("/me?")) {
        return makeResponse({ ok: true, status: 200, json: { id: "user-123" } }) as Response;
      }
      if (href.includes("/user-123/threads_publish?")) {
        // Threads definitively rejected the publish — no post was created.
        return makeResponse({ ok: false, status: 400, text: "Invalid creation_id" }) as Response;
      }
      if (href.includes("/user-123/threads?")) {
        return makeResponse({ ok: true, status: 200, json: { id: "container-789" } }) as Response;
      }
      throw new Error(`Unexpected fetch call: ${href}`);
    }) as typeof fetch;

    await assert.rejects(
      () => publishToThreads({ text: "hello", token: "t", score: 80 }),
      (err: unknown) => err instanceof Error && !(err instanceof PublishAmbiguousError)
    );
  });

  it("fetches and returns the published post permalink", async () => {
    const urls: string[] = [];

    globalThis.setTimeout = ((callback: TimerHandler) => {
      if (typeof callback === "function") {
        callback();
      }
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout;

    globalThis.fetch = (async (url: string | URL) => {
      const href = String(url);
      urls.push(href);

      if (href.includes("/me?")) {
        return makeResponse({ ok: true, status: 200, json: { id: "user-123" } }) as Response;
      }
      if (href.includes("/user-123/threads_publish?")) {
        return makeResponse({ ok: true, status: 200, json: { id: "post-456" } }) as Response;
      }
      if (href.includes("/user-123/threads?")) {
        return makeResponse({ ok: true, status: 200, json: { id: "container-789" } }) as Response;
      }
      if (href.includes("/post-456?")) {
        return makeResponse({
          ok: true,
          status: 200,
          json: { permalink: "https://threads.net/t/post-456" },
        }) as Response;
      }

      throw new Error(`Unexpected fetch call: ${href}`);
    }) as typeof fetch;

    const result = await publishToThreads({
      text: "hello threads",
      token: "token-123",
      score: 80,
    });

    assert.deepStrictEqual(result, {
      id: "post-456",
      permalink: "https://threads.net/t/post-456",
    });
    assert.ok(
      urls.some((href) => {
        const parsed = new URL(href);
        return (
          parsed.pathname.endsWith("/post-456") && parsed.searchParams.get("fields") === "permalink"
        );
      })
    );
  });
});
