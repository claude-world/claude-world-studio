#!/usr/bin/env node

import http from "node:http";
import { WebSocket } from "ws";

// ─── Global flags ────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.STUDIO_PORT || "3001", 10);
const HOST = process.env.STUDIO_HOST || "127.0.0.1";
let JSON_OUTPUT = false;

function parseGlobalFlags(argv) {
  const args = [];
  let port = PORT;
  let host = HOST;
  let skipNext = false;
  for (let i = 0; i < argv.length; i++) {
    if (skipNext) { skipNext = false; continue; }
    const arg = argv[i];
    if (arg === "--json") { JSON_OUTPUT = true; continue; }
    if (arg.startsWith("--port=")) { const v = parseInt(arg.split("=")[1], 10); if (!isNaN(v)) port = v; continue; }
    if (arg.startsWith("--host=")) { host = arg.split("=")[1]; continue; }
    if (arg === "--port" && i + 1 < argv.length && /^\d+$/.test(argv[i + 1])) { port = parseInt(argv[i + 1], 10); skipNext = true; continue; }
    if (arg === "--host" && i + 1 < argv.length && !argv[i + 1].startsWith("-")) { host = argv[i + 1]; skipNext = true; continue; }
    args.push(arg);
  }
  return { args, port, host };
}

// ─── HTTP helper ─────────────────────────────────────────────────────────────

function api(method, path, body, port, host) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: host,
      port,
      path,
      method,
      headers: { "Content-Type": "application/json" },
      timeout: 30000,
    };
    const req = http.request(opts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString();
        try {
          const data = JSON.parse(raw);
          if (res.statusCode >= 400) {
            reject(new Error(data.error || `HTTP ${res.statusCode}`));
          } else {
            resolve(data);
          }
        } catch {
          if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}: ${raw}`));
          else resolve(raw);
        }
      });
    });
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Request timed out: ${method} ${path}`));
    });
    req.on("error", (err) => {
      if (err.code === "ECONNREFUSED") {
        reject(new Error(`Server not running at ${host}:${port}. Start with: studio serve`));
      } else {
        reject(err);
      }
    });
    if (payload) req.write(payload);
    req.end();
  });
}

// ─── Output helpers ──────────────────────────────────────────────────────────

function output(data, humanFn) {
  if (JSON_OUTPUT) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    humanFn(data);
  }
}

function die(msg) {
  if (JSON_OUTPUT) {
    console.error(JSON.stringify({ error: msg }));
  } else {
    console.error(`Error: ${msg}`);
  }
  process.exit(1);
}

// ─── Flag parser ─────────────────────────────────────────────────────────────

function getFlag(args, name, defaultVal = undefined) {
  const prefix = `--${name}=`;
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith(prefix)) return args[i].slice(prefix.length);
    if (args[i] === `--${name}` && i + 1 < args.length && !args[i + 1].startsWith("--")) return args[i + 1];
  }
  return defaultVal;
}

function hasFlag(args, name) {
  return args.includes(`--${name}`);
}

// ─── Commands ────────────────────────────────────────────────────────────────

// serve
async function cmdServe(args, port, host) {
  const { spawnSync } = await import("node:child_process");
  const { existsSync, mkdirSync } = await import("node:fs");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");

  const __filename = fileURLToPath(import.meta.url);
  const projectDir = join(dirname(__filename), "..");

  // Ensure data directory exists
  const dataDir = join(projectDir, "data");
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

  // Use bundled tsx (works in npm install -g and Electron), fallback to npx
  const tsxBin = join(projectDir, "node_modules", ".bin", "tsx");
  const cmd = existsSync(tsxBin) ? tsxBin : "npx";
  const cmdArgs = existsSync(tsxBin) ? ["server/server.ts"] : ["tsx", "server/server.ts"];

  const result = spawnSync(cmd, cmdArgs, {
    cwd: projectDir,
    stdio: "inherit",
    env: { ...process.env, PORT: String(port), HOST: host },
  });

  if (result.error) {
    die(`Failed to start server: ${result.error.message}`);
  }
  process.exit(result.status ?? 1);
}

