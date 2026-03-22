import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import fs from "fs";
import path from "path";
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
    tag: z.string().optional().describe("Topic tag (no # prefix, one per post)"),
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

    const PUBLISH_TIMEOUT_MS = 60000;
    let timeoutId: ReturnType<typeof setTimeout>;

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("Publishing timed out after 60 seconds. Check your network and try again.")), PUBLISH_TIMEOUT_MS);
      });
      const result = await Promise.race([
        publishToThreads({
          text: args.text,
          token: account.token,
          score: args.score,
          imageUrl: args.image_url,
          pollOptions: args.poll_options,
          linkComment: args.link_comment,
          topicTag: args.tag,
        }),
        timeoutPromise,
      ]);
      clearTimeout(timeoutId!);

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
      clearTimeout(timeoutId!);
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

const uploadImageTool = tool(
  "upload_image",
  "Upload a local image file to a public hosting service and return the public URL. Use this to get a public URL for images before publishing to Threads. The file must be inside the session workspace.",
  {
    file_path: z.string().describe("Path to the image file (relative to workspace, e.g. 'downloads/card-1.png')"),
  },
  async (args) => {
    const filePath = args.file_path;

    // Resolve relative to CWD (workspace)
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
      return { content: [{ type: "text" as const, text: `Error: File not found: ${resolved}` }], isError: true };
    }

    const stat = fs.statSync(resolved);
    if (stat.size > 10 * 1024 * 1024) {
      return { content: [{ type: "text" as const, text: `Error: File too large (${(stat.size / 1024 / 1024).toFixed(1)}MB, max 10MB)` }], isError: true };
    }

    const ext = path.extname(resolved).toLowerCase();
    if (![".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(ext)) {
      return { content: [{ type: "text" as const, text: `Error: Unsupported image type: ${ext}. Use .png, .jpg, .gif, or .webp` }], isError: true };
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
        content: [{
          type: "text" as const,
          text: JSON.stringify({ success: true, url: publicUrl, file: fileName }),
        }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Error uploading: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

export function createStudioMcpServer() {
  return createSdkMcpServer({
    name: "studio",
    tools: [publishTool, historyTool, uploadImageTool],
  });
}
