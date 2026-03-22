#!/usr/bin/env node
/**
 * Electron build: prune devDeps → build → restore
 * Uses npx to run electron-builder after pruning (since prune removes it)
 */
const { execSync } = require("child_process");
const path = require("path");
const cwd = path.join(__dirname, "..");

function run(cmd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd, timeout: 300000 });
}

try {
  run("npm prune --omit=dev");
  const size = execSync("du -sm node_modules", { encoding: "utf-8", cwd }).trim();
  console.log(`[build] node_modules after prune: ${size}`);

  // Use npx to fetch and run electron-builder (since it was pruned)
  run("npx electron-builder@26.8.1 --mac");
} finally {
  console.log("[build] Restoring all dependencies...");
  run("npm install");
}