// status
async function cmdStatus(args, port, host) {
  try {
    const start = Date.now();
    await api("GET", "/api/settings", null, port, host);
    const ms = Date.now() - start;
    output({ status: "running", host, port, latency_ms: ms }, (d) => {
      console.log(`Studio is running at http://${d.host}:${d.port} (${d.latency_ms}ms)`);
    });
  } catch {
    output({ status: "stopped", host, port }, () => {
      console.log(`Studio is not running at http://${host}:${port}`);
    });
    process.exit(1);
  }
}

// session list
async function cmdSessionList(args, port, host) {
  const sessions = await api("GET", "/api/sessions", null, port, host);
  output(sessions, (list) => {
    if (list.length === 0) { console.log("No sessions"); return; }
    console.log(`${"ID".padEnd(38)} ${"Title".padEnd(30)} ${"Status".padEnd(10)} Created`);
    console.log("-".repeat(95));
    for (const s of list) {
      console.log(`${s.id.padEnd(38)} ${(s.title || "Untitled").slice(0, 28).padEnd(30)} ${(s.status || "active").padEnd(10)} ${s.created_at}`);
    }
  });
}

// session create
async function cmdSessionCreate(args, port, host) {
  const title = getFlag(args, "title");
  const workspace = getFlag(args, "workspace", process.cwd());
  const session = await api("POST", "/api/sessions", { title, workspacePath: workspace }, port, host);
  output(session, (s) => {
    console.log(`Created session: ${s.id}`);
    if (s.title) console.log(`  Title: ${s.title}`);
    console.log(`  Workspace: ${s.workspace_path}`);
  });
}

// session get
async function cmdSessionGet(args, port, host) {
  const id = args[0];
  if (!id) die("Usage: session get <ID>");
  const session = await api("GET", `/api/sessions/${id}`, null, port, host);
  output(session, (s) => {
    console.log(`Session: ${s.id}`);
    console.log(`  Title: ${s.title || "Untitled"}`);
    console.log(`  Workspace: ${s.workspace_path}`);
    console.log(`  Status: ${s.status || "active"}`);
    console.log(`  Created: ${s.created_at}`);
    console.log(`  Updated: ${s.updated_at}`);
  });
}

// session rename
async function cmdSessionRename(args, port, host) {
  const id = args[0];
  const title = getFlag(args, "title");
  if (!id || !title) die("Usage: session rename <ID> --title <TITLE>");
  await api("PATCH", `/api/sessions/${id}`, { title }, port, host);
  output({ success: true, id, title }, () => {
    console.log(`Renamed session ${id} → "${title}"`);
  });
}

// session delete
async function cmdSessionDelete(args, port, host) {
  const id = args[0];
  if (!id) die("Usage: session delete <ID>");
  await api("DELETE", `/api/sessions/${id}`, null, port, host);
  output({ success: true, id }, () => {
    console.log(`Deleted session ${id}`);
  });
}

// session messages
async function cmdSessionMessages(args, port, host) {
  const id = args[0];
  if (!id) die("Usage: session messages <ID> [--limit N]");
  const limit = getFlag(args, "limit", "50");
  const messages = await api("GET", `/api/sessions/${id}/messages`, null, port, host);
  const limited = messages.slice(-parseInt(limit, 10));
  output(limited, (msgs) => {
    if (msgs.length === 0) { console.log("No messages"); return; }
    for (const m of msgs) {
      const role = m.role.toUpperCase().padEnd(12);
      const content = m.role === "tool_use"
        ? `[${m.tool_name}] ${(m.tool_input || "").slice(0, 80)}`
        : m.role === "tool_result"
        ? `[result] ${(m.content || "").slice(0, 80)}`
        : (m.content || "").slice(0, 120);
      console.log(`${role} ${content}`);
      if (m.cost_usd) console.log(`             Cost: $${m.cost_usd.toFixed(4)}`);
    }
  });
}

