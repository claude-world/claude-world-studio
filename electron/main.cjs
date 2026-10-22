const { app, BrowserWindow, dialog, ipcMain, shell, Menu } = require("electron");
const path = require("path");
const http = require("http");
const net = require("net");
const fs = require("fs");
const { spawn } = require("child_process");
const { autoUpdater } = require("electron-updater");
const { buildServerSpawnConfig } = require("./server-runtime.cjs");
const { createDesktopUpdater } = require("./updater.cjs");

const PREFERRED_PORT = parseInt(process.env.STUDIO_PORT || process.env.PORT || "3001", 10);
// Resolved to an actually-free port at startup (see findAvailablePort). The
// server binds this and the window loads it, so they always agree.
let PORT = PREFERRED_PORT;
let SERVER_URL = `http://127.0.0.1:${PORT}`;

const electronUserDataPath =
  process.env.STUDIO_ELECTRON_USER_DATA_PATH || process.env.STUDIO_USER_DATA_PATH;
if (electronUserDataPath) {
  fs.mkdirSync(electronUserDataPath, { recursive: true });
  app.setPath("userData", electronUserDataPath);
}

let serverProcess = null;
let mainWindow = null;
let desktopUpdater = null;
let isInstallingUpdate = false;

// Single-instance guard: a second launch would fight over the server port and
// silently adopt the first instance's server. Must run after setPath("userData").
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

// Ring buffer of recent server output for startup-failure diagnostics
const serverLogBuffer = [];
function recordServerLog(chunk) {
  serverLogBuffer.push(String(chunk));
  if (serverLogBuffer.length > 200) serverLogBuffer.shift();
}

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
    console.warn(
      `[Electron] Bundled node missing, falling back to runtime path: ${runtimeNodePath}`
    );
  }
  console.log(`[Electron] Starting server: ${path.basename(spawnCmd)} ${spawnArgs.join(" ")}`);
  serverProcess = spawn(spawnCmd, spawnArgs, {
    cwd: projectDir,
    env: spawnEnv,
    stdio: ["pipe", "pipe", "pipe"],
    // POSIX: own process group, so the SIGKILL fallback kills the whole tree.
    // Dev still runs through tsx, which spawns the real server as its child —
    // killing only the wrapper would leave the port bound.
    detached: process.platform !== "win32",
  });

  serverProcess.stdout.on("data", (data) => {
    recordServerLog(data);
    process.stdout.write(`[Server] ${data}`);
  });

  serverProcess.stderr.on("data", (data) => {
    recordServerLog(data);
    process.stderr.write(`[Server] ${data}`);
  });

  serverProcess.on("exit", (code) => {
    console.log(`[Server] Process exited with code ${code}`);
    serverProcess = null;
  });
}

// Can we bind this port on the loopback interface right now? Used to pick a
// free port so we never fight another server (dev server, an orphaned run, or
// an unrelated app) for the default — and never silently adopt a foreign one.
function isPortFree(port) {
  return new Promise((resolve) => {
    const tester = net
      .createServer()
      .once("error", () => resolve(false))
      .once("listening", () => tester.close(() => resolve(true)))
      .listen(port, "127.0.0.1");
  });
}

// Find a bindable port at or after the preferred one, so a busy 3001 (e.g.
// another local service) transparently falls back instead of failing to launch.
async function findAvailablePort(preferred, maxTries = 50) {
  for (let p = preferred; p < preferred + maxTries; p++) {
    if (await isPortFree(p)) return p;
  }
  throw new Error(`No free port found in range ${preferred}-${preferred + maxTries - 1}`);
}

function waitForServer(retries = 60) {
  return new Promise((resolve, reject) => {
    function serverExited() {
      return !serverProcess || serverProcess.exitCode !== null || serverProcess.signalCode !== null;
    }
    function check(n) {
      // Fail fast if our child already died (e.g. EADDRINUSE) instead of
      // adopting a foreign server that happens to answer 200 on the port.
      if (serverExited()) {
        return reject(
          new Error(`Server process exited before becoming ready (is port ${PORT} already in use?)`)
        );
      }
      if (n <= 0) return reject(new Error("Server failed to start"));
      http
        .get(`${SERVER_URL}/api/sessions`, (res) => {
          res.resume();
          if (res.statusCode === 200) {
            if (serverExited()) {
              return reject(
                new Error(
                  `Another server is answering on port ${PORT} but the bundled server exited. Quit the other instance or free the port.`
                )
              );
            }
            return resolve();
          }
          setTimeout(() => check(n - 1), 500);
        })
        .on("error", () => {
          setTimeout(() => check(n - 1), 500);
        });
    }
    check(retries);
  });
}

