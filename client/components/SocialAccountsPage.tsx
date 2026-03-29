import React, { useState, useEffect, useCallback } from "react";

// --- i18n ---

const T = {
  "zh-TW": {
    pageTitle: "社群帳號",
    tabAccounts: "帳號",
    tabReview: "審核佇列",
    tabHistory: "發文紀錄",
    backToChat: "返回對話",
    // Accounts tab
    filterAll: "全部",
    addAccount: "+ 新增帳號",
    noAccountsYet: "尚未設定任何帳號。",
    noAccountsMatch: "沒有符合篩選條件的帳號。",
    noPersona: "尚未設定角色提示",
    autoPublish: "自動發佈",
    edit: "編輯",
    delete: "刪除",
    // Account form
    newAccount: "新增帳號",
    editAccount: "編輯：",
    fieldName: "名稱 *",
    fieldHandle: "帳號 *",
    fieldPlatform: "平台 *",
    fieldStyle: "風格",
    fieldToken: "Token",
    fieldTokenKeep: "Token（留空則保留現有）",
    fieldUserId: "使用者 ID",
    fieldPersonaPrompt: "角色提示",
    placeholderPersona: "告訴 AI 如何為此帳號調整內容...",
    saving: "儲存中...",
    create: "建立",
    update: "更新",
    cancel: "取消",
    accountSaved: "帳號已儲存。",
    accountSaveFailed: "儲存帳號失敗。",
    networkErrorSave: "儲存帳號時發生網路錯誤。",
    // Review tab
    noPendingTitle: "目前沒有待審核的貼文",
    noPendingDesc: "關閉自動發佈的帳號所產生的草稿會在此顯示",
    filterLabel: "篩選：",
    allAccounts: "所有帳號",
    selectAll: "全選",
    publishing: "發佈中...",
    publishSelected: "發佈選取",
    discard: "捨棄",
    discardTitle: "捨棄草稿",
    publishedCount: (s: number, f: number) => `已發佈 ${s}，失敗 ${f}`,
    batchFailed: "批次發佈失敗。",
    networkErrorBatch: "批次發佈時發生網路錯誤。",
    // History tab
    filterByAccount: "篩選帳號：",
    refresh: "重新整理",
    noPostsYet: "尚無發文紀錄",
    // Post row
    viewPost: "查看貼文",
    insights: "洞察",
    hide: "隱藏",
    // Insights
    loadingInsights: "載入洞察資料中...",
    insightsError: "錯誤：",
    refreshInsights: "重新整理",
    metricViews: "觀看",
    metricLikes: "按讚",
    metricReplies: "回覆",
    metricReposts: "轉發",
    metricQuotes: "引用",
    // Status badges
    statusPublished: "已發佈",
    statusDraft: "草稿",
    statusPending: "待發佈",
    statusFailed: "失敗",
  },
  en: {
    pageTitle: "Social Accounts",
    tabAccounts: "Accounts",
    tabReview: "Review Queue",
    tabHistory: "Post History",
    backToChat: "Back to Chat",
    filterAll: "All",
    addAccount: "+ Add Account",
    noAccountsYet: "No accounts configured yet.",
    noAccountsMatch: "No accounts match this filter.",
    noPersona: "No persona configured",
    autoPublish: "Auto-publish",
    edit: "Edit",
    delete: "Delete",
    newAccount: "New Account",
    editAccount: "Edit: ",
    fieldName: "Name *",
    fieldHandle: "Handle *",
    fieldPlatform: "Platform *",
    fieldStyle: "Style",
    fieldToken: "Token",
    fieldTokenKeep: "Token (leave empty to keep current)",
    fieldUserId: "User ID",
    fieldPersonaPrompt: "Persona Prompt",
    placeholderPersona: "Instructions for AI to adapt content for this account...",
    saving: "Saving...",
    create: "Create",
    update: "Update",
    cancel: "Cancel",
    accountSaved: "Account saved.",
    accountSaveFailed: "Failed to save account.",
    networkErrorSave: "Network error saving account.",
    noPendingTitle: "No posts pending review",
    noPendingDesc: "Posts from accounts with auto-publish OFF will appear here",
    filterLabel: "Filter:",
    allAccounts: "All Accounts",
    selectAll: "Select All",
    publishing: "Publishing...",
    publishSelected: "Publish Selected",
    discard: "Discard",
    discardTitle: "Discard draft",
    publishedCount: (s: number, f: number) => `Published ${s}, failed ${f}`,
    batchFailed: "Batch publish failed.",
    networkErrorBatch: "Network error during batch publish.",
    filterByAccount: "Filter by account:",
    refresh: "Refresh",
    noPostsYet: "No posts yet",
    viewPost: "View Post",
    insights: "Insights",
    hide: "Hide",
    loadingInsights: "Loading insights...",
    insightsError: "Error: ",
    refreshInsights: "Refresh",
    metricViews: "Views",
    metricLikes: "Likes",
    metricReplies: "Replies",
    metricReposts: "Reposts",
    metricQuotes: "Quotes",
    statusPublished: "published",
    statusDraft: "draft",
    statusPending: "pending",
    statusFailed: "failed",
  },
  ja: {
    pageTitle: "ソーシャルアカウント",
    tabAccounts: "アカウント",
    tabReview: "レビューキュー",
    tabHistory: "投稿履歴",
    backToChat: "チャットに戻る",
    filterAll: "すべて",
    addAccount: "+ アカウント追加",
    noAccountsYet: "アカウントが未設定です。",
    noAccountsMatch: "このフィルターに一致するアカウントはありません。",
    noPersona: "ペルソナ未設定",
    autoPublish: "自動投稿",
    edit: "編集",
    delete: "削除",
    newAccount: "新規アカウント",
    editAccount: "編集：",
    fieldName: "名前 *",
    fieldHandle: "ハンドル *",
    fieldPlatform: "プラットフォーム *",
    fieldStyle: "スタイル",
    fieldToken: "トークン",
    fieldTokenKeep: "トークン（空欄で現在の値を維持）",
    fieldUserId: "ユーザー ID",
    fieldPersonaPrompt: "ペルソナプロンプト",
    placeholderPersona: "このアカウント向けにコンテンツを調整する指示...",
    saving: "保存中...",
    create: "作成",
    update: "更新",
    cancel: "キャンセル",
    accountSaved: "アカウントを保存しました。",
    accountSaveFailed: "アカウントの保存に失敗しました。",
    networkErrorSave: "アカウント保存中にネットワークエラーが発生しました。",
    noPendingTitle: "レビュー待ちの投稿はありません",
    noPendingDesc: "自動投稿がオフのアカウントからの投稿がここに表示されます",
    filterLabel: "フィルター：",
    allAccounts: "すべてのアカウント",
    selectAll: "すべて選択",
    publishing: "投稿中...",
    publishSelected: "選択した投稿を公開",
    discard: "破棄",
    discardTitle: "下書きを破棄",
    publishedCount: (s: number, f: number) => `${s} 件公開済み、${f} 件失敗`,
    batchFailed: "一括投稿に失敗しました。",
    networkErrorBatch: "一括投稿中にネットワークエラーが発生しました。",
    filterByAccount: "アカウントでフィルター：",
    refresh: "更新",
    noPostsYet: "投稿はまだありません",
    viewPost: "投稿を表示",
    insights: "インサイト",
    hide: "非表示",
    loadingInsights: "インサイトを読み込み中...",
    insightsError: "エラー：",
    refreshInsights: "更新",
    metricViews: "表示回数",
    metricLikes: "いいね",
    metricReplies: "返信",
    metricReposts: "リポスト",
    metricQuotes: "引用",
    statusPublished: "公開済み",
    statusDraft: "下書き",
    statusPending: "保留中",
    statusFailed: "失敗",
  },
};

