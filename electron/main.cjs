const { app, BrowserWindow, shell, Menu } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const http = require("http");

const PORT = 3001;
const SERVER_URL = `http://127.0.0.1:${PORT}`;

let serverProcess = null;
let mainWindow = null;

function startServer() {
  const projectDir = path.join(__dirname, "..");

  // Build client assets if dist/ doesn't exist
  const distDir = path.join(projectDir, "dist");
  const fs = require("fs");
  if (!fs.existsSync(distDir)) {
    console.log("[Electron] Building client assets...");
    require("child_process").execSync("npx vite build", {
      cwd: projectDir,
      stdio: "inherit",
    });
  }

  // Start Express server via bundled tsx (not npx — unavailable in packaged app)
  const tsxBin = path.join(projectDir, "node_modules", ".bin", "tsx");
  serverProcess = spawn(tsxBin, ["server/server.ts"], {
    cwd: projectDir,
    env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1" },
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
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
    // Force kill after 3 seconds
    setTimeout(() => {
      if (serverProcess) {
        serverProcess.kill("SIGKILL");
      }
    }, 3000);
  }
}

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
  killServer();
  app.quit();
});

app.on("before-quit", () => {
  killServer();
});

app.on("activate", () => {
  if (mainWindow === null && serverProcess) {
    createWindow();
  }
});
