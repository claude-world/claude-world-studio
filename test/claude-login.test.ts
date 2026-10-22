/**
 * claude-login.test.ts
 *
 * The in-app sign-in driver. The happy path cannot be completed here — it
 * needs a real browser and a real Anthropic account — so these cover the parts
 * that decide whether a stuck user sees a clear state or an endless spinner:
 * URL capture, the terminal phases, and every way the flow can end badly.
 *
 * STUDIO_CLAUDE_BINARY points at stub scripts that imitate what the real
 * binary prints, so no real OAuth flow is started.
 */

import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const TMP = mkdtempSync(path.join(tmpdir(), "studio-claude-login-"));
process.env.STUDIO_USER_DATA_PATH = path.join(TMP, "user-data");

const AUTH_URL =
  "https://claude.com/cai/oauth/authorize?code=true&client_id=test&state=abc123&code_challenge=xyz";

function stub(name: string, body: string): string {
  const file = path.join(TMP, name);
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}

/** Prints the real banner, then blocks on stdin like `claude auth login`. */
const PRINTS_URL_THEN_WAITS = `
echo "Opening browser to sign in…"
echo "If the browser didn't open, visit: ${AUTH_URL}"
printf "Paste code here if prompted > "
read code
if [ "$code" = "good-code" ]; then exit 0; fi
echo "Invalid code" >&2
exit 1
`;

/** Rejects a bad code on stderr and asks again, like the real binary. */
const RETRIES_ON_BAD_CODE = `
echo "Opening browser to sign in…"
echo "If the browser didn't open, visit: ${AUTH_URL}"
while read code; do
  if [ "$code" = "good-code" ]; then exit 0; fi
  echo "Invalid code. Please make sure the full code was copied." >&2
done
exit 1
`;

type LoginModule = typeof import("../server/services/claude-login.js");
let login: LoginModule;

async function settle(ms = 400): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function waitForPhase(phase: string, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (login.getLoginState()?.phase === phase) return;
    await settle(50);
  }
  assert.fail(`never reached phase "${phase}" (last: ${login.getLoginState()?.phase})`);
}

beforeEach(async () => {
  login = await import("../server/services/claude-login.js");
  login.resetLoginForTests();
  delete process.env.STUDIO_CLAUDE_BINARY;
});

after(() => {
  login?.resetLoginForTests();
  delete process.env.STUDIO_CLAUDE_BINARY;
  rmSync(TMP, { recursive: true, force: true });
});

describe("in-app Claude sign-in", () => {
  it("lifts the authorize URL off stdout and waits for the code", async () => {
    process.env.STUDIO_CLAUDE_BINARY = stub("ok.sh", PRINTS_URL_THEN_WAITS);
    const started = login.startLogin();
    assert.strictEqual(started.phase, "starting");

    await waitForPhase("awaiting_code");
    const state = login.getLoginState();
    assert.strictEqual(state?.url, AUTH_URL, "the URL the browser must open");
    assert.strictEqual(state?.error, undefined);
  });

  it("reuses an in-flight sign-in instead of orphaning a second one", async () => {
    process.env.STUDIO_CLAUDE_BINARY = stub("reuse.sh", PRINTS_URL_THEN_WAITS);
    const first = login.startLogin();
    await waitForPhase("awaiting_code");
    const second = login.startLogin();
    assert.strictEqual(second.id, first.id, "double-click must not start a second login");
  });

  it("reports success once the code is accepted", async () => {
    process.env.STUDIO_CLAUDE_BINARY = stub("success.sh", PRINTS_URL_THEN_WAITS);
    login.startLogin();
    await waitForPhase("awaiting_code");
    login.submitLoginCode("good-code");
    await waitForPhase("success");
    assert.strictEqual(login.getLoginState()?.error, undefined);
  });

  it("lets the user retry a rejected code instead of hanging or restarting", async () => {
    // The real binary prints "Invalid code…" to stderr and asks again rather
    // than exiting; without handling that the phase sat on "finishing"
    // forever. Observed against the real binary, then pinned here.
    process.env.STUDIO_CLAUDE_BINARY = stub("reject.sh", RETRIES_ON_BAD_CODE);
    login.startLogin();
    await waitForPhase("awaiting_code");

    login.submitLoginCode("wrong-code");
    await waitForPhase("awaiting_code");
    assert.match(login.getLoginState()?.error || "", /Invalid code/);
    assert.strictEqual(login.getLoginState()?.url, AUTH_URL, "the same page stays valid");

    // A good code on the second attempt still completes.
    login.submitLoginCode("good-code");
    await waitForPhase("success");
  });

  it("ends in a visible state when the user cancels", async () => {
    process.env.STUDIO_CLAUDE_BINARY = stub("cancel.sh", PRINTS_URL_THEN_WAITS);
    login.startLogin();
    await waitForPhase("awaiting_code");
    const state = login.cancelLogin();
    assert.strictEqual(state?.phase, "cancelled");
    assert.ok(state?.error, "a cancelled sign-in still explains itself");
  });

  it("fails with a message when the binary dies before printing a URL", async () => {
    // What going offline, or a broken install, looks like.
    process.env.STUDIO_CLAUDE_BINARY = stub("offline.sh", 'echo "network unreachable" >&2\nexit 1');
    login.startLogin();
    await waitForPhase("failed");
    assert.match(login.getLoginState()?.error || "", /network unreachable/);
  });

  it("fails immediately when there is no binary to run", () => {
    process.env.STUDIO_CLAUDE_BINARY = path.join(TMP, "absent");
    const state = login.startLogin();
    assert.strictEqual(state.phase, "failed");
    assert.match(state.error || "", /not found/i);
  });

  it("ignores a code when no sign-in is running", () => {
    assert.strictEqual(login.submitLoginCode("stray"), null);
    assert.strictEqual(login.getLoginState(), null);
  });

  it("never leaves a terminal phase without a next step", async () => {
    // Every end state the UI must render as something other than a spinner.
    process.env.STUDIO_CLAUDE_BINARY = stub("terminal.sh", PRINTS_URL_THEN_WAITS);
    login.startLogin();
    await waitForPhase("awaiting_code");
    login.cancelLogin();
    const phase = login.getLoginState()?.phase;
    assert.ok(
      ["success", "failed", "cancelled"].includes(phase || ""),
      `expected a terminal phase, got ${phase}`
    );
  });
});
