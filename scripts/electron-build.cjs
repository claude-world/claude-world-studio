#!/usr/bin/env node
/**
 * Electron build: prune devDeps → build → restore
 * Rebuilds native modules for the packaged Electron runtime before packaging.
 */
const { execSync } = require("child_process");
const path = require("path");
const cwd = path.join(__dirname, "..");
const packageJson = require(path.join(cwd, "package.json"));

// Capture BEFORE `npm prune --omit=dev` removes electron from node_modules.
const installedElectronVersion = (() => {
  try {
    return require(path.join(cwd, "node_modules/electron/package.json")).version;
  } catch {
    return null;
  }
})();

function run(cmd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd, timeout: 1800000 });
}

function getElectronVersion() {
  const pinned = packageJson.build?.electronVersion;
  if (pinned && installedElectronVersion && pinned !== installedElectronVersion) {
    console.warn(
      `[build] WARNING: package.json build.electronVersion (${pinned}) does not match ` +
        `the installed electron devDependency (${installedElectronVersion}).\n` +
        `[build] electron-builder packages Electron ${pinned}, so native modules are rebuilt against it.\n` +
        `[build] Update build.electronVersion to ${installedElectronVersion} to keep them in sync.`
    );
  }
  // The pin decides which Electron electron-builder packages, so native
  // modules must be rebuilt against it — fall back to the installed version.
  const electronVersion = pinned || installedElectronVersion;
  if (!electronVersion) {
    throw new Error(
      "[build] Cannot determine Electron version: no build.electronVersion in package.json and electron is not installed."
    );
  }
  return electronVersion;
}

function rebuildNativeModulesForElectron() {
  const electronVersion = getElectronVersion();
  run(
    `npx @electron/rebuild@3.7.1 -f -w better-sqlite3 -v ${electronVersion} -a ${process.arch}`
  );
  console.log(`[build] Rebuilt better-sqlite3 for Electron ${electronVersion}`);
}

function warnIfNotarizationUnconfigured() {
  const env = process.env;
  const hasAppleId = env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID;
  const hasApiKey = env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER;
  const hasKeychainProfile = env.APPLE_KEYCHAIN_PROFILE;
  if (hasAppleId || hasApiKey || hasKeychainProfile) return;
  const bang = "!".repeat(72);
  console.warn(
    [
      "",
      `[build] ${bang}`,
      "[build] WARNING: No notarization credentials detected.",
      "[build] The DMG will build, but Gatekeeper will BLOCK it on other Macs.",
      "[build] Provide one of:",
      "[build]   APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD + APPLE_TEAM_ID",
      "[build]   APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER",
      "[build]   APPLE_KEYCHAIN_PROFILE (notarytool keychain profile)",
      `[build] ${bang}`,
      "",
    ].join("\n")
  );
}

try {
  warnIfNotarizationUnconfigured();
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
