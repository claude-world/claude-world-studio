/**
 * Is the bundled Claude Code signed in?
 *
 * Without credentials the Agent SDK does not fail — it answers the user's
 * prompt with the literal text "Not logged in · Please run /login" and reports
 * the turn as a success with zero cost. That reads as the assistant talking,
 * and `/login` is a CLI slash command this app does not have. So we ask the
 * bundled binary directly before running a turn, and tell the user plainly.
 *
 * `claude auth status` prints JSON on stdout in every state, but the exit code
 * carries the answer too — 0 signed in, 1 signed out:
 *   signed in : exit 0, {"loggedIn":true,"authMethod":"claude.ai","email":"…"}
 *   API key   : exit 0, {"loggedIn":true,"authMethod":"api_key","apiKeySource":"ANTHROPIC_API_KEY"}
 *   signed out: exit 1, {"loggedIn":false,"authMethod":"none"}
 * So the non-zero exit must not be treated as a failed probe: parse stdout
 * first and only fall back to "unknown" when there is no usable JSON.
 *
 * Measured against the packaged binary: ~2.0 s cold (first page-in of a 260 MB
 * file), ~0.13 s warm. Hence the cache, the de-duplicated in-flight probe, and
 * the startup warm-up in server.ts.
 */
import { execFile } from "child_process";
import { promisify } from "util";
import { logger } from "../logger.js";
import { getBundledClaudePath } from "../runtime-paths.js";

const execFileAsync = promisify(execFile);

export interface ClaudeAuthStatus {
  /** False only when the probe positively said so. A failed probe is not false. */
  loggedIn: boolean;
  /** "claude.ai", "api_key", "none", or "unknown" when the probe could not answer. */
  authMethod: string;
  email?: string;
  /** Present when the probe itself failed; callers must not treat it as signed out. */
  probeError?: string;
  checkedAt: number;
}

const CACHE_MS = 60_000;
const PROBE_TIMEOUT_MS = 20_000;

let cached: ClaudeAuthStatus | null = null;
let inFlight: Promise<ClaudeAuthStatus> | null = null;

function unknown(probeError: string): ClaudeAuthStatus {
  return { loggedIn: false, authMethod: "unknown", probeError, checkedAt: Date.now() };
}

/** Reads the status JSON, whatever the exit code was. Null if unusable. */
function parseStatus(stdout: unknown): ClaudeAuthStatus | null {
  if (typeof stdout !== "string" || stdout.trim() === "") return null;
  try {
    const parsed = JSON.parse(stdout) as {
      loggedIn?: boolean;
      authMethod?: string;
      email?: string;
    };
    if (typeof parsed.loggedIn !== "boolean") return null;
    return {
      loggedIn: parsed.loggedIn,
      authMethod: parsed.authMethod || "none",
      email: parsed.email,
      checkedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

async function probe(): Promise<ClaudeAuthStatus> {
  const binary = getBundledClaudePath();
  if (!binary) {
    return unknown("Bundled Claude Code binary not found");
  }

  try {
    const { stdout } = await execFileAsync(binary, ["auth", "status"], {
      timeout: PROBE_TIMEOUT_MS,
      encoding: "utf-8",
      maxBuffer: 1024 * 1024,
    });
    return parseStatus(stdout) ?? unknown("Unreadable auth status output");
  } catch (err) {
    // Signed out exits 1 while still printing the JSON, so the stdout carried
    // on the error is the answer, not a failure.
    const fromStdout = parseStatus((err as { stdout?: unknown }).stdout);
    if (fromStdout) return fromStdout;

    const message = err instanceof Error ? err.message : String(err);
    logger.warn("ClaudeAuth", `Could not read auth status: ${message}`);
    return unknown(message);
  }
}

/**
 * Cached auth status. Pass `refresh` after an action that could have changed
 * it (a sign-in, or the user asking to re-check).
 */
export async function getClaudeAuthStatus(
  options: { refresh?: boolean } = {}
): Promise<ClaudeAuthStatus> {
  if (options.refresh) {
    cached = null;
  } else if (cached && Date.now() - cached.checkedAt < CACHE_MS) {
    return cached;
  }

  // Collapse concurrent callers onto one spawn — the startup warm-up and a
  // first turn can land together, and the cold probe takes ~2 s.
  if (!inFlight) {
    inFlight = probe().finally(() => {
      inFlight = null;
    });
  }

  const status = await inFlight;
  cached = status;
  return status;
}

/**
 * True only when we positively know there are no credentials. A probe that
 * failed returns false here: a broken check must not block a working app.
 */
export async function isDefinitelySignedOut(): Promise<boolean> {
  const status = await getClaudeAuthStatus();
  return !status.loggedIn && !status.probeError;
}

/** Warm the cache without making anyone wait for the cold probe. */
export function primeClaudeAuthStatus(): void {
  void getClaudeAuthStatus().catch(() => {
    /* probe() already logged it; never reject here */
  });
}

/** Test seam. */
export function resetClaudeAuthCache(): void {
  cached = null;
  inFlight = null;
}
