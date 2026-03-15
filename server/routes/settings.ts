import { Router } from "express";
import { existsSync, readFileSync, readdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import store from "../db.js";
import { getSettings } from "../mcp-config.js";

const { join, isAbsolute } = path;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

const SENSITIVE_KEYS = ["cfBrowserApiKey"] as const;

function maskValue(value: string): string {
  if (!value || value.length < 12) return value ? "***" : "";
  return value.slice(0, 8) + "..." + value.slice(-4);
}

// Get all settings (tokens masked)
router.get("/", (_req, res) => {
  const settings = getSettings();
  const masked: Record<string, string> = { ...settings };

  for (const key of SENSITIVE_KEYS) {
    if (masked[key]) {
      masked[key] = maskValue(masked[key]);
    }
  }

  res.json(masked);
});

// Auto-detect installed MCP tools
router.get("/detect", (_req, res) => {
  const home = process.env.HOME || "";
  const workspace =
    getSettings().defaultWorkspace ||
    process.env.DEFAULT_WORKSPACE ||
    process.cwd();

  const projectMcp = join(__dirname, "../../mcp-servers");
  const searchRoots = [
    projectMcp,
    workspace,
    join(home, "github"),
    join(home, "projects"),
    join(home, "dev"),
    join(home, "code"),
  ].filter((p) => isAbsolute(p) && existsSync(p));

  // trend-pulse
  const tpCandidates = searchRoots.flatMap((root) => [
    join(root, "trend-pulse/.venv/bin/python"),
    join(root, "trend-pulse/.venv/bin/python3"),
  ]);
  const trendPulsePython = tpCandidates.find(existsSync) || "";

  // cf-browser
  const cbCandidates = searchRoots.flatMap((root) => [
    join(root, "cf-browser/mcp-server/.venv/bin/python"),
    join(root, "cf-browser/mcp-server/.venv/bin/python3"),
  ]);
  const cfBrowserPython = cbCandidates.find(existsSync) || "";

  // notebooklm-skill
  const nlmCandidates = [
    ...searchRoots.flatMap((root) => [
      join(root, "notebooklm-skill/mcp-server/server.py"),
      join(root, "notebooklm-skill/mcp_server.py"),
    ]),
    ...searchRoots.flatMap((root) => {
      try {
        return readdirSync(root, { withFileTypes: true })
          .filter((e) => e.isDirectory() && !e.name.startsWith("."))
          .flatMap((e) => [
            join(root, e.name, "notebooklm-skill/mcp-server/server.py"),
          ]);
      } catch { return []; }
    }),
  ];
  const notebooklmPath = nlmCandidates.find(existsSync) || "";

  // cf-browser URL/Key
  let cfBrowserUrl = "";
  let cfBrowserApiKeyFound = false;
  const cfEnvCandidates = [
    ...searchRoots.flatMap((root) => [
      join(root, "cf-browser/.env"),
      join(root, "cf-browser/worker/.env"),
    ]),
    join(__dirname, "../../.env"),
  ];
  for (const envPath of cfEnvCandidates) {
    if (existsSync(envPath)) {
      try {
        const content = readFileSync(envPath, "utf-8");
        const urlMatch = content.match(/^CF_BROWSER_URL=(.+)/m);
        const keyMatch = content.match(/^CF_BROWSER_API_KEY=(.+)/m);
        if (urlMatch && !cfBrowserUrl) cfBrowserUrl = urlMatch[1].trim();
        if (keyMatch && !cfBrowserApiKeyFound) cfBrowserApiKeyFound = true;
      } catch {}
    }
  }

  const detected: Record<string, { value: string; found: boolean }> = {
    trendPulseVenvPython: { value: trendPulsePython, found: !!trendPulsePython },
    cfBrowserVenvPython: { value: cfBrowserPython, found: !!cfBrowserPython },
    notebooklmServerPath: { value: notebooklmPath, found: !!notebooklmPath },
    cfBrowserUrl: { value: cfBrowserUrl, found: !!cfBrowserUrl },
    cfBrowserApiKey: { value: "", found: cfBrowserApiKeyFound },
    defaultWorkspace: { value: workspace, found: existsSync(workspace) },
  };

  res.json(detected);
});

// Apply detected values to DB
router.post("/detect/apply", (_req, res) => {
  const home = process.env.HOME || "";
  const workspace =
    getSettings().defaultWorkspace ||
    process.env.DEFAULT_WORKSPACE ||
    process.cwd();

  let applied = 0;

  // cf-browser .env
  const searchRoots = [workspace, join(home, "github")]
    .filter((p) => isAbsolute(p) && existsSync(p));

  const cfEnvCandidates = [
    ...searchRoots.flatMap((root) => [
      join(root, "cf-browser/.env"),
      join(root, "cf-browser/worker/.env"),
    ]),
    join(__dirname, "../../.env"),
  ];
  for (const envPath of cfEnvCandidates) {
    if (existsSync(envPath)) {
      try {
        const content = readFileSync(envPath, "utf-8");
        const urlMatch = content.match(/^CF_BROWSER_URL=(.+)/m);
        const keyMatch = content.match(/^CF_BROWSER_API_KEY=(.+)/m);
        if (urlMatch) { store.setSetting("cfBrowserUrl", urlMatch[1].trim()); applied++; }
        if (keyMatch) { store.setSetting("cfBrowserApiKey", keyMatch[1].trim()); applied++; }
      } catch (err) {
        console.warn("[Settings] Error reading cf-browser .env:", err);
      }
    }
  }

  // MCP paths
  const mcpRoots = [workspace, join(home, "github"), join(home, "projects")]
    .filter((p) => isAbsolute(p) && existsSync(p));

  const tpPath = mcpRoots.flatMap((r) => [
    join(r, "trend-pulse/.venv/bin/python"),
    join(r, "trend-pulse/.venv/bin/python3"),
  ]).find(existsSync);
  if (tpPath) { store.setSetting("trendPulseVenvPython", tpPath); applied++; }

  const cbPath = mcpRoots.flatMap((r) => [
    join(r, "cf-browser/mcp-server/.venv/bin/python"),
    join(r, "cf-browser/mcp-server/.venv/bin/python3"),
  ]).find(existsSync);
  if (cbPath) { store.setSetting("cfBrowserVenvPython", cbPath); applied++; }

  const nlmPath = [
    ...mcpRoots.flatMap((r) => [join(r, "notebooklm-skill/mcp-server/server.py")]),
    ...mcpRoots.flatMap((r) => {
      try {
        return readdirSync(r, { withFileTypes: true })
          .filter((e) => e.isDirectory() && !e.name.startsWith("."))
          .map((e) => join(r, e.name, "notebooklm-skill/mcp-server/server.py"));
      } catch { return []; }
    }),
  ].find(existsSync);
  if (nlmPath) { store.setSetting("notebooklmServerPath", nlmPath); applied++; }

  res.json({ success: true, applied });
});

// Update settings
router.put("/", (req, res) => {
  const updates = req.body;
  if (!updates || typeof updates !== "object") {
    return res.status(400).json({ error: "Invalid settings" });
  }

  const allowedKeys = [
    "language",
    "trendPulseVenvPython",
    "cfBrowserVenvPython",
    "notebooklmServerPath",
    "cfBrowserUrl",
    "cfBrowserApiKey",
    "defaultWorkspace",
  ];

  const pathKeys = [
    "trendPulseVenvPython",
    "cfBrowserVenvPython",
    "notebooklmServerPath",
    "defaultWorkspace",
  ];

  for (const [key, value] of Object.entries(updates)) {
    if (!allowedKeys.includes(key) || typeof value !== "string") continue;

    if (pathKeys.includes(key) && value) {
      if (!isAbsolute(value) || /[;&|`$(){}]/.test(value)) continue;
    }

    store.setSetting(key, value);
  }

  res.json({ success: true });
});

export default router;
