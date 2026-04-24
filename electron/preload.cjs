const { contextBridge, ipcRenderer } = require("electron");
const {
  IPC_CHECK,
  IPC_DOWNLOAD,
  IPC_GET_STATE,
  IPC_INSTALL,
  UPDATE_STATE_CHANNEL,
} = require("./updater.cjs");

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
