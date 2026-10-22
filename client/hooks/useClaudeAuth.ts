/**
 * Is the bundled Claude Code signed in?
 *
 * Without credentials the agent answers every prompt with "Not logged in ·
 * Please run /login" and the turn still reports success, so nothing in the
 * normal chat flow tells the user what is wrong. This drives the setup banner
 * and the Settings card that do.
 */
import { useCallback, useEffect, useState } from "react";
import { apiGet } from "./useApi";

export interface ClaudeAuthStatus {
  loggedIn: boolean;
  authMethod: string;
  email?: string;
  /** Set when the check itself failed — never treat it as "signed out". */
  probeError?: string;
}

export interface UseClaudeAuth {
  status: ClaudeAuthStatus | null;
  loading: boolean;
  /** True only when the server positively reported no credentials. */
  needsSetup: boolean;
  refresh: () => Promise<void>;
}

export function useClaudeAuth(): UseClaudeAuth {
  const [status, setStatus] = useState<ClaudeAuthStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (refresh: boolean) => {
    const [data] = await apiGet<ClaudeAuthStatus>(
      `/settings/claude-auth${refresh ? "?refresh=1" : ""}`
    );
    // On error apiGet gives [null, error]: show nothing rather than accusing
    // the user of being signed out because the server was unreachable.
    setStatus(data);
    setLoading(false);
  }, []);

  // `loading` already starts true, so the mount fetch sets no state up front.
  useEffect(() => {
    void load(false);
  }, [load]);

  const refresh = useCallback(async () => {
    setLoading(true);
    await load(true);
  }, [load]);

  return {
    status,
    loading,
    needsSetup: status !== null && !status.loggedIn && !status.probeError,
    refresh,
  };
}
