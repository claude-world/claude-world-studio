import { existsSync } from "fs";
import { isAbsolute } from "path";
import type { Settings, Language } from "./types.js";
import store from "./db.js";

/** Validate a path setting: must be absolute and exist on disk */
function isValidPath(p: string): boolean {
  return !!p && isAbsolute(p) && existsSync(p);
}

export function getSettings(): Settings {
  const all = store.getAllSettings();
  return {
    language: (all.language as Language) || "zh-TW",
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
    defaultWorkspace:
      all.defaultWorkspace || process.env.DEFAULT_WORKSPACE || process.cwd(),
  };
}

interface McpServerConfig {
  name: string;
  path: string;
  build: () => Record<string, any>;
}

export function buildMcpServers(settings: Settings) {
  const servers: Record<string, any> = {};

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
      build: () => ({
        command: settings.cfBrowserVenvPython,
        args: ["-m", "cf_browser_mcp.server"],
        env: {
          CF_BROWSER_URL: settings.cfBrowserUrl,
          CF_BROWSER_API_KEY: settings.cfBrowserApiKey,
        },
      }),
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
    if (!cfg.path) continue;

    if (!isValidPath(cfg.path)) {
      console.warn(`[MCP] ${cfg.name} skipped: path not found → ${cfg.path}`);
      continue;
    }

    servers[cfg.name] = cfg.build();
    console.log(`[MCP] ${cfg.name} enabled → ${cfg.path}`);
  }

  return servers;
}