// The app's own origin: the local server on 127.0.0.1/localhost at our port
function isAppUrl(url) {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "http:" &&
      (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") &&
      parseInt(parsed.port || "80", 10) === PORT
    );
  } catch {
    return false;
  }
}

function openExternalIfSafe(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      shell.openExternal(url);
    }
  } catch {
    // Ignore unparseable URLs
  }
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

  // Open external links in system browser — http(s) only (never file:, etc.)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!isAppUrl(url)) openExternalIfSafe(url);
    return { action: "deny" };
  });

  // Never allow in-window navigation away from the local app origin
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    openExternalIfSafe(url);
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
      submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "close" }],
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

    // Force kill after 3s if SIGTERM didn't work. On POSIX, kill the whole
    // process group (spawned detached) so the dev tsx wrapper's server child
    // dies too and doesn't keep the port bound.
    forceKillTimer = setTimeout(() => {
      try {
        if (process.platform !== "win32" && proc.pid) {
          process.kill(-proc.pid, "SIGKILL");
        } else {
          proc.kill("SIGKILL");
        }
      } catch {}
    }, 3000);
  });
}

let isQuitting = false;

// Write startup diagnostics (error + recent server output) to a log file so
// packaged-app failures don't vanish without a trace. Returns the log path.
function writeStartupErrorLog(err) {
  try {
    const logPath = path.join(app.getPath("userData"), "startup-error.log");
    fs.writeFileSync(
      logPath,
      [
        `[${new Date().toISOString()}] ${err.stack || err.message}`,
        "",
        "--- recent server output ---",
        serverLogBuffer.join(""),
      ].join("\n")
    );
    return logPath;
  } catch {
    return null;
  }
}

function showStartupError(err) {
  const logPath = writeStartupErrorLog(err);
  dialog.showErrorBox(
    "Claude World Studio failed to start",
    [
      err.message,
      "",
      `Check that port ${PORT} is free and that the app can access its data folder.`,
      logPath ? `\nDetails were written to:\n${logPath}` : "",
    ]
      .filter(Boolean)
      .join("\n")
  );
}

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) return;

  try {
    desktopUpdater = createDesktopUpdater({
      app,
      autoUpdater,
      dialog,
      getWindows: () => (mainWindow ? [mainWindow] : []),
      ipcMain,
      quitAndInstall: async () => {
        if (isInstallingUpdate) return;
        isInstallingUpdate = true;
        await killServer();
        autoUpdater.quitAndInstall(false, true);
      },
    });
    buildMenu();

    // Pick a free port (falling back from the preferred one if it's taken) so a
    // busy 3001 doesn't block launch. The server binds this and the window loads
    // it, so they always match.
    PORT = await findAvailablePort(PREFERRED_PORT);
    SERVER_URL = `http://127.0.0.1:${PORT}`;
    if (PORT !== PREFERRED_PORT) {
      console.log(`[Electron] Port ${PREFERRED_PORT} in use; using free port ${PORT} instead.`);
    }

    startServer();
    await waitForServer();
    createWindow();
    desktopUpdater.scheduleStartupCheck();
  } catch (err) {
    console.error("[Electron] Failed to start:", err.message);
    showStartupError(err);
    app.quit();
  }
});

// Quit on last window close (all platforms): the server lifecycle is tied to
// the window, so there is intentionally no macOS dock-activate re-open path.
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

app.on("quit", () => {
  desktopUpdater?.dispose();
});

// The server child is spawned `detached` (its own process group) so the SIGKILL
// fallback can take out the dev tsx wrapper's child too. The downside: on `npm run electron:dev`,
// a terminal Ctrl+C (SIGINT) goes only to the foreground group and never reaches
// the detached server, orphaning it and leaving its port bound. Kill the whole
// group on a signal so the port is freed before we exit.
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    if (serverProcess && serverProcess.pid) {
      try {
        if (process.platform !== "win32") process.kill(-serverProcess.pid, "SIGKILL");
        else serverProcess.kill("SIGKILL");
      } catch {}
    }
    process.exit(0);
  });
}