// chat (WebSocket streaming)
async function cmdChat(args, port, host) {
  const verbose = hasFlag(args, "verbose");
  let sessionId = getFlag(args, "session");
  const workspace = getFlag(args, "workspace", process.cwd());

  // Read message from --message or stdin
  let message = getFlag(args, "message");
  if (!message && !process.stdin.isTTY) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    message = Buffer.concat(chunks).toString().trim();
  }
  if (!message) die("Usage: chat --message <TEXT> [--session ID] [--workspace PATH]");

  // Auto-create session if needed
  if (!sessionId) {
    const session = await api("POST", "/api/sessions", { workspacePath: workspace }, port, host);
    sessionId = session.id;
    process.stderr.write(`Session: ${sessionId}\n`);
  }

  // Connect WebSocket
  const ws = new WebSocket(`ws://${host}:${port}/ws`);
  let done = false;

  const cleanup = () => {
    if (!done) {
      done = true;
      try { ws.close(); } catch {}
    }
  };

  process.on("SIGINT", () => {
    // Send interrupt and wait briefly for flush before exiting
    try {
      ws.send(JSON.stringify({ type: "interrupt", sessionId }), () => {
        cleanup();
        process.exit(130);
      });
    } catch {
      cleanup();
      process.exit(130);
    }
    // Fallback exit if callback doesn't fire within 500ms
    setTimeout(() => { cleanup(); process.exit(130); }, 500);
  });

  ws.on("error", (err) => {
    die(`WebSocket error: ${err.message}`);
  });

  ws.on("open", () => {
    ws.send(JSON.stringify({ type: "subscribe", sessionId }));
  });

  let subscribed = false;

  ws.on("message", (data) => {
    try {
      const event = JSON.parse(data.toString());

      switch (event.type) {
        case "connected":
          break;

        case "history":
          // History received — now send our chat message
          if (!subscribed) {
            subscribed = true;
            ws.send(JSON.stringify({ type: "chat", sessionId, content: message }));
          }
          break;

        case "assistant_message":
          if (JSON_OUTPUT) {
            process.stdout.write(JSON.stringify(event) + "\n");
          } else {
            process.stdout.write(event.content || "");
          }
          break;

        case "tool_use":
          if (JSON_OUTPUT) {
            process.stdout.write(JSON.stringify(event) + "\n");
          } else if (verbose) {
            process.stderr.write(`[tool] ${event.toolName || event.tool_name || "unknown"}\n`);
          }
          break;

        case "tool_result":
          if (JSON_OUTPUT) {
            process.stdout.write(JSON.stringify(event) + "\n");
          } else if (verbose) {
            const preview = (event.content || "").slice(0, 100);
            process.stderr.write(`[result] ${preview}\n`);
          }
          break;

        case "result":
          if (JSON_OUTPUT) {
            process.stdout.write(JSON.stringify(event) + "\n");
          } else {
            process.stdout.write("\n");
            const cost = event.cost_usd ?? event.cost;
            if (cost) {
              process.stderr.write(`Cost: $${cost.toFixed(4)}\n`);
            }
          }
          cleanup();
          process.exit(event.success === false ? 1 : 0);
          break;

        case "error":
          die(event.error || "Unknown error");
          break;

        case "interrupted":
          if (JSON_OUTPUT) {
            process.stdout.write(JSON.stringify(event) + "\n");
          }
          process.stderr.write("Session interrupted\n");
          cleanup();
          process.exit(130);
          break;

        default:
          if (JSON_OUTPUT) {
            process.stdout.write(JSON.stringify(event) + "\n");
          }
      }
    } catch (err) {
      // Non-JSON message, ignore
    }
  });

  ws.on("close", () => {
    if (!done) {
      done = true;
      process.stderr.write("Connection closed unexpectedly\n");
      process.exit(1);
    }
  });
}

// interrupt
async function cmdInterrupt(args, port, host) {
  const id = args[0];
  if (!id) die("Usage: interrupt <SESSION_ID>");

  const ws = new WebSocket(`ws://${host}:${port}/ws`);
  ws.on("open", () => {
    ws.send(JSON.stringify({ type: "interrupt", sessionId: id }));
    setTimeout(() => {
      ws.close();
      output({ success: true, sessionId: id }, () => {
        console.log(`Interrupted session ${id}`);
      });
    }, 200);
  });
  ws.on("error", (err) => die(`WebSocket error: ${err.message}`));
}

