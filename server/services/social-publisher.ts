import type { PostInsights } from "../types.js";
import { logger } from "../logger.js";

const API_BASE = "https://graph.threads.net/v1.0";
const MAX_TEXT_LENGTH = 500;
const MIN_PUBLISH_SCORE = 70;
const CONTAINER_POLL_INTERVAL = 5000;
const CONTAINER_POLL_TIMEOUT = 120000;

export interface PublishOptions {
  text: string;
  token: string;
  score?: number;
  // Media
  imageUrl?: string;
  videoUrl?: string;
  carouselUrls?: string[]; // 2-20 URLs
  // Attachments (TEXT only)
  pollOptions?: string; // pipe-separated: "A|B|C"
  gifId?: string;
  linkAttachment?: string; // URL for link preview card
  textAttachment?: string; // file path or inline text (up to 10k chars)
  // Spoiler
  spoilerMedia?: boolean; // blur image/video/carousel
  spoilerText?: string[]; // ["offset:length", ...] up to 10
  // Special
  ghost?: boolean; // 24hr ephemeral post
  quotePostId?: string; // quote another post
  // Content controls
  replyControl?: string; // everyone|accounts_you_follow|mentioned_only|parent_post_author_only|followers_only
  topicTag?: string; // 1-50 chars
  altText?: string; // accessibility description, max 1000 chars
  linkComment?: string; // auto-reply with link
  // Cancellation
  signal?: AbortSignal; // abort signal to cancel publish mid-flight
}

export interface PublishResult {
  id: string;
  permalink: string;
}

// ── API Helpers ──

async function threadsRequest(
  method: "GET" | "POST",
  endpoint: string,
  token: string,
  params?: Record<string, string>
): Promise<any> {
  const url = new URL(`${API_BASE}${endpoint}`);
  url.searchParams.set("access_token", token);

  if (method === "GET") {
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
    }
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(30000) });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Threads API error (${res.status}): ${body}`);
    }
    return res.json();
  }

  // POST: params go in form-urlencoded body
  const body = new URLSearchParams(params || {}).toString();
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Threads API error (${res.status}): ${errBody}`);
  }
  return res.json();
}

async function getUserId(token: string): Promise<string> {
  const data = await threadsRequest("GET", "/me", token, { fields: "id" });
  if (!data.id) throw new Error("Failed to get user ID from Threads API");
  return data.id;
}

async function waitForContainer(
  containerId: string,
  token: string,
  signal?: AbortSignal
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < CONTAINER_POLL_TIMEOUT) {
    if (signal?.aborted) throw new Error("Publish aborted");
    const status = await threadsRequest("GET", `/${containerId}`, token, {
      fields: "status,error_message",
    });
    if (status.status === "FINISHED") return;
    if (status.status === "ERROR") {
      throw new Error(`Container error: ${status.error_message || "unknown"}`);
    }
    await new Promise((r) => setTimeout(r, CONTAINER_POLL_INTERVAL));
  }
  // Timeout — attempt publish anyway (Meta sometimes doesn't return FINISHED)
  logger.warn(
    "Publisher",
    `Container poll timed out after ${CONTAINER_POLL_TIMEOUT / 1000}s, attempting publish`
  );
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Main Publish Function ──

