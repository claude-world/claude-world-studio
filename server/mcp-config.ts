import { existsSync } from "fs";
import { isAbsolute } from "path";
import { execFileSync } from "child_process";
import type { Settings, Language, Theme, CfBrowserMode } from "./types.js";
import store from "./db.js";

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
    trendPulseVenvPython:
      all.trendPulseVenvPython || process.env.TREND_PULSE_PYTHON || "",
    cfBrowserVenvPython:
      all.cfBrowserVenvPython || process.env.CF_BROWSER_PYTHON || "",
    notebooklmServerPath:
      all.notebooklmServerPath || process.env.NOTEBOOKLM_SERVER_PATH || "",
    cfBrowserUrl:
      all.cfBrowserUrl || process.env.CF_BROWSER_URL || "",
    cfBrowserApiKey:
      all.cfBrowserApiKey || process.env.CF_BROWSER_API_KEY || "",
    cfAccountId:
      all.cfAccountId || process.env.CF_ACCOUNT_ID || "",
    cfApiToken:
      all.cfApiToken || process.env.CF_API_TOKEN || "",
    defaultWorkspace:
      all.defaultWorkspace || process.env.DEFAULT_WORKSPACE || process.cwd(),
  };
}

/** uvx definitions for each MCP server (used as fallback) */
const UVX_SERVERS: Record<string, { from: string; cmd: string }> = {
  "trend-pulse": { from: "trend-pulse[mcp]", cmd: "trend-pulse-server" },
  "cf-browser":  { from: "cf-browser-mcp",   cmd: "cf-browser-mcp" },
  "notebooklm":  { from: "notebooklm-skill", cmd: "notebooklm-mcp" },
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
      build: () => ({
        command: "python3",
        args: [settings.notebooklmServerPath],
        env: {},
      }),
    },
  ];

  for (const cfg of configs) {
    // 1. Local venv path configured and valid → use it
    if (cfg.path && isValidPath(cfg.path)) {
      servers[cfg.name] = cfg.build();
      console.log(`[MCP] ${cfg.name} enabled → ${cfg.path}`);
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
      console.log(`[MCP] ${cfg.name} enabled → uvx ${uvxDef.cmd}`);
      continue;
    }

    // 3. Skip
    if (cfg.path) {
      console.warn(`[MCP] ${cfg.name} skipped: path not found → ${cfg.path}`);
    }
  }

  return servers;
}
