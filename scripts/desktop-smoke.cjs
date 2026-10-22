#!/usr/bin/env node
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const APP_BUNDLE_PATH = path.join(process.cwd(), "dist", "mac-arm64", "Claude World Studio.app");
const APP_PATH = path.join(
  APP_BUNDLE_PATH,
  "Contents",
  "MacOS",
  "Claude World Studio"
);
const DIST_DIR = path.join(process.cwd(), "dist");
const APP_UPDATE_CONFIG_PATH = path.join(
  process.cwd(),
  "dist",
  "mac-arm64",
  "Claude World Studio.app",
  "Contents",
  "Resources",
  "app-update.yml"
);
const LATEST_MAC_YML_PATH = path.join(DIST_DIR, "latest-mac.yml");

const PORT = parseInt(process.env.STUDIO_SMOKE_PORT || "3131", 10);
const HOST = "127.0.0.1";
const BASE_URL = `http://${HOST}:${PORT}`;
// realpath: on macOS os.tmpdir() sits under the /var -> /private/var symlink, while the
// server reports realpath-resolved workspaces, so compare against the resolved path.
const SMOKE_ROOT = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), "studio-desktop-smoke-"))
);
const USER_DATA_DIR = path.join(SMOKE_ROOT, "user-data");
const DEFAULT_WORKSPACE = path.join(SMOKE_ROOT, "workspace");
const APP_STDOUT_PATH = path.join(SMOKE_ROOT, "app.stdout.log");
const APP_STDERR_PATH = path.join(SMOKE_ROOT, "app.stderr.log");

function request(method, route, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: HOST,
        port: PORT,
        path: route,
        method,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": payload ? Buffer.byteLength(payload) : 0,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf-8");
          let parsed = raw;
          try {
            parsed = raw ? JSON.parse(raw) : null;
          } catch {}
          if ((res.statusCode || 500) >= 400) {
            reject(
              new Error(
                `${method} ${route} failed: ${res.statusCode}\n${typeof parsed === "string" ? parsed : JSON.stringify(parsed)}`
              )
            );
            return;
          }
          resolve(parsed);
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function waitForServer(timeoutMs = 30000, isAppExited = () => false) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (isAppExited()) {
      throw new Error("Packaged app exited before desktop server started");
    }
    try {
      return await request("GET", "/api/settings");
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("Timed out waiting for desktop server to start");
}

async function runUiSmoke() {
  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];

  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      errors.push(`console: ${msg.text()}`);
    }
  });

  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  for (const label of [
    "Social Accounts",
    "Posts",
    "Strategy",
    "Scheduled Tasks",
    "Agent Dashboard",
    "Settings",
  ]) {
    await page.getByRole("button", { name: label }).click();
    await page.waitForLoadState("networkidle");
  }

  await browser.close();

  if (errors.length > 0) {
    throw new Error(`UI smoke errors:\n${errors.join("\n")}`);
  }
}

function readIfExists(filePath) {
  try {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : "";
  } catch {
    return "";
  }
}

