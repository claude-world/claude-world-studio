import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import store from "../db.js";
import { publishToThreads } from "./social-publisher.js";

const publishTool = tool(
  "publish_to_threads",
  "Publish content to Threads via Graph API. Quality gate: score >= 70 required. Pass account_id from the Social Accounts table.",
  {
    text: z.string().describe("Post text content (max 500 chars)"),
    account_id: z.string().describe("Account ID from Social Accounts table"),
    score: z.number().describe("Content quality score (must be >= 70)"),
    image_url: z.string().optional().describe("Public image URL to attach"),
    poll_options: z.string().optional().describe("Poll options separated by | (2-4 options, max 25 chars each)"),
    link_comment: z.string().optional().describe("Auto-reply with this link (avoids reach penalty)"),
  },
  async (args) => {
    const account = store.getAccount(args.account_id);
    if (!account) {
      return { content: [{ type: "text" as const, text: `Error: Account not found: ${args.account_id}` }], isError: true };
    }
    if (!account.token) {
      return { content: [{ type: "text" as const, text: `Error: No token configured for account "${account.name}". Add token in Settings.` }], isError: true };
    }
    if (account.platform !== "threads") {
      return { content: [{ type: "text" as const, text: `Error: Account "${account.name}" is ${account.platform}, not threads.` }], isError: true };
    }

    try {
      const result = await publishToThreads({
        text: args.text,
        token: account.token,
        score: args.score,
        imageUrl: args.image_url,
        pollOptions: args.poll_options,
        linkComment: args.link_comment,
      });

      // Log to publish history
      store.addPublish({
        session_id: null,
        platform: "threads",
        account: args.account_id,
        content: args.text,
        post_id: result.id,
        post_url: result.permalink,
        status: "published",
      });

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            success: true,
            post_id: result.id,
            permalink: result.permalink,
            account: account.name,
            handle: account.handle,
          }),
        }],
      };
    } catch (err) {
      // Log failed attempt
      store.addPublish({
        session_id: null,
        platform: "threads",
        account: args.account_id,
        content: args.text,
        post_id: null,
        post_url: null,
        status: "failed",
      });

      return {
        content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
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
      content: [{
        type: "text" as const,
        text: JSON.stringify(history, null, 2),
      }],
    };
  }
);

export function createStudioMcpServer() {
  return createSdkMcpServer({
    name: "studio",
    tools: [publishTool, historyTool],
  });
}