// account list
async function cmdAccountList(args, port, host) {
  const accounts = await api("GET", "/api/accounts", null, port, host);
  output(accounts, (list) => {
    if (list.length === 0) { console.log("No accounts"); return; }
    console.log(`${"ID".padEnd(38)} ${"Name".padEnd(20)} ${"Handle".padEnd(25)} Platform`);
    console.log("-".repeat(95));
    for (const a of list) {
      console.log(`${a.id.padEnd(38)} ${a.name.slice(0, 18).padEnd(20)} ${a.handle.slice(0, 23).padEnd(25)} ${a.platform}`);
    }
  });
}

// account create
async function cmdAccountCreate(args, port, host) {
  const name = getFlag(args, "name");
  const handle = getFlag(args, "handle");
  const platform = getFlag(args, "platform");
  const token = getFlag(args, "token");
  const userId = getFlag(args, "user-id");
  const style = getFlag(args, "style");
  const persona = getFlag(args, "persona");
  if (!name || !handle || !platform) die("Usage: account create --name N --handle H --platform P [--token T] [--user-id U] [--style S] [--persona T]");
  const account = await api("POST", "/api/accounts", {
    name, handle, platform, token, user_id: userId, style, persona_prompt: persona,
  }, port, host);
  output(account, (a) => {
    console.log(`Created account: ${a.id}`);
    console.log(`  ${a.name} (${a.handle}) on ${a.platform}`);
  });
}

// account update
async function cmdAccountUpdate(args, port, host) {
  const id = args[0];
  if (!id) die("Usage: account update <ID> [--name N] [--handle H] [--token T] ...");
  const body = {};
  const name = getFlag(args, "name"); if (name) body.name = name;
  const handle = getFlag(args, "handle"); if (handle) body.handle = handle;
  const platform = getFlag(args, "platform"); if (platform) body.platform = platform;
  const token = getFlag(args, "token"); if (token) body.token = token;
  const userId = getFlag(args, "user-id"); if (userId) body.user_id = userId;
  const style = getFlag(args, "style"); if (style) body.style = style;
  const persona = getFlag(args, "persona"); if (persona) body.persona_prompt = persona;
  const account = await api("PUT", `/api/accounts/${id}`, body, port, host);
  output(account, (a) => {
    console.log(`Updated account: ${a.id}`);
    console.log(`  ${a.name} (${a.handle}) on ${a.platform}`);
  });
}

// account delete
async function cmdAccountDelete(args, port, host) {
  const id = args[0];
  if (!id) die("Usage: account delete <ID>");
  await api("DELETE", `/api/accounts/${id}`, null, port, host);
  output({ success: true, id }, () => {
    console.log(`Deleted account ${id}`);
  });
}

// settings get
async function cmdSettingsGet(args, port, host) {
  const settings = await api("GET", "/api/settings", null, port, host);
  output(settings, (s) => {
    for (const [k, v] of Object.entries(s)) {
      console.log(`  ${k}: ${v || "(not set)"}`);
    }
  });
}

// settings detect
async function cmdSettingsDetect(args, port, host) {
  const detected = await api("GET", "/api/settings/detect", null, port, host);
  output(detected, (d) => {
    for (const [k, info] of Object.entries(d)) {
      const status = info.found ? "✓" : "✗";
      const value = k === "cfBrowserApiKey" ? (info.found ? "(found)" : "(not found)") : (info.value || "(not found)");
      console.log(`  ${status} ${k}: ${value}`);
    }
  });
}

// settings apply
async function cmdSettingsApply(args, port, host) {
  const result = await api("POST", "/api/settings/detect/apply", null, port, host);
  output(result, (r) => {
    console.log(`Applied ${r.applied} setting(s) from auto-detection`);
  });
}

// settings set
async function cmdSettingsSet(args, port, host) {
  const body = {};
  const keys = ["language", "trend-pulse-python", "cf-browser-python", "notebooklm-path", "cf-browser-url", "cf-browser-key", "default-workspace"];
  const apiKeys = ["language", "trendPulseVenvPython", "cfBrowserVenvPython", "notebooklmServerPath", "cfBrowserUrl", "cfBrowserApiKey", "defaultWorkspace"];
  for (let i = 0; i < keys.length; i++) {
    const val = getFlag(args, keys[i]);
    if (val !== undefined) body[apiKeys[i]] = val;
  }
  if (Object.keys(body).length === 0) {
    die("Usage: settings set --language L --trend-pulse-python P --cf-browser-python P ...");
  }
  await api("PUT", "/api/settings", body, port, host);
  output({ success: true, updated: body }, (r) => {
    console.log("Settings updated:");
    for (const [k, v] of Object.entries(r.updated)) {
      console.log(`  ${k}: ${v}`);
    }
  });
}

