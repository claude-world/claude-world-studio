import React, { useState, useEffect } from "react";
import type { Language } from "../App";

interface SettingsPageProps {
  isVisible: boolean;
  onClose: () => void;
  language: Language;
  onLanguageChange: (lang: Language) => void;
}

interface SettingsData {
  trendPulseVenvPython: string;
  cfBrowserVenvPython: string;
  notebooklmServerPath: string;
  cfBrowserUrl: string;
  cfBrowserApiKey: string;
  cfAccountId: string;
  cfApiToken: string;
  cfBrowserMode: "cf-api" | "worker";
  defaultWorkspace: string;
}

type DetectedMap = Record<string, { value: string; found: boolean }>;

interface CliInfo {
  name: string;
  command: string;
  description: string;
  installed: boolean;
  version: string;
  website: string;
}

interface FieldDef {
  key: string;
  label: string;
  placeholder: string;
  sensitive?: boolean;
}

interface SettingGroup {
  title: string;
  fields: FieldDef[];
  guide?: { title: string; steps: string[]; links?: { label: string; url: string }[] };
}

/** Keys that are auto-provided by uvx and don't need manual paths */
const UVX_AUTO_KEYS = new Set(["trendPulseVenvPython", "cfBrowserVenvPython", "notebooklmServerPath"]);

const SETTING_GROUPS: SettingGroup[] = [
  {
    title: "MCP Servers",
    fields: [
      { key: "trendPulseVenvPython", label: "trend-pulse Python path", placeholder: "Auto (uvx)" },
      { key: "cfBrowserVenvPython", label: "cf-browser Python path", placeholder: "Auto (uvx)" },
      { key: "notebooklmServerPath", label: "NotebookLM server path", placeholder: "Auto (uvx)" },
    ],
    guide: {
      title: "How to set up MCP Servers",
      steps: [
        "--- Recommended: uvx (no clone needed) ---",
        "uvx --from 'trend-pulse[mcp]' trend-pulse-server",
        "uvx --from cf-browser-mcp cf-browser-mcp",
        "uvx --from notebooklm-skill notebooklm-mcp",
        "",
        "If uvx is installed, paths above are auto-detected.",
        "Only CF Browser URL/Key need manual config.",
        "",
        "--- Alternative: manual install ---",
        "git clone https://github.com/claude-world/trend-pulse.git",
        "cd trend-pulse && python3 -m venv .venv && .venv/bin/pip install -e '.[mcp]'",
      ],
      links: [
        { label: "trend-pulse", url: "https://github.com/claude-world/trend-pulse" },
        { label: "cf-browser", url: "https://github.com/claude-world/cf-browser" },
        { label: "notebooklm-skill", url: "https://github.com/claude-world/notebooklm-skill" },
        { label: "Install uv", url: "https://docs.astral.sh/uv/" },
      ],
    },
  },
  {
    title: "General",
    fields: [
      { key: "defaultWorkspace", label: "Default workspace path", placeholder: "/path/to/workspace" },
    ],
  },
];

const LANGUAGE_OPTIONS: { code: Language; label: string }[] = [
  { code: "zh-TW", label: "繁體中文 (Taiwan)" },
  { code: "en", label: "English" },
  { code: "ja", label: "日本語 (Japanese)" },
];

function StatusDot({ found }: { found: boolean }) {
  return (
    <span className={`inline-block w-2 h-2 rounded-full ${found ? "bg-green-500" : "bg-gray-300 dark:bg-gray-600"}`} title={found ? "Detected" : "Not found"} />
  );
}

