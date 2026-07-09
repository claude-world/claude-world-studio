import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { basename, dirname, isAbsolute, join } from "path";
import { execFileSync } from "child_process";
import { tmpdir } from "os";
import type { Settings, Language, Theme, CfBrowserMode } from "./types.js";
import store from "./db.js";
import { logger } from "./logger.js";
import { getDefaultWorkspace } from "./runtime-paths.js";

/** Validate a path setting: must be absolute and exist on disk */
function isValidPath(p: string): boolean {
  return !!p && isAbsolute(p) && existsSync(p);
}

/** Check if uvx is available on the system */
let _uvxAvailable: boolean | null = null;
function isUvxAvailable(): boolean {
  if (_uvxAvailable === null) {
    try {
      execFileSync("uvx", ["--version"], { stdio: "ignore" });
      _uvxAvailable = true;
    } catch {
      _uvxAvailable = false;
    }
  }
  return _uvxAvailable;
}

export function getSettings(): Settings {
  const all = store.getAllSettings();
  return {
    language: (all.language as Language) || "zh-TW",
    theme: (all.theme as Theme) || "light",
    cfBrowserMode: (all.cfBrowserMode as CfBrowserMode) || "cf-api",
    trendPulseVenvPython: all.trendPulseVenvPython || process.env.TREND_PULSE_PYTHON || "",
    cfBrowserVenvPython: all.cfBrowserVenvPython || process.env.CF_BROWSER_PYTHON || "",
    notebooklmServerPath: all.notebooklmServerPath || process.env.NOTEBOOKLM_SERVER_PATH || "",
    cfBrowserUrl: all.cfBrowserUrl || process.env.CF_BROWSER_URL || "",
    cfBrowserApiKey: all.cfBrowserApiKey || process.env.CF_BROWSER_API_KEY || "",
    cfAccountId: all.cfAccountId || process.env.CF_ACCOUNT_ID || "",
    cfApiToken: all.cfApiToken || process.env.CF_API_TOKEN || "",
    defaultWorkspace: all.defaultWorkspace || getDefaultWorkspace(),
    minOverallScore: parseInt(all.minOverallScore as string) || 70,
    minConversationScore: parseInt(all.minConversationScore as string) || 55,
    agenticLevel: (all.agenticLevel as Settings["agenticLevel"]) || "enhanced",
  };
}

/** uvx definitions for each MCP server (used as fallback) */
const UVX_SERVERS: Record<string, { from: string; cmd: string }> = {
  "trend-pulse": { from: "trend-pulse[mcp]", cmd: "trend-pulse-server" },
  "cf-browser": { from: "cf-browser-mcp", cmd: "cf-browser-mcp" },
  notebooklm: { from: "notebooklm-skill", cmd: "notebooklm-mcp" },
};

interface McpServerConfig {
  name: string;
  path: string;
  build: () => Record<string, any>;
}

