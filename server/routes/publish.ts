import { Router } from "express";
import store from "../db.js";
import {
  publishToThreads,
  fetchThreadsInsights,
  fetchUserThreads,
} from "../services/social-publisher.js";
import {
  PublishSchema,
  BatchPublishSchema,
  BatchRefreshInsightsSchema,
  parseBody,
} from "../validation.js";

const MAX_HISTORY_LIMIT = 500;

const router = Router();

// Publish content to a specific account
router.post("/", async (req, res) => {
  const parsed = parseBody(PublishSchema, req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error });

  const {
    accountId,
    text,
    sessionId,
    score,
    imageUrl,
    videoUrl,
    carouselUrls,
    pollOptions,
    gifId,
    linkAttachment,
    textAttachment,
    linkComment,
    sourceUrl,
    spoilerMedia,
    spoilerText,
    ghost,
    quotePostId,
    replyControl,
    topicTag,
    altText,
  } = parsed.data;

  const account = store.getAccount(accountId);
  if (!account) {
    return res.status(400).json({ error: `Account not found: ${accountId}` });
  }
  if (account.platform !== "threads") {
    return res.status(400).json({ error: `Platform not supported: ${account.platform}` });
  }

  const saveDraft = (message: string) => {
    const record = store.addPublish({
      session_id: sessionId || null,
      platform: account.platform,
      account: accountId,
      content: text,
      score: score ?? null,
      image_url: imageUrl || null,
      post_id: null,
      post_url: null,
      status: "draft",
      link_comment: linkComment || null,
      source_url: sourceUrl || null,
    });
    return res.json({
      success: true,
      id: record.id,
      status: "draft",
      message,
    });
  };

  if (score === undefined) {
    return saveDraft("Post saved as draft because no quality score was provided");
  }

  // If auto_publish is off, save as draft for review
  if (!account.auto_publish) {
    return saveDraft("Post saved as draft for review");
  }

  if (!account.token) {
    return res.status(400).json({ error: `No token configured for account: ${account.name}` });
  }

  const record = store.addPublish({
    session_id: sessionId || null,
    platform: account.platform,
    account: accountId,
    content: text,
    score,
    image_url: imageUrl || null,
    post_id: null,
    post_url: null,
    status: "pending",
    link_comment: linkComment || null,
    source_url: sourceUrl || null,
  });

  try {
    let result: any;

    result = await publishToThreads({
      text,
      token: account.token,
      score,
      imageUrl,
      videoUrl,
      carouselUrls,
      pollOptions,
      gifId,
      linkAttachment,
      textAttachment,
      spoilerMedia,
      spoilerText,
      ghost,
      quotePostId,
      replyControl,
      topicTag,
      altText,
      linkComment,
    });

    store.updatePublishStatus(record.id, "published", result?.id, result?.permalink);

    res.json({
      success: true,
      id: record.id,
      postId: result?.id,
      postUrl: result?.permalink,
    });
  } catch (error) {
    store.updatePublishStatus(record.id, "failed");
    res.status(500).json({
      error: (error as Error).message,
      id: record.id,
    });
  }
});

// Discard a draft post
router.post("/:id/discard", (req, res) => {
  const record = store.getPublishById(req.params.id);
  if (!record) {
    return res.status(404).json({ error: "Post not found" });
  }
  if (record.status !== "draft") {
    return res.status(400).json({ error: "Only draft posts can be discarded" });
  }
  store.updatePublishStatus(req.params.id, "discarded");
  res.json({ success: true });
});

// Batch publish selected draft posts
router.post("/batch", async (req, res) => {
  const parsed = parseBody(BatchPublishSchema, req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error });
  const { ids } = parsed.data;

  const results: { id: string; success: boolean; error?: string; postUrl?: string }[] = [];

  for (const id of ids) {
    const record = store.getPublishById(id);
    if (!record || record.status !== "draft") {
      results.push({ id, success: false, error: "Not found or not a draft" });
      continue;
    }

    const account = store.getAccount(record.account);
    if (!account || !account.token) {
      store.updatePublishStatus(id, "failed");
      results.push({ id, success: false, error: "Account or token missing" });
      continue;
    }
    if (account.platform !== "threads") {
      store.updatePublishStatus(id, "failed");
      results.push({ id, success: false, error: `Platform not supported: ${account.platform}` });
      continue;
    }
    if (record.score === null || record.score === undefined) {
      results.push({ id, success: false, error: "Draft has no quality score" });
      continue;
    }

    store.updatePublishStatus(id, "pending");

    try {
      const result = await publishToThreads({
        text: record.content,
        token: account.token,
        score: record.score,
        imageUrl: record.image_url || undefined,
        linkComment: record.link_comment || undefined,
      });

      store.updatePublishStatus(id, "published", result?.id, result?.permalink);
      results.push({ id, success: true, postUrl: result?.permalink });
    } catch (error) {
      store.updatePublishStatus(id, "failed");
      results.push({ id, success: false, error: (error as Error).message });
    }
  }

  res.json({ results });
});

// Get all pending/draft posts for review
router.get("/pending", (_req, res) => {
  const posts = store.getPendingPosts();
  // Enrich with account info
  const enriched = posts.map((p) => {
    const account = store.getAccount(p.account);
    return {
      ...p,
      account_name: account?.name || "Unknown",
      account_handle: account?.handle || "",
      account_platform: account?.platform || p.platform,
    };
  });
  res.json(enriched);
});

