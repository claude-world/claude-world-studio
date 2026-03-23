import { useState, useEffect, useCallback } from "react";
import type { Language } from "../App";

interface PostWithInsights {
  id: string;
  platform: string;
  account: string;
  content: string;
  image_url: string | null;
  post_id: string | null;
  post_url: string | null;
  status: string;
  link_comment: string | null;
  source_url: string | null;
  created_at: string;
  views: number | null;
  likes: number | null;
  replies: number | null;
  reposts: number | null;
  quotes: number | null;
  insights_fetched_at: string | null;
  account_name: string;
  account_handle: string;
}

interface Account {
  id: string;
  name: string;
  handle: string;
  platform: string;
}

const T = {
  "zh-TW": {
    title: "文章管理",
    back: "返回",
    allAccounts: "所有帳號",
    filterAll: "全部",
    filterWithLink: "有來源連結",
    filterWithoutLink: "無來源連結",
    coverage: "來源覆蓋率",
    postsHaveSource: "篇有來源連結",
    noSourceLink: "無來源連結",
    sourceLink: "來源連結",
    refreshInsights: "刷新數據",
    refreshing: "刷新中...",
    noPosts: "尚無文章",
    viewPost: "查看貼文",
    published: "已發布",
    draft: "草稿",
    pending: "待發布",
    failed: "失敗",
    discarded: "已丟棄",
  },
  en: {
    title: "Posts Management",
    back: "Back",
    allAccounts: "All Accounts",
    filterAll: "All",
    filterWithLink: "With Source",
    filterWithoutLink: "Without Source",
    coverage: "Source Coverage",
    postsHaveSource: "posts have source link",
    noSourceLink: "No source link",
    sourceLink: "Source link",
    refreshInsights: "Refresh Insights",
    refreshing: "Refreshing...",
    noPosts: "No posts yet",
    viewPost: "View Post",
    published: "Published",
    draft: "Draft",
    pending: "Pending",
    failed: "Failed",
    discarded: "Discarded",
  },
  ja: {
    title: "投稿管理",
    back: "戻る",
    allAccounts: "全アカウント",
    filterAll: "全て",
    filterWithLink: "ソースあり",
    filterWithoutLink: "ソースなし",
    coverage: "ソースカバレッジ",
    postsHaveSource: "件がソースリンクあり",
    noSourceLink: "ソースリンクなし",
    sourceLink: "ソースリンク",
    refreshInsights: "データ更新",
    refreshing: "更新中...",
    noPosts: "投稿がありません",
    viewPost: "投稿を見る",
    published: "公開済",
    draft: "下書き",
    pending: "保留中",
    failed: "失敗",
    discarded: "破棄",
  },
};

function formatRelativeTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d`;
  return d.toLocaleDateString();
}

function compactNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

type LinkFilter = "all" | "with_link" | "without_link";

export function AccountPostsPage({ onClose, language = "zh-TW" }: { onClose: () => void; language?: Language }) {
  const t = T[language] || T["zh-TW"];
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [posts, setPosts] = useState<PostWithInsights[]>([]);
  const [selectedAccount, setSelectedAccount] = useState("all");
  const [linkFilter, setLinkFilter] = useState<LinkFilter>("all");
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    try {
      const url = selectedAccount === "all"
        ? "/api/publish/posts-detail?limit=200"
        : `/api/publish/accounts/${selectedAccount}/posts-detail?limit=200`;
      const res = await fetch(url);
      if (res.ok) setPosts(await res.json());
      else setPosts([]);
    } catch { setPosts([]); }
    setLoading(false);
  }, [selectedAccount]);

  useEffect(() => {
    fetch("/api/accounts").then((r) => r.ok ? r.json() : []).then(setAccounts).catch(() => {});
  }, []);

  useEffect(() => { fetchPosts(); }, [fetchPosts]);

  const filtered = posts.filter((p) => {
    if (linkFilter === "with_link") return p.link_comment;
    if (linkFilter === "without_link") return !p.link_comment;
    return true;
  });

  const publishedCount = posts.filter((p) => p.status === "published").length;
  const withLinkCount = posts.filter((p) => p.link_comment).length;
  const coveragePct = posts.length > 0 ? Math.round((withLinkCount / posts.length) * 100) : 0;

  const handleRefresh = async () => {
    setRefreshing(true);
    const staleThreshold = Date.now() - 6 * 3600000;
    const toRefresh = posts
      .filter((p) => p.status === "published" && p.post_id && (!p.insights_fetched_at || new Date(p.insights_fetched_at).getTime() < staleThreshold))
      .map((p) => p.id)
      .slice(0, 20);

    if (toRefresh.length > 0) {
      try {
        await fetch("/api/publish/refresh-insights", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: toRefresh }),
        });
      } catch { /* ignore */ }
    }
    await fetchPosts();
    setRefreshing(false);
  };

  const statusBadge = (status: string) => {
    const map: Record<string, { bg: string; text: string; label: string }> = {
      published: { bg: "bg-green-500/20", text: "text-green-400", label: t.published },
      draft: { bg: "bg-gray-500/20", text: "text-gray-400", label: t.draft },
      pending: { bg: "bg-yellow-500/20", text: "text-yellow-400", label: t.pending },
      failed: { bg: "bg-red-500/20", text: "text-red-400", label: t.failed },
      discarded: { bg: "bg-gray-500/20", text: "text-gray-500", label: t.discarded },
    };
    const s = map[status] || map.draft;
    return <span className={`text-[10px] px-1.5 py-0.5 rounded ${s.bg} ${s.text}`}>{s.label}</span>;
  };

  return (
    <div className="flex-1 flex flex-col bg-white dark:bg-gray-950 overflow-hidden">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800 px-6 py-4">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-lg font-bold text-gray-900 dark:text-white">{t.title}</h1>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 mt-3">
          <select
            value={selectedAccount}
            onChange={(e) => setSelectedAccount(e.target.value)}
            className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
          >
            <option value="all">{t.allAccounts}</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>@{a.handle}</option>
            ))}
          </select>

          <div className="flex rounded-lg border border-gray-300 dark:border-gray-700 overflow-hidden">
            {(["all", "with_link", "without_link"] as LinkFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setLinkFilter(f)}
                className={`text-xs px-3 py-1.5 transition-colors ${
                  linkFilter === f
                    ? "bg-blue-600 text-white"
                    : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                }`}
              >
                {f === "all" ? t.filterAll : f === "with_link" ? t.filterWithLink : t.filterWithoutLink}
              </button>
            ))}
          </div>
        </div>

        {/* Coverage bar */}
        <div className="mt-3 flex items-center gap-3">
          <div className="flex-1">
            <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
              <span>{t.coverage}: {withLinkCount}/{posts.length} {t.postsHaveSource}</span>
              <span>{coveragePct}%</span>
            </div>
            <div className="h-1.5 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${coveragePct >= 80 ? "bg-green-500" : coveragePct >= 50 ? "bg-yellow-500" : "bg-red-500"}`}
                style={{ width: `${coveragePct}%` }}
              />
            </div>
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white transition-colors whitespace-nowrap"
          >
            {refreshing ? t.refreshing : t.refreshInsights}
          </button>
        </div>
      </div>

      {/* Post list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-400">
            <svg className="w-5 h-5 animate-spin mr-2" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-gray-400 text-sm">{t.noPosts}</div>
        ) : (
          filtered.map((post) => (
            <div key={post.id} className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 p-4">
              {/* Top row: handle + date + status */}
              <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 mb-2">
                <span className="font-medium text-gray-700 dark:text-gray-300">@{post.account_handle}</span>
                <span>&middot;</span>
                <span>{formatRelativeTime(post.created_at)}</span>
                <span>&middot;</span>
                {statusBadge(post.status)}
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 capitalize">{post.platform}</span>
              </div>

              {/* Content preview */}
              <p className="text-sm text-gray-800 dark:text-gray-200 line-clamp-3 whitespace-pre-wrap mb-3">
                {post.content}
              </p>

              {/* Metrics row */}
              {post.views !== null && (
                <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400 mb-3">
                  <span title="Views">&#x1f441; {compactNumber(post.views ?? 0)}</span>
                  <span title="Likes">&#x2764;&#xfe0f; {compactNumber(post.likes ?? 0)}</span>
                  <span title="Replies">&#x1f4ac; {compactNumber(post.replies ?? 0)}</span>
                  <span title="Reposts">&#x1f501; {compactNumber(post.reposts ?? 0)}</span>
                  <span title="Quotes">&#x1f4dd; {compactNumber(post.quotes ?? 0)}</span>
                </div>
              )}

              {/* Link comment badge */}
              <div className="flex items-center justify-between">
                {post.link_comment ? (
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-green-500/10 text-green-500">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      {t.sourceLink}
                    </span>
                    <span className="text-gray-400 dark:text-gray-500 truncate max-w-[280px]" title={post.link_comment}>
                      {post.link_comment}
                    </span>
                  </div>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-red-500/10 text-red-400">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    {t.noSourceLink}
                  </span>
                )}

                {post.post_url && (
                  <a
                    href={post.post_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-500 hover:text-blue-400 transition-colors"
                  >
                    {t.viewPost} &rarr;
                  </a>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
