const UPDATE_STATE_CHANNEL = "studio:update/state";
const IPC_GET_STATE = "studio:update/get-state";
const IPC_CHECK = "studio:update/check";
const IPC_DOWNLOAD = "studio:update/download";
const IPC_INSTALL = "studio:update/install";

function createDefaultUpdateState({
  currentVersion,
  isPackaged,
  platform = process.platform,
  configured = isPackaged,
}) {
  const desktopOnlyMessage = isPackaged
    ? "Automatic updates are supported on packaged desktop builds only."
    : "Automatic updates are available only in the installed desktop app.";
  return {
    supported: isPackaged && (platform === "darwin" || platform === "win32"),
    configured: Boolean(configured),
    status: isPackaged ? "idle" : "unsupported",
    currentVersion,
    latestVersion: null,
    releaseName: null,
    releaseDate: null,
    releaseNotes: "",
    downloadProgress: 0,
    checkedAt: null,
    message: isPackaged ? "Ready to check for updates." : desktopOnlyMessage,
  };
}

function normalizeReleaseNotes(releaseNotes) {
  if (typeof releaseNotes === "string") {
    return releaseNotes;
  }
  if (!Array.isArray(releaseNotes)) {
    return "";
  }
  return releaseNotes
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const title = typeof item.version === "string" ? `Version ${item.version}` : "";
      const note = typeof item.note === "string" ? item.note : "";
      return [title, note].filter(Boolean).join("\n");
    })
    .filter(Boolean)
    .join("\n\n");
}

function normalizeUpdateErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error || "Unknown update error");
  if (
    /latest-mac\.yml/i.test(message) ||
    /Cannot find latest/i.test(message) ||
    /No published versions/i.test(message) ||
    /404/i.test(message)
  ) {
    return "No published desktop update is available yet.";
  }
  return message;
}

