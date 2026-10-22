/**
 * files-path-traversal.test.ts
 *
 * Adversarial coverage for GET /api/sessions/:id/files/*filepath
 * (server/routes/files.ts), the sink CodeQL reports as js/path-injection at
 * files.ts:115 — `fsp.realpath()` on a caller-supplied path.
 *
 * Every case here is an attempt to read a file outside the session workspace.
 * They must all be refused. The positive controls at the end prove the route
 * still serves legitimate files, so a test that passes by breaking the feature
 * would be caught.
 *
 * Requests go through node:http rather than fetch, because the WHATWG URL
 * parser collapses `..` segments before they reach the wire — which would
 * quietly turn a traversal test into a request for something else. Here the
 * request line is byte-for-byte what we wrote.
 *
 * DB isolation: STUDIO_USER_DATA_PATH points at a fresh temp dir and MUST be
 * set before db.js is imported — hence the dynamic import inside before().
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

const TMP_DIR = mkdtempSync(path.join(tmpdir(), "studio-traversal-"));
process.env.STUDIO_USER_DATA_PATH = TMP_DIR;

// realpath: on macOS os.tmpdir() sits under the /var -> /private/var symlink,
// and the route compares realpath-resolved paths.
const SANDBOX = realpathSync(mkdtempSync(path.join(tmpdir(), "studio-traversal-fs-")));
const WORKSPACE = path.join(SANDBOX, "workspace");
const OUTSIDE = path.join(SANDBOX, "outside");
/** Shares the workspace's prefix — catches a startsWith() without a separator. */
const SIBLING = `${WORKSPACE}-evil`;

let server: Server | undefined;
let port = 0;
let sessionId = "";

/** Raw GET with no URL normalisation: `rawPath` is sent exactly as given. */
function rawGet(rawPath: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port, path: rawPath, method: "GET" },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c as Buffer));
        res.on("end", () =>
          resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString("utf-8") })
        );
      }
    );
    req.on("error", reject);
    req.end();
  });
}

function fileUrl(suffix: string): string {
  return `/api/sessions/${sessionId}/files/${suffix}`;
}

before(async () => {
  mkdirSync(WORKSPACE, { recursive: true });
  mkdirSync(OUTSIDE, { recursive: true });
  mkdirSync(SIBLING, { recursive: true });
  mkdirSync(path.join(WORKSPACE, "sub"), { recursive: true });

  writeFileSync(path.join(WORKSPACE, "ok.txt"), "inside-workspace");
  writeFileSync(path.join(WORKSPACE, "sub", "nested.txt"), "nested-inside");
  writeFileSync(path.join(OUTSIDE, "secret.txt"), "SECRET-OUTSIDE");
  writeFileSync(path.join(SIBLING, "secret.txt"), "SECRET-SIBLING");

  // A symlink inside the workspace aimed at a directory outside it, and one
  // aimed at a single file outside it.
  symlinkSync(OUTSIDE, path.join(WORKSPACE, "escape-dir"));
  symlinkSync(path.join(OUTSIDE, "secret.txt"), path.join(WORKSPACE, "escape-file"));
  // A symlink that stays inside: must keep working.
  symlinkSync(path.join(WORKSPACE, "ok.txt"), path.join(WORKSPACE, "inside-link"));

  const express = (await import("express")).default;
  const filesRouter = (await import("../server/routes/files.js")).default;
  const store = (await import("../server/db.js")).default;

  const session = store.createSession("traversal", WORKSPACE);
  sessionId = session.id;

  const app = express();
  app.use("/api/sessions", filesRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      port = (server!.address() as AddressInfo).port;
      resolve();
    });
  });
});

after(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  rmSync(SANDBOX, { recursive: true, force: true });
  rmSync(TMP_DIR, { recursive: true, force: true });
});

/** Nothing outside the workspace may ever appear in a response body. */
function assertNoLeak(body: string, label: string) {
  assert.ok(!body.includes("SECRET-OUTSIDE"), `${label} leaked the file outside the workspace`);
  assert.ok(!body.includes("SECRET-SIBLING"), `${label} leaked the sibling-directory file`);
  assert.ok(!body.includes("root:"), `${label} leaked /etc/passwd`);
}

