#!/usr/bin/env node
/**
 * Electron build: prune devDeps → build → restore
 * Rebuilds native modules for the packaged Electron runtime before packaging.
 */
const { execSync } = require("child_process");
const path = require("path");
const cwd = path.join(__dirname, "..");
const packageJson = require(path.join(cwd, "package.json"));

function run(cmd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd, timeout: 1800000 });
}

function getElectronVersion() {
  return packageJson.build?.electronVersion || require(path.join(cwd, "node_modules/electron/package.json")).version;
}

function rebuildNativeModulesForElectron() {
  const electronVersion = getElectronVersion();
  run(
    `npx @electron/rebuild@3.7.1 -f -w better-sqlite3 -v ${electronVersion} -a ${process.arch}`
  );
  console.log(`[build] Rebuilt better-sqlite3 for Electron ${electronVersion}`);
}

try {
  run("npm prune --omit=dev --legacy-peer-deps");
  const size = execSync("du -sm node_modules", { encoding: "utf-8", cwd }).trim();
  console.log(`[build] node_modules after prune: ${size}`);
  rebuildNativeModulesForElectron();

  // Use npx to fetch and run electron-builder (since it was pruned)
  run("npx electron-builder@26.8.1 --mac");
} finally {
  console.log("[build] Restoring all dependencies...");
  run("npm install --legacy-peer-deps");
}