// publish
async function cmdPublish(args, port, host) {
  const accountId = getFlag(args, "account");
  const text = getFlag(args, "text");
  const score = getFlag(args, "score");
  const imageUrl = getFlag(args, "image-url");
  const poll = getFlag(args, "poll");
  const linkComment = getFlag(args, "link-comment");
  const tag = getFlag(args, "tag");
  if (!accountId || !text) die("Usage: publish --account ID --text T [--score N] [--image-url U] [--poll 'A|B'] [--link-comment U] [--tag T]");

  const body = { accountId, text };
  if (score) body.score = parseInt(score, 10);
  if (imageUrl) body.imageUrl = imageUrl;
  if (poll) body.pollOptions = poll.split("|");
  if (linkComment) body.linkComment = linkComment;
  if (tag) body.tag = tag;

  const result = await api("POST", "/api/publish", body, port, host);
  output(result, (r) => {
    if (r.success) {
      console.log(`Published! Post ID: ${r.postId || "pending"}`);
      if (r.postUrl) console.log(`  URL: ${r.postUrl}`);
    } else {
      console.log(`Publish failed: ${r.error}`);
    }
  });
}

// history
async function cmdHistory(args, port, host) {
  const limit = getFlag(args, "limit", "20");
  const history = await api("GET", `/api/publish/history?limit=${limit}`, null, port, host);
  output(history, (list) => {
    if (list.length === 0) { console.log("No publish history"); return; }
    console.log(`${"ID".padEnd(38)} ${"Platform".padEnd(12)} ${"Status".padEnd(12)} Content`);
    console.log("-".repeat(100));
    for (const h of list) {
      console.log(`${h.id.padEnd(38)} ${h.platform.padEnd(12)} ${h.status.padEnd(12)} ${(h.content || "").slice(0, 40)}`);
    }
  });
}

// file list
async function cmdFileList(args, port, host) {
  const sessionId = args[0];
  if (!sessionId) die("Usage: file list <SESSION_ID> [--depth N]");
  const depth = getFlag(args, "depth", "3");
  const result = await api("GET", `/api/sessions/${sessionId}/files?depth=${depth}`, null, port, host);
  output(result, (r) => {
    console.log(`Workspace: ${r.workspace}`);
    printTree(r.tree, "");
  });
}

function printTree(entries, indent) {
  for (const e of entries) {
    if (e.type === "directory") {
      console.log(`${indent}${e.name}/`);
      if (e.children) printTree(e.children, indent + "  ");
    } else {
      const size = e.size != null ? ` (${formatSize(e.size)})` : "";
      console.log(`${indent}${e.name}${size}`);
    }
  }
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}

// file read
async function cmdFileRead(args, port, host) {
  const sessionId = args[0];
  const filePath = args[1];
  if (!sessionId || !filePath) die("Usage: file read <SESSION_ID> <PATH>");
  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  const result = await api("GET", `/api/sessions/${sessionId}/files/${encodedPath}`, null, port, host);
  output(result, (r) => {
    if (typeof r === "string") {
      process.stdout.write(r);
    } else {
      process.stdout.write(r.content || "");
      if (r.truncated) {
        process.stderr.write(`\n[truncated at ${formatSize(r.size)}]\n`);
      }
    }
  });
}

