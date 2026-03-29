import React, { useState, useEffect, useRef } from "react";
import type { Language } from "../App";

const T = {
  "zh-TW": {
    settings: "設定",
    configured: "已設定",
    backToChat: "返回聊天",
    autoDetect: "自動偵測 MCP 工具",
    scanSystem: "掃描系統",
    scanning: "掃描中...",
    apply: "套用",
    found: "找到",
    uvxDetected: "uvx 已偵測 — MCP 伺服器自動設定，不需要手動路徑。",
    aiCodingClis: "AI 編碼 CLI",
    scanningSystem: "掃描系統中...",
    detected: "已偵測",
    enabled: "已啟用",
    setAsPrimary: "設為主要",
    install: "安裝",
    routingMode: "路由模式",
    primaryOnly: "僅主要",
    primaryOnlyDesc: (name: string) => `所有任務都交給 ${name}。其他 CLI 可用於手動交接。`,
    autoDispatch: "自動分派",
    autoDispatchDesc: (n: number) =>
      `自動將任務分配到 ${n} 個已啟用的 CLI。大型任務會被拆分並行處理。`,
    language: "語言",
    mcpServers: "MCP 伺服器",
    general: "一般",
    cfBrowserMode: "CF 瀏覽器模式",
    cfApi: "CF API",
    cfApiDesc: "直接呼叫 Cloudflare Browser Rendering API（需要 API Token）",
    worker: "Worker",
    workerDesc: "使用你部署的 Cloudflare Worker",
    workerUrl: "Worker URL",
    workerApiKey: "Worker API Key",
    accountId: "帳戶 ID",
    accountIdHint: "在 Cloudflare 控制台側邊欄找到。",
    apiToken: "API Token",
    getApiToken: "取得 API Token",
    apiTokenHint: "建立具有 Account / Workers Browser Rendering / Edit 權限的 Token。",
    saveSettings: "儲存設定",
    saving: "儲存中...",
    saved: "設定已儲存！開啟新 Session 以套用變更。",
    errorSaving: "儲存設定時發生錯誤。",
    detectionFailed: "偵測失敗。",
    detectedSettings: (f: number, t: number) => `偵測到 ${f}/${t} 項設定。`,
    applied: "已套用。點擊儲存以保存。",
    applyFailed: "警告：伺服器端套用失敗。",
    useDetected: "使用偵測值",
    autoUvx: "自動 (uvx)",
    uvxAutoConfigured: "uvx 自動設定",
    howToSetup: "如何設定 MCP 伺服器",
    recommendedUvx: "推薦：uvx（不需要 clone）",
    uvxAutoNote: "如果安裝了 uvx，以上路徑會自動偵測。",
    uvxManualNote: "只有 CF Browser URL/Key 需要手動設定。",
    alternativeManual: "替代：手動安裝",
    trendPulsePath: "trend-pulse Python 路徑",
    cfBrowserPath: "cf-browser Python 路徑",
    notebooklmPath: "NotebookLM 伺服器路徑",
    defaultWorkspace: "預設工作目錄",
    minOverallScore: "最低總分門檻",
    minConversationScore: "最低對話持久性門檻",
    qualityGates: "品質門檻",
    notInstalled: "未安裝",
    primaryCantDisable: "主要 CLI 無法停用",
    primary: "主要",
    disable: "停用",
    enable: "啟用",
    tooltipDetected: "已偵測",
    tooltipNotFound: "未找到",
  },
  en: {
    settings: "Settings",
    configured: "configured",
    backToChat: "Back to Chat",
    autoDetect: "Auto-Detect MCP Tools",
    scanSystem: "Scan System",
    scanning: "Scanning...",
    apply: "Apply",
    found: "found",
    uvxDetected: "uvx detected — MCP servers auto-configured, no manual paths needed.",
    aiCodingClis: "AI Coding CLIs",
    scanningSystem: "Scanning system...",
    detected: "detected",
    enabled: "enabled",
    setAsPrimary: "Set Primary",
    install: "Install",
    routingMode: "Routing Mode",
    primaryOnly: "Primary Only",
    primaryOnlyDesc: (name: string) =>
      `All tasks go to ${name}. Other CLIs are available for manual handoff.`,
    autoDispatch: "Auto-Dispatch",
    autoDispatchDesc: (n: number) =>
      `Automatically distribute tasks across ${n} enabled CLIs. Large tasks get split and parallelized.`,
    language: "Language / 語言",
    mcpServers: "MCP Servers",
    general: "General",
    cfBrowserMode: "CF Browser Mode",
    cfApi: "CF API",
    cfApiDesc: "Call Cloudflare Browser Rendering API directly (needs API Token)",
    worker: "Worker",
    workerDesc: "Use your own deployed Cloudflare Worker",
    workerUrl: "Worker URL",
    workerApiKey: "Worker API Key",
    accountId: "Account ID",
    accountIdHint: "Found in your Cloudflare dashboard sidebar.",
    apiToken: "API Token",
    getApiToken: "Get API Token",
    apiTokenHint: "Create a token with Account / Workers Browser Rendering / Edit permission.",
    saveSettings: "Save Settings",
    saving: "Saving...",
    saved: "Settings saved! Start a new session to apply changes.",
    errorSaving: "Error saving settings.",
    detectionFailed: "Detection failed.",
    detectedSettings: (f: number, t: number) => `Detected ${f}/${t} settings.`,
    applied: "Applied. Click Save to persist.",
    applyFailed: "Warning: Failed to apply server-side.",
    useDetected: "use detected",
    autoUvx: "auto (uvx)",
    uvxAutoConfigured: "uvx auto-configured",
    howToSetup: "How to set up MCP Servers",
    recommendedUvx: "Recommended: uvx (no clone needed)",
    uvxAutoNote: "If uvx is installed, paths above are auto-detected.",
    uvxManualNote: "Only CF Browser URL/Key need manual config.",
    alternativeManual: "Alternative: manual install",
    trendPulsePath: "trend-pulse Python path",
    cfBrowserPath: "cf-browser Python path",
    notebooklmPath: "NotebookLM server path",
    defaultWorkspace: "Default workspace path",
    minOverallScore: "Min overall score",
    minConversationScore: "Min conversation durability",
    qualityGates: "Quality Gates",
    notInstalled: "Not installed",
    primaryCantDisable: "Primary CLI cannot be disabled",
    primary: "Primary",
    disable: "Disable",
    enable: "Enable",
    tooltipDetected: "Detected",
    tooltipNotFound: "Not found",
  },
  ja: {
    settings: "設定",
    configured: "設定済み",
    backToChat: "チャットに戻る",
    autoDetect: "MCP ツール自動検出",
    scanSystem: "システムスキャン",
    scanning: "スキャン中...",
    apply: "適用",
    found: "検出",
    uvxDetected: "uvx 検出 — MCP サーバーは自動設定済み、手動パスは不要です。",
    aiCodingClis: "AI コーディング CLI",
    scanningSystem: "システムをスキャン中...",
    detected: "検出済み",
    enabled: "有効",
    setAsPrimary: "プライマリに設定",
    install: "インストール",
    routingMode: "ルーティングモード",
    primaryOnly: "プライマリのみ",
    primaryOnlyDesc: (name: string) =>
      `すべてのタスクは ${name} に送信されます。他の CLI は手動ハンドオフ用です。`,
    autoDispatch: "自動ディスパッチ",
    autoDispatchDesc: (n: number) =>
      `${n} 個の有効な CLI にタスクを自動分配します。大きなタスクは分割して並列処理されます。`,
    language: "言語",
    mcpServers: "MCP サーバー",
    general: "一般",
    cfBrowserMode: "CF ブラウザモード",
    cfApi: "CF API",
    cfApiDesc: "Cloudflare Browser Rendering API を直接呼び出し（API Token が必要）",
    worker: "Worker",
    workerDesc: "デプロイした Cloudflare Worker を使用",
    workerUrl: "Worker URL",
    workerApiKey: "Worker API キー",
    accountId: "アカウント ID",
    accountIdHint: "Cloudflare ダッシュボードのサイドバーで確認できます。",
    apiToken: "API トークン",
    getApiToken: "API トークンを取得",
    apiTokenHint: "Account / Workers Browser Rendering / Edit 権限のトークンを作成してください。",
    saveSettings: "設定を保存",
    saving: "保存中...",
    saved: "設定を保存しました！変更を適用するには新しいセッションを開始してください。",
    errorSaving: "設定の保存中にエラーが発生しました。",
    detectionFailed: "検出に失敗しました。",
    detectedSettings: (f: number, t: number) => `${f}/${t} 件の設定を検出しました。`,
    applied: "適用しました。保存をクリックして永続化してください。",
    applyFailed: "警告：サーバー側の適用に失敗しました。",
    useDetected: "検出値を使用",
    autoUvx: "自動 (uvx)",
    uvxAutoConfigured: "uvx 自動設定済み",
    howToSetup: "MCP サーバーの設定方法",
    recommendedUvx: "推奨：uvx（クローン不要）",
    uvxAutoNote: "uvx がインストールされていれば、パスは自動検出されます。",
    uvxManualNote: "CF Browser URL/Key のみ手動設定が必要です。",
    alternativeManual: "代替：手動インストール",
    trendPulsePath: "trend-pulse Python パス",
    cfBrowserPath: "cf-browser Python パス",
    notebooklmPath: "NotebookLM サーバーパス",
    defaultWorkspace: "デフォルトワークスペースパス",
    minOverallScore: "最低総合スコア",
    minConversationScore: "最低会話持続性スコア",
    qualityGates: "品質ゲート",
    notInstalled: "未インストール",
    primaryCantDisable: "プライマリ CLI は無効にできません",
    primary: "プライマリ",
    disable: "無効化",
    enable: "有効化",
    tooltipDetected: "検出済み",
    tooltipNotFound: "未検出",
  },
};

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
  minOverallScore: string;
  minConversationScore: string;
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
  browseDir?: boolean;
  inputType?: string;
  min?: number;
  max?: number;
  step?: number;
}

