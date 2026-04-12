/**
 * Strategy Agent — Phase 3 analytics-driven content strategy (v2.0).
 *
 * Queries publish history + insights, cross-references long-term memory,
 * and returns a prioritized content calendar with recommendations.
 *
 * Exposed as the `run_strategy_agent` Studio MCP tool so Claude can invoke
 * it directly during a planning session.
 */

import store from "../db.js";
import { memoryService } from "./memory-service.js";
import { logger } from "../logger.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ContentCalendarEntry {
  /** ISO day-of-week string */
  day_label: string;
  /** Hour of day (0–23) */
  hour: number;
  /** Seed topic derived from top-performing posts */
  topic_seed: string;
  /** Recommended content format */
  format: string;
  /** Execution priority */
  priority: "high" | "medium" | "low";
}

export interface StrategyReport {
  period_days: number;
  total_published: number;
  engagement_rate_pct: number;
  top_formats: { format: string; avg_views: number; posts: number }[];
  best_hours: number[];
  topic_seeds: string[];
  past_successes: string[];
  content_calendar: ContentCalendarEntry[];
  recommendations: string[];
  generated_at: string;
}

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// ── StrategyAgent ─────────────────────────────────────────────────────────────

class StrategyAgent {
  /**
   * Run the full strategy analysis for an account.
   * Queries analytics, retrieves memory, builds calendar + recommendations.
   */
  runStrategy(params: {
    accountId?: string;
    days?: number;
    includeCalendar?: boolean;
  }): StrategyReport {
    const days = Math.min(params.days ?? 30, 365);

    const overview = store.getAnalyticsOverview(days, params.accountId);
    const contentAnalysis = store.getContentAnalysis(days);

    // ── Format performance ─────────────────────────────────────────────────
    const topFormats: { format: string; avg_views: number; posts: number }[] = [
      ...(contentAnalysis.image_vs_text || []),
    ]
      .sort((a: any, b: any) => b.avg_views - a.avg_views)
      .map((f: any) => ({
        format: String(f.type),
        avg_views: Math.round(f.avg_views),
        posts: Number(f.count),
      }));

    // ── Best posting hours (top 5 by avg engagement) ───────────────────────
    const bestHours: number[] = [...(contentAnalysis.hour_performance || [])]
      .sort((a: any, b: any) => b.avg_engagement - a.avg_engagement)
      .slice(0, 5)
      .map((h: any) => Number(h.hour));

    // ── Topic seeds from top-performing posts ──────────────────────────────
    const topPosts = ((overview.top_posts || []) as any[])
      .map((p) => String(p.content ?? "").slice(0, 100))
      .filter(Boolean);

    // ── Past successes from memory ─────────────────────────────────────────
    const successMems = memoryService.searchMemory("publish content post", {
      accountId: params.accountId,
      memoryType: "success",
      limit: 5,
    });
    const pastSuccesses = successMems.map((m) => m.content.slice(0, 120));

    // ── Build recommendations ──────────────────────────────────────────────
    const recommendations: string[] = [];

    if (topFormats[0]) {
      recommendations.push(
        `Prioritize ${topFormats[0].format} posts — avg ${topFormats[0].avg_views} views (${topFormats[0].posts} posts analyzed)`
      );
    }
    if (bestHours.length > 0) {
      recommendations.push(
        `Best posting times: ${bestHours
          .slice(0, 3)
          .map((h) => `${h}:00`)
          .join(", ")}`
      );
    }

    // Link vs no-link comparison — DB returns rows with type='with_link'|'no_link'
    const linkPerf = (contentAnalysis.link_vs_no_link || []) as any[];
    const withLink = linkPerf.find((l) => l.type === "with_link");
    const noLink = linkPerf.find((l) => l.type === "no_link");
    if (withLink && noLink) {
      const better = withLink.avg_views > noLink.avg_views ? "with link" : "without link";
      const winViews = Math.round(Math.max(withLink.avg_views, noLink.avg_views));
      recommendations.push(
        `Posts ${better} outperform (${winViews} avg views) — adjust link strategy accordingly`
      );
    }

    const engRate = Math.round((Number(overview.engagement_rate) || 0) * 10000) / 100;
    recommendations.push(
      engRate > 5
        ? `Engagement rate ${engRate}% — strong performance, maintain current strategy`
        : `Engagement rate ${engRate}% — add stronger CTAs and contrast hooks to boost replies`
    );

    // Best day recommendation
    const dayPerf = [...((contentAnalysis.day_performance || []) as any[])]
      .sort((a, b) => b.avg_engagement - a.avg_engagement)
      .slice(0, 2);
    if (dayPerf.length > 0) {
      // DB column is named 'day', not 'day_of_week'
      const bestDayLabels = dayPerf.map((d) => DAY_LABELS[Number(d.day)] || `Day ${d.day}`);
      recommendations.push(`Top posting days: ${bestDayLabels.join(" and ")}`);
    }

    // ── Build content calendar ─────────────────────────────────────────────
    const calendar: ContentCalendarEntry[] = [];
    if (params.includeCalendar !== false) {
      const sortedDays = [...((contentAnalysis.day_performance || []) as any[])].sort(
        (a, b) => b.avg_engagement - a.avg_engagement
      );

      const slots = bestHours.slice(0, 3);
      slots.forEach((hour, i) => {
        const dayEntry = sortedDays[i % sortedDays.length];
        const dayOfWeek = dayEntry ? Number(dayEntry.day) : (i * 2) % 7;
        calendar.push({
          day_label: DAY_LABELS[dayOfWeek],
          hour,
          topic_seed: topPosts[i] || `trending topic ${i + 1}`,
          format: topFormats[i % Math.max(topFormats.length, 1)]?.format || "text",
          priority: (["high", "medium", "low"] as const)[Math.min(i, 2)],
        });
      });
    }

    // ── Save strategy to memory for future recall ──────────────────────────
    if ((overview.published_posts || 0) > 0) {
      memoryService.saveMemory({
        accountId: params.accountId,
        content: `Content strategy (${days}d): ${overview.published_posts} posts, ${engRate}% engagement. Top format: ${topFormats[0]?.format || "text"}. Best hours: ${bestHours
          .slice(0, 3)
          .map((h) => `${h}:00`)
          .join(", ")}.`,
        tags: ["strategy", "analytics", "calendar"],
        memoryType: "success",
      });
    }

    logger.info(
      "StrategyAgent",
      `Strategy generated for ${params.accountId ? `account ${params.accountId}` : "all accounts"} over ${days} days`
    );

    return {
      period_days: days,
      total_published: Number(overview.published_posts) || 0,
      engagement_rate_pct: engRate,
      top_formats: topFormats,
      best_hours: bestHours,
      topic_seeds: topPosts.slice(0, 5),
      past_successes: pastSuccesses,
      content_calendar: calendar,
      recommendations,
      generated_at: new Date().toISOString(),
    };
  }
}

export const strategyAgent = new StrategyAgent();
export type { StrategyAgent };
