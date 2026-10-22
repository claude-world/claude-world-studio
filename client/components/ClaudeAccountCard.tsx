/**
 * Claude account status in Settings — the one place that explains how to sign
 * in, so the banner and the chat error both have somewhere to point.
 *
 * The instructions are terminal-based for now. An in-app sign-in button
 * belongs here when it lands, replacing the steps rather than adding to them.
 */
import { useState } from "react";
import { useLanguage } from "../hooks/useLanguage";
import type { ClaudeAuthStatus } from "../hooks/useClaudeAuth";
import { useClaudeLogin } from "../hooks/useClaudeLogin";

const T = {
  "zh-TW": {
    title: "Claude 帳號",
    signedInAs: "已登入",
    viaSubscription: "Claude 訂閱",
    viaApiKey: "API 金鑰",
    notSignedIn: "尚未登入 — AI 代理無法執行",
    unknown: "無法確認登入狀態",
    checking: "檢查中…",
    recheck: "重新檢查",
    signIn: "登入 Claude",
    signingIn: "開啟登入頁面…",
    finishing: "登入中…",
    awaitTitle: "已在瀏覽器開啟登入頁面",
    awaitBody: "完成登入後，把網頁顯示的代碼貼到這裡。",
    codeLabel: "貼上代碼",
    submit: "完成登入",
    reopen: "重新開啟登入頁面",
    cancel: "取消",
    failedTitle: "登入未完成",
    tryAgain: "再試一次",
    manualTitle: "或用終端機登入",
    step1: "開啟「終端機」應用程式",
    step2Suffix: "（會開啟瀏覽器完成登入）",
    step3: "回到這裡按「重新檢查」",
    altKey: "或設定 ANTHROPIC_API_KEY 環境變數後重新啟動 Studio。",
  },
  en: {
    title: "Claude account",
    signedInAs: "Signed in",
    viaSubscription: "Claude subscription",
    viaApiKey: "API key",
    notSignedIn: "Not signed in — the AI agent cannot run",
    unknown: "Could not check the sign-in status",
    checking: "Checking…",
    recheck: "Check again",
    signIn: "Sign in to Claude",
    signingIn: "Opening the sign-in page…",
    finishing: "Signing in…",
    awaitTitle: "The sign-in page is open in your browser",
    awaitBody: "Finish signing in there, then paste the code it shows.",
    codeLabel: "Paste code",
    submit: "Finish sign-in",
    reopen: "Open the page again",
    cancel: "Cancel",
    failedTitle: "Sign-in did not finish",
    tryAgain: "Try again",
    manualTitle: "Or sign in from a terminal",
    step1: "Open the Terminal app",
    step2Suffix: "— it opens a browser to finish",
    step3: 'Come back here and press "Check again"',
    altKey: "Or set the ANTHROPIC_API_KEY environment variable and restart Studio.",
  },
  ja: {
    title: "Claude アカウント",
    signedInAs: "ログイン済み",
    viaSubscription: "Claude サブスクリプション",
    viaApiKey: "API キー",
    notSignedIn: "未ログイン — AI エージェントを実行できません",
    unknown: "ログイン状態を確認できませんでした",
    checking: "確認中…",
    recheck: "再確認",
    signIn: "Claude にログイン",
    signingIn: "ログインページを開いています…",
    finishing: "ログイン中…",
    awaitTitle: "ブラウザでログインページを開きました",
    awaitBody: "ログインを完了し、表示されたコードをここに貼り付けてください。",
    codeLabel: "コードを貼り付け",
    submit: "ログインを完了",
    reopen: "ログインページを再度開く",
    cancel: "キャンセル",
    failedTitle: "ログインが完了しませんでした",
    tryAgain: "再試行",
    manualTitle: "またはターミナルでログイン",
    step1: "ターミナル.app を開く",
    step2Suffix: "を実行（ブラウザが開きます）",
    step3: "ここに戻って「再確認」を押す",
    altKey: "または ANTHROPIC_API_KEY を設定して Studio を再起動してください。",
  },
} as const;

interface ClaudeAccountCardProps {
  status: ClaudeAuthStatus | null;
  loading: boolean;
  onRecheck: () => void;
}

