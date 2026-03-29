import { useState, useEffect, useCallback } from "react";
import type { Language } from "../App";

interface OverviewData {
  total_posts: number;
  published_posts: number;
  posts_with_link: number;
  posts_without_link: number;
  total_views: number;
  total_likes: number;
  total_replies: number;
  total_reposts: number;
  total_quotes: number;
  engagement_rate: number;
  per_account: Array<{
    account_id: string;
    name: string;
    handle: string;
    post_count: number;
    total_views: number;
    total_engagement: number;
  }>;
  top_posts: Array<{
    id: string;
    content: string;
    account: string;
    created_at: string;
    handle: string;
    views: number;
    likes: number;
    replies: number;
    reposts: number;
    quotes: number;
  }>;
  daily_counts: Array<{
    date: string;
    post_count: number;
    total_views: number;
  }>;
}

interface ContentAnalysis {
  image_vs_text: Array<{
    type: string;
    count: number;
    avg_views: number;
    avg_likes: number;
    avg_replies: number;
  }>;
  link_vs_no_link: Array<{
    type: string;
    count: number;
    avg_views: number;
    avg_likes: number;
    avg_replies: number;
  }>;
  hour_performance: Array<{
    hour: number;
    count: number;
    avg_views: number;
    avg_engagement: number;
  }>;
  day_performance: Array<{ day: number; count: number; avg_views: number; avg_engagement: number }>;
}

const T = {
  "zh-TW": {
    title: "流量戰略",
    back: "返回",
    refresh: "刷新",
    refreshing: "刷新中...",
    days7: "7天",
    days14: "14天",
    days30: "30天",
    totalPosts: "總文章數",
    published: "已發布",
    totalViews: "總觀看數",
    engagementRate: "互動率",
    linkCoverage: "來源覆蓋",
    perAccountTitle: "帳號比較",
    account: "帳號",
    posts: "文章",
    views: "觀看",
    engagement: "互動",
    engRate: "互動率",
    strategyTitle: "內容策略分析",
    imageVsText: "圖文 vs 純文字",
    linkImpact: "來源連結影響",
    bestHour: "最佳發文時段",
    bestDay: "最佳發文日",
    avgViews: "平均觀看",
    topPostsTitle: "熱門文章 Top 5",
    trendTitle: "趨勢",
    postCount: "發文數",
    noData: "尚無數據",
    sun: "日",
    mon: "一",
    tue: "二",
    wed: "三",
    thu: "四",
    fri: "五",
    sat: "六",
  },
  en: {
    title: "Traffic Strategy",
    back: "Back",
    refresh: "Refresh",
    refreshing: "Refreshing...",
    days7: "7D",
    days14: "14D",
    days30: "30D",
    totalPosts: "Total Posts",
    published: "Published",
    totalViews: "Total Views",
    engagementRate: "Engagement Rate",
    linkCoverage: "Link Coverage",
    perAccountTitle: "Account Comparison",
    account: "Account",
    posts: "Posts",
    views: "Views",
    engagement: "Engagement",
    engRate: "Eng. Rate",
    strategyTitle: "Content Strategy",
    imageVsText: "Image vs Text-only",
    linkImpact: "Source Link Impact",
    bestHour: "Best Posting Hour",
    bestDay: "Best Posting Day",
    avgViews: "Avg Views",
    topPostsTitle: "Top 5 Posts",
    trendTitle: "Trend",
    postCount: "Posts",
    noData: "No data yet",
    sun: "Sun",
    mon: "Mon",
    tue: "Tue",
    wed: "Wed",
    thu: "Thu",
    fri: "Fri",
    sat: "Sat",
  },
  ja: {
    title: "トラフィック戦略",
    back: "戻る",
    refresh: "更新",
    refreshing: "更新中...",
    days7: "7日",
    days14: "14日",
    days30: "30日",
    totalPosts: "総投稿数",
    published: "公開済",
    totalViews: "総閲覧数",
    engagementRate: "エンゲージメント率",
    linkCoverage: "ソースカバレッジ",
    perAccountTitle: "アカウント比較",
    account: "アカウント",
    posts: "投稿",
    views: "閲覧",
    engagement: "エンゲージメント",
    engRate: "率",
    strategyTitle: "コンテンツ戦略",
    imageVsText: "画像 vs テキスト",
    linkImpact: "ソースリンクの影響",
    bestHour: "最適投稿時間",
    bestDay: "最適投稿日",
    avgViews: "平均閲覧",
    topPostsTitle: "人気投稿 Top 5",
    trendTitle: "トレンド",
    postCount: "投稿数",
    noData: "データなし",
    sun: "日",
    mon: "月",
    tue: "火",
    wed: "水",
    thu: "木",
    fri: "金",
    sat: "土",
  },
};

