import { Router } from "express";
import store from "../db.js";
import { publishToThreads } from "../services/social-publisher.js";

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

  const record = store.addPublish({
    session_id: sessionId || null,
    platform: account.platform,
    account: accountId,
    content: text,
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

// Get publish history
router.get("/history", (req, res) => {
  const rawLimit = parseInt(req.query.limit as string) || 50;
  const limit = Math.min(Math.max(rawLimit, 1), MAX_HISTORY_LIMIT);
  const history = store.getPublishHistory(limit);
  res.json(history);
});

export default router;