export function buildMcpServers(settings: Settings) {
  const servers: Record<string, any> = {};
  const uvx = isUvxAvailable();

  const configs: McpServerConfig[] = [
    {
      name: "trend-pulse",
      path: settings.trendPulseVenvPython,
      build: () => ({
        command: settings.trendPulseVenvPython,
        args: ["-m", "trend_pulse.server"],
        env: {},
      }),
    },
    {
      name: "cf-browser",
      path: settings.cfBrowserVenvPython,
      build: () => {
        const env: Record<string, string> = {};
        if (settings.cfBrowserMode === "worker") {
          if (settings.cfBrowserUrl) env.CF_BROWSER_URL = settings.cfBrowserUrl;
          if (settings.cfBrowserApiKey) env.CF_BROWSER_API_KEY = settings.cfBrowserApiKey;
        } else {
          if (settings.cfAccountId) env.CF_ACCOUNT_ID = settings.cfAccountId;
          if (settings.cfApiToken) env.CF_API_TOKEN = settings.cfApiToken;
        }
        return {
          command: settings.cfBrowserVenvPython,
          args: ["-m", "cf_browser_mcp.server"],
          env,
        };
      },
    },
    {
      name: "notebooklm",
      path: settings.notebooklmServerPath,
      build: () => {
        const serverDir = dirname(settings.notebooklmServerPath);
        const projectDir = ["mcp-server", "mcp_server"].includes(basename(serverDir))
          ? dirname(serverDir)
          : serverDir;
        const candidates = [
          join(projectDir, ".venv/bin/python"),
          join(serverDir, ".venv/bin/python"),
        ];
        const cmd = candidates.find(existsSync) || "python3";
        return {
          command: cmd,
          args: [settings.notebooklmServerPath],
          env: {},
        };
      },
    },
  ];

  for (const cfg of configs) {
    // 1. Local venv path configured and valid → use it
    if (cfg.path && isValidPath(cfg.path)) {
      servers[cfg.name] = cfg.build();
      logger.info("MCPConfig", `${cfg.name} enabled → ${cfg.path}`);
      continue;
    }

    // 2. Fallback to uvx if available
    const uvxDef = UVX_SERVERS[cfg.name];
    if (uvx && uvxDef) {
      const env: Record<string, string> = {};
      if (cfg.name === "cf-browser") {
        if (settings.cfBrowserMode === "worker") {
          if (settings.cfBrowserUrl) env.CF_BROWSER_URL = settings.cfBrowserUrl;
          if (settings.cfBrowserApiKey) env.CF_BROWSER_API_KEY = settings.cfBrowserApiKey;
        } else {
          if (settings.cfAccountId) env.CF_ACCOUNT_ID = settings.cfAccountId;
          if (settings.cfApiToken) env.CF_API_TOKEN = settings.cfApiToken;
        }
      }
      servers[cfg.name] = {
        command: "uvx",
        args: ["--from", uvxDef.from, uvxDef.cmd],
        env,
      };
      logger.info("MCPConfig", `${cfg.name} enabled → uvx ${uvxDef.cmd}`);
      continue;
    }

    // 3. Skip
    if (cfg.path) {
      logger.warn("MCPConfig", `${cfg.name} skipped: path not found → ${cfg.path}`);
    }
  }

  return servers;
}

/** Temp dir prefix for per-session MCP config files (contain credentials) */
const MCP_TMPDIR_PREFIX = "studio-mcp-";

/** Temp dirs created by writeMcpConfigFile in this process, keyed by config file path */
const mcpConfigDirs = new Map<string, string>();

/**
 * Write MCP server config to a temp JSON file for external CLIs.
 * Returns the absolute path to the config file.
 * The owning session must call removeMcpConfigFile() on close — the config
 * contains credentials (cfApiToken / CF_BROWSER_API_KEY).
 */
export function writeMcpConfigFile(settings: Settings): string {
  const servers = buildMcpServers(settings);
  const mcpConfig: Record<string, any> = { mcpServers: {} };

  for (const [name, config] of Object.entries(servers)) {
    mcpConfig.mcpServers[name] = config;
  }

  const dir = mkdtempSync(join(tmpdir(), MCP_TMPDIR_PREFIX));
  chmodSync(dir, 0o700);
  const configPath = join(dir, "mcp-config.json");
  writeFileSync(configPath, JSON.stringify(mcpConfig, null, 2), { encoding: "utf-8", mode: 0o600 });
  mcpConfigDirs.set(configPath, dir);
  logger.info("MCPConfig", `Config written to ${configPath}`);
  return configPath;
}

/** Remove the temp dir behind a config file created by writeMcpConfigFile (best-effort). */
export function removeMcpConfigFile(configPath: string): void {
  const dir = mcpConfigDirs.get(configPath);
  mcpConfigDirs.delete(configPath);
  if (!dir) return;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    logger.warn("MCPConfig", `Failed to remove temp config dir ${dir}`, {
      error: (err as Error).message,
    });
  }
}

/** Stale-dir age threshold: dirs this old can't belong to a live session of another instance */
const STALE_MCP_DIR_MS = 24 * 60 * 60 * 1000;

/**
 * Best-effort startup sweep of studio-mcp-* temp dirs left behind by previous
 * server runs (they contain credentials). Only removes dirs older than 24h so
 * a concurrently running instance's live configs are never touched.
 */
export function cleanupStaleMcpConfigDirs(): void {
  let entries: string[];
  try {
    entries = readdirSync(tmpdir());
  } catch {
    return;
  }
  const now = Date.now();
  let removed = 0;
  for (const name of entries) {
    if (!name.startsWith(MCP_TMPDIR_PREFIX)) continue;
    const dir = join(tmpdir(), name);
    try {
      if (now - statSync(dir).mtimeMs < STALE_MCP_DIR_MS) continue;
      rmSync(dir, { recursive: true, force: true });
      removed++;
    } catch {
      // Best-effort — skip dirs we can't stat or remove
    }
  }
  if (removed > 0) {
    logger.info("MCPConfig", `Removed ${removed} stale MCP config temp dir(s)`);
  }
}