function compact(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

function pctDiff(a: number, b: number): string {
  if (b === 0) return a > 0 ? "+∞" : "0%";
  const diff = ((a - b) / b) * 100;
  return `${diff >= 0 ? "+" : ""}${Math.round(diff)}%`;
}

export function TrafficDashboardPage({
  onClose,
  language = "zh-TW",
}: {
  onClose: () => void;
  language?: Language;
}) {
  const t = T[language] || T["zh-TW"];
  const dayNames = [t.sun, t.mon, t.tue, t.wed, t.thu, t.fri, t.sat];

  const [days, setDays] = useState(30);
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [analysis, setAnalysis] = useState<ContentAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [ovRes, anRes] = await Promise.all([
        fetch(`/api/publish/analytics/overview?days=${days}`),
        fetch(`/api/publish/analytics/content-analysis?days=${days}`),
      ]);
      if (ovRes.ok) setOverview(await ovRes.json());
      if (anRes.ok) setAnalysis(await anRes.json());
    } catch {
      /* ignore */
    }
    setLoading(false);
  }, [days]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const postsRes = await fetch("/api/publish/posts-detail?limit=200");
      if (postsRes.ok) {
        const posts = await postsRes.json();
        const staleThreshold = Date.now() - 6 * 3600000;
        const ids = posts
          .filter(
            (p: any) =>
              p.status === "published" &&
              p.post_id &&
              (!p.insights_fetched_at || new Date(p.insights_fetched_at).getTime() < staleThreshold)
          )
          .map((p: any) => p.id)
          .slice(0, 20);
        if (ids.length > 0) {
          await fetch("/api/publish/refresh-insights", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids }),
          });
        }
      }
    } catch {
      /* ignore */
    }
    await fetchData();
    setRefreshing(false);
  };

  const engRateColor = (rate: number) => {
    if (rate >= 0.03) return "text-green-500";
    if (rate >= 0.01) return "text-yellow-500";
    return "text-red-400";
  };

  const linkCoveragePct = overview
    ? overview.total_posts > 0
      ? Math.round((overview.posts_with_link / overview.total_posts) * 100)
      : 0
    : 0;

  // Strategy insights helpers
  const imgData = analysis?.image_vs_text?.find((d) => d.type === "with_image");
  const txtData = analysis?.image_vs_text?.find((d) => d.type === "text_only");
  const linkData = analysis?.link_vs_no_link?.find((d) => d.type === "with_link");
  const noLinkData = analysis?.link_vs_no_link?.find((d) => d.type === "no_link");
  const bestHour = analysis?.hour_performance?.length
    ? analysis.hour_performance.reduce((a, b) => (b.avg_views > a.avg_views ? b : a))
    : null;
  const bestDayEntry = analysis?.day_performance?.length
    ? analysis.day_performance.reduce((a, b) => (b.avg_views > a.avg_views ? b : a))
    : null;

  // Trend chart
  const maxPostCount = overview?.daily_counts?.length
    ? Math.max(...overview.daily_counts.map((d) => d.post_count), 1)
    : 1;

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white dark:bg-gray-950">
        <svg className="w-6 h-6 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24">
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-white dark:bg-gray-950 overflow-hidden">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white dark:bg-gray-950 border-b border-gray-200 dark:border-gray-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              aria-label={t.back}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </button>
            <h1 className="text-lg font-bold text-gray-900 dark:text-white">{t.title}</h1>
          </div>
          <div className="flex items-center gap-2">
            {/* Days selector */}
            <div className="flex rounded-lg border border-gray-300 dark:border-gray-700 overflow-hidden">
              {([7, 14, 30] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  className={`text-xs px-3 py-1.5 transition-colors ${
                    days === d
                      ? "bg-blue-600 text-white"
                      : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                  }`}
                >
                  {d === 7 ? t.days7 : d === 14 ? t.days14 : t.days30}
                </button>
              ))}
            </div>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white transition-colors"
            >
              {refreshing ? t.refreshing : t.refresh}
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {!overview ? (
          <div className="text-center py-20 text-gray-400 text-sm">{t.noData}</div>
        ) : (
          <>
            {/* Section 1: Overview Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <OverviewCard
                label={t.totalPosts}
                value={String(overview.published_posts)}
                sub={`/ ${overview.total_posts} ${t.totalPosts.toLowerCase()}`}
                borderColor="border-blue-500"
              />
              <OverviewCard
                label={t.totalViews}
                value={compact(overview.total_views)}
                sub={`${compact(overview.total_likes)} likes`}
                borderColor="border-green-500"
              />
              <OverviewCard
                label={t.engagementRate}
                value={`${(overview.engagement_rate * 100).toFixed(1)}%`}
                sub=""
                borderColor="border-yellow-500"
                valueClass={engRateColor(overview.engagement_rate)}
              />
              <OverviewCard
                label={t.linkCoverage}
                value={`${linkCoveragePct}%`}
                sub={`${overview.posts_with_link}/${overview.total_posts}`}
                borderColor="border-purple-500"
                valueClass={
                  linkCoveragePct >= 80
                    ? "text-green-500"
                    : linkCoveragePct >= 50
                      ? "text-yellow-500"
                      : "text-red-400"
                }
              />
            </div>

            {/* Section 2: Per-Account Comparison */}
            {overview.per_account.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                  {t.perAccountTitle}
                </h2>
                <div className="rounded-lg border border-gray-200 dark:border-gray-800 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 text-xs">
                        <th className="text-left px-4 py-2 font-medium">{t.account}</th>
                        <th className="text-right px-4 py-2 font-medium">{t.posts}</th>
                        <th className="text-right px-4 py-2 font-medium">{t.views}</th>
                        <th className="text-right px-4 py-2 font-medium">{t.engagement}</th>
                        <th className="text-right px-4 py-2 font-medium">{t.engRate}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview.per_account.map((a) => {
                        const rate = a.total_views > 0 ? a.total_engagement / a.total_views : 0;
                        return (
                          <tr
                            key={a.account_id}
                            className="border-t border-gray-100 dark:border-gray-800"
                          >
                            <td className="px-4 py-2.5 text-gray-800 dark:text-gray-200 font-medium">
                              @{a.handle}
                            </td>
                            <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-400">
                              {a.post_count}
                            </td>
                            <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-400">
                              {compact(a.total_views)}
                            </td>
                            <td className="px-4 py-2.5 text-right text-gray-600 dark:text-gray-400">
                              {compact(a.total_engagement)}
                            </td>
                            <td
                              className={`px-4 py-2.5 text-right font-medium ${engRateColor(rate)}`}
                            >
                              {(rate * 100).toFixed(1)}%
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Section 3: Content Strategy Insights */}
            {analysis && (
              <div>
                <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                  {t.strategyTitle}
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Image vs Text */}
                  <InsightCard
                    icon="&#x1f4ca;"
                    title={t.imageVsText}
                    content={
                      imgData && txtData ? (
                        <div className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
                          <div>
                            Image: {compact(imgData.avg_views)} {t.avgViews} ({imgData.count} posts)
                          </div>
                          <div>
                            Text: {compact(txtData.avg_views)} {t.avgViews} ({txtData.count} posts)
                          </div>
                          <div className="font-medium text-gray-700 dark:text-gray-300">
                            {pctDiff(imgData.avg_views, txtData.avg_views)} views
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">{t.noData}</span>
                      )
                    }
                  />

                  {/* Link impact */}
                  <InsightCard
                    icon="&#x1f517;"
                    title={t.linkImpact}
                    content={
                      linkData && noLinkData ? (
                        <div className="space-y-1 text-xs text-gray-500 dark:text-gray-400">
                          <div>
                            With link: {compact(linkData.avg_views)} {t.avgViews} ({linkData.count}{" "}
                            posts)
                          </div>
                          <div>
                            No link: {compact(noLinkData.avg_views)} {t.avgViews} (
                            {noLinkData.count} posts)
                          </div>
                          <div className="font-medium text-gray-700 dark:text-gray-300">
                            {pctDiff(linkData.avg_views, noLinkData.avg_views)} views
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">{t.noData}</span>
                      )
                    }
                  />

                  {/* Best hour */}
                  <InsightCard
                    icon="&#x23f0;"
                    title={t.bestHour}
                    content={
                      bestHour ? (
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          <span className="text-lg font-bold text-gray-800 dark:text-gray-200">
                            {String(bestHour.hour).padStart(2, "0")}:00
                          </span>
                          <span className="ml-2">
                            {compact(bestHour.avg_views)} {t.avgViews}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">{t.noData}</span>
                      )
                    }
                  />

                  {/* Best day */}
                  <InsightCard
                    icon="&#x1f4c5;"
                    title={t.bestDay}
                    content={
                      bestDayEntry ? (
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          <span className="text-lg font-bold text-gray-800 dark:text-gray-200">
                            {dayNames[bestDayEntry.day]}
                          </span>
                          <span className="ml-2">
                            {compact(bestDayEntry.avg_views)} {t.avgViews}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">{t.noData}</span>
                      )
                    }
                  />
                </div>
              </div>
            )}

            {/* Section 4: Top 5 Posts */}
            {overview.top_posts.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                  {t.topPostsTitle}
                </h2>
                <div className="space-y-2">
                  {overview.top_posts.map((post, i) => (
                    <div
                      key={post.id}
                      className="flex items-center gap-3 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 px-4 py-3"
                    >
                      <span className="text-lg font-bold text-gray-300 dark:text-gray-600 w-6 text-center shrink-0">
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-800 dark:text-gray-200 truncate">
                          {post.content}
                        </p>
                        <span className="text-[10px] text-gray-400">@{post.handle}</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 shrink-0">
                        <span>&#x1f441; {compact(post.views)}</span>
                        <span>&#x2764;&#xfe0f; {compact(post.likes)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Section 5: Trend Bar Chart */}
            {overview.daily_counts.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                  {t.trendTitle}
                </h2>
                <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 p-4">
                  <div className="flex items-end gap-1 h-32">
                    {overview.daily_counts.map((day, i) => {
                      const pct = (day.post_count / maxPostCount) * 100;
                      return (
                        <div
                          key={day.date}
                          className="flex-1 flex flex-col items-center justify-end group relative"
                        >
                          <div
                            className="w-full bg-blue-500 rounded-t transition-all hover:bg-blue-400 min-h-[2px]"
                            style={{ height: `${Math.max(pct, 2)}%` }}
                            title={`${day.date}: ${day.post_count} ${t.postCount}, ${compact(day.total_views)} ${t.views.toLowerCase()}`}
                          />
                          {/* Show label for first, middle, last */}
                          {(i === 0 ||
                            i === overview.daily_counts.length - 1 ||
                            i === Math.floor(overview.daily_counts.length / 2)) && (
                            <span className="text-[9px] text-gray-400 mt-1 whitespace-nowrap">
                              {day.date.slice(5)}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function OverviewCard({
  label,
  value,
  sub,
  borderColor,
  valueClass,
}: {
  label: string;
  value: string;
  sub: string;
  borderColor: string;
  valueClass?: string;
}) {
  return (
    <div
      className={`rounded-lg border-l-4 ${borderColor} bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-4`}
    >
      <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</div>
      <div className={`text-2xl font-bold ${valueClass || "text-gray-900 dark:text-white"}`}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function InsightCard({
  icon,
  title,
  content,
}: {
  icon: string;
  title: string;
  content: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-base">{icon}</span>
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{title}</span>
      </div>
      {content}
    </div>
  );
}
