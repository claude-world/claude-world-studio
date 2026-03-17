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
  defaultWorkspace: string;
}

interface Account {
  id: string;
  name: string;
  handle: string;
  platform: string;
  token: string;
  user_id: string;
  style: string;
  persona_prompt: string;
}

type DetectedMap = Record<string, { value: string; found: boolean }>;

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
      { key: "cfBrowserUrl", label: "CF Browser URL", placeholder: "https://cf-browser.your-subdomain.workers.dev" },
      { key: "cfBrowserApiKey", label: "CF Browser API Key", placeholder: "api-key", sensitive: true },
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
    <span className={`inline-block w-2 h-2 rounded-full ${found ? "bg-green-500" : "bg-gray-300"}`} title={found ? "Detected" : "Not found"} />
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
        <div className="mt-2 ml-5 p-3 bg-blue-50 border border-blue-100 rounded-lg text-xs text-gray-700 space-y-1">
          {guide.steps.map((step, i) => {
            if (step === "") return <div key={i} className="h-2" />;
            if (step.startsWith("---")) return <div key={i} className="font-semibold text-gray-800 pt-1">{step.replace(/^-+\s*/, "").replace(/\s*-+$/, "")}</div>;
            return <div key={i}><code className="whitespace-pre-wrap break-all">{step}</code></div>;
          })}
          {guide.links && (
            <div className="pt-2 border-t border-blue-200 mt-2 flex flex-wrap gap-3">
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

// ─── Accounts Manager ───

const EMPTY_ACCOUNT: Omit<Account, "id"> = {
  name: "", handle: "", platform: "threads", token: "", user_id: "", style: "", persona_prompt: "",
};

function AccountsManager() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [editing, setEditing] = useState<Account | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const fetchAccounts = () => {
    fetch("/api/accounts").then((r) => r.ok ? r.json() : []).then(setAccounts).catch(() => {});
  };

  useEffect(() => { fetchAccounts(); }, []);

  const handleSave = async () => {
    if (!editing || !editing.name || !editing.handle) return;
    setSaving(true);

    const url = isNew ? "/api/accounts" : `/api/accounts/${editing.id}`;
    const method = isNew ? "POST" : "PUT";

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing),
      });
      if (res.ok) {
        setEditing(null);
        setIsNew(false);
        fetchAccounts();
        setNotice("Saved. Start a new session to use updated accounts.");
      }
    } catch {}
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/accounts/${id}`, { method: "DELETE" });
      if (res.ok) { fetchAccounts(); setNotice("Deleted. Start a new session to apply."); }
    } catch {}
  };

  const startNew = () => {
    setEditing({ id: "", ...EMPTY_ACCOUNT });
    setIsNew(true);
  };

  const startEdit = (account: Account) => {
    setEditing({ ...account, token: "" }); // Don't prefill masked token
    setIsNew(false);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">Social Accounts</h3>
        <button onClick={startNew} className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium">
          + Add Account
        </button>
      </div>

      {/* Notice */}
      {notice && (
        <div className="mb-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700 flex items-center gap-2">
          <span>&#9888;</span>
          <span>{notice}</span>
        </div>
      )}

      {/* Account list */}
      {accounts.length === 0 && !editing && (
        <p className="text-xs text-gray-400 mb-4">No accounts configured. Click "Add Account" to get started.</p>
      )}

      <div className="space-y-2 mb-4">
        {accounts.map((a) => (
          <div key={a.id} className="flex items-center justify-between p-3 border border-gray-200 rounded-lg">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-800">{a.handle}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${a.platform === "threads" ? "bg-gray-100 text-gray-600" : "bg-pink-50 text-pink-600"}`}>
                  {a.platform}
                </span>
                {a.style && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">{a.style}</span>}
              </div>
              <div className="text-xs text-gray-400 mt-0.5">{a.name}</div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button onClick={() => startEdit(a)} className="text-xs px-2 py-1 border border-gray-200 rounded hover:bg-gray-50 text-gray-600">Edit</button>
              <button onClick={() => handleDelete(a.id)} className="text-xs px-2 py-1 text-red-500 hover:bg-red-50 rounded">Delete</button>
            </div>
          </div>
        ))}
      </div>

      {/* Edit form */}
      {editing && (
        <div className="p-4 border border-blue-200 rounded-lg bg-blue-50/30 space-y-3">
          <div className="text-sm font-medium text-gray-700">{isNew ? "New Account" : `Edit: ${editing.handle}`}</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Name *</label>
              <input type="text" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Claude World Taiwan" className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Handle *</label>
              <input type="text" value={editing.handle} onChange={(e) => setEditing({ ...editing, handle: e.target.value })} placeholder="@your.account" className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Platform *</label>
              <select value={editing.platform} onChange={(e) => setEditing({ ...editing, platform: e.target.value })} className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm">
                <option value="threads">Threads</option>
                <option value="instagram">Instagram</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Style</label>
              <input type="text" value={editing.style} onChange={(e) => setEditing({ ...editing, style: e.target.value })} placeholder="tech-educator, futurist..." className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Token {!isNew && "(leave empty to keep current)"}</label>
              <input type="password" value={editing.token} onChange={(e) => setEditing({ ...editing, token: e.target.value })} placeholder="API token" className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm font-mono" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">User ID</label>
              <input type="text" value={editing.user_id} onChange={(e) => setEditing({ ...editing, user_id: e.target.value })} placeholder="your-threads-user-id" className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm font-mono" />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Persona Prompt (AI uses this to adapt content style for this account)</label>
            <textarea value={editing.persona_prompt} onChange={(e) => setEditing({ ...editing, persona_prompt: e.target.value })} rows={3} placeholder="You are a tech educator focused on Claude Code. Write in Traditional Chinese. Tone: professional yet approachable..." className="w-full px-3 py-2 border border-gray-300 rounded text-sm resize-none" />
          </div>
          <div className="flex gap-2">
            <button onClick={handleSave} disabled={!editing.name || !editing.handle || saving} className="text-xs px-4 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40">
              {saving ? "Saving..." : isNew ? "Create" : "Update"}
            </button>
            <button onClick={() => { setEditing(null); setIsNew(false); }} className="text-xs px-3 py-1.5 border border-gray-200 rounded hover:bg-gray-50 text-gray-600">Cancel</button>
          </div>
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

  useEffect(() => {
    if (!isVisible) return;
    fetch("/api/settings").then((r) => r.ok ? r.json() : {}).then(setSettings).catch(() => {});
  }, [isVisible]);

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
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error();
      setMessage("Settings saved! Start a new session to apply MCP changes.");
    } catch { setMessage("Error saving settings."); }
    setSaving(false);
  };

  if (!isVisible) return null;

  const allKeys = SETTING_GROUPS.flatMap((g) => g.fields.map((f) => f.key));
  const detectedCount = allKeys.filter((k) => detected[k]?.found).length;
  const configuredCount = allKeys.filter((k) => (settings as any)[k]).length;

  return (
    <div className="flex-1 flex flex-col bg-white overflow-y-auto">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between sticky top-0 bg-white z-10">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold text-gray-800">Settings</h2>
          <span className="text-xs text-gray-400">{configuredCount}/{allKeys.length} configured</span>
        </div>
        <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700">Back to Chat</button>
      </div>

      <div className="p-6 max-w-2xl space-y-8">
        {/* Auto-detect */}
        <div className="p-4 bg-gradient-to-r from-emerald-50 to-blue-50 border border-emerald-200 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-800">Auto-Detect MCP Tools</h3>
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
            <div className="mt-2 px-3 py-2 bg-emerald-100 border border-emerald-300 rounded-md flex items-center gap-2 text-xs text-emerald-800">
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
                    <span className={info.found ? "text-gray-700" : "text-gray-400"}>
                      {label}
                      {isUvxAuto && <span className="ml-1 text-emerald-600 font-medium">(uvx)</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Language */}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wider">Language / 語言</h3>
          <div className="flex gap-2">
            {LANGUAGE_OPTIONS.map((opt) => (
              <button key={opt.code} onClick={() => onLanguageChange(opt.code)} className={`px-4 py-2 rounded-lg text-sm font-medium transition-all border ${language === opt.code ? "bg-blue-600 text-white border-blue-600 shadow" : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"}`}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Social Accounts */}
        <AccountsManager />

        {/* MCP + General settings */}
        {SETTING_GROUPS.map((group) => (
          <div key={group.title}>
            <h3 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wider">{group.title}</h3>
            {group.guide && <SetupGuide guide={group.guide} />}
            <div className="space-y-3">
              {group.fields.map((field) => {
                const det = detected[field.key];
                const hasValue = !!(settings as any)[field.key];
                const isUvxAuto = UVX_AUTO_KEYS.has(field.key) && detected["uvxAvailable"]?.found;
                const uvxHandled = isUvxAuto && !hasValue;

                return (
                  <div key={field.key}>
                    <label className="text-sm text-gray-600 flex items-center gap-2 mb-1">
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
                      <div className="px-3 py-2 border border-emerald-200 bg-emerald-50/30 rounded-lg text-sm text-emerald-700 font-mono">
                        uvx auto-configured
                      </div>
                    ) : (
                      <input
                        type={field.sensitive ? "password" : "text"}
                        value={(settings as any)[field.key] || ""}
                        onChange={(e) => setSettings((prev) => ({ ...prev, [field.key]: e.target.value }))}
                        placeholder={field.placeholder}
                        className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono ${hasValue ? "border-green-300 bg-green-50/30" : "border-gray-300"}`}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {/* Save */}
        <div className="flex items-center gap-3">
          <button onClick={handleSave} disabled={saving} className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm">
            {saving ? "Saving..." : "Save Settings"}
          </button>
          {message && <span className="text-sm text-gray-600">{message}</span>}
        </div>
      </div>
    </div>
  );
}
