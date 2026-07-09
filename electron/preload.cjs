const { contextBridge, ipcRenderer } = require("electron");

// This preload runs in a sandboxed renderer (Electron >= 20 default), which can
// only require built-in modules like "electron" — a relative require of
// updater.cjs would throw and abort the whole preload. The channel names are
// therefore duplicated here and MUST stay in sync with electron/updater.cjs
// (enforced by test/electron-updater.test.ts).
const UPDATE_STATE_CHANNEL = "studio:update/state";
const IPC_GET_STATE = "studio:update/get-state";
const IPC_CHECK = "studio:update/check";
const IPC_DOWNLOAD = "studio:update/download";
const IPC_INSTALL = "studio:update/install";

contextBridge.exposeInMainWorld("desktopUpdater", {
  getState: () => ipcRenderer.invoke(IPC_GET_STATE),
  checkForUpdates: () => ipcRenderer.invoke(IPC_CHECK),
  downloadUpdate: () => ipcRenderer.invoke(IPC_DOWNLOAD),
  installUpdate: () => ipcRenderer.invoke(IPC_INSTALL),
  onStateChange: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on(UPDATE_STATE_CHANNEL, listener);
    return () => {
      ipcRenderer.removeListener(UPDATE_STATE_CHANNEL, listener);
    };
  },
});
