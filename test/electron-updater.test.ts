import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  IPC_CHECK,
  IPC_DOWNLOAD,
  IPC_GET_STATE,
  IPC_INSTALL,
  createDesktopUpdater,
  normalizeUpdateErrorMessage,
} = require("../electron/updater.cjs");

class FakeUpdater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = false;
  allowPrerelease = true;
  checkCalls = 0;
  downloadCalls = 0;

  async checkForUpdates() {
    this.checkCalls += 1;
  }

  async downloadUpdate() {
    this.downloadCalls += 1;
  }
}

function createFakeIpcMain() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    handle(channel: string, handler: (...args: unknown[]) => unknown) {
      handlers.set(channel, handler);
    },
    removeHandler(channel: string) {
      handlers.delete(channel);
    },
    async invoke(channel: string, ...args: unknown[]) {
      const handler = handlers.get(channel);
      if (!handler) {
        throw new Error(`Missing handler for ${channel}`);
      }
      return handler({}, ...args);
    },
  };
}

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("desktop updater", () => {
  it("returns unsupported state for non-packaged builds", async () => {
    const updater = createDesktopUpdater({
      app: {
        isPackaged: false,
        getVersion: () => "2.2.0",
      },
      autoUpdater: new FakeUpdater(),
      dialog: { showMessageBox: async () => ({ response: 1 }) },
      getWindows: () => [],
      ipcMain: createFakeIpcMain(),
      isPackaged: false,
      platform: "darwin",
    });

    const state = updater.getState();
    assert.equal(state.status, "unsupported");
    assert.equal(state.supported, false);
    assert.equal(state.configured, false);
  });

  it("checks, downloads, and broadcasts update state changes", async () => {
    const autoUpdater = new FakeUpdater();
    const broadcasts: Array<{ status: string; latestVersion: string | null }> = [];
    const ipcMain = createFakeIpcMain();
    const dialogResponses = [{ response: 0 }, { response: 1 }];

    autoUpdater.checkForUpdates = async function () {
      this.checkCalls += 1;
      this.emit("checking-for-update");
      this.emit("update-available", {
        version: "2.3.0",
        releaseName: "Studio 2.3.0",
        releaseNotes: "Bug fixes",
      });
    };

    autoUpdater.downloadUpdate = async function () {
      this.downloadCalls += 1;
      this.emit("download-progress", { percent: 42.4 });
      this.emit("update-downloaded", {
        version: "2.3.0",
        releaseName: "Studio 2.3.0",
        releaseNotes: "Bug fixes",
      });
    };

    const updater = createDesktopUpdater({
      app: {
        isPackaged: true,
        getVersion: () => "2.2.0",
      },
      autoUpdater,
      dialog: {
        showMessageBox: async () => dialogResponses.shift() || { response: 1 },
      },
      getWindows: () => [
        {
          isDestroyed: () => false,
          webContents: {
            send: (_channel: string, state: { status: string; latestVersion: string | null }) => {
              broadcasts.push({ status: state.status, latestVersion: state.latestVersion });
            },
          },
        },
      ],
      ipcMain,
      isPackaged: true,
      platform: "darwin",
    });

    const checkedState = (await ipcMain.invoke(IPC_CHECK)) as {
      status: string;
      latestVersion: string | null;
    };
    await tick();

    assert.equal(autoUpdater.autoDownload, false);
    assert.equal(autoUpdater.autoInstallOnAppQuit, true);
    assert.equal(autoUpdater.allowPrerelease, false);
    assert.equal(autoUpdater.checkCalls, 1);
    assert.equal(autoUpdater.downloadCalls, 1);
    assert.equal(checkedState.status, "downloaded");
    assert.equal(checkedState.latestVersion, "2.3.0");
    assert.ok(
      broadcasts.some((state) => state.status === "available" && state.latestVersion === "2.3.0")
    );
    assert.ok(broadcasts.some((state) => state.status === "downloaded"));

    const currentState = (await ipcMain.invoke(IPC_GET_STATE)) as {
      status: string;
      latestVersion: string | null;
    };
    assert.equal(currentState.status, "downloaded");
  });

  it("installs a downloaded update through the injected callback", async () => {
    const autoUpdater = new FakeUpdater();
    const ipcMain = createFakeIpcMain();
    let installCalls = 0;

    const updater = createDesktopUpdater({
      app: {
        isPackaged: true,
        getVersion: () => "2.2.0",
      },
      autoUpdater,
      dialog: { showMessageBox: async () => ({ response: 1 }) },
      getWindows: () => [],
      ipcMain,
      isPackaged: true,
      platform: "darwin",
      quitAndInstall: async () => {
        installCalls += 1;
      },
    });

    autoUpdater.emit("update-downloaded", { version: "2.3.0" });
    await tick();
    await ipcMain.invoke(IPC_INSTALL);

    assert.equal(installCalls, 1);
    assert.equal(updater.getState().status, "downloaded");
  });

  it("maps missing release metadata errors to a friendly message", () => {
    const message = normalizeUpdateErrorMessage(
      new Error("Cannot find latest-mac.yml in the published release")
    );
    assert.equal(message, "No published desktop update is available yet.");
  });

  it("downloads via IPC only when an update is available", async () => {
    const autoUpdater = new FakeUpdater();
    const ipcMain = createFakeIpcMain();

    createDesktopUpdater({
      app: {
        isPackaged: true,
        getVersion: () => "2.2.0",
      },
      autoUpdater,
      dialog: { showMessageBox: async () => ({ response: 1 }) },
      getWindows: () => [],
      ipcMain,
      isPackaged: true,
      platform: "darwin",
    });

    await ipcMain.invoke(IPC_DOWNLOAD);
    assert.equal(autoUpdater.downloadCalls, 0);

    autoUpdater.emit("update-available", { version: "2.3.0" });
    await tick();
    await ipcMain.invoke(IPC_DOWNLOAD);
    assert.equal(autoUpdater.downloadCalls, 1);
  });
});
