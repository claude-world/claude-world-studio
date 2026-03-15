#!/usr/bin/env node

import { execSync, spawn, spawnSync } from "child_process";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectDir = join(__dirname, "..");
const PORT = process.env.PORT || "3001";
const HOST = process.env.HOST || "127.0.0.1";
const URL = `http://${HOST}:${PORT}`;

const [,, command, ...args] = process.argv;

// ── Helpers ──────────────────────────────────────────────

function ensureDataDir() {
  const dataDir = join(projectDir, "data");
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
}

function parseArgs(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        parsed[key] = next;
        i++;
      } else {
        parsed[key] = true;
      }
    }
  }
  return parsed;
}

async function apiGet(path) {
  const http = await import("http");
  return new Promise((resolve, reject) => {
    http.get(`${URL}${path}`, (res) => {
      let data = "";
      res.on("data", (c) => data += c);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error(data)); }
      });
    }).on("error", reject);
  });
}

async function apiPost(path, body) {
  const http = await import("http");
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body);
    const req = http.request(`${URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(postData) },
    }, (res) => {
      let data = "";
      res.on("data", (c) => data += c);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error(data)); }
      });
    });
    req.on("error", reject);
    req.write(postData);
    req.end();
  });
}

async function ensureServer() {
  try {
    await apiGet("/api/sessions");
    return true;
  } catch {
    console.error("Studio server not running. Start it first: claude-world-studio");
    process.exit(1);
  }
}

// ── Commands ─────────────────────────────────────────────

async function cmdServe() {
  ensureDataDir();
  const distDir = join(projectDir, "dist");
  if (!existsSync(distDir)) {
    console.log("Building client assets...");
    execSync("npx vite build", { cwd: projectDir, stdio: "inherit" });
  }

  const tsxBin = join(projectDir, "node_modules", ".bin", "tsx");
  const server = spawn(tsxBin, ["server/server.ts"], {
    cwd: projectDir,
    env: { ...process.env, PORT, HOST },
    stdio: "inherit",
  });

  const http = await import("http");
  function waitAndOpen(retries = 30) {
    http.get(`${URL}/api/sessions`, (res) => {
      if (res.statusCode === 200) {
        console.log(`\n  Claude World Studio → ${URL}\n`);
        const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
        spawn(cmd, [URL], { detached: true, stdio: "ignore" }).unref();
      } else if (retries > 0) {
        setTimeout(() => waitAndOpen(retries - 1), 500);
      }
    }).on("error", () => {
      if (retries > 0) setTimeout(() => waitAndOpen(retries - 1), 500);
    });
  }
  waitAndOpen();

  process.on("SIGINT", () => { server.kill("SIGTERM"); process.exit(0); });
  process.on("SIGTERM", () => { server.kill("SIGTERM"); process.exit(0); });
}

async function cmdPublish() {
  await ensureServer();
  const opts = parseArgs(args);
  if (!opts.text || !opts.account) {
    console.error("Usage: claude-world-studio publish --account ACCOUNT_ID --text \"content\" [--score 80] [--image-url URL] [--poll \"A|B|C\"] [--link-comment URL] [--tag topic]");
    process.exit(1);
  }
  const result = await apiPost("/api/publish", {
    accountId: opts.account,
    text: opts.text,
    score: opts.score ? Number(opts.score) : undefined,
    imageUrl: opts["image-url"],
    pollOptions: opts.poll,
    linkComment: opts["link-comment"],
    tag: opts.tag,
  });
  console.log(JSON.stringify(result, null, 2));
}

async function cmdHistory() {
  await ensureServer();
  const opts = parseArgs(args);
  const limit = opts.limit || "20";
  const history = await apiGet(`/api/publish/history?limit=${limit}`);
  if (history.length === 0) {
    console.log("No publish history.");
    return;
  }
  console.log(`\nPublish History (${history.length} records):\n`);
  for (const h of history) {
    const status = h.status === "published" ? "✓" : "✗";
    const text = h.content.length > 60 ? h.content.slice(0, 60) + "..." : h.content;
    console.log(`  ${status} [${h.created_at}] ${h.platform}/${h.account}: ${text}`);
    if (h.post_url) console.log(`    → ${h.post_url}`);
  }
}

async function cmdAccounts() {
  await ensureServer();
  const accounts = await apiGet("/api/accounts");
  if (accounts.length === 0) {
    console.log("No accounts configured. Add accounts in Settings UI.");
    return;
  }
  console.log("\nSocial Accounts:\n");
  console.log("  ID                                    Name              Handle              Platform");
  console.log("  " + "─".repeat(90));
  for (const a of accounts) {
    const hasToken = a.token ? "✓" : "✗";
    console.log(`  ${a.id}  ${a.name.padEnd(16)}  ${a.handle.padEnd(18)}  ${a.platform} ${hasToken}`);
  }
}

async function cmdStatus() {
  try {
    await apiGet("/api/sessions");
    console.log(`✓ Studio running at ${URL}`);
    const accounts = await apiGet("/api/accounts");
    console.log(`  ${accounts.length} account(s) configured`);
    const history = await apiGet("/api/publish/history?limit=1");
    if (history.length > 0) {
      console.log(`  Last publish: ${history[0].created_at} (${history[0].status})`);
    }
  } catch {
    console.log(`✗ Studio not running (expected at ${URL})`);
  }
}

function cmdHelp() {
  console.log(`
Claude World Studio CLI

Usage: claude-world-studio <command> [options]

Commands:
  (none)          Start Studio web UI (default)
  publish         Publish to Threads
  history         Show publish history
  accounts        List social accounts
  status          Check if Studio is running
  help            Show this help

Publish Options:
  --account ID    Account ID (required, use 'accounts' to list)
  --text TEXT     Post content (required, max 500 chars)
  --score N       Quality score (must be >= 70)
  --image-url URL Public image URL to attach
  --poll "A|B|C"  Poll options (pipe-separated)
  --link-comment  URL to auto-reply (avoids reach penalty)
  --tag TOPIC     Topic tag (no # prefix)

Examples:
  claude-world-studio                                    # start web UI
  claude-world-studio status                             # check server
  claude-world-studio accounts                           # list accounts
  claude-world-studio publish --account abc --text "Hello" --score 75
  claude-world-studio history --limit 10
`);
}

// ── Router ───────────────────────────────────────────────

switch (command) {
  case undefined:
  case "serve":
    cmdServe();
    break;
  case "publish":
    cmdPublish();
    break;
  case "history":
    cmdHistory();
    break;
  case "accounts":
    cmdAccounts();
    break;
  case "status":
    cmdStatus();
    break;
  case "help":
  case "--help":
  case "-h":
    cmdHelp();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    cmdHelp();
    process.exit(1);
}