function getOutput(openOutput) {
  return [
    openOutput.join(""),
    readIfExists(APP_STDOUT_PATH),
    readIfExists(APP_STDERR_PATH),
  ]
    .filter(Boolean)
    .join("\n");
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function quitApp() {
  return new Promise((resolve) => {
    const child = spawn("osascript", [
      "-e",
      'tell application id "com.claude-world.studio" to quit',
    ]);
    child.on("exit", resolve);
    child.on("error", resolve);
  });
}

const RESOURCES_DIR = path.join(APP_BUNDLE_PATH, "Contents", "Resources");
const UNPACKED_DIR = path.join(RESOURCES_DIR, "app.asar.unpacked");

/**
 * The release ships an esbuild bundle instead of the TypeScript sources plus
 * tsx, and drops every production dependency only our own code imported. Check
 * the shipped tree directly: a packaging regression here is invisible until the
 * app is installed on a machine that has no node_modules to fall back on.
 */
function verifyPackagedLayout() {
  const serverBundle = path.join(UNPACKED_DIR, "server-dist", "server.mjs");
  if (!fs.existsSync(serverBundle)) {
    throw new Error(`Bundled server missing: ${serverBundle}`);
  }
  if (!fs.existsSync(path.join(UNPACKED_DIR, "dist", "index.html"))) {
    throw new Error("Client assets must be unpacked next to the bundled server");
  }
  for (const dropped of ["tsx", "esbuild", path.join("@anthropic-ai", "sdk")]) {
    const strayPath = path.join(UNPACKED_DIR, "node_modules", dropped);
    if (fs.existsSync(strayPath)) {
      throw new Error(`Packaged app still ships node_modules/${dropped}`);
    }
  }
  const addon = path.join(
    UNPACKED_DIR,
    "node_modules",
    "better-sqlite3",
    "build",
    "Release",
    "better_sqlite3.node"
  );
  if (!fs.existsSync(addon)) {
    throw new Error(`better-sqlite3 native addon missing: ${addon}`);
  }
}

/**
 * Load the Agent SDK and build a Studio-style MCP tool inside the packaged
 * tree, using the app's own Electron-as-node runtime. The running server only
 * proves its own import graph resolves; this covers the modules the SDK pulls
 * in lazily when a session actually starts (MCP server, zod schema conversion),
 * which is exactly what trimming node_modules could break.
 */
function verifyPackagedAgentSdk() {
  const probe = [
    "const { pathToFileURL } = require('node:url');",
    "const path = require('node:path');",
    `const nm = ${JSON.stringify(path.join(UNPACKED_DIR, "node_modules"))};`,
    "const load = (p) => import(pathToFileURL(path.join(nm, p)).href);",
    "(async () => {",
    "  const [sdk, zodMod] = await Promise.all([",
    "    load('@anthropic-ai/claude-agent-sdk/sdk.mjs'),",
    "    load('zod/index.js'),",
    "  ]);",
    "  const z = zodMod.z || zodMod.default;",
    "  const server = sdk.createSdkMcpServer({",
    "    name: 'smoke', version: '1.0.0',",
    "    tools: [sdk.tool('echo', 'echo', { text: z.string() }, async () => ({ content: [] }))],",
    "  });",
    "  if (!server || server.type !== 'sdk') throw new Error('unexpected MCP server: ' + JSON.stringify(server && server.type));",
    "  console.log('agent-sdk-ok');",
    "})().catch((err) => { console.error(err && err.stack || String(err)); process.exit(1); });",
  ].join("\n");

  const result = spawnSync(APP_PATH, ["-e", probe], {
    encoding: "utf-8",
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    timeout: 60000,
  });
  if (result.status !== 0 || !String(result.stdout).includes("agent-sdk-ok")) {
    throw new Error(
      [
        "Agent SDK failed to load from the packaged tree (a trimmed dependency?).",
        (result.stdout || "").trim(),
        (result.stderr || "").trim(),
      ]
        .filter(Boolean)
        .join("\n")
    );
  }
}

function verifyPackagedAppSignature() {
  const result = spawnSync(
    "codesign",
    ["--verify", "--deep", "--strict", "--verbose=2", APP_BUNDLE_PATH],
    { encoding: "utf-8" }
  );
  if (result.status !== 0) {
    throw new Error(
      [
        "Packaged app signature is invalid; rebuild the desktop artifact before running smoke tests.",
        (result.stdout || "").trim(),
        (result.stderr || "").trim(),
      ]
        .filter(Boolean)
        .join("\n")
    );
  }
}

async function main() {
  if (!fs.existsSync(APP_BUNDLE_PATH)) {
    throw new Error(`Packaged app not found: ${APP_BUNDLE_PATH}`);
  }
  if (!fs.existsSync(APP_PATH)) {
    throw new Error(`Packaged app executable not found: ${APP_PATH}`);
  }
  if (!fs.existsSync(APP_UPDATE_CONFIG_PATH)) {
    throw new Error(`Packaged updater config missing: ${APP_UPDATE_CONFIG_PATH}`);
  }
  if (!fs.existsSync(LATEST_MAC_YML_PATH)) {
    throw new Error(`latest-mac.yml missing: ${LATEST_MAC_YML_PATH}`);
  }
  // Accept both local artifact names ("Claude World Studio-…") and the
  // publish pipeline's dashed safeArtifactName ("Claude-World-Studio-…").
  const zipArtifact = fs
    .readdirSync(DIST_DIR)
    .find((name) => /^Claude[ -]World[ -]Studio-.*\.zip$/.test(name));
  if (!zipArtifact) {
    throw new Error(`macOS zip artifact missing in ${DIST_DIR}`);
  }
  verifyPackagedLayout();
  verifyPackagedAppSignature();
  verifyPackagedAgentSdk();

  const openOutput = [];
  let appExited = false;
  const child = spawn("open", [
    "-n",
    "-g",
    "-W",
    "--stdout",
    APP_STDOUT_PATH,
    "--stderr",
    APP_STDERR_PATH,
    "--env",
    `STUDIO_PORT=${PORT}`,
    "--env",
    `STUDIO_ELECTRON_USER_DATA_PATH=${USER_DATA_DIR}`,
    "--env",
    `STUDIO_USER_DATA_PATH=${USER_DATA_DIR}`,
    "--env",
    `STUDIO_DEFAULT_WORKSPACE=${DEFAULT_WORKSPACE}`,
    APP_BUNDLE_PATH,
  ], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (data) => openOutput.push(data.toString("utf-8")));
  child.stderr.on("data", (data) => openOutput.push(data.toString("utf-8")));
  child.on("exit", () => {
    appExited = true;
  });

  try {
    const settings = await waitForServer(30000, () => appExited);
    if (!settings.defaultWorkspace || settings.defaultWorkspace.includes(".app/Contents/Resources")) {
      throw new Error(`Invalid default workspace: ${settings.defaultWorkspace}`);
    }

    const session = await request("POST", "/api/sessions", {});
    if (session.workspace_path !== settings.defaultWorkspace) {
      throw new Error(
        `Session workspace mismatch: ${session.workspace_path} !== ${settings.defaultWorkspace}`
      );
    }

    const syncResult = await request("POST", "/api/settings/sync-skills");
    if (syncResult.synced !== syncResult.total) {
      throw new Error(`Skill sync incomplete: ${JSON.stringify(syncResult)}`);
    }

    const skillPath = path.join(USER_DATA_DIR, "skills", "threads-viral-agent", "SKILL.md");
    if (!fs.existsSync(skillPath)) {
      throw new Error(`Synced skill missing: ${skillPath}`);
    }

    const account = await request("POST", "/api/accounts", {
      name: "Smoke Threads",
      handle: "@smoke",
      platform: "threads",
      token: "dummy-token-1234567890",
      auto_publish: false,
    });

    const draft = await request("POST", "/api/publish", {
      accountId: account.id,
      text: "desktop smoke draft",
      sessionId: session.id,
      score: 80,
    });
    if (draft.status !== "draft") {
      throw new Error(`Expected draft publish result, got ${JSON.stringify(draft)}`);
    }

    const pending = await request("GET", "/api/publish/pending");
    if (!Array.isArray(pending) || pending.length === 0) {
      throw new Error("Pending draft queue should not be empty after manual-review publish");
    }

    await runUiSmoke();

    console.log(
      JSON.stringify(
        {
          ok: true,
          baseUrl: BASE_URL,
          defaultWorkspace: settings.defaultWorkspace,
          pendingDrafts: pending.length,
        },
        null,
        2
      )
    );
  } catch (err) {
    const joinedOutput = getOutput(openOutput);
    throw new Error(`${err.message}\n\nApp output:\n${joinedOutput}`);
  } finally {
    await quitApp();
    await waitForExit(child, 5000);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
    fs.rmSync(SMOKE_ROOT, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
