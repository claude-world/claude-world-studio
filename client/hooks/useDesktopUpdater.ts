import { useCallback, useEffect, useState } from "react";

export type DesktopUpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "up-to-date"
  | "error"
  | "unsupported";

export interface DesktopUpdateState {
  supported: boolean;
  configured: boolean;
  status: DesktopUpdateStatus;
  currentVersion: string;
  latestVersion: string | null;
  releaseName: string | null;
  releaseDate: string | null;
  releaseNotes: string;
  downloadProgress: number;
  checkedAt: string | null;
  message: string;
}

export const UNSUPPORTED_UPDATE_STATE: DesktopUpdateState = {
  supported: false,
  configured: false,
  status: "unsupported",
  currentVersion: "",
  latestVersion: null,
  releaseName: null,
  releaseDate: null,
  releaseNotes: "",
  downloadProgress: 0,
  checkedAt: null,
  message: "Automatic updates are available only in the installed desktop app.",
};

async function runAction(
  action: (() => Promise<DesktopUpdateState>) | undefined,
  fallback: DesktopUpdateState
): Promise<DesktopUpdateState> {
  if (!action) return fallback;
  try {
    return await action();
  } catch (error) {
    return {
      ...fallback,
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export function useDesktopUpdater() {
  const [state, setState] = useState<DesktopUpdateState>(UNSUPPORTED_UPDATE_STATE);

  useEffect(() => {
    const updater = window.desktopUpdater;
    if (!updater) return;

    let active = true;

    runAction(updater.getState, UNSUPPORTED_UPDATE_STATE).then((next) => {
      if (active) setState(next);
    });

    const unsubscribe = updater.onStateChange((next) => {
      if (active) setState(next);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const checkForUpdates = useCallback(async () => {
    const next = await runAction(window.desktopUpdater?.checkForUpdates, state);
    setState(next);
    return next;
  }, [state]);

  const downloadUpdate = useCallback(async () => {
    const next = await runAction(window.desktopUpdater?.downloadUpdate, state);
    setState(next);
    return next;
  }, [state]);

  const installUpdate = useCallback(async () => {
    const next = await runAction(window.desktopUpdater?.installUpdate, state);
    setState(next);
    return next;
  }, [state]);

  return {
    state,
    checkForUpdates,
    downloadUpdate,
    installUpdate,
  };
}