describe("GET /api/sessions/:id/files/* — traversal attempts", () => {
  it("refuses relative ../ traversal to /etc/passwd", async () => {
    const res = await rawGet(fileUrl("../../../../../../etc/passwd"));
    assertNoLeak(res.body, "relative ../");
    assert.ok(res.status === 403 || res.status === 404, `got ${res.status}: ${res.body}`);
  });

  it("refuses relative ../ traversal to a file outside the workspace", async () => {
    const res = await rawGet(fileUrl("../outside/secret.txt"));
    assertNoLeak(res.body, "relative ../outside");
    assert.strictEqual(res.status, 403, res.body);
  });

  it("refuses an absolute path outside the workspace", async () => {
    const res = await rawGet(fileUrl(path.join(OUTSIDE, "secret.txt")));
    assertNoLeak(res.body, "absolute outside");
    assert.strictEqual(res.status, 403, res.body);
  });

  it("refuses /etc/passwd by absolute path", async () => {
    const res = await rawGet(fileUrl("/etc/passwd"));
    assertNoLeak(res.body, "absolute /etc/passwd");
    assert.strictEqual(res.status, 403, res.body);
  });

  it("refuses a sibling directory that shares the workspace prefix", async () => {
    // /…/workspace-evil must not pass a startsWith(/…/workspace) check.
    const res = await rawGet(fileUrl(path.join(SIBLING, "secret.txt")));
    assertNoLeak(res.body, "prefix sibling");
    assert.strictEqual(res.status, 403, res.body);
  });

  it("refuses a symlink inside the workspace pointing at an outside directory", async () => {
    const res = await rawGet(fileUrl("escape-dir/secret.txt"));
    assertNoLeak(res.body, "symlinked directory");
    assert.strictEqual(res.status, 403, res.body);
  });

  it("refuses a symlink inside the workspace pointing at an outside file", async () => {
    const res = await rawGet(fileUrl("escape-file"));
    assertNoLeak(res.body, "symlinked file");
    assert.strictEqual(res.status, 403, res.body);
  });

  it("refuses URL-encoded ../ traversal", async () => {
    const res = await rawGet(fileUrl("%2e%2e%2f%2e%2e%2foutside%2fsecret.txt"));
    assertNoLeak(res.body, "percent-encoded traversal");
    assert.ok(res.status === 403 || res.status === 404, `got ${res.status}: ${res.body}`);
  });

  it("refuses mixed-case URL-encoded ../ traversal", async () => {
    const res = await rawGet(fileUrl("%2E%2E/outside/secret.txt"));
    assertNoLeak(res.body, "mixed-case encoded traversal");
    assert.ok(res.status === 403 || res.status === 404, `got ${res.status}: ${res.body}`);
  });

  it("refuses double-encoded ../ traversal", async () => {
    const res = await rawGet(fileUrl("%252e%252e%252foutside%252fsecret.txt"));
    assertNoLeak(res.body, "double-encoded traversal");
    assert.ok(res.status >= 400, `got ${res.status}: ${res.body}`);
  });

  it("refuses an embedded null byte without crashing the server", async () => {
    const res = await rawGet(fileUrl("ok.txt%00.png"));
    assertNoLeak(res.body, "null byte");
    assert.ok(res.status >= 400, `got ${res.status}: ${res.body}`);
    // The process must still be serving afterwards.
    const after = await rawGet(fileUrl("ok.txt"));
    assert.strictEqual(after.status, 200, "server stopped serving after a null byte");
  });

  it("refuses a backslash-separated traversal attempt", async () => {
    const res = await rawGet(fileUrl("..\\..\\outside\\secret.txt"));
    assertNoLeak(res.body, "backslash traversal");
    assert.ok(res.status >= 400, `got ${res.status}: ${res.body}`);
  });
});

describe("GET /api/sessions/:id/files/* — legitimate access still works", () => {
  it("serves a file in the workspace root", async () => {
    const res = await rawGet(fileUrl("ok.txt"));
    assert.strictEqual(res.status, 200, res.body);
    assert.strictEqual(JSON.parse(res.body).content, "inside-workspace");
  });

  it("serves a nested file", async () => {
    const res = await rawGet(fileUrl("sub/nested.txt"));
    assert.strictEqual(res.status, 200, res.body);
    assert.strictEqual(JSON.parse(res.body).content, "nested-inside");
  });

  it("serves a file by absolute path inside the workspace", async () => {
    const res = await rawGet(fileUrl(path.join(WORKSPACE, "ok.txt")));
    assert.strictEqual(res.status, 200, res.body);
    assert.strictEqual(JSON.parse(res.body).content, "inside-workspace");
  });

  it("follows a symlink that stays inside the workspace", async () => {
    const res = await rawGet(fileUrl("inside-link"));
    assert.strictEqual(res.status, 200, res.body);
    assert.strictEqual(JSON.parse(res.body).content, "inside-workspace");
  });

  it("404s a missing file inside the workspace", async () => {
    const res = await rawGet(fileUrl("no-such-file.txt"));
    assert.strictEqual(res.status, 404, res.body);
  });
});

describe("GET /api/sessions/:id/files/* — no filesystem probing outside the workspace", () => {
  // realpath() ran on the caller's path before containment was checked, so the
  // status code distinguished "exists" from "does not exist" anywhere on disk.
  // Containment is now decided lexically first, which makes both answers 403.
  it("gives the same answer for existing and missing paths outside the workspace", async () => {
    const existing = await rawGet(fileUrl("/etc/passwd"));
    const missing = await rawGet(fileUrl("/etc/surely-no-such-file-xyzzy"));
    assert.strictEqual(
      existing.status,
      missing.status,
      `status leaks existence outside the workspace: ${existing.status} vs ${missing.status}`
    );
    assert.strictEqual(existing.status, 403);
  });

  it("gives the same answer for existing and missing traversal targets", async () => {
    const existing = await rawGet(fileUrl("../outside/secret.txt"));
    const missing = await rawGet(fileUrl("../outside/nope.txt"));
    assert.strictEqual(
      existing.status,
      missing.status,
      `status leaks existence via traversal: ${existing.status} vs ${missing.status}`
    );
  });
});