// Get publish history
router.get("/history", (req, res) => {
  const rawLimit = parseInt(req.query.limit as string) || 50;
  const limit = Math.min(Math.max(rawLimit, 1), MAX_HISTORY_LIMIT);
  const history = store.getPublishHistory(limit);
  res.json(history);
});

// Get insights for a published post
router.get("/history/:id/insights", async (req, res) => {
  const record = store.getPublishById(req.params.id);
  if (!record) {
    return res.status(404).json({ error: "Post not found" });
  }
  if (record.status !== "published" || !record.post_id) {
    return res.status(400).json({ error: "Post is not published or has no post ID" });
  }

  const account = store.getAccount(record.account);
  if (!account || !account.token) {
    return res.status(400).json({ error: "Account or token missing" });
  }

  try {
    const insights = await fetchThreadsInsights(record.post_id, account.token);
    res.json(insights);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Get posts with insights for a specific account
router.get("/accounts/:id/posts-detail", (req, res) => {
  const rawLimit = parseInt(req.query.limit as string) || 50;
  const limit = Math.min(Math.max(rawLimit, 1), MAX_HISTORY_LIMIT);
  const posts = store.getPostsWithInsights(req.params.id, limit);
  const account = store.getAccount(req.params.id);
  const enriched = posts.map((p: any) => ({
    ...p,
    account_name: account?.name || "Unknown",
    account_handle: account?.handle || "",
  }));
  res.json(enriched);
});

// Get all posts with insights (no account filter)
router.get("/posts-detail", (req, res) => {
  const rawLimit = parseInt(req.query.limit as string) || 100;
  const limit = Math.min(Math.max(rawLimit, 1), MAX_HISTORY_LIMIT);
  const posts = store.getAllPostsWithInsights(limit);
  const accounts = store.getAllAccounts();
  const accountMap = new Map(accounts.map((a) => [a.id, a]));
  const enriched = posts.map((p: any) => {
    const acct = accountMap.get(p.account);
    return { ...p, account_name: acct?.name || "Unknown", account_handle: acct?.handle || "" };
  });
  res.json(enriched);
});

// Batch refresh insights (max 20 per call)
router.post("/refresh-insights", async (req, res) => {
  const parsed = parseBody(BatchRefreshInsightsSchema, req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error });
  const { ids } = parsed.data;

  const batch = ids;
  const results: { id: string; success: boolean; insights?: any; error?: string }[] = [];

  for (let i = 0; i < batch.length; i++) {
    const id = batch[i];
    const record = store.getPublishById(id);
    if (!record || record.status !== "published" || !record.post_id) {
      results.push({ id, success: false, error: "Not published or no post_id" });
      continue;
    }
    const account = store.getAccount(record.account);
    if (!account || !account.token) {
      results.push({ id, success: false, error: "Account or token missing" });
      continue;
    }
    try {
      const insights = await fetchThreadsInsights(record.post_id, account.token);
      store.upsertInsightsCache(id, insights);
      results.push({ id, success: true, insights });
      if (i < batch.length - 1) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    } catch (error) {
      results.push({ id, success: false, error: (error as Error).message });
    }
  }

  res.json({ results });
});

// Backfill missing post_ids by matching content with Threads API
router.post("/backfill-post-ids", async (_req, res) => {
  const accounts = store.getAllAccounts();
  const results: {
    account: string;
    success: boolean;
    error?: string;
    total_missing?: number;
    matched?: number;
  }[] = [];

  for (const account of accounts) {
    if (!account.token || !account.user_id) {
      results.push({ account: account.handle, success: false, error: "No token or user_id" });
      continue;
    }

    try {
      // Get recent posts from Threads API
      const apiPosts = await fetchUserThreads(account.user_id, account.token, 50);

      // Get DB records for this account that are published but have no post_id
      const dbPosts = store.getPublishByAccount(account.id, 100);
      const missingPostId = dbPosts.filter(
        (p) => p.status === "published" && (!p.post_id || p.post_id === "")
      );

      let matched = 0;
      for (const dbPost of missingPostId) {
        // Match by content similarity (first 50 chars)
        const dbContent = (dbPost.content || "").slice(0, 50).trim();
        if (!dbContent) continue;

        const match = apiPosts.find((ap) => ap.text && ap.text.slice(0, 50).trim() === dbContent);

        if (match) {
          store.updatePublishStatus(dbPost.id, "published", match.id, match.permalink);
          matched++;
        }
      }

      results.push({
        account: account.handle,
        success: true,
        total_missing: missingPostId.length,
        matched,
      });
    } catch (err) {
      results.push({ account: account.handle, success: false, error: (err as Error).message });
    }
  }

  res.json({ results });
});

// Analytics overview
router.get("/analytics/overview", (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days as string) || 30, 1), 365);
  const offset = Math.min(Math.max(parseInt(req.query.offset as string) || 0, 0), 365);
  const accountId = req.query.account_id as string | undefined;
  const overview = store.getAnalyticsOverview(days, accountId, offset);
  res.json(overview);
});

// Content analysis
router.get("/analytics/content-analysis", (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days as string) || 30, 1), 365);
  const analysis = store.getContentAnalysis(days);
  res.json(analysis);
});

export default router;
