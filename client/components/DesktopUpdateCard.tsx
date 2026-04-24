import type { Language } from "../App";
import type { DesktopUpdateState } from "../hooks/useDesktopUpdater";

const T = {
  "zh-TW": {
    title: "桌面版更新",
    subtitle: "檢查、下載並安裝最新桌面版。",
    currentVersion: "目前版本",
    latestVersion: "最新版本",
    lastChecked: "上次檢查",
    releaseNotes: "版本說明",
    notAvailable: "只有安裝版桌面 app 才支援自動更新。",
    check: "檢查更新",
    checking: "檢查中...",
    download: "下載更新",
    downloading: "下載中...",
    install: "立即安裝並重啟",
    upToDate: "已是最新版本。",
  },
  en: {
    title: "Desktop Updates",
    subtitle: "Check, download, and install the latest desktop release.",
    currentVersion: "Current version",
    latestVersion: "Latest version",
    lastChecked: "Last checked",
    releaseNotes: "Release notes",
    notAvailable: "Automatic updates are only available in the installed desktop app.",
    check: "Check for Updates",
    checking: "Checking...",
    download: "Download Update",
    downloading: "Downloading...",
    install: "Install & Relaunch",
    upToDate: "You're up to date.",
  },
  ja: {
    title: "デスクトップ更新",
    subtitle: "最新のデスクトップ版を確認、ダウンロード、インストールします。",
    currentVersion: "現在のバージョン",
    latestVersion: "最新バージョン",
    lastChecked: "最終確認",
    releaseNotes: "リリースノート",
    notAvailable: "自動更新はインストール済みのデスクトップアプリでのみ利用できます。",
    check: "更新を確認",
    checking: "確認中...",
    download: "更新をダウンロード",
    downloading: "ダウンロード中...",
    install: "再起動してインストール",
    upToDate: "最新バージョンです。",
  },
} as const;

interface DesktopUpdateCardProps {
  language: Language;
  state: DesktopUpdateState;
  onCheckForUpdates: () => void | Promise<unknown>;
  onDownloadUpdate: () => void | Promise<unknown>;
  onInstallUpdate: () => void | Promise<unknown>;
}

export function DesktopUpdateCard({
  language,
  state,
  onCheckForUpdates,
  onDownloadUpdate,
  onInstallUpdate,
}: DesktopUpdateCardProps) {
  const t = T[language];
  const busy = state.status === "checking" || state.status === "downloading";
  const showDownload = state.status === "available";
  const showInstall = state.status === "downloaded";
  const lastChecked = state.checkedAt ? new Date(state.checkedAt).toLocaleString() : "—";
  const latestVersion = state.latestVersion || "—";
  const currentVersion = state.currentVersion || "—";

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{t.title}</h3>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t.subtitle}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => void onCheckForUpdates()}
            disabled={busy || !state.supported || !state.configured}
            className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
          >
            {state.status === "checking" ? t.checking : t.check}
          </button>
          {showDownload && (
            <button
              onClick={() => void onDownloadUpdate()}
              disabled={busy}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {state.status === "downloading" ? t.downloading : t.download}
            </button>
          )}
          {showInstall && (
            <button
              onClick={() => void onInstallUpdate()}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
            >
              {t.install}
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Info label={t.currentVersion} value={currentVersion} />
        <Info label={t.latestVersion} value={latestVersion} />
        <Info label={t.lastChecked} value={lastChecked} />
      </div>

      <div
        className={`mt-4 rounded-lg border px-3 py-2 text-sm ${
          state.status === "error"
            ? "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/50 dark:text-red-300"
            : state.status === "downloaded"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
              : state.status === "available"
                ? "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-300"
                : "border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-300"
        }`}
      >
        {!state.supported || !state.configured
          ? t.notAvailable
          : state.status === "up-to-date"
            ? t.upToDate
            : state.message}
      </div>

      {state.status === "downloading" && (
        <div className="mt-4">
          <div className="mb-1 flex justify-between text-xs text-gray-500 dark:text-gray-400">
            <span>{t.downloading}</span>
            <span>{Math.round(state.downloadProgress)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
            <div
              className="h-full rounded-full bg-blue-600 transition-all"
              style={{ width: `${Math.max(0, Math.min(state.downloadProgress, 100))}%` }}
            />
          </div>
        </div>
      )}

      {state.releaseNotes && (
        <div className="mt-4">
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {t.releaseNotes}
          </h4>
          <div className="max-h-40 overflow-y-auto rounded-lg bg-gray-50 p-3 text-sm whitespace-pre-wrap text-gray-700 dark:bg-gray-900/60 dark:text-gray-300">
            {state.releaseNotes}
          </div>
        </div>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-900/60">
      <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {label}
      </div>
      <div className="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">{value}</div>
    </div>
  );
}
