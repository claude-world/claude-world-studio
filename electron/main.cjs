const { app, BrowserWindow, shell, Menu } = require("electron");
const path = require("path");
const http = require("http");
const fs = require("fs");
const { spawn } = require("child_process");
const { autoUpdater } = require("electron-updater");
const { buildServerSpawnConfig } = require("./server-runtime.cjs");
const { createDesktopUpdater } = require("./updater.cjs");

const PORT = parseInt(process.env.STUDIO_PORT || process.env.PORT || "3001", 10);
const SERVER_URL = `http://127.0.0.1:${PORT}`;

const electronUserDataPath = process.env.STUDIO_ELECTRON_USER_DATA_PATH || process.env.STUDIO_USER_DATA_PATH;
if (electronUserDataPath) {
  fs.mkdirSync(electronUserDataPath, { recursive: true });
  app.setPath("userData", electronUserDataPath);
}

let serverProcess = null;
let mainWindow = null;
let desktopUpdater = null;
let isInstallingUpdate = false;

function startServer() {
  // In packaged app, spawnable files live in app.asar.unpacked
  const appPath = app.getAppPath();
  const projectDir = app.isPackaged
    ? appPath.replace("app.asar", "app.asar.unpacked")
    : path.join(__dirname, "..");

  // Build client assets if dist/ doesn't exist (dev mode only)
  if (!app.isPackaged) {
    const distDir = path.join(projectDir, "dist");
    if (!fs.existsSync(distDir)) {
      console.log("[Electron] Building client assets...");
      require("child_process").execSync("npx vite build", {
        cwd: projectDir,
        stdio: "inherit",
      });
    }
  }

  const { spawnCmd, spawnArgs, spawnEnv, mergedPath, runtimeNodePath } = buildServerSpawnConfig({
    app,
    projectDir,
    port: PORT,
    host: "127.0.0.1",
  });

  console.log(`[Electron] PATH for server: ${mergedPath.split(":").slice(0, 5).join(":")}...`);
  console.log(`[Electron] Runtime node: ${runtimeNodePath}`);
  if (app.isPackaged && !fs.existsSync(runtimeNodePath)) {
    console.warn(`[Electron] Bundled node missing, falling back to runtime path: ${runtimeNodePath}`);
  }
  console.log(`[Electron] Starting server: ${path.basename(spawnCmd)} ${spawnArgs.join(" ")}`);
  serverProcess = spawn(spawnCmd, spawnArgs, {
    cwd: projectDir,
    env: spawnEnv,
    stdio: ["pipe", "pipe", "pipe"],
  });

  serverProcess.stdout.on("data", (data) => {
    process.stdout.write(`[Server] ${data}`);
  });

  serverProcess.stderr.on("data", (data) => {
    process.stderr.write(`[Server] ${data}`);
  });

  serverProcess.on("exit", (code) => {
    console.log(`[Server] Process exited with code ${code}`);
    serverProcess = null;
  });
}

function waitForServer(retries = 60) {
  return new Promise((resolve, reject) => {
    function check(n) {
      if (n <= 0) return reject(new Error("Server failed to start"));
      http
        .get(`${SERVER_URL}/api/sessions`, (res) => {
          if (res.statusCode === 200) return resolve();
          setTimeout(() => check(n - 1), 500);
        })
        .on("error", () => {
          setTimeout(() => check(n - 1), 500);
        });
    }
    check(retries);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: "Claude World Studio",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  mainWindow.loadURL(SERVER_URL);

  // Open external links in system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function buildMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        {
          label: "Check for Updates...",
          click: () => {
            desktopUpdater?.checkForUpdates("menu");
          },
        },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { role: "close" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function killServer() {
  return new Promise((resolve) => {
    if (!serverProcess) return resolve();

    const proc = serverProcess;
    let settled = false;
    let forceKillTimer;
    let safetyTimer;

    function done() {
      if (settled) return;
      settled = true;
      clearTimeout(forceKillTimer);
      clearTimeout(safetyTimer);
      resolve();
    }

    // Absolute backstop: resolve even if exit event was missed
    // (e.g. process died before our .once("exit") was registered).
    // Declared before .once("exit") to avoid TDZ if exit fires synchronously.
    safetyTimer = setTimeout(done, 6000);

    // Resolve once the process actually exits
    proc.once("exit", done);

    proc.kill("SIGTERM");

    // Force kill after 3s if SIGTERM didn't work
    forceKillTimer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch {}
    }, 3000);
  });
}

let isQuitting = false;

app.whenReady().then(async () => {
  desktopUpdater = createDesktopUpdater({
    app,
    autoUpdater,
    dialog: require("electron").dialog,
    getWindows: () => (mainWindow ? [mainWindow] : []),
    ipcMain: require("electron").ipcMain,
    quitAndInstall: async () => {
      if (isInstallingUpdate) return;
      isInstallingUpdate = true;
      await killServer();
      autoUpdater.quitAndInstall(false, true);
    },
  });
  buildMenu();
  startServer();

  try {
    await waitForServer();
    createWindow();
    desktopUpdater.scheduleStartupCheck();
  } catch (err) {
    console.error("[Electron] Failed to start server:", err.message);
    app.quit();
  }
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", (event) => {
  // Wait for server to actually exit before allowing quit
  if (isInstallingUpdate) {
    return;
  }
  if (serverProcess && !isQuitting) {
    isQuitting = true;
    event.preventDefault();
    killServer().then(() => app.quit());
  }
});

app.on("activate", () => {
  if (mainWindow === null && serverProcess) {
    createWindow();
  }
});

app.on("quit", () => {
  desktopUpdater?.dispose();
});