type LangKey = keyof typeof T;
type Translations = (typeof T)[LangKey];

interface Account {
  id: string;
  name: string;
  handle: string;
  platform: string;
  token: string;
  user_id: string;
  style: string;
  persona_prompt: string;
  auto_publish: number;
}

interface Post {
  id: string;
  session_id: string | null;
  platform: string;
  account: string;
  content: string;
  image_url: string | null;
  post_id: string | null;
  post_url: string | null;
  status: string;
  created_at: string;
  // enriched fields for pending
  account_name?: string;
  account_handle?: string;
}

interface Insights {
  views: number;
  likes: number;
  replies: number;
  reposts: number;
  quotes: number;
}

type Tab = "accounts" | "review" | "history";

const EMPTY_ACCOUNT: Omit<Account, "id"> = {
  name: "",
  handle: "",
  platform: "threads",
  token: "",
  user_id: "",
  style: "",
  persona_prompt: "",
  auto_publish: 0,
};

// --- Sub-components ---

function StatusBadge({ status, t }: { status: string; t: Translations }) {
  const styles: Record<string, string> = {
    published: "bg-green-100 text-green-700",
    draft: "bg-amber-100 text-amber-700",
    pending: "bg-blue-100 text-blue-700",
    failed: "bg-red-100 text-red-700",
  };
  const labels: Record<string, string> = {
    published: t.statusPublished,
    draft: t.statusDraft,
    pending: t.statusPending,
    failed: t.statusFailed,
  };
  return (
    <span
      className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${styles[status] || "bg-gray-100 text-gray-600"}`}
    >
      {labels[status] || status}
    </span>
  );
}

function InsightsPanel({ postId, t }: { postId: string; t: Translations }) {
  const [insights, setInsights] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fetchInsights = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/publish/history/${postId}/insights`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setInsights(await res.json());
    } catch (e) {
      setError((e as Error).message);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchInsights();
  }, [postId]);

  if (loading) return <div className="text-xs text-gray-400 py-2">{t.loadingInsights}</div>;
  if (error)
    return (
      <div className="text-xs text-red-500 py-2">
        {t.insightsError}
        {error}
      </div>
    );
  if (!insights) return null;

  const metrics = [
    { label: t.metricViews, value: insights.views, icon: "👁" },
    { label: t.metricLikes, value: insights.likes, icon: "❤️" },
    { label: t.metricReplies, value: insights.replies, icon: "💬" },
    { label: t.metricReposts, value: insights.reposts, icon: "🔁" },
    { label: t.metricQuotes, value: insights.quotes, icon: "📝" },
  ];

  return (
    <div className="flex gap-4 py-2">
      {metrics.map((m) => (
        <div key={m.label} className="text-center">
          <div className="text-lg font-semibold text-gray-800 dark:text-gray-100">
            {m.value.toLocaleString()}
          </div>
          <div className="text-[10px] text-gray-500 dark:text-gray-400">
            {m.icon} {m.label}
          </div>
        </div>
      ))}
      <button
        onClick={fetchInsights}
        className="self-center text-[10px] text-blue-500 hover:text-blue-700 ml-2"
      >
        {t.refreshInsights}
      </button>
    </div>
  );
}

