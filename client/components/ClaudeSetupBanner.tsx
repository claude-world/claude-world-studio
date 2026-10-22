/**
 * Shown on every page while there are no Claude credentials.
 *
 * Without this the first-run experience is: install, launch, type a message,
 * and get "Not logged in · Please run /login" back as if the assistant said
 * it — a CLI slash command that does not exist in this app.
 */
import { useLanguage } from "../hooks/useLanguage";

const T = {
  "zh-TW": {
    title: "尚未登入 Claude",
    body: "Studio 需要 Anthropic 帳號才能執行 AI 代理。其他功能仍可使用。",
    action: "前往設定",
  },
  en: {
    title: "Not signed in to Claude",
    body: "Studio needs an Anthropic account before the AI agent can run. Everything else still works.",
    action: "Open Settings",
  },
  ja: {
    title: "Claude にログインしていません",
    body: "AI エージェントの実行には Anthropic アカウントが必要です。他の機能はそのまま使えます。",
    action: "設定を開く",
  },
} as const;

interface ClaudeSetupBannerProps {
  /** Only true when the server positively reported no credentials. */
  show: boolean;
  onOpenSettings: () => void;
}

export function ClaudeSetupBanner({ show, onOpenSettings }: ClaudeSetupBannerProps) {
  const t = T[useLanguage()];
  if (!show) return null;

  return (
    <div
      role="status"
      className="flex items-center gap-3 px-4 py-2.5 bg-amber-50 border-b border-amber-300 text-amber-900 dark:bg-amber-950/60 dark:border-amber-700 dark:text-amber-100"
    >
      <svg
        className="w-5 h-5 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"
        />
      </svg>
      <div className="min-w-0 flex-1">
        <span className="font-semibold">{t.title}</span>
        <span className="ml-2 text-sm opacity-90">{t.body}</span>
      </div>
      <button
        onClick={onOpenSettings}
        className="shrink-0 px-3 py-1.5 text-sm font-medium rounded-md bg-amber-600 text-white hover:bg-amber-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
      >
        {t.action}
      </button>
    </div>
  );
}
