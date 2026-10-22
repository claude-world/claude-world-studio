/**
 * claude-auth.test.ts
 *
 * The sign-in probe behind the setup banner and the chat gate.
 *
 * The case worth protecting: `claude auth status` prints its JSON **and exits
 * 1** when signed out. Reading only the resolved value of execFile() throws
 * that answer away, the probe degrades to "unknown", and the gate falls open —
 * which is exactly the bug this suite was written after hitting.
 *
 * Each case points STUDIO_CLAUDE_BINARY at a stub script, so no real binary
 * and no real credentials are involved.
 */

import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const TMP = mkdtempSync(path.join(tmpdir(), "studio-claude-auth-"));
process.env.STUDIO_USER_DATA_PATH = path.join(TMP, "user-data");

const CALL_LOG = path.join(TMP, "calls.log");

/** A fake `claude` that prints `stdout` and exits `code`, logging each call. */
function stubBinary(name: string, stdout: string, code: number): string {
  const file = path.join(TMP, name);
  writeFileSync(
    file,
    [
      "#!/bin/sh",
      `echo "call" >> ${JSON.stringify(CALL_LOG)}`,
      `cat <<'STUB_EOF'`,
      stdout,
      "STUB_EOF",
      `exit ${code}`,
      "",
    ].join("\n")
  );
  chmodSync(file, 0o755);
  return file;
}

function callCount(): number {
  if (!existsSync(CALL_LOG)) return 0;
  return readFileSync(CALL_LOG, "utf-8").split("\n").filter(Boolean).length;
}

type AuthModule = typeof import("../server/services/claude-auth.js");
let auth: AuthModule;

beforeEach(async () => {
  auth = await import("../server/services/claude-auth.js");
  auth.resetClaudeAuthCache();
  rmSync(CALL_LOG, { force: true });
  delete process.env.STUDIO_CLAUDE_BINARY;
});

after(() => {
  delete process.env.STUDIO_CLAUDE_BINARY;
  rmSync(TMP, { recursive: true, force: true });
});

const SIGNED_IN = '{"loggedIn":true,"authMethod":"claude.ai","email":"user@example.com"}';
const SIGNED_OUT = '{"loggedIn":false,"authMethod":"none"}';
const API_KEY = '{"loggedIn":true,"authMethod":"api_key","apiKeySource":"ANTHROPIC_API_KEY"}';

describe("claude auth probe", () => {
  it("reads a signed-in account", async () => {
    process.env.STUDIO_CLAUDE_BINARY = stubBinary("signed-in.sh", SIGNED_IN, 0);
    const status = await auth.getClaudeAuthStatus();
    assert.strictEqual(status.loggedIn, true);
    assert.strictEqual(status.authMethod, "claude.ai");
    assert.strictEqual(status.email, "user@example.com");
    assert.strictEqual(status.probeError, undefined);
  });

  it("treats an ANTHROPIC_API_KEY user as signed in", async () => {
    process.env.STUDIO_CLAUDE_BINARY = stubBinary("api-key.sh", API_KEY, 0);
    const status = await auth.getClaudeAuthStatus();
    assert.strictEqual(status.loggedIn, true);
    assert.strictEqual(status.authMethod, "api_key");
    assert.strictEqual(await auth.isDefinitelySignedOut(), false);
  });

  it("reads signed-out status from stdout even though the exit code is 1", async () => {
    // The regression this suite exists for: exit 1 is the answer, not a failure.
    process.env.STUDIO_CLAUDE_BINARY = stubBinary("signed-out.sh", SIGNED_OUT, 1);
    const status = await auth.getClaudeAuthStatus();
    assert.strictEqual(status.loggedIn, false);
    assert.strictEqual(status.authMethod, "none");
    assert.strictEqual(status.probeError, undefined, "a non-zero exit is not a probe failure");
    assert.strictEqual(await auth.isDefinitelySignedOut(), true);
  });

  it("fails open when the output cannot be read", async () => {
    process.env.STUDIO_CLAUDE_BINARY = stubBinary("garbage.sh", "not json at all", 1);
    const status = await auth.getClaudeAuthStatus();
    assert.ok(status.probeError, "expected a probe error");
    assert.strictEqual(
      await auth.isDefinitelySignedOut(),
      false,
      "a broken probe must never block a working app"
    );
  });

  it("fails open when the binary is missing", async () => {
    process.env.STUDIO_CLAUDE_BINARY = path.join(TMP, "does-not-exist");
    const status = await auth.getClaudeAuthStatus();
    assert.strictEqual(status.authMethod, "unknown");
    assert.match(status.probeError || "", /not found/i);
    assert.strictEqual(await auth.isDefinitelySignedOut(), false);
  });

  it("caches, so a cold 2s probe is paid once", async () => {
    process.env.STUDIO_CLAUDE_BINARY = stubBinary("cached.sh", SIGNED_IN, 0);
    await auth.getClaudeAuthStatus();
    await auth.getClaudeAuthStatus();
    await auth.getClaudeAuthStatus();
    assert.strictEqual(callCount(), 1);
  });

  it("re-probes when asked to refresh", async () => {
    process.env.STUDIO_CLAUDE_BINARY = stubBinary("refresh.sh", SIGNED_IN, 0);
    await auth.getClaudeAuthStatus();
    await auth.getClaudeAuthStatus({ refresh: true });
    assert.strictEqual(callCount(), 2);
  });

  it("collapses concurrent probes onto one spawn", async () => {
    process.env.STUDIO_CLAUDE_BINARY = stubBinary("concurrent.sh", SIGNED_IN, 0);
    const results = await Promise.all([
      auth.getClaudeAuthStatus(),
      auth.getClaudeAuthStatus(),
      auth.getClaudeAuthStatus(),
    ]);
    assert.strictEqual(callCount(), 1, "startup warm-up and a first turn must not both spawn");
    for (const r of results) assert.strictEqual(r.loggedIn, true);
  });

  it("primes without throwing when the probe fails", async () => {
    process.env.STUDIO_CLAUDE_BINARY = path.join(TMP, "nope");
    assert.doesNotThrow(() => auth.primeClaudeAuthStatus());
    await auth.getClaudeAuthStatus();
  });
});