function PostRow({ post, showAccount, t }: { post: Post; showAccount?: boolean; t: Translations }) {
  const [showInsights, setShowInsights] = useState(false);

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {showAccount && post.account_name && (
            <div className="text-[10px] text-gray-400 dark:text-gray-500 mb-1">
              {post.account_handle || post.account_name}
            </div>
          )}
          <p className="text-sm text-gray-800 dark:text-gray-100 whitespace-pre-wrap break-words line-clamp-3">
            {post.content}
          </p>
          <div className="flex items-center gap-2 mt-1.5">
            <StatusBadge status={post.status} t={t} />
            <span className="text-[10px] text-gray-400">
              {new Date(post.created_at).toLocaleString()}
            </span>
            {post.post_url && (
              <a
                href={post.post_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-blue-500 hover:underline"
              >
                {t.viewPost}
              </a>
            )}
          </div>
        </div>
        {post.status === "published" && post.post_id && (
          <button
            onClick={() => setShowInsights(!showInsights)}
            className="text-xs px-2 py-1 border border-gray-200 rounded hover:bg-gray-50 text-gray-600 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800 shrink-0"
          >
            {showInsights ? t.hide : t.insights}
          </button>
        )}
      </div>
      {showInsights && post.post_id && <InsightsPanel postId={post.id} t={t} />}
    </div>
  );
}