function createDesktopUpdater({
  app,
  autoUpdater,
  ipcMain,
  dialog,
  logger = console,
  getWindows = () => [],
  quitAndInstall = () => autoUpdater.quitAndInstall(false, true),
  isPackaged = app.isPackaged,
  platform = process.platform,
  autoCheckDelayMs = 5000,
}) {
  let state = createDefaultUpdateState({
    currentVersion: app.getVersion(),
    isPackaged,
    platform,
  });
  let startupCheckTimer = null;

  const listeners = [];

  const supported = state.supported;

  function snapshot() {
    return { ...state };
  }

  function broadcast() {
    const next = snapshot();
    for (const win of getWindows()) {
      if (!win || win.isDestroyed?.() || !win.webContents) continue;
      win.webContents.send(UPDATE_STATE_CHANNEL, next);
    }
  }

  function setState(patch) {
    state = { ...state, ...patch };
    broadcast();
    return snapshot();
  }

  function registerHandler(channel, handler) {
    ipcMain.removeHandler?.(channel);
    ipcMain.handle(channel, handler);
  }

  async function promptForDownload(info) {
    if (!dialog) return;
    const version = info?.version ? `v${info.version}` : "the latest version";
    const result = await dialog.showMessageBox({
      type: "info",
      buttons: ["Download Now", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "Update Available",
      message: `${version} is available for Claude World Studio.`,
      detail: "Download the update now and install it when you're ready to relaunch.",
    });
    if (result.response === 0) {
      await downloadUpdate();
    }
  }

  async function promptForInstall(info) {
    if (!dialog) return;
    const version = info?.version ? `v${info.version}` : "The update";
    const result = await dialog.showMessageBox({
      type: "info",
      buttons: ["Install & Relaunch", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "Update Ready",
      message: `${version} has been downloaded.`,
      detail: "Restart the app now to install the new version.",
    });
    if (result.response === 0) {
      await installUpdate();
    }
  }

  function handleError(error) {
    const message = normalizeUpdateErrorMessage(error);
    if (typeof logger.error === "function") {
      logger.error("[Updater]", message);
    } else if (typeof logger.warn === "function") {
      logger.warn("[Updater]", message);
    }
    return setState({
      status: "error",
      checkedAt: new Date().toISOString(),
      message,
    });
  }

  async function checkForUpdates(source = "manual") {
    if (!supported || !state.configured) {
      return snapshot();
    }
    if (state.status === "checking" || state.status === "downloading") {
      return snapshot();
    }

    setState({
      status: "checking",
      message: source === "startup" ? "Checking for desktop updates..." : "Checking for updates...",
    });

    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      return handleError(error);
    }

    return snapshot();
  }

  async function downloadUpdate() {
    if (!supported || !state.configured) {
      return snapshot();
    }
    if (state.status === "downloading" || state.status === "downloaded") {
      return snapshot();
    }
    if (state.status !== "available") {
      return snapshot();
    }

    setState({
      status: "downloading",
      message: "Downloading update...",
      downloadProgress: 0,
    });

    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      return handleError(error);
    }

    return snapshot();
  }

  async function installUpdate() {
    if (!supported || !state.configured || state.status !== "downloaded") {
      return snapshot();
    }

    setState({
      status: "downloaded",
      message: "Installing update...",
    });

    await quitAndInstall();
    return snapshot();
  }

  function scheduleStartupCheck() {
    if (!supported || !state.configured) {
      return;
    }
    clearTimeout(startupCheckTimer);
    startupCheckTimer = setTimeout(() => {
      checkForUpdates("startup");
    }, autoCheckDelayMs);
  }

  function dispose() {
    clearTimeout(startupCheckTimer);
    for (const [event, handler] of listeners) {
      autoUpdater.removeListener(event, handler);
    }
    ipcMain.removeHandler?.(IPC_GET_STATE);
    ipcMain.removeHandler?.(IPC_CHECK);
    ipcMain.removeHandler?.(IPC_DOWNLOAD);
    ipcMain.removeHandler?.(IPC_INSTALL);
  }

  registerHandler(IPC_GET_STATE, async () => snapshot());
  registerHandler(IPC_CHECK, async () => checkForUpdates("manual"));
  registerHandler(IPC_DOWNLOAD, async () => downloadUpdate());
  registerHandler(IPC_INSTALL, async () => installUpdate());

  if (!supported) {
    state = {
      ...state,
      configured: false,
      status: "unsupported",
      message:
        isPackaged && platform !== "darwin" && platform !== "win32"
          ? "Automatic updates are supported on macOS and Windows releases."
          : state.message,
    };
    return {
      checkForUpdates,
      dispose,
      downloadUpdate,
      getState: snapshot,
      installUpdate,
      scheduleStartupCheck,
    };
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;

  const onChecking = () => {
    setState({
      status: "checking",
      message: "Checking for updates...",
    });
  };
  const onAvailable = async (info) => {
    setState({
      status: "available",
      checkedAt: new Date().toISOString(),
      latestVersion: info?.version || null,
      releaseName: info?.releaseName || null,
      releaseDate: info?.releaseDate || null,
      releaseNotes: normalizeReleaseNotes(info?.releaseNotes),
      downloadProgress: 0,
      message: info?.version
        ? `Version ${info.version} is available to download.`
        : "A desktop update is available to download.",
    });
    await promptForDownload(info);
  };
  const onNotAvailable = (info) => {
    setState({
      status: "up-to-date",
      checkedAt: new Date().toISOString(),
      latestVersion: info?.version || state.currentVersion,
      releaseName: info?.releaseName || null,
      releaseDate: info?.releaseDate || null,
      releaseNotes: normalizeReleaseNotes(info?.releaseNotes),
      downloadProgress: 0,
      message: "You're up to date.",
    });
  };
  const onProgress = (progress) => {
    setState({
      status: "downloading",
      downloadProgress: Number(progress?.percent || 0),
      message: `Downloading update... ${Math.round(Number(progress?.percent || 0))}%`,
    });
  };
  const onDownloaded = async (info) => {
    setState({
      status: "downloaded",
      checkedAt: new Date().toISOString(),
      latestVersion: info?.version || state.latestVersion,
      releaseName: info?.releaseName || null,
      releaseDate: info?.releaseDate || null,
      releaseNotes: normalizeReleaseNotes(info?.releaseNotes),
      downloadProgress: 100,
      message: info?.version
        ? `Version ${info.version} is ready to install.`
        : "The downloaded update is ready to install.",
    });
    await promptForInstall(info);
  };
  const onError = (error) => {
    handleError(error);
  };

  for (const [event, handler] of [
    ["checking-for-update", onChecking],
    ["update-available", onAvailable],
    ["update-not-available", onNotAvailable],
    ["download-progress", onProgress],
    ["update-downloaded", onDownloaded],
    ["error", onError],
  ]) {
    autoUpdater.on(event, handler);
    listeners.push([event, handler]);
  }

  return {
    checkForUpdates,
    dispose,
    downloadUpdate,
    getState: snapshot,
    installUpdate,
    scheduleStartupCheck,
  };
}

module.exports = {
  IPC_CHECK,
  IPC_DOWNLOAD,
  IPC_GET_STATE,
  IPC_INSTALL,
  UPDATE_STATE_CHANNEL,
  createDefaultUpdateState,
  createDesktopUpdater,
  normalizeReleaseNotes,
  normalizeUpdateErrorMessage,
};
