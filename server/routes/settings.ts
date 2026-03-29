import { Router } from "express";
import { existsSync, readFileSync, readdirSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { execFileSync, execFile } from "child_process";
import { promisify } from "util";
import path from "path";

const execFileAsync = promisify(execFile);
import { fileURLToPath } from "url";
import store from "../db.js";
import { getSettings } from "../mcp-config.js";
import { logger } from "../logger.js";

const { join, dirname, isAbsolute } = path;

/** Check if uvx is available */
function hasUvx(): boolean {
  try {
    execFileSync("uvx", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

const SENSITIVE_KEYS = ["cfBrowserApiKey", "cfApiToken"] as const;

function maskValue(value: string): string {
  if (!value || value.length < 12) return value ? "***" : "";
  return value.slice(0, 8) + "..." + value.slice(-4);
}

// Get all settings (tokens masked)
router.get("/", (_req, res) => {
  const settings = getSettings();
  // Include all DB settings (CLI routing, etc.) that getSettings() doesn't cover
  const allDbSettings = store.getAllSettings();
  const merged: Record<string, any> = { ...allDbSettings, ...settings };

  for (const key of SENSITIVE_KEYS) {
    if (merged[key]) {
      merged[key] = maskValue(merged[key]);
    }
  }

  res.json(merged);
});

// Open native folder picker (macOS only — other platforms return empty)
router.get("/pick-folder", async (_req, res) => {
  if (process.platform !== "darwin") {
    return res.json({ path: "" });
  }
  try {
    const result = execFileSync(
      "osascript",
      ["-e", 'POSIX path of (choose folder with prompt "Select workspace folder")'],
      { encoding: "utf-8", timeout: 120000 }
    ).trim();
    res.json({ path: result.replace(/\/$/, "") });
  } catch {
    res.json({ path: "" }); // User cancelled
  }
});

// Auto-detect installed MCP tools
router.get("/detect", (_req, res) => {
  const home = process.env.HOME || "";
  const workspace =
    getSettings().defaultWorkspace || process.env.DEFAULT_WORKSPACE || process.cwd();

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
          .flatMap((e) => [join(root, e.name, "notebooklm-skill/mcp-server/server.py")]);
      } catch {
        return [];
      }
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

  const uvxAvailable = hasUvx();

  const detected: Record<string, { value: string; found: boolean }> = {
    trendPulseVenvPython: {
      value: trendPulsePython || (uvxAvailable ? "uvx:trend-pulse[mcp]" : ""),
      found: !!trendPulsePython || uvxAvailable,
    },
    cfBrowserVenvPython: {
      value: cfBrowserPython || (uvxAvailable ? "uvx:cf-browser-mcp" : ""),
      found: !!cfBrowserPython || uvxAvailable,
    },
    notebooklmServerPath: {
      value: notebooklmPath || (uvxAvailable ? "uvx:notebooklm-skill" : ""),
      found: !!notebooklmPath || uvxAvailable,
    },
    cfBrowserUrl: { value: cfBrowserUrl, found: !!cfBrowserUrl },
    cfBrowserApiKey: { value: "", found: cfBrowserApiKeyFound },
    defaultWorkspace: { value: workspace, found: existsSync(workspace) },
    uvxAvailable: { value: uvxAvailable ? "true" : "", found: uvxAvailable },
  };

  res.json(detected);
});

// Apply detected values to DB
router.post("/detect/apply", (_req, res) => {
  const home = process.env.HOME || "";
  const workspace =
    getSettings().defaultWorkspace || process.env.DEFAULT_WORKSPACE || process.cwd();

  let applied = 0;

  // cf-browser .env
  const searchRoots = [workspace, join(home, "github")].filter(
    (p) => isAbsolute(p) && existsSync(p)
  );

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
        // Only apply if user hasn't already set a value
        if (urlMatch && !store.getSetting("cfBrowserUrl")) {
          store.setSetting("cfBrowserUrl", urlMatch[1].trim());
          applied++;
        }
        if (keyMatch && !store.getSetting("cfBrowserApiKey")) {
          store.setSetting("cfBrowserApiKey", keyMatch[1].trim());
          applied++;
        }
      } catch (err) {
        logger.warn("Routes:Settings", "Error reading cf-browser .env", {
          error: (err as Error).message,
        });
      }
    }
  }

  // MCP paths — only apply if user hasn't already set a value
  const mcpRoots = [workspace, join(home, "github"), join(home, "projects")].filter(
    (p) => isAbsolute(p) && existsSync(p)
  );

  const tpPath = mcpRoots
    .flatMap((r) => [
      join(r, "trend-pulse/.venv/bin/python"),
      join(r, "trend-pulse/.venv/bin/python3"),
    ])
    .find(existsSync);
  if (tpPath && !store.getSetting("trendPulseVenvPython")) {
    store.setSetting("trendPulseVenvPython", tpPath);
    applied++;
  }

  const cbPath = mcpRoots
    .flatMap((r) => [
      join(r, "cf-browser/mcp-server/.venv/bin/python"),
      join(r, "cf-browser/mcp-server/.venv/bin/python3"),
    ])
    .find(existsSync);
  if (cbPath && !store.getSetting("cfBrowserVenvPython")) {
    store.setSetting("cfBrowserVenvPython", cbPath);
    applied++;
  }

  const nlmPath = [
    ...mcpRoots.flatMap((r) => [join(r, "notebooklm-skill/mcp-server/server.py")]),
    ...mcpRoots.flatMap((r) => {
      try {
        return readdirSync(r, { withFileTypes: true })
          .filter((e) => e.isDirectory() && !e.name.startsWith("."))
          .map((e) => join(r, e.name, "notebooklm-skill/mcp-server/server.py"));
      } catch {
        return [];
      }
    }),
  ].find(existsSync);
  if (nlmPath && !store.getSetting("notebooklmServerPath")) {
    store.setSetting("notebooklmServerPath", nlmPath);
    applied++;
  }

  res.json({ success: true, applied });
});