// --- Account Edit Form ---

function AccountForm({
  account,
  isNew,
  onSave,
  onCancel,
  t,
}: {
  account: Account;
  isNew: boolean;
  onSave: (data: Account) => Promise<void>;
  onCancel: () => void;
  t: Translations;
}) {
  const [form, setForm] = useState(account);
  const [saving, setSaving] = useState(false);

  // Resync local state when editing a different account
  useEffect(() => {
    setForm(account);
  }, [account?.id]);

  const handleSave = async () => {
    if (!form.name || !form.handle) return;
    setSaving(true);
    await onSave(form);
    setSaving(false);
  };

  return (
    <div className="p-4 border border-blue-200 dark:border-blue-800 rounded-lg bg-blue-50/30 dark:bg-blue-950/20 space-y-3">
      <div className="text-sm font-medium text-gray-700 dark:text-gray-200">
        {isNew ? t.newAccount : `${t.editAccount}${account.handle}`}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">
            {t.fieldName}
          </label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Claude World Taiwan"
            className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">
            {t.fieldHandle}
          </label>
          <input
            type="text"
            value={form.handle}
            onChange={(e) => setForm({ ...form, handle: e.target.value })}
            placeholder="@your.account"
            className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">
            {t.fieldPlatform}
          </label>
          <select
            value={form.platform}
            onChange={(e) => setForm({ ...form, platform: e.target.value })}
            className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded text-sm"
          >
            <option value="threads">Threads</option>
            <option value="instagram">Instagram</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">
            {t.fieldStyle}
          </label>
          <input
            type="text"
            value={form.style}
            onChange={(e) => setForm({ ...form, style: e.target.value })}
            placeholder="tech-educator, futurist..."
            className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">
            {isNew ? t.fieldToken : t.fieldTokenKeep}
          </label>
          <input
            type="password"
            value={form.token}
            onChange={(e) => setForm({ ...form, token: e.target.value })}
            placeholder="API token"
            className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded text-sm font-mono"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">
            {t.fieldUserId}
          </label>
          <input
            type="text"
            value={form.user_id}
            onChange={(e) => setForm({ ...form, user_id: e.target.value })}
            placeholder="your-threads-user-id"
            className="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded text-sm font-mono"
          />
        </div>
      </div>
      <div>
        <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">
          {t.fieldPersonaPrompt}
        </label>
        <textarea
          value={form.persona_prompt}
          onChange={(e) => setForm({ ...form, persona_prompt: e.target.value })}
          rows={3}
          placeholder={t.placeholderPersona}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded text-sm resize-none"
        />
      </div>
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={!form.name || !form.handle || saving}
          className="text-xs px-4 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40"
        >
          {saving ? t.saving : isNew ? t.create : t.update}
        </button>
        <button
          onClick={onCancel}
          className="text-xs px-3 py-1.5 border border-gray-200 rounded hover:bg-gray-50 text-gray-600 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800"
        >
          {t.cancel}
        </button>
      </div>
    </div>
  );
}

// --- Main Page ---