export async function publishToThreads(opts: PublishOptions): Promise<PublishResult> {
  if (opts.score !== undefined && opts.score < MIN_PUBLISH_SCORE) {
    throw new Error(
      `Score ${opts.score} below minimum ${MIN_PUBLISH_SCORE}. Improve content before publishing.`
    );
  }
  if (opts.text.length > MAX_TEXT_LENGTH) {
    throw new Error(`Text too long: ${opts.text.length} chars (max ${MAX_TEXT_LENGTH})`);
  }
  if (!opts.token) {
    throw new Error("No token provided. Configure token in Settings for this account.");
  }

  if (opts.signal?.aborted) throw new Error("Publish aborted");
  const userId = await getUserId(opts.token);
  const params: Record<string, string> = {};

  // ── Determine media type ──

  if (opts.carouselUrls && opts.carouselUrls.length >= 2) {
    // Carousel: create child containers first
    const childIds: string[] = [];
    for (const url of opts.carouselUrls.slice(0, 20)) {
      if (opts.signal?.aborted) throw new Error("Publish aborted");
      const isVideo = /\.(mp4|mov)$/i.test(url);
      const childParams: Record<string, string> = {
        media_type: isVideo ? "VIDEO" : "IMAGE",
        [isVideo ? "video_url" : "image_url"]: url,
        is_carousel_item: "true",
      };
      const child = await threadsRequest("POST", `/${userId}/threads`, opts.token, childParams);
      childIds.push(child.id);
      if (isVideo) {
        await waitForContainer(child.id, opts.token, opts.signal);
      } else {
        await delay(2000);
      }
    }
    params.media_type = "CAROUSEL";
    params.children = childIds.join(",");
    if (opts.text) params.text = opts.text;
  } else if (opts.videoUrl) {
    params.media_type = "VIDEO";
    params.video_url = opts.videoUrl;
    if (opts.text) params.text = opts.text;
  } else if (opts.imageUrl) {
    params.media_type = "IMAGE";
    params.image_url = opts.imageUrl;
    if (opts.text) params.text = opts.text;
  } else {
    params.media_type = "TEXT";
    if (opts.text) params.text = opts.text;
  }

  // ── Attachments (TEXT type only, no media) ──
  if (!opts.imageUrl && !opts.videoUrl && !(opts.carouselUrls && opts.carouselUrls.length >= 2)) {
    if (opts.pollOptions) {
      const options = opts.pollOptions
        .split("|")
        .map((s) => s.trim())
        .slice(0, 4);
      const poll: Record<string, string> = {};
      const keys = ["option_a", "option_b", "option_c", "option_d"];
      options.forEach((opt, i) => {
        poll[keys[i]] = opt.slice(0, 25);
      });
      params.poll_attachment = JSON.stringify(poll);
    }
    if (opts.gifId) {
      params.gif_attachment = JSON.stringify({ gif_id: opts.gifId, provider: "GIPHY" });
    }
    if (opts.linkAttachment) {
      params.link_attachment = opts.linkAttachment;
    }
    if (opts.textAttachment) {
      params.text_attachment = JSON.stringify({ text: opts.textAttachment.slice(0, 10000) });
    }
    if (opts.ghost) {
      params.is_ghost_post = "true";
    }
  }

  // ── Content controls ──
  if (opts.quotePostId) params.quote_post_id = opts.quotePostId;
  if (opts.replyControl) params.reply_control = opts.replyControl;
  if (opts.topicTag) params.topic_tag = opts.topicTag;
  if (opts.altText) params.alt_text = opts.altText;
  if (opts.spoilerMedia) params.is_spoiler_media = "true";
  if (opts.spoilerText) {
    const entities = opts.spoilerText.map((spec) => {
      const [offset, length] = spec.split(":").map(Number);
      return { entity_type: "SPOILER", offset, length };
    });
    params.text_entities = JSON.stringify(entities);
  }

  // ── Step 1: Create container ──
  if (opts.signal?.aborted) throw new Error("Publish aborted");
  const container = await threadsRequest("POST", `/${userId}/threads`, opts.token, params);
  const containerId = container.id;
  if (!containerId) throw new Error("Failed to create media container");

  // ── Step 2: Wait for processing ──
  if (opts.videoUrl || (opts.carouselUrls && opts.carouselUrls.length >= 2)) {
    await waitForContainer(containerId, opts.token, opts.signal);
  } else {
    await delay(3000);
  }

  // ── Step 3: Publish ──
  if (opts.signal?.aborted) throw new Error("Publish aborted");
  const result = await threadsRequest("POST", `/${userId}/threads_publish`, opts.token, {
    creation_id: containerId,
  });
  const postId = result.id;
  if (!postId) throw new Error("Threads API returned no post ID after publish");

  // ── Step 4: Auto-reply with link (if provided) ──
  if (opts.linkComment && postId) {
    await delay(3000);
    try {
      const replyContainer = await threadsRequest("POST", `/${userId}/threads`, opts.token, {
        media_type: "TEXT",
        text: opts.linkComment,
        reply_to_id: postId,
      });
      await delay(3000);
      await threadsRequest("POST", `/${userId}/threads_publish`, opts.token, {
        creation_id: replyContainer.id,
      });
    } catch (e) {
      logger.warn("Publisher", `Link reply failed: ${(e as Error).message}`);
    }
  }

  return { id: postId, permalink: "" };
}

// ── Fetch User Threads (for backfill) ──

export async function fetchUserThreads(
  userId: string,
  token: string,
  limit = 50
): Promise<Array<{ id: string; text: string; timestamp: string; permalink: string }>> {
  const url = `${API_BASE}/${encodeURIComponent(userId)}/threads?fields=id,text,timestamp,permalink&limit=${limit}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Threads API error ${res.status}: ${errText}`);
  }
  const data = await res.json();
  return data.data || [];
}

// ── Insights ──

export async function fetchThreadsInsights(postId: string, token: string): Promise<PostInsights> {
  const metrics = "views,likes,replies,reposts,quotes";
  const url = `${API_BASE}/${encodeURIComponent(postId)}/insights?metric=${metrics}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Threads Insights API error (${res.status}): ${body}`);
  }

  const json = await res.json();
  const data: Record<string, number> = {};
  for (const entry of json.data || []) {
    data[entry.name] = entry.total_value?.value ?? entry.values?.[0]?.value ?? 0;
  }

  return {
    views: data.views ?? 0,
    likes: data.likes ?? 0,
    replies: data.replies ?? 0,
    reposts: data.reposts ?? 0,
    quotes: data.quotes ?? 0,
  };
}