// CLI definitions
const CLI_DEFS = [
  {
    name: "Claude Code",
    command: "claude",
    versionArgs: ["--version"],
    description: "Anthropic's AI coding assistant CLI",
    website: "https://docs.anthropic.com/en/docs/claude-code",
  },
  {
    name: "OpenAI Codex",
    command: "codex",
    versionArgs: ["--version"],
    description: "OpenAI's coding agent CLI",
    website: "https://github.com/openai/codex",
  },
  {
    name: "Gemini CLI",
    command: "gemini",
    versionArgs: ["--version"],
    description: "Google's Gemini AI CLI",
    website: "https://github.com/google-gemini/gemini-cli",
  },
  {
    name: "OpenCode",
    command: "opencode",
    versionArgs: ["version"],
    description: "Open-source AI coding CLI (multi-provider)",
    website: "https://github.com/opencode-ai/opencode",
  },
  {
    name: "Aider",
    command: "aider",
    versionArgs: ["--version"],
    description: "AI pair programming in terminal",
    website: "https://aider.chat",
  },
  {
    name: "GitHub Copilot",
    command: "gh-copilot",
    versionArgs: ["copilot", "--version"],
    execCommand: "gh",
    description: "GitHub Copilot in the CLI",
    website: "https://docs.github.com/en/copilot/github-copilot-in-the-cli",
  },
] as const;

/** Valid CLI command identifiers for input validation */
const VALID_CLI_COMMANDS: Set<string> = new Set(CLI_DEFS.map((d) => d.command));

// Detect available coding CLIs (async — doesn't block event loop)
router.get("/detect-clis", async (_req, res) => {
  const results = await Promise.all(
    CLI_DEFS.map(async (def) => {
      const bin = "execCommand" in def ? def.execCommand : def.command;
      let installed = false;
      let version = "";
      try {
        const { stdout } = await execFileAsync(bin, [...def.versionArgs], {
          timeout: 2000,
          encoding: "utf-8",
        });
        installed = true;
        const firstLine = (stdout as string).split("\n")[0].trim();
        // Extract semver-like token, or fall back to stripping common prefixes
        const semverMatch = firstLine.match(/(\d+\.\d+[\d.]*)/);
        version = semverMatch
          ? semverMatch[1]
          : firstLine.replace(/^(v|version\s*:?\s*)/i, "").trim();
      } catch {
        // not installed, timed out, or errored
      }
      return {
        name: def.name,
        command: def.command,
        description: def.description,
        installed,
        version,
        website: def.website,
      };
    })
  );

  res.json(results);
});

