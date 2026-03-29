const { app, BrowserWindow, shell, Menu } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const http = require("http");

const PORT = 3001;
const SERVER_URL = `http://127.0.0.1:${PORT}`;

let serverProcess = null;
let mainWindow = null;

function startServer() {
  // In packaged app, spawnable files live in app.asar.unpacked
  const appPath = app.getAppPath();
  const projectDir = app.isPackaged
    ? appPath.replace("app.asar", "app.asar.unpacked")
    : path.join(__dirname, "..");
  const fs = require("fs");

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

  // Start Express server via tsx
  // In packaged mode: .bin symlinks are broken, use node + tsx CLI directly
  // In dev mode: .bin/tsx symlink works fine
  // Get the full login-shell PATH (Electron launched from Finder has a minimal PATH)
  const { execSync } = require("child_process");
  let shellPath;
  try {
    shellPath = execSync("/bin/zsh -lc 'echo $PATH'", { encoding: "utf-8", timeout: 5000 }).trim();
  } catch {
    shellPath = process.env.PATH || "";
  }
  // Merge: use the shell PATH (which has nvm/homebrew/etc) as base
  const mergedPath = shellPath || process.env.PATH || "/usr/local/bin:/usr/bin:/bin";
  console.log(`[Electron] PATH for server: ${mergedPath.split(":").slice(0, 5).join(":")}...`);

  // Find system node absolute path for the SDK to spawn
  let systemNode;
  try {
    systemNode = execSync("/bin/zsh -lc 'which node'", { encoding: "utf-8", timeout: 5000 }).trim();
  } catch {
    systemNode = "/usr/local/bin/node";
  }
  console.log(`[Electron] System node: ${systemNode}`);

  const spawnEnv = { ...process.env, PORT: String(PORT), HOST: "127.0.0.1", PATH: mergedPath, STUDIO_NODE_PATH: systemNode };

  // Find system node for packaged mode (Electron's Node has different ABI for native modules)
  let spawnCmd, spawnArgs;
  if (app.isPackaged) {
    const tsxCli = path.join(projectDir, "node_modules", "tsx", "dist", "cli.mjs");
    // Reuse systemNode resolved above — already captured in STUDIO_NODE_PATH as well
    spawnCmd = systemNode;
    spawnArgs = [tsxCli, "server/server.ts"];
  } else {
    spawnCmd = path.join(projectDir, "node_modules", ".bin", "tsx");
    spawnArgs = ["server/server.ts"];
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
  buildMenu();
  startServer();

  try {
    await waitForServer();
    createWindow();
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
