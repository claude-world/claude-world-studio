/**
 * Drives `claude auth login` so a user can sign in without opening a terminal.
 *
 * The OAuth flow is not reimplemented here — the bundled binary runs it. Given
 * a non-TTY stdin it prints the authorize URL and then waits for the code the
 * browser shows:
 *
 *   Opening browser to sign in…
 *   If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?…
 *   Paste code here if prompted >
 *
 * So: spawn it, lift the URL off stdout, let the renderer hand that to
 * shell.openExternal, then write the pasted code back to stdin. The redirect
 * target is a page that displays a code to copy, so pasting one is the flow
 * this OAuth client is built for, not a workaround.
 *
 * One sign-in at a time: this is a single-user desktop app, and two concurrent
 * flows would race over the same credentials file.
 */
import { spawn, type ChildProcess } from "child_process";
import { randomUUID } from "crypto";
import { logger } from "../logger.js";
import { getBundledClaudePath } from "../runtime-paths.js";
import { registerCleanup } from "../cleanup-registry.js";
import { getClaudeAuthStatus } from "./claude-auth.js";

export type LoginPhase =
  "starting" | "awaiting_code" | "finishing" | "success" | "failed" | "cancelled";

export interface LoginState {
  id: string;
  phase: LoginPhase;
  /** Present from "awaiting_code" on — the page the user must open. */
  url?: string;
  /** Present on "failed"; safe to show. */
  error?: string;
}

/** No URL in this long means the binary never got started properly. */
const URL_TIMEOUT_MS = 45_000;
/** How long to wait for the user to come back with a code. */
const CODE_TIMEOUT_MS = 10 * 60_000;
/**
 * Backstop after a code is submitted. The binary validates over the network
 * and, on a bad code, prints to stderr and asks again rather than exiting —
 * so without this the phase could sit on "finishing" forever, which is the
 * endless spinner this flow exists to avoid.
 */
const FINISH_TIMEOUT_MS = 90_000;

interface ActiveLogin {
  id: string;
  phase: LoginPhase;
  url?: string;
  error?: string;
  child: ChildProcess;
  stdout: string;
  stderr: string;
  urlTimer: NodeJS.Timeout;
  codeTimer?: NodeJS.Timeout;
  finishTimer?: NodeJS.Timeout;
}

let active: ActiveLogin | null = null;
let unregisterCleanup: (() => void) | null = null;

function snapshot(login: ActiveLogin | null): LoginState | null {
  if (!login) return null;
  return { id: login.id, phase: login.phase, url: login.url, error: login.error };
}

