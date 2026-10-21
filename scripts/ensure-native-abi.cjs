#!/usr/bin/env node
/**
 * Preflight: make sure better-sqlite3's native binding matches the current Node ABI.
 *
 * `npm run electron:build` rebuilds better-sqlite3 for Electron's ABI, which then
 * breaks `npm test` / `npm run dev` under plain Node until the module is rebuilt.
 * This script detects that state and heals it automatically.
 *
 * Happy path: silent and instant. Exits non-zero only if the rebuild fails.
 * Wired as postinstall/predev/pretest/prestart in package.json.
 */
"use strict";

const path = require("path");
const { spawnSync } = require("child_process");
const { createRequire } = require("module");

const projectRoot = path.join(__dirname, "..");
const req = createRequire(path.join(projectRoot, "package.json"));

// Not installed yet (e.g. mid-install) — nothing to heal; npm install builds it.
try {
  req.resolve("better-sqlite3/package.json");
} catch {
  process.exit(0);
}

// better-sqlite3 loads its native addon lazily, on the first `new Database()`,
// so a bare require() succeeds even when the binary was built for another ABI.
try {
  const Database = req("better-sqlite3");
  new Database(":memory:").close();
  process.exit(0); // ABI matches — done.
} catch (err) {
  console.error(
    `[studio] better-sqlite3 was built for a different runtime (${err.code || "load error"}) — rebuilding for Node ${process.version}...`
  );
}

const rebuild = spawnSync("npm", ["rebuild", "better-sqlite3"], {
  cwd: projectRoot,
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (rebuild.error || rebuild.status !== 0) {
  console.error("[studio] npm rebuild better-sqlite3 failed. Run it manually and re-try.");
  process.exit(rebuild.status || 1);
}

// Verify in a fresh process (this process already cached the failed dlopen).
const verify = spawnSync(
  process.execPath,
  ["-e", "new (require('better-sqlite3'))(':memory:').close()"],
  { cwd: projectRoot, stdio: "inherit" }
);

if (verify.status !== 0) {
  console.error("[studio] better-sqlite3 still fails to load after rebuild.");
  process.exit(1);
}

console.error(`[studio] better-sqlite3 rebuilt for Node ${process.version}.`);