interface SettingGroup {
  title: string;
  fields: FieldDef[];
  guide?: { title: string; steps: string[]; links?: { label: string; url: string }[] };
}

/** Keys that are auto-provided by uvx and don't need manual paths */
const UVX_AUTO_KEYS = new Set([
  "trendPulseVenvPython",
  "cfBrowserVenvPython",
  "notebooklmServerPath",
]);

function getSettingGroups(t: (typeof T)["en"]): SettingGroup[] {
  return [
    {
      title: t.mcpServers,
      fields: [
        { key: "trendPulseVenvPython", label: t.trendPulsePath, placeholder: t.autoUvx },
        { key: "cfBrowserVenvPython", label: t.cfBrowserPath, placeholder: t.autoUvx },
        { key: "notebooklmServerPath", label: t.notebooklmPath, placeholder: t.autoUvx },
      ],
      guide: {
        title: t.howToSetup,
        steps: [
          `--- ${t.recommendedUvx} ---`,
          "uvx --from 'trend-pulse[mcp]' trend-pulse-server",
          "uvx --from cf-browser-mcp cf-browser-mcp",
          "uvx --from notebooklm-skill notebooklm-mcp",
          "",
          t.uvxAutoNote,
          t.uvxManualNote,
          "",
          `--- ${t.alternativeManual} ---`,
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
      title: t.general,
      fields: [
        {
          key: "defaultWorkspace",
          label: t.defaultWorkspace,
          placeholder: "/path/to/workspace",
          browseDir: true,
        },
      ],
    },
    {
      title: t.qualityGates,
      fields: [
        {
          key: "minOverallScore",
          label: t.minOverallScore,
          placeholder: "70",
          inputType: "number",
          min: 0,
          max: 100,
          step: 1,
        },
        {
          key: "minConversationScore",
          label: t.minConversationScore,
          placeholder: "55",
          inputType: "number",
          min: 0,
          max: 100,
          step: 1,
        },
      ],
    },
  ];
}

const LANGUAGE_OPTIONS: { code: Language; label: string }[] = [
  { code: "zh-TW", label: "繁體中文 (Taiwan)" },
  { code: "en", label: "English" },
  { code: "ja", label: "日本語 (Japanese)" },
];

function StatusDot({
  found,
  tooltipFound,
  tooltipNotFound,
}: {
  found: boolean;
  tooltipFound?: string;
  tooltipNotFound?: string;
}) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${found ? "bg-green-500" : "bg-gray-300 dark:bg-gray-600"}`}
      title={found ? tooltipFound || "" : tooltipNotFound || ""}
    />
  );
}

function SetupGuide({ guide }: { guide: NonNullable<SettingGroup["guide"]> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-4">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-xs text-blue-600 hover:text-blue-800 font-medium"
      >
        <svg
          className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-90" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        {guide.title}
      </button>
      {open && (
        <div className="mt-2 ml-5 p-3 bg-blue-50 border border-blue-100 rounded-lg text-xs text-gray-700 space-y-1 dark:bg-blue-950 dark:border-blue-900 dark:text-gray-300">
          {guide.steps.map((step, i) => {
            if (step === "") return <div key={i} className="h-2" />;
            if (step.startsWith("---"))
              return (
                <div key={i} className="font-semibold text-gray-800 dark:text-gray-200 pt-1">
                  {step.replace(/^-+\s*/, "").replace(/\s*-+$/, "")}
                </div>
              );
            return (
              <div key={i}>
                <code className="whitespace-pre-wrap break-all">{step}</code>
              </div>
            );
          })}
          {guide.links && (
            <div className="pt-2 border-t border-blue-200 dark:border-blue-800 mt-2 flex flex-wrap gap-3">
              {guide.links.map((link) => (
                <a
                  key={link.url}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-800 underline"
                >
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

export function SettingsPage({
  isVisible,
  onClose,
  language,
  onLanguageChange,
}: SettingsPageProps) {
  const t = T[language];
  const SETTING_GROUPS = getSettingGroups(t);
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
  const hasSavedCliConfig = useRef(false);

  useEffect(() => {
    if (!isVisible) return;
    hasSavedCliConfig.current = false;

    // Phase 1: Load settings from DB immediately (instant render)
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}))
      .then((settingsData: any) => {
        setSettings(settingsData);
        if (settingsData.cliRoutingMode) setCliRoutingMode(settingsData.cliRoutingMode);
        if (settingsData.cliPrimary) setCliPrimary(settingsData.cliPrimary);
        if (settingsData.cliEnabledList) {
          setCliEnabledSet(new Set(settingsData.cliEnabledList.split(",").filter(Boolean)));
          hasSavedCliConfig.current = true;
        }
      });

    // Phase 2: Detect CLIs in background (updates version/install status)
    setDetectingClis(true);
    fetch("/api/settings/detect-clis")
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => [])
      .then((cliData: CliInfo[]) => {
        setClis(cliData);
        const installedCommands = cliData.filter((c) => c.installed).map((c) => c.command);

        // Only auto-enable if user has no saved CLI config
        if (!hasSavedCliConfig.current) {
          setCliEnabledSet((prev) => {
            if (prev.size === 0) return new Set(installedCommands);
            return prev;
          });
        }
        // If no saved primary, use first installed (but preserve user's saved choice)
        setCliPrimary((prev) => {
          if (!prev) return installedCommands[0] || "claude";
          return prev;
        });
      })
      .finally(() => setDetectingClis(false));
  }, [isVisible]);

  // Auto-demote to "primary" mode when only 1 CLI is enabled
  useEffect(() => {
    if (cliEnabledSet.size <= 1 && cliRoutingMode === "auto-dispatch") {
      setCliRoutingMode("primary");
      saveCliSettings(cliPrimary, "primary", cliEnabledSet);
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
      setMessage(t.detectedSettings(found, Object.keys(data).length));
    } catch {
      setMessage(t.detectionFailed);
    }
    setDetecting(false);
  };

  const saveCliSettings = (primary: string, routing: string, enabled: Set<string>) => {
    fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cliPrimary: primary,
        cliRoutingMode: routing,
        cliEnabledList: [...enabled].join(","),
      }),
    }).catch(() => {});
  };

  const toggleCliEnabled = (command: string) => {
    if (command === cliPrimary) return; // Primary CLI cannot be disabled
    setCliEnabledSet((prev) => {
      const next = new Set(prev);
      if (next.has(command)) {
        next.delete(command);
      } else {
        next.add(command);
      }
      saveCliSettings(cliPrimary, cliRoutingMode, next);
      return next;
    });
  };

  const handleSetPrimary = (command: string) => {
    setCliPrimary(command);
    // Ensure primary is always enabled
    const newEnabled = new Set([...cliEnabledSet, command]);
    setCliEnabledSet(newEnabled);
    saveCliSettings(command, cliRoutingMode, newEnabled);
  };

  const handleApplyDetected = async () => {
    const updates: Partial<SettingsData> = {};
    for (const [key, info] of Object.entries(detected)) {
      // Only apply detected values for keys that the user hasn't already set
      if (info.found && info.value && !(settings as any)[key]) {
        (updates as any)[key] = info.value;
      }
    }
    setSettings((prev) => ({ ...prev, ...updates }));

    const hasSensitive = detected["cfBrowserApiKey"]?.found;
    if (hasSensitive) {
      try {
        const res = await fetch("/api/settings/detect/apply", { method: "POST" });
        if (!res.ok) {
          setMessage(t.applyFailed);
          return;
        }
      } catch {
        setMessage(t.applyFailed);
        return;
      }
    }
    setMessage(t.applied);
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
      setMessage(t.saved);
    } catch {
      setMessage(t.errorSaving);
    }
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
          <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">{t.settings}</h2>
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {configuredCount}/{allKeys.length} {t.configured}
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          {t.backToChat}
        </button>
      </div>

      <div className="p-6 max-w-2xl space-y-8">
        {/* Auto-detect */}
        <div className="p-4 bg-gradient-to-r from-emerald-50 to-blue-50 border border-emerald-200 rounded-lg dark:from-emerald-900/40 dark:to-blue-900/40 dark:border-emerald-700">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
              {t.autoDetect}
            </h3>
            <div className="flex gap-2">
              <button
                onClick={handleDetect}
                disabled={detecting}
                className="px-3 py-1.5 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:opacity-50 text-xs font-medium"
              >
                {detecting ? t.scanning : t.scanSystem}
              </button>
              {detectedCount > 0 && (
                <button
                  onClick={handleApplyDetected}
                  className="px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-xs font-medium"
                >
                  {t.apply} {detectedCount} {t.found}
                </button>
              )}
            </div>
          </div>
          {detected["uvxAvailable"]?.found && (
            <div className="mt-2 px-3 py-2 bg-emerald-100 border border-emerald-300 rounded-md flex items-center gap-2 text-xs text-emerald-800 dark:bg-emerald-900/50 dark:border-emerald-600 dark:text-emerald-300">
              <StatusDot
                found={true}
                tooltipFound={t.tooltipDetected}
                tooltipNotFound={t.tooltipNotFound}
              />
              <span>{t.uvxDetected}</span>
            </div>
          )}
          {Object.keys(detected).length > 0 && (
            <div className="mt-3 grid grid-cols-2 gap-1.5">
              {allKeys.map((key) => {
                const info = detected[key];
                if (!info) return null;
                const label =
                  SETTING_GROUPS.flatMap((g) => g.fields).find((f) => f.key === key)?.label || key;
                const isUvxAuto =
                  UVX_AUTO_KEYS.has(key) &&
                  detected["uvxAvailable"]?.found &&
                  info.value?.startsWith("uvx:");
                return (
                  <div key={key} className="flex items-center gap-1.5 text-xs">
                    <StatusDot
                      found={info.found}
                      tooltipFound={t.tooltipDetected}
                      tooltipNotFound={t.tooltipNotFound}
                    />
                    <span
                      className={
                        info.found
                          ? "text-gray-700 dark:text-gray-200"
                          : "text-gray-400 dark:text-gray-500"
                      }
                    >
                      {label}
                      {isUvxAuto && (
                        <span className="ml-1 text-emerald-600 dark:text-emerald-400 font-medium">
                          (uvx)
                        </span>
                      )}
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
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
              {t.aiCodingClis}
            </h3>
            {detectingClis && (
              <span className="text-xs text-gray-400 dark:text-gray-500 animate-pulse">
                {t.scanningSystem}
              </span>
            )}
            {!detectingClis && clis.length > 0 && (
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {clis.filter((c) => c.installed).length}/{clis.length} {t.detected}
                {" \u00B7 "}
                {cliEnabledSet.size} {t.enabled}
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
                          !cli.installed
                            ? "bg-gray-200 dark:bg-gray-700 cursor-not-allowed"
                            : isEnabled
                              ? "bg-green-500 cursor-pointer"
                              : "bg-gray-300 dark:bg-gray-600 cursor-pointer"
                        } ${isPrimary ? "cursor-not-allowed" : ""}`}
                        title={
                          !cli.installed
                            ? t.notInstalled
                            : isPrimary
                              ? t.primaryCantDisable
                              : isEnabled
                                ? t.disable
                                : t.enable
                        }
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${isEnabled ? "translate-x-4" : "translate-x-0.5"}`}
                        />
                      </button>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-800 dark:text-gray-100">
                            {cli.name}
                          </span>
                          <code className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400 font-mono">
                            {cli.command}
                          </code>
                          {cli.installed && cli.version && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 font-mono">
                              v{cli.version.replace(/^v/, "")}
                            </span>
                          )}
                          {isPrimary && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 font-medium">
                              {t.primary}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                          {cli.description}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {cli.installed && !isPrimary && isEnabled && (
                        <button
                          onClick={() => handleSetPrimary(cli.command)}
                          className="text-[10px] px-2 py-1 border border-gray-200 dark:border-gray-600 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30 text-gray-500 dark:text-gray-400 hover:text-blue-600"
                          title={t.setAsPrimary}
                        >
                          {t.setAsPrimary}
                        </button>
                      )}
                      {!cli.installed && (
                        <a
                          href={cli.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                        >
                          {t.install}
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
              <label className="text-sm text-gray-700 dark:text-gray-200 font-medium block mb-2">
                {t.routingMode}
              </label>
              <div className="space-y-2">
                <label
                  className={`flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                    cliRoutingMode === "primary"
                      ? "border-purple-300 bg-purple-50/50 dark:border-purple-500 dark:bg-purple-900/30"
                      : "border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500"
                  }`}
                >
                  <input
                    type="radio"
                    name="cliRoutingMode"
                    value="primary"
                    checked={cliRoutingMode === "primary"}
                    onChange={() => {
                      setCliRoutingMode("primary");
                      saveCliSettings(cliPrimary, "primary", cliEnabledSet);
                    }}
                    className="mt-0.5 text-purple-600"
                  />
                  <div>
                    <div className="text-sm font-medium text-gray-700 dark:text-gray-200">
                      {t.primaryOnly}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {t.primaryOnlyDesc(
                        clis.find((c) => c.command === cliPrimary)?.name || cliPrimary
                      )}
                    </div>
                  </div>
                </label>
                <label
                  className={`flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                    cliRoutingMode === "auto-dispatch"
                      ? "border-purple-300 bg-purple-50/50 dark:border-purple-500 dark:bg-purple-900/30"
                      : "border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500"
                  }`}
                >
                  <input
                    type="radio"
                    name="cliRoutingMode"
                    value="auto-dispatch"
                    checked={cliRoutingMode === "auto-dispatch"}
                    onChange={() => {
                      setCliRoutingMode("auto-dispatch");
                      saveCliSettings(cliPrimary, "auto-dispatch", cliEnabledSet);
                    }}
                    className="mt-0.5 text-purple-600"
                  />
                  <div>
                    <div className="text-sm font-medium text-gray-700 dark:text-gray-200">
                      {t.autoDispatch}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {t.autoDispatchDesc(cliEnabledSet.size)}
                    </div>
                  </div>
                </label>
              </div>
            </div>
          )}
        </div>

        {/* Language */}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 uppercase tracking-wider">
            {t.language}
          </h3>
          <div className="flex gap-2">
            {LANGUAGE_OPTIONS.map((opt) => (
              <button
                key={opt.code}
                onClick={() => onLanguageChange(opt.code)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all border ${language === opt.code ? "bg-blue-600 text-white border-blue-600 shadow" : "bg-white text-gray-600 border-gray-300 hover:border-gray-400 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600"}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* MCP + General settings */}
        {SETTING_GROUPS.map((group) => (
          <div key={group.title}>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 uppercase tracking-wider">
              {group.title}
            </h3>
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
                      {uvxHandled ? (
                        <StatusDot
                          found={true}
                          tooltipFound={t.tooltipDetected}
                          tooltipNotFound={t.tooltipNotFound}
                        />
                      ) : hasValue ? (
                        <StatusDot
                          found={true}
                          tooltipFound={t.tooltipDetected}
                          tooltipNotFound={t.tooltipNotFound}
                        />
                      ) : det ? (
                        <StatusDot
                          found={det.found}
                          tooltipFound={t.tooltipDetected}
                          tooltipNotFound={t.tooltipNotFound}
                        />
                      ) : null}
                      {field.label}
                      {uvxHandled && (
                        <span className="text-xs text-emerald-600 font-medium">{t.autoUvx}</span>
                      )}
                      {!uvxHandled && det?.found && !hasValue && (
                        <button
                          onClick={() =>
                            setSettings((prev) => ({ ...prev, [field.key]: det.value }))
                          }
                          className="text-xs text-emerald-600 hover:text-emerald-800 font-medium ml-1"
                        >
                          {t.useDetected}
                        </button>
                      )}
                    </label>
                    {uvxHandled ? (
                      <div className="px-3 py-2 border border-emerald-200 bg-emerald-50/30 rounded-lg text-sm text-emerald-700 font-mono dark:border-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-300">
                        {t.uvxAutoConfigured}
                      </div>
                    ) : (
                      <div className={field.browseDir ? "flex gap-2" : ""}>
                        <input
                          type={field.sensitive ? "password" : field.inputType || "text"}
                          value={(settings as any)[field.key] || ""}
                          onChange={(e) =>
                            setSettings((prev) => ({ ...prev, [field.key]: e.target.value }))
                          }
                          placeholder={field.placeholder}
                          {...(field.min !== undefined ? { min: field.min } : {})}
                          {...(field.max !== undefined ? { max: field.max } : {})}
                          {...(field.step !== undefined ? { step: field.step } : {})}
                          className={`${field.browseDir ? "flex-1" : "w-full"} px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono ${hasValue ? "border-green-300 bg-green-50/30 dark:border-green-600 dark:bg-green-900/20 dark:text-gray-100" : "border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"}`}
                        />
                        {field.browseDir && (
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                const r = await fetch("/api/settings/pick-folder");
                                const d = await r.json();
                                if (d.path)
                                  setSettings((prev) => ({ ...prev, [field.key]: d.path }));
                              } catch {}
                            }}
                            className="px-3 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-600 dark:text-gray-300 shrink-0"
                          >
                            📂
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {group.title === t.mcpServers && (
              <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                <label className="text-sm text-gray-600 dark:text-gray-400 font-medium block mb-3">
                  {t.cfBrowserMode}
                </label>
                <div className="space-y-2 mb-3">
                  <label
                    className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                      (settings as any).cfBrowserMode !== "worker"
                        ? "border-blue-300 bg-blue-50/50 dark:border-blue-500 dark:bg-blue-900/30"
                        : "border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500"
                    }`}
                  >
                    <input
                      type="radio"
                      name="cfBrowserMode"
                      value="cf-api"
                      checked={(settings as any).cfBrowserMode !== "worker"}
                      onChange={() => setSettings((prev) => ({ ...prev, cfBrowserMode: "cf-api" }))}
                      className="text-blue-600"
                    />
                    <div>
                      <div className="text-sm font-medium text-gray-700 dark:text-gray-200">
                        {t.cfApi}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{t.cfApiDesc}</div>
                    </div>
                  </label>
                  <label
                    className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                      (settings as any).cfBrowserMode === "worker"
                        ? "border-blue-300 bg-blue-50/50 dark:border-blue-500 dark:bg-blue-900/30"
                        : "border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500"
                    }`}
                  >
                    <input
                      type="radio"
                      name="cfBrowserMode"
                      value="worker"
                      checked={(settings as any).cfBrowserMode === "worker"}
                      onChange={() => setSettings((prev) => ({ ...prev, cfBrowserMode: "worker" }))}
                      className="text-blue-600"
                    />
                    <div>
                      <div className="text-sm font-medium text-gray-700 dark:text-gray-200">
                        {t.worker}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{t.workerDesc}</div>
                    </div>
                  </label>
                </div>
                {(settings as any).cfBrowserMode === "worker" ? (
                  <div className="space-y-3 ml-7">
                    <div>
                      <label className="text-sm text-gray-600 dark:text-gray-400 mb-1 block">
                        {t.workerUrl}
                      </label>
                      <input
                        type="text"
                        value={(settings as any).cfBrowserUrl || ""}
                        onChange={(e) =>
                          setSettings((prev) => ({ ...prev, cfBrowserUrl: e.target.value }))
                        }
                        placeholder="https://cf-browser.your-subdomain.workers.dev"
                        className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                      />
                    </div>
                    <div>
                      <label className="text-sm text-gray-600 dark:text-gray-400 mb-1 block">
                        {t.workerApiKey}
                      </label>
                      <input
                        type="password"
                        value={(settings as any).cfBrowserApiKey || ""}
                        onChange={(e) =>
                          setSettings((prev) => ({ ...prev, cfBrowserApiKey: e.target.value }))
                        }
                        placeholder="worker-api-key"
                        className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3 ml-7">
                    <div>
                      <label className="text-sm text-gray-600 dark:text-gray-400 mb-1 block">
                        {t.accountId}
                      </label>
                      <input
                        type="text"
                        value={(settings as any).cfAccountId || ""}
                        onChange={(e) =>
                          setSettings((prev) => ({ ...prev, cfAccountId: e.target.value }))
                        }
                        placeholder="your-cloudflare-account-id"
                        className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                      />
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                        {t.accountIdHint}
                      </p>
                    </div>
                    <div>
                      <label className="text-sm text-gray-600 dark:text-gray-400 mb-1 flex items-center gap-2">
                        {t.apiToken}
                        <a
                          href="https://dash.cloudflare.com/profile/api-tokens"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                        >
                          {t.getApiToken}
                          <svg
                            className="w-3 h-3 inline ml-0.5 -mt-0.5"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                            />
                          </svg>
                        </a>
                      </label>
                      <input
                        type="password"
                        value={(settings as any).cfApiToken || ""}
                        onChange={(e) =>
                          setSettings((prev) => ({ ...prev, cfApiToken: e.target.value }))
                        }
                        placeholder="cf-api-token"
                        className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                      />
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                        {t.apiTokenHint}
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
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm"
          >
            {saving ? t.saving : t.saveSettings}
          </button>
          {message && <span className="text-sm text-gray-600 dark:text-gray-400">{message}</span>}
        </div>
      </div>
    </div>
  );
}