export function ClaudeAccountCard({ status, loading, onRecheck }: ClaudeAccountCardProps) {
  const t = T[useLanguage()];
  const login = useClaudeLogin(onRecheck);
  const [code, setCode] = useState("");
  const phase = login.state?.phase;

  const signedIn = status?.loggedIn === true;
  const indeterminate = status === null || !!status.probeError;
  const dot = signedIn ? "bg-emerald-500" : indeterminate ? "bg-gray-400" : "bg-amber-500";

  let headline: string;
  if (loading && status === null) headline = t.checking;
  else if (signedIn) headline = t.signedInAs;
  else if (indeterminate) headline = t.unknown;
  else headline = t.notSignedIn;

  const method =
    status?.authMethod === "api_key"
      ? t.viaApiKey
      : status?.authMethod === "claude.ai"
        ? t.viaSubscription
        : "";

  return (
    <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
      <div className="flex items-center gap-3">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-gray-900 dark:text-gray-100">{t.title}</div>
          <div className="text-sm text-gray-600 dark:text-gray-300">
            {headline}
            {signedIn && method ? ` · ${method}` : ""}
            {signedIn && status?.email ? ` · ${status.email}` : ""}
          </div>
        </div>
        <button
          onClick={onRecheck}
          disabled={loading}
          className="shrink-0 rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:hover:bg-gray-800"
        >
          {loading ? t.checking : t.recheck}
        </button>
      </div>

      {!signedIn && !phase && (
        <button
          onClick={() => void login.start()}
          disabled={login.busy}
          className="mt-3 w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {t.signIn}
        </button>
      )}

      {(phase === "starting" || phase === "finishing") && (
        <div className="mt-3 flex items-center gap-2 rounded-md bg-gray-50 p-3 text-sm text-gray-700 dark:bg-gray-800 dark:text-gray-300">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
          {phase === "starting" ? t.signingIn : t.finishing}
        </div>
      )}

      {phase === "awaiting_code" && (
        <div className="mt-3 rounded-md bg-blue-50 p-3 text-sm dark:bg-blue-950/50">
          <div className="font-medium text-gray-900 dark:text-gray-100">{t.awaitTitle}</div>
          <p className="mt-0.5 text-gray-700 dark:text-gray-300">{t.awaitBody}</p>
          {/* A rejected code reopens this input with the binary's reason. */}
          {login.state?.error && (
            <p className="mt-1 font-medium text-amber-700 dark:text-amber-300">
              {login.state.error}
            </p>
          )}
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!code.trim()) return;
              void login.submitCode(code.trim());
              setCode("");
            }}
          >
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={t.codeLabel}
              aria-label={t.codeLabel}
              autoComplete="off"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-900"
            />
            <button
              type="submit"
              disabled={login.busy || !code.trim()}
              className="shrink-0 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {t.submit}
            </button>
          </form>
          <div className="mt-2 flex gap-3 text-xs">
            <button
              onClick={login.reopenUrl}
              className="underline text-blue-700 dark:text-blue-300"
            >
              {t.reopen}
            </button>
            <button
              onClick={() => void login.cancel()}
              className="underline text-gray-600 dark:text-gray-400"
            >
              {t.cancel}
            </button>
          </div>
        </div>
      )}

      {(phase === "failed" || phase === "cancelled") && (
        <div className="mt-3 rounded-md bg-amber-50 p-3 text-sm dark:bg-amber-950/50">
          <div className="font-medium text-amber-900 dark:text-amber-200">{t.failedTitle}</div>
          {login.state?.error && (
            <p className="mt-0.5 text-amber-800 dark:text-amber-300">{login.state.error}</p>
          )}
          <button
            onClick={() => void login.start()}
            disabled={login.busy}
            className="mt-2 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {t.tryAgain}
          </button>
        </div>
      )}

      {!signedIn && (
        <div className="mt-3 rounded-md bg-gray-50 p-3 text-sm dark:bg-gray-800">
          <div className="mb-1 font-medium text-gray-800 dark:text-gray-200">{t.manualTitle}</div>
          <ol className="list-decimal space-y-0.5 pl-5 text-gray-700 dark:text-gray-300">
            <li>{t.step1}</li>
            <li>
              <code className="rounded bg-gray-200 px-1 py-0.5 text-xs dark:bg-gray-700">
                claude auth login
              </code>
              <span className="ml-1">{t.step2Suffix}</span>
            </li>
            <li>{t.step3}</li>
          </ol>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{t.altKey}</p>
        </div>
      )}
    </div>
  );
}