function SetupGuide({ guide }: { guide: NonNullable<SettingGroup["guide"]> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-4">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 text-xs text-blue-600 hover:text-blue-800 font-medium">
        <svg className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        {guide.title}
      </button>
      {open && (
        <div className="mt-2 ml-5 p-3 bg-blue-50 border border-blue-100 rounded-lg text-xs text-gray-700 space-y-1 dark:bg-blue-950 dark:border-blue-900 dark:text-gray-300">
          {guide.steps.map((step, i) => {
            if (step === "") return <div key={i} className="h-2" />;
            if (step.startsWith("---")) return <div key={i} className="font-semibold text-gray-800 dark:text-gray-200 pt-1">{step.replace(/^-+\s*/, "").replace(/\s*-+$/, "")}</div>;
            return <div key={i}><code className="whitespace-pre-wrap break-all">{step}</code></div>;
          })}
          {guide.links && (
            <div className="pt-2 border-t border-blue-200 dark:border-blue-800 mt-2 flex flex-wrap gap-3">
              {guide.links.map((link) => (
                <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 underline">
                  {link.label}
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Settings Page ───

export function SettingsPage({ isVisible, onClose, language, onLanguageChange }: SettingsPageProps) {
  const [settings, setSettings] = useState<Partial<SettingsData>>({});
  const [detected, setDetected] = useState<DetectedMap>({});
  const [detecting, setDetecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [clis, setClis] = useState<CliInfo[]>([]);
  const [detectingClis, setDetectingClis] = useState(false);
  const [cliRoutingMode, setCliRoutingMode] = useState<"primary" | "auto-dispatch">("primary");
  const [cliEnabledSet, setCliEnabledSet] = useState<Set<string>>(new Set());
  const [cliPrimary, setCliPrimary] = useState("");

  useEffect(() => {
    if (!isVisible) return;
    setDetectingClis(true);
    // Fetch settings + CLI detection in parallel, apply together to avoid race
    Promise.all([
      fetch("/api/settings").then((r) => r.ok ? r.json() : {}).catch(() => ({})),
      fetch("/api/settings/detect-clis").then((r) => r.ok ? r.json() : []).catch(() => []),
    ]).then(([settingsData, cliData]: [any, CliInfo[]]) => {
      // Apply settings
      setSettings(settingsData);
      if (settingsData.cliRoutingMode) setCliRoutingMode(settingsData.cliRoutingMode);
      // Apply CLI detection
      setClis(cliData);
      const installedCommands = cliData.filter((c) => c.installed).map((c) => c.command);
      // CLI enabled list: use saved config, or auto-enable all installed
      if (settingsData.cliEnabledList) {
        const saved = new Set<string>(settingsData.cliEnabledList.split(",").filter(Boolean));
        setCliEnabledSet(saved);
      } else {
        setCliEnabledSet(new Set(installedCommands));
      }
      // Primary: use saved, or first installed CLI
      const savedPrimary = settingsData.cliPrimary;
      if (savedPrimary && installedCommands.includes(savedPrimary)) {
        setCliPrimary(savedPrimary);
      } else {
        setCliPrimary(installedCommands[0] || "claude");
      }
    }).finally(() => setDetectingClis(false));
  }, [isVisible]);

  // Auto-demote to "primary" mode when only 1 CLI is enabled
  useEffect(() => {
    if (cliEnabledSet.size <= 1 && cliRoutingMode === "auto-dispatch") {
      setCliRoutingMode("primary");
    }
  }, [cliEnabledSet.size, cliRoutingMode]);

  const handleDetect = async () => {
    setDetecting(true);
    setMessage("");
    try {
      const res = await fetch("/api/settings/detect");
      if (!res.ok) throw new Error();
      const data: DetectedMap = await res.json();
      setDetected(data);
      const found = Object.values(data).filter((d) => d.found).length;
      setMessage(`Detected ${found}/${Object.keys(data).length} settings.`);
    } catch { setMessage("Detection failed."); }
    setDetecting(false);
  };

  const toggleCliEnabled = (command: string) => {
    if (command === cliPrimary) return; // Primary CLI cannot be disabled
    setCliEnabledSet((prev) => {
      const next = new Set(prev);
      next.has(command) ? next.delete(command) : next.add(command);
      return next;
    });
  };

  const handleSetPrimary = (command: string) => {
    setCliPrimary(command);
    // Ensure primary is always enabled
    setCliEnabledSet((prev) => new Set([...prev, command]));
  };

  const handleApplyDetected = async () => {
    const updates: Partial<SettingsData> = {};
    for (const [key, info] of Object.entries(detected)) {
      if (info.found && info.value) {
        (updates as any)[key] = info.value;
      }
    }
    setSettings((prev) => ({ ...prev, ...updates }));

    const hasSensitive = detected["cfBrowserApiKey"]?.found;
    if (hasSensitive) {
      try {
        const res = await fetch("/api/settings/detect/apply", { method: "POST" });
        if (!res.ok) { setMessage("Warning: Failed to apply server-side."); return; }
      } catch { setMessage("Warning: Failed to apply server-side."); return; }
    }
    setMessage("Applied. Click Save to persist.");
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage("");
    try {
      const payload = {
        ...settings,
        cliRoutingMode,
        cliPrimary,
        cliEnabledList: [...cliEnabledSet].join(","),
      };
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error();
      setMessage("Settings saved! Start a new session to apply changes.");
    } catch { setMessage("Error saving settings."); }
    setSaving(false);
  };

  if (!isVisible) return null;

  const allKeys = SETTING_GROUPS.flatMap((g) => g.fields.map((f) => f.key));
  const detectedCount = allKeys.filter((k) => detected[k]?.found).length;
  const configuredCount = allKeys.filter((k) => (settings as any)[k]).length;

  return (
    <div className="flex-1 flex flex-col bg-white dark:bg-gray-900 overflow-y-auto">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between sticky top-0 bg-white dark:bg-gray-900 z-10">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Settings</h2>
          <span className="text-xs text-gray-400 dark:text-gray-500">{configuredCount}/{allKeys.length} configured</span>
        </div>
        <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">Back to Chat</button>
      </div>

      <div className="p-6 max-w-2xl space-y-8">
        {/* Auto-detect */}
        <div className="p-4 bg-gradient-to-r from-emerald-50 to-blue-50 border border-emerald-200 rounded-lg dark:from-emerald-900/40 dark:to-blue-900/40 dark:border-emerald-700">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">Auto-Detect MCP Tools</h3>
            <div className="flex gap-2">
              <button onClick={handleDetect} disabled={detecting} className="px-3 py-1.5 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:opacity-50 text-xs font-medium">
                {detecting ? "Scanning..." : "Scan System"}
              </button>
              {detectedCount > 0 && (
                <button onClick={handleApplyDetected} className="px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-xs font-medium">
                  Apply {detectedCount} found
                </button>
              )}
            </div>
          </div>
          {detected["uvxAvailable"]?.found && (
            <div className="mt-2 px-3 py-2 bg-emerald-100 border border-emerald-300 rounded-md flex items-center gap-2 text-xs text-emerald-800 dark:bg-emerald-900/50 dark:border-emerald-600 dark:text-emerald-300">
              <StatusDot found={true} />
              <span><strong>uvx detected</strong> — MCP servers auto-configured, no manual paths needed.</span>
            </div>
          )}
          {Object.keys(detected).length > 0 && (
            <div className="mt-3 grid grid-cols-2 gap-1.5">
              {allKeys.map((key) => {
                const info = detected[key];
                if (!info) return null;
                const label = SETTING_GROUPS.flatMap((g) => g.fields).find((f) => f.key === key)?.label || key;
                const isUvxAuto = UVX_AUTO_KEYS.has(key) && detected["uvxAvailable"]?.found && info.value?.startsWith("uvx:");
                return (
                  <div key={key} className="flex items-center gap-1.5 text-xs">
                    <StatusDot found={info.found} />
                    <span className={info.found ? "text-gray-700 dark:text-gray-200" : "text-gray-400 dark:text-gray-500"}>
                      {label}
                      {isUvxAuto && <span className="ml-1 text-emerald-600 dark:text-emerald-400 font-medium">(uvx)</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* AI Coding CLIs */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">AI Coding CLIs</h3>
            {detectingClis && <span className="text-xs text-gray-400 dark:text-gray-500 animate-pulse">Scanning system...</span>}
            {!detectingClis && clis.length > 0 && (
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {clis.filter((c) => c.installed).length}/{clis.length} detected
                {" \u00B7 "}
                {cliEnabledSet.size} enabled
              </span>
            )}
          </div>

          {/* CLI cards */}
          {clis.length > 0 && (
            <div className="space-y-2 mb-4">
              {clis.map((cli) => {
                const isEnabled = cliEnabledSet.has(cli.command);
                const isPrimary = cliPrimary === cli.command;
                return (
                  <div
                    key={cli.command}
                    className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                      !cli.installed
                        ? "border-gray-200 bg-gray-50/30 dark:border-gray-700 dark:bg-gray-800/30 opacity-60"
                        : isEnabled
                          ? "border-green-200 bg-green-50/30 dark:border-green-700 dark:bg-green-900/20"
                          : "border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {/* Enable toggle */}
                      <button
                        onClick={() => cli.installed && toggleCliEnabled(cli.command)}
                        disabled={!cli.installed || isPrimary}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 ${
                          !cli.installed ? "bg-gray-200 dark:bg-gray-700 cursor-not-allowed" :
                          isEnabled ? "bg-green-500 cursor-pointer" : "bg-gray-300 dark:bg-gray-600 cursor-pointer"
                        } ${isPrimary ? "cursor-not-allowed" : ""}`}
                        title={!cli.installed ? "Not installed" : isPrimary ? "Primary CLI cannot be disabled" : isEnabled ? "Disable" : "Enable"}
                      >
                        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${isEnabled ? "translate-x-4" : "translate-x-0.5"}`} />
                      </button>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-800 dark:text-gray-100">{cli.name}</span>
                          <code className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400 font-mono">{cli.command}</code>
                          {cli.installed && cli.version && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 font-mono">
                              v{cli.version.replace(/^v/, "")}
                            </span>
                          )}
                          {isPrimary && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 font-medium">
                              Primary
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{cli.description}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {cli.installed && !isPrimary && isEnabled && (
                        <button
                          onClick={() => handleSetPrimary(cli.command)}
                          className="text-[10px] px-2 py-1 border border-gray-200 dark:border-gray-600 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30 text-gray-500 dark:text-gray-400 hover:text-blue-600"
                          title="Set as primary CLI"
                        >
                          Set Primary
                        </button>
                      )}
                      {!cli.installed && (
                        <a
                          href={cli.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                        >
                          Install
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Routing mode — only useful with 2+ enabled CLIs */}
          {cliEnabledSet.size > 1 && (
            <div className="p-4 bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-900/30 dark:to-indigo-900/30 border border-purple-200 dark:border-purple-700 rounded-lg">
              <label className="text-sm text-gray-700 dark:text-gray-200 font-medium block mb-2">Routing Mode</label>
              <div className="space-y-2">
                <label className={`flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                  cliRoutingMode === "primary"
                    ? "border-purple-300 bg-purple-50/50 dark:border-purple-500 dark:bg-purple-900/30"
                    : "border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500"
                }`}>
                  <input type="radio" name="cliRoutingMode" value="primary"
                    checked={cliRoutingMode === "primary"}
                    onChange={() => setCliRoutingMode("primary")}
                    className="mt-0.5 text-purple-600" />
                  <div>
                    <div className="text-sm font-medium text-gray-700 dark:text-gray-200">Primary Only</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      All tasks go to <strong>{clis.find((c) => c.command === cliPrimary)?.name || cliPrimary}</strong>. Other CLIs are available for manual handoff.
                    </div>
                  </div>
                </label>
                <label className={`flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                  cliRoutingMode === "auto-dispatch"
                    ? "border-purple-300 bg-purple-50/50 dark:border-purple-500 dark:bg-purple-900/30"
                    : "border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500"
                }`}>
                  <input type="radio" name="cliRoutingMode" value="auto-dispatch"
                    checked={cliRoutingMode === "auto-dispatch"}
                    onChange={() => setCliRoutingMode("auto-dispatch")}
                    className="mt-0.5 text-purple-600" />
                  <div>
                    <div className="text-sm font-medium text-gray-700 dark:text-gray-200">Auto-Dispatch</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      Automatically distribute tasks across {cliEnabledSet.size} enabled CLIs. Large tasks get split and parallelized.
                      Best with 2+ CLIs for comparison or throughput.
                    </div>
                  </div>
                </label>
              </div>
            </div>
          )}
        </div>

        {/* Language */}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 uppercase tracking-wider">Language / 語言</h3>
          <div className="flex gap-2">
            {LANGUAGE_OPTIONS.map((opt) => (
              <button key={opt.code} onClick={() => onLanguageChange(opt.code)} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all border ${language === opt.code ? "bg-blue-600 text-white border-blue-600 shadow" : "bg-white text-gray-600 border-gray-300 hover:border-gray-400 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600"}`}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* MCP + General settings */}
        {SETTING_GROUPS.map((group) => (
          <div key={group.title}>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 uppercase tracking-wider">{group.title}</h3>
            {group.guide && <SetupGuide guide={group.guide} />}
            <div className="space-y-3">
              {group.fields.map((field) => {
                const det = detected[field.key];
                const hasValue = !!(settings as any)[field.key];
                const isUvxAuto = UVX_AUTO_KEYS.has(field.key) && detected["uvxAvailable"]?.found;
                const uvxHandled = isUvxAuto && !hasValue;

                return (
                  <div key={field.key}>
                    <label className="text-sm text-gray-600 dark:text-gray-400 flex items-center gap-2 mb-1">
                      {uvxHandled ? <StatusDot found={true} /> : hasValue ? <StatusDot found={true} /> : det ? <StatusDot found={det.found} /> : null}
                      {field.label}
                      {uvxHandled && <span className="text-xs text-emerald-600 font-medium">auto (uvx)</span>}
                      {!uvxHandled && det?.found && !hasValue && (
                        <button onClick={() => setSettings((prev) => ({ ...prev, [field.key]: det.value }))} className="text-xs text-emerald-600 hover:text-emerald-800 font-medium ml-1">
                          use detected
                        </button>
                      )}
                    </label>
                    {uvxHandled ? (
                      <div className="px-3 py-2 border border-emerald-200 bg-emerald-50/30 rounded-lg text-sm text-emerald-700 font-mono dark:border-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300">
                        uvx auto-configured
                      </div>
                    ) : (
                      <input
                        type={field.sensitive ? "password" : "text"}
                        value={(settings as any)[field.key] || ""}
                        onChange={(e) => setSettings((prev) => ({ ...prev, [field.key]: e.target.value }))}
                        placeholder={field.placeholder}
                        className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono ${hasValue ? "border-green-300 bg-green-50/30 dark:border-green-600 dark:bg-green-900/20 dark:text-gray-100" : "border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"}`}
                      />
                    )}
                  </div>
                );
              })}
            </div>
            {group.title === "MCP Servers" && (
              <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                <label className="text-sm text-gray-600 dark:text-gray-400 font-medium block mb-3">CF Browser Mode</label>
                <div className="space-y-2 mb-3">
                  <label className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                    (settings as any).cfBrowserMode !== "worker"
                      ? "border-blue-300 bg-blue-50/50 dark:border-blue-500 dark:bg-blue-900/30"
                      : "border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500"
                  }`}>
                    <input type="radio" name="cfBrowserMode" value="cf-api"
                      checked={(settings as any).cfBrowserMode !== "worker"}
                      onChange={() => setSettings((prev) => ({ ...prev, cfBrowserMode: "cf-api" }))}
                      className="text-blue-600" />
                    <div>
                      <div className="text-sm font-medium text-gray-700 dark:text-gray-200">CF API</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">Call Cloudflare Browser Rendering API directly (needs API Token)</div>
                    </div>
                  </label>
                  <label className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                    (settings as any).cfBrowserMode === "worker"
                      ? "border-blue-300 bg-blue-50/50 dark:border-blue-500 dark:bg-blue-900/30"
                      : "border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500"
                  }`}>
                    <input type="radio" name="cfBrowserMode" value="worker"
                      checked={(settings as any).cfBrowserMode === "worker"}
                      onChange={() => setSettings((prev) => ({ ...prev, cfBrowserMode: "worker" }))}
                      className="text-blue-600" />
                    <div>
                      <div className="text-sm font-medium text-gray-700 dark:text-gray-200">Worker</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">Use your own deployed Cloudflare Worker</div>
                    </div>
                  </label>
                </div>
                {(settings as any).cfBrowserMode === "worker" ? (
                  <div className="space-y-3 ml-7">
                    <div>
                      <label className="text-sm text-gray-600 dark:text-gray-400 mb-1 block">Worker URL</label>
                      <input type="text"
                        value={(settings as any).cfBrowserUrl || ""}
                        onChange={(e) => setSettings((prev) => ({ ...prev, cfBrowserUrl: e.target.value }))}
                        placeholder="https://cf-browser.your-subdomain.workers.dev"
                        className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                      />
                    </div>
                    <div>
                      <label className="text-sm text-gray-600 dark:text-gray-400 mb-1 block">Worker API Key</label>
                      <input type="password"
                        value={(settings as any).cfBrowserApiKey || ""}
                        onChange={(e) => setSettings((prev) => ({ ...prev, cfBrowserApiKey: e.target.value }))}
                        placeholder="worker-api-key"
                        className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3 ml-7">
                    <div>
                      <label className="text-sm text-gray-600 dark:text-gray-400 mb-1 block">Account ID</label>
                      <input type="text"
                        value={(settings as any).cfAccountId || ""}
                        onChange={(e) => setSettings((prev) => ({ ...prev, cfAccountId: e.target.value }))}
                        placeholder="your-cloudflare-account-id"
                        className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                      />
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                        Found in your Cloudflare dashboard sidebar.
                      </p>
                    </div>
                    <div>
                      <label className="text-sm text-gray-600 dark:text-gray-400 mb-1 flex items-center gap-2">
                        API Token
                        <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noopener noreferrer"
                          className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300">
                          Get API Token
                          <svg className="w-3 h-3 inline ml-0.5 -mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </a>
                      </label>
                      <input type="password"
                        value={(settings as any).cfApiToken || ""}
                        onChange={(e) => setSettings((prev) => ({ ...prev, cfApiToken: e.target.value }))}
                        placeholder="cf-api-token"
                        className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                      />
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                        Create a token with <strong>Account / Workers Browser Rendering / Edit</strong> permission.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {/* Save */}
        <div className="flex items-center gap-3">
          <button onClick={handleSave} disabled={saving} className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm">
            {saving ? "Saving..." : "Save Settings"}
          </button>
          {message && <span className="text-sm text-gray-600 dark:text-gray-400">{message}</span>}
        </div>
      </div>
    </div>
  );
}
