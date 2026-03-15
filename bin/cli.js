#!/usr/bin/env node

import { execSync, spawn } from "child_process";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectDir = join(__dirname, "..");
const PORT = process.env.PORT || "3001";
const HOST = process.env.HOST || "127.0.0.1";
const URL = `http://${HOST}:${PORT}`;

// Build client if needed
const distDir = join(projectDir, "dist");
if (!existsSync(distDir)) {
  console.log("Building client assets...");
  execSync("npx vite build", { cwd: projectDir, stdio: "inherit" });
}

// Ensure data directory exists
const dataDir = join(projectDir, "data");
if (!existsSync(dataDir)) {
  const { mkdirSync } = await import("fs");
  mkdirSync(dataDir, { recursive: true });
}

// Start server
const tsxBin = join(projectDir, "node_modules", ".bin", "tsx");
const server = spawn(tsxBin, ["server/server.ts"], {
  cwd: projectDir,
  env: { ...process.env, PORT, HOST },
  stdio: "inherit",
});

// Open browser when server is ready
const http = await import("http");
function waitAndOpen(retries = 30) {
  http
    .get(`${URL}/api/sessions`, (res) => {
      if (res.statusCode === 200) {
        console.log(`\n  Claude World Studio → ${URL}\n`);
        // Open in default browser
        const cmd =
          process.platform === "darwin"
            ? "open"
            : process.platform === "win32"
              ? "start"
              : "xdg-open";
        spawn(cmd, [URL], { detached: true, stdio: "ignore" }).unref();
      } else if (retries > 0) {
        setTimeout(() => waitAndOpen(retries - 1), 500);
      }
    })
    .on("error", () => {
      if (retries > 0) setTimeout(() => waitAndOpen(retries - 1), 500);
    });
}
waitAndOpen();

// Graceful shutdown
process.on("SIGINT", () => {
  server.kill("SIGTERM");
  process.exit(0);
});
process.on("SIGTERM", () => {
  server.kill("SIGTERM");
  process.exit(0);
});