// help
function showHelp() {
  console.log(`Claude World Studio CLI

Usage: studio [--json] [--port N] [--host H] <command> [flags]

Server:
  serve                                       Start web UI server
  status                                      Check server status

Sessions:
  session list                                List active sessions
  session create [--title T] [--workspace P]  Create session
  session get <ID>                            Get session details
  session rename <ID> --title T               Rename session
  session delete <ID>                         Delete session
  session messages <ID> [--limit N]           Get conversation history

Chat:
  chat [--session ID] [--message T]           Send message (WebSocket streaming)
       [--workspace P] [--verbose]
  interrupt <ID>                              Stop running session

Accounts:
  account list                                List social accounts
  account create --name N --handle H          Create account
         --platform P [--token T]
         [--user-id U] [--style S] [--persona T]
  account update <ID> [--name] [--handle]     Update account
         [--token] [--platform] ...
  account delete <ID>                         Delete account

Settings:
  settings get                                Show current settings
  settings detect                             Scan system for MCP tools
  settings apply                              Apply detected values
  settings set [--language L]                 Update settings
         [--trend-pulse-python P]
         [--cf-browser-python P] ...

Publishing:
  publish --account ID --text T               Publish content
         [--score N] [--image-url U]
         [--poll "A|B"] [--link-comment U]
         [--tag T]
  history [--limit N]                         Show publish history

Files:
  file list <SESSION_ID> [--depth N]          List workspace files
  file read <SESSION_ID> <PATH>               Read file content

Global flags:
  --json          Output JSON (for programmatic use)
  --port N        Server port (default: 3001, env: STUDIO_PORT)
  --host H        Server host (default: 127.0.0.1, env: STUDIO_HOST)

Environment:
  STUDIO_PORT     Default port
  STUDIO_HOST     Default host

Examples:
  studio status
  studio session list --json
  studio session create --title "Trend Research" --workspace /path/to/project
  studio chat --message "Find trending topics in Taiwan"
  studio chat --session abc123 --message "Publish the best one" --json
  echo "What's trending?" | studio chat --json
  studio publish --account acc123 --text "Hello world!" --score 85
  studio settings detect --json
  studio file list sess123 --depth 2
`);
}

// ─── Router ──────────────────────────────────────────────────────────────────

const { args, port, host } = parseGlobalFlags(process.argv.slice(2));

const cmd = args[0];
const sub = args[1];
const rest = args.slice(2);

const COMMANDS = {
  serve:     () => cmdServe(rest, port, host),
  status:    () => cmdStatus(rest, port, host),
  session:   {
    list:     () => cmdSessionList(rest, port, host),
    create:   () => cmdSessionCreate(rest, port, host),
    get:      () => cmdSessionGet(rest, port, host),
    rename:   () => cmdSessionRename(rest, port, host),
    delete:   () => cmdSessionDelete(rest, port, host),
    messages: () => cmdSessionMessages(rest, port, host),
  },
  chat:      () => cmdChat(args.slice(1), port, host),
  interrupt: () => cmdInterrupt(args.slice(1), port, host),
  account:   {
    list:     () => cmdAccountList(rest, port, host),
    create:   () => cmdAccountCreate(rest, port, host),
    update:   () => cmdAccountUpdate(rest, port, host),
    delete:   () => cmdAccountDelete(rest, port, host),
  },
  settings:  {
    get:      () => cmdSettingsGet(rest, port, host),
    detect:   () => cmdSettingsDetect(rest, port, host),
    apply:    () => cmdSettingsApply(rest, port, host),
    set:      () => cmdSettingsSet(rest, port, host),
  },
  publish:   () => cmdPublish(args.slice(1), port, host),
  history:   () => cmdHistory(args.slice(1), port, host),
  file:      {
    list:     () => cmdFileList(rest, port, host),
    read:     () => cmdFileRead(rest, port, host),
  },
  help:      () => { showHelp(); },
};

async function main() {
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    showHelp();
    return;
  }

  const entry = COMMANDS[cmd];
  if (!entry) {
    die(`Unknown command: ${cmd}. Run 'studio help' for usage.`);
  }

  if (typeof entry === "function") {
    try {
      await entry();
    } catch (err) {
      die(err.message);
    }
    return;
  }

  // Nested subcommand
  if (!sub || sub === "help") {
    const subs = Object.keys(entry).join(", ");
    die(`Usage: studio ${cmd} <${subs}>`);
  }

  const handler = entry[sub];
  if (!handler) {
    const subs = Object.keys(entry).join(", ");
    die(`Unknown subcommand: ${cmd} ${sub}. Available: ${subs}`);
  }

  try {
    await handler();
  } catch (err) {
    die(err.message);
  }
}

main();
