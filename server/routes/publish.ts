import { Router } from "express";
import store from "../db.js";
import { publishToThreads, fetchThreadsInsights } from "../services/social-publisher.js";

const MAX_HISTORY_LIMIT = 500;

const router = Router();

// Publish content to a specific account
router.post("/", async (req, res) => {
  const {
    accountId, text, sessionId, score,
    // Media
    imageUrl, videoUrl, carouselUrls,
    // Attachments
    pollOptions, gifId, linkAttachment, textAttachment,
    // Spoiler
    spoilerMedia, spoilerText,
    // Special
    ghost, quotePostId,
    // Controls
    replyControl, topicTag, altText, linkComment,
  } = req.body;

  if (!accountId || !text) {
    return res.status(400).json({ error: "accountId and text are required" });
  }

  const account = store.getAccount(accountId);
  if (!account) {
    return res.status(400).json({ error: `Account not found: ${accountId}` });
  }
  if (!account.token) {
    return res.status(400).json({ error: `No token configured for account: ${account.name}` });
  }

  // If auto_publish is off, save as draft for review
  if (!account.auto_publish) {
    const record = store.addPublish({
      session_id: sessionId || null,
      platform: account.platform,
      account: accountId,
      content: text,
      image_url: imageUrl || null,
      post_id: null,
      post_url: null,
      status: "draft",
    });
    return res.json({
      success: true,
      id: record.id,
      status: "draft",
      message: "Post saved as draft for review",
    });
  }

  const record = store.addPublish({
    session_id: sessionId || null,
    platform: account.platform,
    account: accountId,
    content: text,
    image_url: imageUrl || null,
    post_id: null,
    post_url: null,
    status: "pending",
  });

  try {
    let result: any;

    if (account.platform === "threads") {
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
    } else {
      throw new Error(`Publishing to ${account.platform} is not yet supported`);
    }

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
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "ids array is required" });
  }
  if (ids.length > 50) {
    return res.status(400).json({ error: "Maximum 50 posts per batch" });
  }

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

    store.updatePublishStatus(id, "pending");

    try {
      let result: any;
      if (account.platform === "threads") {
        result = await publishToThreads({
          text: record.content,
          token: account.token,
          imageUrl: record.image_url || undefined,
        });
      } else {
        throw new Error(`Platform ${account.platform} not supported`);
      }

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

export default router;
