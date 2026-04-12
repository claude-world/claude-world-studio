import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import fs from "fs";
import path from "path";
import store from "../db.js";
import { getSettings } from "../mcp-config.js";
import { publishToThreads } from "./social-publisher.js";
import { memoryService } from "./memory-service.js";

const publishTool = tool(
  "publish_to_threads",
  "Publish content to Threads via Graph API. Quality gate: score >= 70 required. Supports: text, image, video, carousel (2-20 images/videos), poll, link-comment, topic-tag.",
  {
    text: z.string().describe("Post text content (max 500 chars)"),
    account_id: z.string().describe("Account ID from Social Accounts table"),
    score: z
      .number()
      .min(1)
      .describe("Content quality score (must be >= minimum threshold from settings)"),
    // Media (mutually exclusive: pick one)
    image_url: z.string().optional().describe("Public image URL (single image post)"),
    video_url: z.string().optional().describe("Public video URL (single video post)"),
    carousel_urls: z
      .array(z.string())
      .optional()
      .describe("2-20 public URLs for carousel. .mp4/.mov auto-detected as video."),
    // Attachments (TEXT-only posts, no media)
    poll_options: z
      .string()
      .optional()
      .describe("Poll options separated by | (2-4 options, max 25 chars each)"),
    gif_id: z.string().optional().describe("GIPHY GIF ID for GIF attachment"),
    link_attachment: z.string().optional().describe("URL for link preview card attachment"),
    // Spoiler
    spoiler_media: z.boolean().optional().describe("Blur image/video/carousel as spoiler"),
    // Special
    ghost: z.boolean().optional().describe("24-hour ephemeral post (disappears after 24h)"),
    quote_post_id: z.string().optional().describe("Quote another post by its ID"),
    // Content controls
    reply_control: z
      .string()
      .optional()
      .describe("Who can reply: everyone|accounts_you_follow|mentioned_only"),
    tag: z.string().optional().describe("Topic tag (no # prefix, one per post)"),
    alt_text: z.string().optional().describe("Image alt text for accessibility (max 1000 chars)"),
    link_comment: z
      .string()
      .optional()
      .describe("Auto-reply with this link (avoids reach penalty from URL in body)"),
  },
  async (args) => {
    const account = store.getAccount(args.account_id);
    if (!account) {
      return {
        content: [{ type: "text" as const, text: `Error: Account not found: ${args.account_id}` }],
        isError: true,
      };
    }
    if (!account.token) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: No token configured for account "${account.name}". Add token in Settings.`,
          },
        ],
        isError: true,
      };
    }
    if (account.platform !== "threads") {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: Account "${account.name}" is ${account.platform}, not threads.`,
          },
        ],
        isError: true,
      };
    }

    // Programmatic quality gate — inspired by Claude Code's verification agent pattern.
    // The agent CANNOT bypass this by passing a low score or omitting score.
    const minScore = getSettings().minOverallScore || 70;
    if (args.score < minScore) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Quality gate failed: score ${args.score} < minimum ${minScore}. Improve the content before publishing.`,
          },
        ],
        isError: true,
      };
    }

    const PUBLISH_TIMEOUT_MS = 60000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PUBLISH_TIMEOUT_MS);

    try {
      const result = await publishToThreads({
        text: args.text,
        token: account.token,
        score: args.score,
        imageUrl: args.image_url,
        videoUrl: args.video_url,
        carouselUrls: args.carousel_urls,
        pollOptions: args.poll_options,
        gifId: args.gif_id,
        linkAttachment: args.link_attachment,
        spoilerMedia: args.spoiler_media,
        ghost: args.ghost,
        quotePostId: args.quote_post_id,
        replyControl: args.reply_control,
        topicTag: args.tag,
        altText: args.alt_text,
        linkComment: args.link_comment,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      // Log to publish history
      store.addPublish({
        session_id: null,
        platform: "threads",
        account: args.account_id,
        content: args.text,
        image_url: args.image_url || null,
        post_id: result.id,
        post_url: result.permalink,
        status: "published",
        link_comment: args.link_comment || null,
        source_url: null,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              post_id: result.id,
              permalink: result.permalink,
              account: account.name,
              handle: account.handle,
            }),
          },
        ],
      };
    } catch (err) {
      clearTimeout(timeoutId);
      const message = controller.signal.aborted
        ? "Publishing timed out after 60 seconds. Check your network and try again."
        : (err as Error).message;
      // Log failed attempt
      store.addPublish({
        session_id: null,
        platform: "threads",
        account: args.account_id,
        content: args.text,
        image_url: args.image_url || null,
        post_id: null,
        post_url: null,
        status: "failed",
        link_comment: args.link_comment || null,
        source_url: null,
      });

      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  }
);

const historyTool = tool(
  "get_publish_history",
  "Get recent publish history from local database. No API token needed.",
  {
    limit: z.number().optional().describe("Number of records to return (default 20, max 500)"),
  },
  async (args) => {
    const limit = Math.min(Math.max(args.limit || 20, 1), 500);
    const history = store.getPublishHistory(limit);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(history, null, 2),
        },
      ],
    };
  }
);

const uploadImageTool = tool(
  "upload_image",
  "Upload a local image file to a public hosting service and return the public URL. Use this to get a public URL for images before publishing to Threads. The file must be inside the session workspace.",
  {
    file_path: z
      .string()
      .describe("Path to the image file (relative to workspace, e.g. 'downloads/card-1.png')"),
  },
  async (args) => {
    const filePath = args.file_path;

    // Resolve relative to CWD (workspace)
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
      return {
        content: [{ type: "text" as const, text: `Error: File not found: ${resolved}` }],
        isError: true,
      };
    }

    const stat = fs.statSync(resolved);
    if (stat.size > 10 * 1024 * 1024) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: File too large (${(stat.size / 1024 / 1024).toFixed(1)}MB, max 10MB)`,
          },
        ],
        isError: true,
      };
    }

    const ext = path.extname(resolved).toLowerCase();
    if (![".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(ext)) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: Unsupported image type: ${ext}. Use .png, .jpg, .gif, or .webp`,
          },
        ],
        isError: true,
      };
    }

    try {
      const fileBuffer = fs.readFileSync(resolved);
      const fileName = path.basename(resolved);

      // Use catbox.moe litterbox — 24h temporary file hosting (same as threads-viral-agent skill)
      const formData = new FormData();
      formData.append("reqtype", "fileupload");
      formData.append("time", "24h");
      formData.append("fileToUpload", new Blob([fileBuffer]), fileName);

      const res = await fetch("https://litterbox.catbox.moe/resources/internals/api.php", {
        method: "POST",
        body: formData,
        signal: AbortSignal.timeout(60000),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Upload failed (${res.status}): ${body}`);
      }

      const publicUrl = (await res.text()).trim();
      if (!publicUrl.startsWith("http")) {
        throw new Error(`Upload returned invalid URL: ${publicUrl}`);
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ success: true, url: publicUrl, file: fileName }),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error uploading: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

const createGoalTool = tool(
  "create_goal_session",
  "Create a structured agent goal to track a multi-step content mission across the session. Returns a goal_id to reference in subsequent reflections.",
  {
    description: z
      .string()
      .describe("Clear description of the goal (e.g. 'Publish 3 viral posts about AI this week')"),
    account_id: z.string().optional().describe("Account ID this goal is for (optional)"),
  },
  async (args) => {
    try {
      const goal = store.createGoal({
        description: args.description,
        accountId: args.account_id,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              goal_id: goal.id,
              description: goal.description,
              status: goal.status,
              message: "Goal created. Use goal_id in run_reflection_loop to track progress.",
            }),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          { type: "text" as const, text: `Error creating goal: ${(err as Error).message}` },
        ],
        isError: true,
      };
    }
  }
);

const reflectionLoopTool = tool(
  "run_reflection_loop",
  "Self-evaluate the last content or tool result. Saves a reflection record and extracts improvement notes as long-term memories. Use after scoring content or after a failed publish attempt.",
  {
    last_content: z
      .string()
      .describe(
        "The content or outcome to reflect on (post text, score result, error message, etc.)"
      ),
    score_details: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        "Score breakdown object if available (e.g. {overall: 72, hook: 65, engagement: 80})"
      ),
    goal_id: z.string().optional().describe("Goal ID to associate this reflection with"),
    session_id: z.string().optional().describe("Session ID (auto-detected if omitted)"),
    trigger: z
      .enum(["tool_result", "turn_end", "score_gate_fail"])
      .optional()
      .describe("What triggered this reflection"),
  },
  async (args) => {
    try {
      const overall = (args.score_details as any)?.overall ?? (args.score_details as any)?.score;
      const scoreBefore = typeof overall === "number" ? overall : undefined;

      // Extract actionable improvement notes from the content
      let improvementNotes: string | undefined;
      if (args.score_details) {
        const scores = args.score_details as Record<string, number>;
        const weak = Object.entries(scores)
          .filter(([k, v]) => k !== "overall" && typeof v === "number" && v < 70)
          .map(([k, v]) => `${k}: ${v}`);
        if (weak.length > 0) {
          improvementNotes = `Low scores in: ${weak.join(", ")}. Focus on improving these dimensions next time.`;
        }
      }

      const reflection = memoryService.saveReflection({
        sessionId: args.session_id || "unknown",
        goalId: args.goal_id,
        trigger: (args.trigger as any) || "tool_result",
        reflectionContent: args.last_content,
        improvementNotes,
        scoreBefore,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              reflection_id: reflection.id,
              improvement_notes: improvementNotes || null,
              next_action_suggestion: improvementNotes
                ? "Address the low-scoring dimensions before next publish attempt."
                : "Content quality looks good — proceed with confidence.",
            }),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          { type: "text" as const, text: `Error in reflection loop: ${(err as Error).message}` },
        ],
        isError: true,
      };
    }
  }
);

const searchMemoryTool = tool(
  "search_memory",
  "Search long-term agent memory for past lessons, preferences, and reflections. Use this at session start to recall what worked (or failed) in previous sessions.",
  {
    query: z
      .string()
      .describe("Search query — keywords or phrase (e.g. 'hook writing Taiwan audience')"),
    filter_by_goal: z.string().optional().describe("Limit results to a specific goal_id"),
    memory_type: z
      .enum(["general", "reflection", "preference", "failure", "success"])
      .optional()
      .describe("Filter by memory type"),
    limit: z.number().optional().describe("Max results to return (default 10, max 20)"),
  },
  async (args) => {
    try {
      const results = memoryService.searchMemory(args.query, {
        goalId: args.filter_by_goal,
        memoryType: args.memory_type as any,
        limit: Math.min(args.limit || 10, 20),
      });

      if (results.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                found: 0,
                memories: [],
                message: "No matching memories found.",
              }),
            },
          ],
        };
      }

      const formatted = results.map((m) => ({
        id: m.id,
        content: m.content,
        type: m.memory_type,
        tags: m.tags ? JSON.parse(m.tags) : [],
        access_count: m.access_count,
        created_at: m.created_at,
      }));

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ found: results.length, memories: formatted }),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          { type: "text" as const, text: `Error searching memory: ${(err as Error).message}` },
        ],
        isError: true,
      };
    }
  }
);

const strategyTool = tool(
  "generate_strategy_from_analytics",
  "Analyze past publish performance to generate data-driven content strategy recommendations. Use this at the start of a content planning session.",
  {
    days: z.number().optional().describe("Lookback window in days (default 30, max 365)"),
    account_id: z
      .string()
      .optional()
      .describe("Filter to a specific account (omit for all accounts)"),
  },
  async (args) => {
    try {
      const days = Math.min(args.days || 30, 365);
      const overview = store.getAnalyticsOverview(days, args.account_id);
      const contentAnalysis = store.getContentAnalysis(days);

      const topFormats = [...(contentAnalysis.image_vs_text || [])]
        .sort((a: any, b: any) => b.avg_views - a.avg_views)
        .map((f: any) => ({ format: f.type, avg_views: Math.round(f.avg_views), posts: f.count }));

      const bestHours = [...(contentAnalysis.hour_performance || [])]
        .sort((a: any, b: any) => b.avg_engagement - a.avg_engagement)
        .slice(0, 3)
        .map((h: any) => `${h.hour}:00`);

      const topPosts = (overview.top_posts || []).map((p: any) => p.content?.slice(0, 60));

      // Save as a 'success' memory for future recall
      if (overview.total_posts > 0) {
        memoryService.saveMemory({
          accountId: args.account_id,
          content: `Analytics (${days}d): ${overview.published_posts} posts, ${Math.round((overview.engagement_rate || 0) * 100)}% engagement. Best format: ${topFormats[0]?.format || "n/a"}. Best hours: ${bestHours.join(", ")}.`,
          tags: ["analytics", "strategy"],
          memoryType: "success",
        });
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              period_days: days,
              total_published: overview.published_posts || 0,
              engagement_rate_pct: Math.round((overview.engagement_rate || 0) * 10000) / 100,
              top_formats: topFormats,
              best_posting_hours: bestHours,
              recommended_topics: topPosts.filter(Boolean).slice(0, 3),
              insight: topFormats[0]
                ? `${topFormats[0].format} posts get ${topFormats[0].avg_views} avg views — prioritize this format.`
                : "Not enough data yet — publish more to generate recommendations.",
            }),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          { type: "text" as const, text: `Error generating strategy: ${(err as Error).message}` },
        ],
        isError: true,
      };
    }
  }
);

// Lazy import to avoid circular deps — strategy-agent imports store + memoryService
let _strategyAgent: typeof import("./strategy-agent.js").strategyAgent | null = null;
async function getStrategyAgent() {
  if (!_strategyAgent) {
    const mod = await import("./strategy-agent.js");
    _strategyAgent = mod.strategyAgent;
  }
  return _strategyAgent;
}

const runStrategyAgentTool = tool(
  "run_strategy_agent",
  "Run the full content strategy agent: analyze past publish performance, retrieve relevant memories, and return a prioritized content calendar with actionable recommendations. Use at session start for data-driven content planning.",
  {
    account_id: z.string().optional().describe("Account ID to analyze (omit for all accounts)"),
    days: z.number().optional().describe("Lookback window in days (default 30, max 365)"),
    include_calendar: z
      .boolean()
      .optional()
      .describe("Include 7-day content calendar in output (default true)"),
  },
  async (args) => {
    try {
      const agent = await getStrategyAgent();
      const report = agent.runStrategy({
        accountId: args.account_id,
        days: args.days,
        includeCalendar: args.include_calendar !== false,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(report, null, 2),
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error running strategy agent: ${(err as Error).message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

export function createStudioMcpServer() {
  return createSdkMcpServer({
    name: "studio",
    tools: [
      publishTool,
      historyTool,
      uploadImageTool,
      createGoalTool,
      reflectionLoopTool,
      searchMemoryTool,
      strategyTool,
      runStrategyAgentTool,
    ],
  });
}
