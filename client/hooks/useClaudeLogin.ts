/**
 * Drives the in-app Claude sign-in.
 *
 * The server runs `claude auth login` and reports its phase; this opens the
 * authorize URL with window.open — electron/main.cjs's setWindowOpenHandler
 * routes any non-app URL to shell.openExternal — and posts back the code the
 * browser shows.
 *
 * Every terminal phase is a visible state, never an endless spinner: the user
 * may close the browser, refuse consent, go offline, or simply walk away, and
 * the server turns each of those into "failed" with a message.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { apiDelete, apiGet, apiPost } from "./useApi";

export type LoginPhase =
  "starting" | "awaiting_code" | "finishing" | "success" | "failed" | "cancelled";

export interface LoginState {
  id: string;
  phase: LoginPhase;
  url?: string;
  error?: string;
}

export interface UseClaudeLogin {
  state: LoginState | null;
  busy: boolean;
  start: () => Promise<void>;
  submitCode: (code: string) => Promise<void>;
  cancel: () => Promise<void>;
  reopenUrl: () => void;
  dismiss: () => void;
}

/** Fast while the server is working, slow while we wait on a human. */
function pollDelay(phase: LoginPhase | undefined): number | null {
  if (phase === "starting" || phase === "finishing") return 1000;
  if (phase === "awaiting_code") return 5000; // only to notice the server-side timeout
  return null;
}

export function useClaudeLogin(onSignedIn: () => void): UseClaudeLogin {
  const [state, setState] = useState<LoginState | null>(null);
  const [busy, setBusy] = useState(false);
  const openedUrlRef = useRef<string | null>(null);
  const onSignedInRef = useRef(onSignedIn);
  const phase = state?.phase;
  const url = state?.url;

  useEffect(() => {
    onSignedInRef.current = onSignedIn;
  }, [onSignedIn]);

  // Open the authorize page once per sign-in attempt, never on every poll.
  useEffect(() => {
    if (phase !== "awaiting_code" || !url) return;
    if (openedUrlRef.current === url) return;
    openedUrlRef.current = url;
    window.open(url, "_blank", "noopener,noreferrer");
  }, [phase, url]);

  useEffect(() => {
    if (phase === "success") onSignedInRef.current();
  }, [phase]);

  useEffect(() => {
    const delay = pollDelay(phase);
    if (delay === null) return;
    const timer = setTimeout(async () => {
      const [next] = await apiGet<LoginState>("/settings/claude-auth/login");
      if (next) setState(next);
    }, delay);
    return () => clearTimeout(timer);
  }, [phase, state]);

  const start = useCallback(async () => {
    setBusy(true);
    openedUrlRef.current = null;
    const [next] = await apiPost<LoginState>("/settings/claude-auth/login", {});
    setState(next ?? { id: "", phase: "failed", error: "Could not reach Studio's server." });
    setBusy(false);
  }, []);

  const submitCode = useCallback(async (code: string) => {
    setBusy(true);
    const [next] = await apiPost<LoginState>("/settings/claude-auth/login/code", { code });
    if (next) setState(next);
    setBusy(false);
  }, []);

  const cancel = useCallback(async () => {
    setBusy(true);
    await apiDelete<LoginState>("/settings/claude-auth/login");
    setState(null);
    openedUrlRef.current = null;
    setBusy(false);
  }, []);

  const reopenUrl = useCallback(() => {
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }, [url]);

  const dismiss = useCallback(() => {
    setState(null);
    openedUrlRef.current = null;
  }, []);

  return { state, busy, start, submitCode, cancel, reopenUrl, dismiss };
}