// Update settings
router.put("/", (req, res) => {
  const updates = req.body;
  if (typeof updates !== "object" || updates === null || Array.isArray(updates)) {
    return res.status(400).json({ error: "Body must be an object" });
  }

  const allowedKeys = [
    "language",
    "theme",
    "cfBrowserMode",
    "trendPulseVenvPython",
    "cfBrowserVenvPython",
    "notebooklmServerPath",
    "cfBrowserUrl",
    "cfBrowserApiKey",
    "cfAccountId",
    "cfApiToken",
    "defaultWorkspace",
    "cliRoutingMode",
    "cliEnabledList",
    "cliPrimary",
    "minOverallScore",
    "minConversationScore",
  ];

  const pathKeys = [
    "trendPulseVenvPython",
    "cfBrowserVenvPython",
    "notebooklmServerPath",
    "defaultWorkspace",
  ];

  for (const [key, value] of Object.entries(updates)) {
    if (!allowedKeys.includes(key) || typeof value !== "string") continue;

    // Skip masked sensitive values — don't overwrite real keys with masked placeholders
    if (SENSITIVE_KEYS.includes(key as any) && value.includes("...")) continue;

    if (pathKeys.includes(key) && value) {
      if (!isAbsolute(value) || /[;&|`$(){}]/.test(value)) continue;
    }

    // Validate CLI command names
    if (key === "cliPrimary" && value && !VALID_CLI_COMMANDS.has(value)) continue;
    if (key === "cliEnabledList" && value) {
      const parts = value.split(",").filter(Boolean);
      if (!parts.every((p) => VALID_CLI_COMMANDS.has(p))) continue;
    }

    // Validate numeric score range
    if ((key === "minOverallScore" || key === "minConversationScore") && value) {
      const n = parseInt(value, 10);
      if (isNaN(n) || n < 0 || n > 100) continue;
    }

    store.setSetting(key, value);
  }

  res.json({ success: true });
});

// POST /api/settings/sync-skills
router.post("/sync-skills", async (_req, res) => {
  const SKILL_URLS = [
    {
      url: "https://raw.githubusercontent.com/claude-world/claude-world-studio/main/.claude/skills/threads-viral-agent/SKILL.md",
      path: "threads-viral-agent/SKILL.md",
    },
    {
      url: "https://raw.githubusercontent.com/claude-world/claude-world-studio/main/.claude/skills/content-pipeline/SKILL.md",
      path: "content-pipeline/SKILL.md",
    },
    {
      url: "https://raw.githubusercontent.com/claude-world/claude-world-studio/main/.claude/skills/studio/SKILL.md",
      path: "studio/SKILL.md",
    },
  ];

  const skillsDir = join(__dirname, "../../.claude/skills");
  const results: { path: string; success: boolean; error?: string; size?: number }[] = [];

  for (const skill of SKILL_URLS) {
    try {
      const response = await fetch(skill.url);
      if (!response.ok) {
        results.push({ path: skill.path, success: false, error: `HTTP ${response.status}` });
        continue;
      }
      const content = await response.text();
      const filePath = join(skillsDir, skill.path);

      // Ensure directory exists
      const dir = dirname(filePath);
      await mkdir(dir, { recursive: true });

      await writeFile(filePath, content, "utf-8");
      logger.info("Routes:Settings", `Synced skill: ${skill.path} (${content.length} bytes)`);
      results.push({ path: skill.path, success: true, size: content.length });
    } catch (err) {
      logger.warn("Routes:Settings", `Failed to sync skill: ${skill.path}`, {
        error: (err as Error).message,
      });
      results.push({ path: skill.path, success: false, error: (err as Error).message });
    }
  }

  res.json({
    synced: results.filter((r) => r.success).length,
    total: SKILL_URLS.length,
    results,
  });
});

export default router;