export function SocialAccountsPage({
  onClose,
  language,
}: {
  onClose: () => void;
  language?: "zh-TW" | "en" | "ja";
}) {
  const t = T[(language ?? "en") as LangKey];
  const [tab, setTab] = useState<Tab>("accounts");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [editing, setEditing] = useState<Account | null>(null);
  const [isNew, setIsNew] = useState(false);

  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Accounts tab filter
  const [platformFilter, setPlatformFilter] = useState<"all" | "threads" | "instagram">("all");

  // Review queue
  const [pendingPosts, setPendingPosts] = useState<Post[]>([]);
  const [reviewFilter, setReviewFilter] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [publishing, setPublishing] = useState(false);

  // History
  const [historyAccount, setHistoryAccount] = useState<string>("all");
  const [posts, setPosts] = useState<Post[]>([]);

  const fetchAccounts = useCallback(() => {
    fetch("/api/accounts")
      .then((r) => (r.ok ? r.json() : []))
      .then(setAccounts)
      .catch(() => {});
  }, []);

  const fetchPending = useCallback(() => {
    fetch("/api/publish/pending")
      .then((r) => (r.ok ? r.json() : []))
      .then(setPendingPosts)
      .catch(() => {});
  }, []);

  const fetchHistory = useCallback((accountId: string) => {
    const url =
      accountId === "all"
        ? "/api/publish/history?limit=200"
        : `/api/accounts/${accountId}/posts?limit=200`;
    fetch(url)
      .then((r) => (r.ok ? r.json() : []))
      .then(setPosts)
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);
  useEffect(() => {
    if (tab === "review") fetchPending();
  }, [tab, fetchPending]);
  useEffect(() => {
    if (tab === "history") fetchHistory(historyAccount);
  }, [tab, historyAccount, fetchHistory]);

  // --- Account actions ---

  const handleSaveAccount = async (data: Account) => {
    const url = isNew ? "/api/accounts" : `/api/accounts/${data.id}`;
    const method = isNew ? "POST" : "PUT";
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        setEditing(null);
        setIsNew(false);
        fetchAccounts();
        setNotice({ type: "success", text: t.accountSaved });
      } else {
        const err = await res.json().catch(() => ({}));
        setNotice({ type: "error", text: err.error || t.accountSaveFailed });
      }
    } catch {
      setNotice({ type: "error", text: t.networkErrorSave });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/accounts/${id}`, { method: "DELETE" });
      if (res.ok) fetchAccounts();
    } catch {}
  };

  const handleToggleAutoPublish = async (id: string, current: number) => {
    try {
      const res = await fetch(`/api/accounts/${id}/auto-publish`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auto_publish: !current }),
      });
      if (res.ok) fetchAccounts();
    } catch {}
  };

  // --- Review queue actions ---

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filteredAccounts =
    platformFilter === "all" ? accounts : accounts.filter((a) => a.platform === platformFilter);
  const filteredPending =
    reviewFilter === "all" ? pendingPosts : pendingPosts.filter((p) => p.account === reviewFilter);

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredPending.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredPending.map((p) => p.id)));
    }
  };

  const handleBatchPublish = async () => {
    if (selectedIds.size === 0) return;
    // Only publish IDs visible in the current filter
    const visibleIds = new Set(filteredPending.map((p) => p.id));
    const idsToPublish = [...selectedIds].filter((id) => visibleIds.has(id));
    if (idsToPublish.length === 0) return;
    setPublishing(true);
    try {
      const res = await fetch("/api/publish/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: idsToPublish }),
      });
      if (res.ok) {
        const data = await res.json();
        const succeeded = data.results?.filter((r: any) => r.success).length ?? 0;
        const failed = data.results?.filter((r: any) => !r.success).length ?? 0;
        setNotice({
          type: failed > 0 ? "error" : "success",
          text: t.publishedCount(succeeded, failed),
        });
      } else {
        const err = await res.json().catch(() => ({}));
        setNotice({ type: "error", text: err.error || t.batchFailed });
      }
      setSelectedIds(new Set());
      fetchPending();
    } catch {
      setNotice({ type: "error", text: t.networkErrorBatch });
    }
    setPublishing(false);
  };

  const handleDiscardDraft = async (id: string) => {
    try {
      await fetch(`/api/publish/${id}/discard`, { method: "POST" });
      fetchPending();
    } catch {}
  };

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "accounts", label: t.tabAccounts, count: accounts.length },
    { key: "review", label: t.tabReview, count: pendingPosts.length },
    { key: "history", label: t.tabHistory },
  ];

  return (
    <div className="flex-1 flex flex-col bg-white dark:bg-gray-900 overflow-y-auto">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between sticky top-0 bg-white dark:bg-gray-900 z-10">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">{t.pageTitle}</h2>
          <div className="flex gap-1">
            {tabs.map((tab_item) => (
              <button
                key={tab_item.key}
                onClick={() => setTab(tab_item.key)}
                className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors ${
                  tab === tab_item.key
                    ? "bg-blue-600 text-white"
                    : "text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-800"
                }`}
              >
                {tab_item.label}
                {tab_item.count !== undefined && tab_item.count > 0 && (
                  <span
                    className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] ${
                      tab === tab_item.key
                        ? "bg-blue-500 text-white"
                        : "bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400"
                    }`}
                  >
                    {tab_item.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          {t.backToChat}
        </button>
      </div>

      <div className="p-6 max-w-3xl">
        {/* Notice banner */}
        {notice && (
          <div
            className={`mb-4 px-3 py-2 rounded-lg text-xs flex items-center justify-between ${
              notice.type === "success"
                ? "bg-green-50 border border-green-200 text-green-700 dark:bg-green-950 dark:border-green-800 dark:text-green-400"
                : "bg-red-50 border border-red-200 text-red-700 dark:bg-red-950 dark:border-red-800 dark:text-red-400"
            }`}
          >
            <span>{notice.text}</span>
            <button
              onClick={() => setNotice(null)}
              className="text-gray-400 hover:text-gray-600 ml-2"
            >
              x
            </button>
          </div>
        )}

        {/* ===== Accounts Tab ===== */}
        {tab === "accounts" && (
          <div className="space-y-4">
            {/* Toolbar: filter pills + add button */}
            <div className="flex items-center justify-between">
              <div className="flex gap-1">
                {(["all", "threads", "instagram"] as const).map((f) => {
                  const count =
                    f === "all" ? accounts.length : accounts.filter((a) => a.platform === f).length;
                  return (
                    <button
                      key={f}
                      onClick={() => setPlatformFilter(f)}
                      className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${
                        platformFilter === f
                          ? "bg-blue-600 text-white"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
                      }`}
                    >
                      {f === "all" ? t.filterAll : f.charAt(0).toUpperCase() + f.slice(1)} ({count})
                    </button>
                  );
                })}
              </div>
              <button
                onClick={() => {
                  setEditing({ id: "", ...EMPTY_ACCOUNT });
                  setIsNew(true);
                }}
                className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium"
              >
                {t.addAccount}
              </button>
            </div>

            {filteredAccounts.length === 0 && !editing && (
              <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">
                {accounts.length === 0 ? t.noAccountsYet : t.noAccountsMatch}
              </p>
            )}

            {filteredAccounts.map((a) => {
              // Server masks tokens: "" = none, "***" = short token, "xxxx...xxxx" = real token
              const hasToken = a.token === "***" || a.token.includes("...");
              const hasUserId = a.user_id !== "";
              const healthColor = !hasToken
                ? "bg-red-500"
                : a.platform === "threads" && !hasUserId
                  ? "bg-amber-500"
                  : "bg-green-500";

              return (
                <div
                  key={a.id}
                  className="border border-gray-200 dark:border-gray-700 rounded-lg p-4"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {/* Avatar with health dot */}
                      <div className="relative">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white text-sm font-bold">
                          {a.handle.replace("@", "").charAt(0).toUpperCase()}
                        </div>
                        <span
                          className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white dark:border-gray-900 ${healthColor}`}
                        />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                            {a.handle}
                          </span>
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${a.platform === "threads" ? "bg-gray-100 text-gray-600" : "bg-pink-50 text-pink-600"}`}
                          >
                            {a.platform}
                          </span>
                          {a.style && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">
                              {a.style}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-400 dark:text-gray-500">{a.name}</div>
                        {/* Persona preview */}
                        {a.persona_prompt ? (
                          <div className="text-xs text-gray-400 dark:text-gray-500 italic mt-0.5 max-w-md truncate">
                            {a.persona_prompt.slice(0, 80)}
                            {a.persona_prompt.length > 80 ? "..." : ""}
                          </div>
                        ) : (
                          <div className="text-[10px] text-amber-500 mt-0.5">{t.noPersona}</div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {/* Auto-publish toggle */}
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {t.autoPublish}
                        </span>
                        <button
                          onClick={() => handleToggleAutoPublish(a.id, a.auto_publish)}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${a.auto_publish ? "bg-green-500" : "bg-gray-300 dark:bg-gray-600"}`}
                        >
                          <span
                            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${a.auto_publish ? "translate-x-4" : "translate-x-0.5"}`}
                          />
                        </button>
                      </div>
                      <div className="relative">
                        <button
                          onClick={() => {
                            setEditing({ ...a, token: "" });
                            setIsNew(false);
                          }}
                          className="text-xs px-2 py-1 border border-gray-200 rounded hover:bg-gray-50 text-gray-600 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800"
                        >
                          {t.edit}
                        </button>
                        {!hasToken && (
                          <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 text-white text-[8px] flex items-center justify-center font-bold">
                            !
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => handleDelete(a.id)}
                        className="text-xs px-2 py-1 text-red-500 hover:bg-red-50 rounded"
                      >
                        {t.delete}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}

            {editing && (
              <AccountForm
                account={editing}
                isNew={isNew}
                onSave={handleSaveAccount}
                onCancel={() => {
                  setEditing(null);
                  setIsNew(false);
                }}
                t={t}
              />
            )}
          </div>
        )}

        {/* ===== Review Queue Tab ===== */}
        {tab === "review" && (
          <div className="space-y-4">
            {pendingPosts.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-3xl mb-3">&#9989;</div>
                <p className="text-sm text-gray-500 dark:text-gray-400">{t.noPendingTitle}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{t.noPendingDesc}</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {/* Account filter */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {t.filterLabel}
                      </span>
                      <select
                        value={reviewFilter}
                        onChange={(e) => {
                          setReviewFilter(e.target.value);
                          setSelectedIds(new Set());
                        }}
                        className="text-xs px-2 py-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded"
                      >
                        <option value="all">{t.allAccounts}</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.handle} ({a.platform})
                          </option>
                        ))}
                      </select>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={
                          filteredPending.length > 0 && selectedIds.size === filteredPending.length
                        }
                        onChange={toggleSelectAll}
                        className="rounded"
                      />
                      {t.selectAll} ({filteredPending.length})
                    </label>
                  </div>
                  <button
                    onClick={handleBatchPublish}
                    disabled={selectedIds.size === 0 || publishing}
                    className="text-xs px-4 py-1.5 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-40 font-medium"
                  >
                    {publishing ? t.publishing : `${t.publishSelected} (${selectedIds.size})`}
                  </button>
                </div>

                <div className="space-y-2">
                  {filteredPending.map((post) => (
                    <div key={post.id} className="flex gap-3 items-start">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(post.id)}
                        onChange={() => toggleSelect(post.id)}
                        className="mt-3 rounded"
                      />
                      <div className="flex-1">
                        <PostRow post={post} showAccount t={t} />
                      </div>
                      <button
                        onClick={() => handleDiscardDraft(post.id)}
                        className="mt-2 text-[10px] text-red-400 hover:text-red-600 shrink-0"
                        title={t.discardTitle}
                      >
                        {t.discard}
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ===== Post History Tab ===== */}
        {tab === "history" && (
          <div className="space-y-4">
            {/* Account filter */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 dark:text-gray-400">{t.filterByAccount}</span>
              <select
                value={historyAccount}
                onChange={(e) => setHistoryAccount(e.target.value)}
                className="text-xs px-2 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded"
              >
                <option value="all">{t.allAccounts}</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.handle} ({a.platform})
                  </option>
                ))}
              </select>
              <button
                onClick={() => fetchHistory(historyAccount)}
                className="text-xs text-blue-500 hover:text-blue-700"
              >
                {t.refresh}
              </button>
            </div>

            {posts.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">
                {t.noPostsYet}
              </p>
            ) : (
              <div className="space-y-2">
                {posts.map((post) => (
                  <PostRow key={post.id} post={post} showAccount={historyAccount === "all"} t={t} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