function finish(login: ActiveLogin, phase: LoginPhase, error?: string): void {
  if (login.phase === "success" || login.phase === "failed" || login.phase === "cancelled") return;
  login.phase = phase;
  login.error = error;
  clearTimeout(login.urlTimer);
  if (login.codeTimer) clearTimeout(login.codeTimer);
  if (login.finishTimer) clearTimeout(login.finishTimer);
  if (!login.child.killed && login.child.exitCode === null) {
    try {
      login.child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }
  logger.info("ClaudeLogin", `Sign-in ${phase}${error ? `: ${error}` : ""}`);
}

/** First https:// URL the binary prints — the authorize page. */
function extractUrl(text: string): string | undefined {
  const match = text.match(/https:\/\/[^\s"'<>]+/);
  return match?.[0];
}

/** Last non-empty line, for a failure the user can act on. */
function lastLine(text: string): string {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return lines[lines.length - 1] || "";
}

function armCodeTimer(login: ActiveLogin): void {
  if (login.codeTimer) clearTimeout(login.codeTimer);
  login.codeTimer = setTimeout(() => {
    finish(login, "failed", "Sign-in timed out. Start again when you are ready.");
  }, CODE_TIMEOUT_MS);
}

export function getLoginState(): LoginState | null {
  return snapshot(active);
}

export function startLogin(): LoginState {
  // An in-flight sign-in is reused rather than restarted — double-clicking the
  // button must not orphan a child holding the credentials file.
  if (active && (active.phase === "starting" || active.phase === "awaiting_code")) {
    return snapshot(active)!;
  }

  const binary = getBundledClaudePath();
  if (!binary) {
    const failed: LoginState = {
      id: randomUUID(),
      phase: "failed",
      error: "Bundled Claude Code binary not found",
    };
    return failed;
  }

  const child = spawn(binary, ["auth", "login"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      // The binary opens a browser itself. Suppress that so exactly one tab
      // opens — the one the renderer passes to shell.openExternal, which is
      // also the only one that works when Studio runs without a session
      // browser configured.
      BROWSER: "/usr/bin/true",
    },
  });

  const login: ActiveLogin = {
    id: randomUUID(),
    phase: "starting",
    child,
    stdout: "",
    stderr: "",
    urlTimer: setTimeout(() => {
      finish(login, "failed", "Timed out waiting for the sign-in page. Check your connection.");
    }, URL_TIMEOUT_MS),
  };

  child.stdout?.on("data", (chunk: Buffer) => {
    login.stdout += chunk.toString("utf-8");
    if (login.url) return;
    const url = extractUrl(login.stdout);
    if (!url) return;
    login.url = url;
    login.phase = "awaiting_code";
    clearTimeout(login.urlTimer);
    armCodeTimer(login);
    logger.info("ClaudeLogin", "Sign-in page ready, waiting for the code");
  });

  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf-8");
    login.stderr += text;

    // A rejected code ("Invalid code. Please make sure the full code was
    // copied.") does not end the process — the binary asks again. Hand the
    // message back and reopen the input rather than tearing the flow down
    // and making the user restart from the browser.
    if (login.phase === "finishing" && login.child.exitCode === null) {
      login.phase = "awaiting_code";
      login.error = lastLine(text) || "That code was not accepted. Try again.";
      if (login.finishTimer) clearTimeout(login.finishTimer);
      armCodeTimer(login);
      logger.info("ClaudeLogin", "Code rejected, waiting for another");
    }
  });

  child.on("error", (err) => {
    finish(login, "failed", err.message);
  });

  child.on("exit", (code) => {
    if (login.phase === "success" || login.phase === "failed" || login.phase === "cancelled") {
      return;
    }
    if (code === 0) {
      finish(login, "success");
      // The cache still says signed out; make the next read go to the binary.
      void getClaudeAuthStatus({ refresh: true }).catch(() => {});
      return;
    }
    // Exiting before a code was submitted means the user never finished.
    const detail = lastLine(login.stderr) || lastLine(login.stdout);
    finish(
      login,
      "failed",
      detail && !detail.startsWith("Paste code")
        ? detail
        : "Sign-in did not complete. Start again to retry."
    );
  });

  active = login;
  if (!unregisterCleanup) {
    unregisterCleanup = registerCleanup(() => {
      if (active) finish(active, "cancelled", "Studio is shutting down");
    });
  }
  return snapshot(login)!;
}

export function submitLoginCode(code: string): LoginState | null {
  if (!active) return null;
  if (active.phase !== "awaiting_code") return snapshot(active);

  active.phase = "finishing";
  active.error = undefined;
  if (active.codeTimer) clearTimeout(active.codeTimer);
  active.finishTimer = setTimeout(() => {
    finish(active!, "failed", "Sign-in did not come back. Start again to retry.");
  }, FINISH_TIMEOUT_MS);

  try {
    // Never logged: this is a one-time OAuth authorization code. stdin stays
    // open so a rejected code can be followed by another.
    active.child.stdin?.write(`${code}\n`);
  } catch (err) {
    finish(active, "failed", err instanceof Error ? err.message : String(err));
  }
  return snapshot(active);
}

export function cancelLogin(): LoginState | null {
  if (active) finish(active, "cancelled", "Sign-in cancelled");
  return snapshot(active);
}

/** Test seam. */
export function resetLoginForTests(): void {
  if (active) finish(active, "cancelled");
  active = null;
  unregisterCleanup?.();
  unregisterCleanup = null;
}
