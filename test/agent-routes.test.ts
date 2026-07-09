/**
 * agent-routes.test.ts
 *
 * Real HTTP coverage for server/routes/agent.ts. We mount the ACTUAL Express
 * router the same way server.ts does (app.use("/api/agent", agentRouter)),
 * bind it to an ephemeral port with app.listen(0), and drive it with global
 * fetch. No supertest dependency is available, so we use a real socket.
 *
 * DB isolation: STUDIO_USER_DATA_PATH points at a fresh temp dir and MUST be set
 * before db.js is imported — hence dynamic import inside before().
 *
 * NOT covered here (and why):
 *  - POST /api/agent/matrix-run and the pause/resume/abort *happy* paths call
 *    orchestrator.runGoal(), which spins the real PLAN→EXECUTE→REFLECT state
 *    machine (timers + memory writes). Those belong to the orchestrator's own
 *    lifecycle suite. We assert the documented 409 behaviour for goals that have
 *    no live orchestrator run instead.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

const TMP_DIR = mkdtempSync(path.join(tmpdir(), "studio-routetest-"));
process.env.STUDIO_USER_DATA_PATH = TMP_DIR;

let server: Server | undefined;
let port = 0;

async function api(
  method: string,
  pathname: string,
  body?: unknown
): Promise<{ status: number; body: any }> {
  const res = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: any;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

before(async () => {
  const express = (await import("express")).default;
  const agentRouter = (await import("../server/routes/agent.js")).default;
  const app = express();
  app.use(express.json());
  app.use("/api/agent", agentRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  port = (server!.address() as AddressInfo).port;
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
  // Clears the orchestrator's non-unref'd GC interval so the process can exit.
  const { runAllCleanups } = await import("../server/cleanup-registry.js");
  await runAllCleanups();
  rmSync(TMP_DIR, { recursive: true, force: true });
});

// ── Goals ────────────────────────────────────────────────────────────────────

describe("POST /api/agent/goals", () => {
  it("creates a goal (201) with active status and 0 progress", async () => {
    const { status, body } = await api("POST", "/api/agent/goals", {
      description: "Write a weekly recap thread",
    });
    assert.strictEqual(status, 201);
    assert.ok(body.id, "response should include the new goal id");
    assert.strictEqual(body.description, "Write a weekly recap thread");
    assert.strictEqual(body.status, "active");
    assert.strictEqual(body.progress, 0);
  });

  it("rejects a missing description (400)", async () => {
    const { status, body } = await api("POST", "/api/agent/goals", {});
    assert.strictEqual(status, 400);
    assert.match(body.error, /description is required/);
  });

  it("rejects an over-long description (400)", async () => {
    const { status } = await api("POST", "/api/agent/goals", { description: "x".repeat(2001) });
    assert.strictEqual(status, 400);
  });
});

describe("GET /api/agent/goals + /goals/:id", () => {
  it("lists active goals and can fetch one by id", async () => {
    const created = await api("POST", "/api/agent/goals", { description: "Fetchable goal" });
    const id = created.body.id;

    const list = await api("GET", "/api/agent/goals");
    assert.strictEqual(list.status, 200);
    assert.ok(Array.isArray(list.body));
    assert.ok(
      list.body.some((g: any) => g.id === id),
      "created goal should appear in active list"
    );

    const one = await api("GET", `/api/agent/goals/${id}`);
    assert.strictEqual(one.status, 200);
    assert.strictEqual(one.body.id, id);
  });

  it("returns 400 for an invalid status filter", async () => {
    const { status } = await api("GET", "/api/agent/goals?status=bogus");
    assert.strictEqual(status, 400);
  });

  it("returns 404 for an unknown goal id", async () => {
    const { status, body } = await api("GET", "/api/agent/goals/does-not-exist");
    assert.strictEqual(status, 404);
    assert.match(body.error, /not found/i);
  });
});

describe("PATCH /api/agent/goals/:id/progress", () => {
  it("updates progress and clamps into 0-100", async () => {
    const created = await api("POST", "/api/agent/goals", { description: "Progress goal" });
    const id = created.body.id;

    const patched = await api("PATCH", `/api/agent/goals/${id}/progress`, { progress: 50 });
    assert.strictEqual(patched.status, 200);
    assert.strictEqual(patched.body.progress, 50);

    const clamped = await api("PATCH", `/api/agent/goals/${id}/progress`, { progress: 250 });
    assert.strictEqual(clamped.body.progress, 100, "progress above 100 should clamp to 100");
  });

  it("transitions status and moves the goal out of the active list", async () => {
    const created = await api("POST", "/api/agent/goals", { description: "Completable goal" });
    const id = created.body.id;

    const done = await api("PATCH", `/api/agent/goals/${id}/progress`, { status: "completed" });
    assert.strictEqual(done.status, 200);
    assert.strictEqual(done.body.status, "completed");

    const active = await api("GET", "/api/agent/goals?status=active");
    assert.ok(!active.body.some((g: any) => g.id === id), "completed goal must leave active list");
    const completed = await api("GET", "/api/agent/goals?status=completed");
    assert.ok(completed.body.some((g: any) => g.id === id));
  });

  it("rejects an invalid status (400)", async () => {
    const created = await api("POST", "/api/agent/goals", { description: "Bad status goal" });
    const { status } = await api("PATCH", `/api/agent/goals/${created.body.id}/progress`, {
      status: "nonsense",
    });
    assert.strictEqual(status, 400);
  });

  it("returns 404 when patching a non-existent goal", async () => {
    const { status } = await api("PATCH", "/api/agent/goals/nope/progress", { progress: 10 });
    assert.strictEqual(status, 404);
  });
});

describe("DELETE /api/agent/goals/:id", () => {
  it("deletes a goal and a subsequent GET returns 404", async () => {
    const created = await api("POST", "/api/agent/goals", { description: "Deletable goal" });
    const id = created.body.id;

    const del = await api("DELETE", `/api/agent/goals/${id}`);
    assert.strictEqual(del.status, 200);
    assert.strictEqual(del.body.deleted, true);

    const after = await api("GET", `/api/agent/goals/${id}`);
    assert.strictEqual(after.status, 404);
  });

  it("returns 404 when deleting an unknown goal", async () => {
    const { status } = await api("DELETE", "/api/agent/goals/ghost-id");
    assert.strictEqual(status, 404);
  });
});

describe("pause/resume/abort on a goal with no orchestrator run (documented 409)", () => {
  it("pause returns 409", async () => {
    const created = await api("POST", "/api/agent/goals", { description: "No-run goal 1" });
    const { status, body } = await api("POST", `/api/agent/goals/${created.body.id}/pause`);
    assert.strictEqual(status, 409);
    assert.match(body.error, /not found or not in a pausable state/);
  });

  it("resume returns 409", async () => {
    const created = await api("POST", "/api/agent/goals", { description: "No-run goal 2" });
    const { status } = await api("POST", `/api/agent/goals/${created.body.id}/resume`);
    assert.strictEqual(status, 409);
  });

  it("abort returns 409", async () => {
    const created = await api("POST", "/api/agent/goals", { description: "No-run goal 3" });
    const { status } = await api("POST", `/api/agent/goals/${created.body.id}/abort`);
    assert.strictEqual(status, 409);
  });
});

// ── Memories ───────────────────────────────────────────────────────────────

describe("Memories CRUD via routes", () => {
  it("POST creates a memory (201), GET ?q finds it, GET without q lists context, DELETE removes it", async () => {
    const created = await api("POST", "/api/agent/memories", {
      content: "routememtoken important lesson about hooks",
      memoryType: "success",
    });
    assert.strictEqual(created.status, 201);
    const id = created.body.id;
    assert.ok(id);

    const searched = await api("GET", "/api/agent/memories?q=routememtoken");
    assert.strictEqual(searched.status, 200);
    assert.ok(Array.isArray(searched.body));
    assert.ok(
      searched.body.some((m: any) => m.id === id),
      "search should return the new memory"
    );

    const listed = await api("GET", "/api/agent/memories");
    assert.strictEqual(listed.status, 200);
    assert.ok(Array.isArray(listed.body));
    assert.ok(
      listed.body.some((m: any) => m.id === id),
      "context list should include the memory"
    );

    const del = await api("DELETE", `/api/agent/memories/${id}`);
    assert.strictEqual(del.status, 200);
    assert.strictEqual(del.body.deleted, true);

    const delAgain = await api("DELETE", `/api/agent/memories/${id}`);
    assert.strictEqual(delAgain.status, 404, "deleting a gone memory should 404");
  });

  it("rejects missing content (400)", async () => {
    const { status } = await api("POST", "/api/agent/memories", { memoryType: "general" });
    assert.strictEqual(status, 400);
  });

  it("rejects an invalid memoryType (400)", async () => {
    const { status } = await api("POST", "/api/agent/memories", {
      content: "hi",
      memoryType: "bogus",
    });
    assert.strictEqual(status, 400);
  });

  it("rejects an invalid type filter on GET (400)", async () => {
    const { status } = await api("GET", "/api/agent/memories?type=bogus");
    assert.strictEqual(status, 400);
  });
});

// ── Workflows ────────────────────────────────────────────────────────────────

describe("Workflows CRUD via routes", () => {
  it("supports the full create→read→update→delete lifecycle", async () => {
    const created = await api("POST", "/api/agent/workflows", {
      name: "Weekly Recap",
      template: JSON.stringify({ steps: ["research", "draft"] }),
      description: "A reusable recap flow",
    });
    assert.strictEqual(created.status, 201);
    const id = created.body.id;
    assert.strictEqual(created.body.name, "Weekly Recap");
    assert.strictEqual(created.body.run_count, 0);

    const list = await api("GET", "/api/agent/workflows");
    assert.strictEqual(list.status, 200);
    assert.ok(list.body.some((w: any) => w.id === id));

    const one = await api("GET", `/api/agent/workflows/${id}`);
    assert.strictEqual(one.status, 200);
    assert.strictEqual(one.body.id, id);

    const updated = await api("PUT", `/api/agent/workflows/${id}`, {
      name: "Weekly Recap v2",
      template: JSON.stringify({ steps: ["research", "draft", "publish"] }),
    });
    assert.strictEqual(updated.status, 200);
    assert.strictEqual(updated.body.name, "Weekly Recap v2");

    const del = await api("DELETE", `/api/agent/workflows/${id}`);
    assert.strictEqual(del.status, 200);
    assert.strictEqual(del.body.deleted, true);

    const gone = await api("GET", `/api/agent/workflows/${id}`);
    assert.strictEqual(gone.status, 404);
  });

  it("rejects a workflow missing name (400)", async () => {
    const { status } = await api("POST", "/api/agent/workflows", { template: "{}" });
    assert.strictEqual(status, 400);
  });

  it("rejects a workflow missing template (400)", async () => {
    const { status } = await api("POST", "/api/agent/workflows", { name: "No Template" });
    assert.strictEqual(status, 400);
  });

  it("returns 404 when updating an unknown workflow", async () => {
    const { status } = await api("PUT", "/api/agent/workflows/ghost", {
      name: "x",
      template: "{}",
    });
    assert.strictEqual(status, 404);
  });
});
