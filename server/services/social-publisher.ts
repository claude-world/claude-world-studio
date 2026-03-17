import { execFile } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCRIPTS_DIR = path.join(__dirname, "../../scripts");
const MAX_TEXT_LENGTH = 500;
const MIN_PUBLISH_SCORE = 70;

export interface PublishOptions {
  text: string;
  token: string;
  score?: number;
  // Media
  imageUrl?: string;
  videoUrl?: string;
  carouselUrls?: string[];       // 2-20 URLs
  // Attachments (TEXT only)
  pollOptions?: string;          // pipe-separated: "A|B|C"
  gifId?: string;
  linkAttachment?: string;       // URL for link preview card
  textAttachment?: string;       // file path or inline text (up to 10k chars)
  // Spoiler
  spoilerMedia?: boolean;        // blur image/video/carousel
  spoilerText?: string[];        // ["offset:length", ...] up to 10
  // Special
  ghost?: boolean;               // 24hr ephemeral post
  quotePostId?: string;          // quote another post
  // Content controls
  replyControl?: string;         // everyone|accounts_you_follow|mentioned_only|parent_post_author_only|followers_only
  topicTag?: string;             // 1-50 chars
  altText?: string;              // accessibility description, max 1000 chars
  linkComment?: string;          // auto-reply with link
}

export interface PublishResult {
  id: string;
  permalink: string;
}

export async function publishToThreads(opts: PublishOptions): Promise<PublishResult> {
  if (opts.score !== undefined && opts.score < MIN_PUBLISH_SCORE) {
    throw new Error(`Score ${opts.score} below minimum ${MIN_PUBLISH_SCORE}. Improve content before publishing.`);
  }
  if (opts.text.length > MAX_TEXT_LENGTH) {
    throw new Error(`Text too long: ${opts.text.length} chars (max ${MAX_TEXT_LENGTH})`);
  }
  if (!opts.token) {
    throw new Error("No token provided. Configure token in Settings for this account.");
  }

  return new Promise((resolve, reject) => {
    const scriptPath = path.join(SCRIPTS_DIR, "threads_api.py");
    const args = [scriptPath, "publish", "--token", opts.token, "--text", opts.text];

    // Media
    if (opts.imageUrl) {
      args.push("--image", opts.imageUrl);
    }
    if (opts.videoUrl) {
      args.push("--video", opts.videoUrl);
    }
    if (opts.carouselUrls && opts.carouselUrls.length >= 2) {
      args.push("--carousel", ...opts.carouselUrls);
    }

    // Attachments (TEXT only)
    if (opts.pollOptions) {
      args.push("--poll", opts.pollOptions);
    }
    if (opts.gifId) {
      args.push("--gif-id", opts.gifId);
    }
    if (opts.linkAttachment) {
      args.push("--link-attachment", opts.linkAttachment);
    }
    if (opts.textAttachment) {
      args.push("--text-attachment", opts.textAttachment);
    }

    // Spoiler
    if (opts.spoilerMedia) {
      args.push("--spoiler-media");
    }
    if (opts.spoilerText) {
      for (const range of opts.spoilerText) {
        args.push("--spoiler-text", range);
      }
    }

    // Special
    if (opts.ghost) {
      args.push("--ghost");
    }
    if (opts.quotePostId) {
      args.push("--quote-post-id", opts.quotePostId);
    }

    // Content controls
    if (opts.replyControl) {
      args.push("--reply-control", opts.replyControl);
    }
    if (opts.topicTag) {
      args.push("--topic-tag", opts.topicTag);
    }
    if (opts.altText) {
      args.push("--alt-text", opts.altText);
    }
    if (opts.linkComment) {
      args.push("--link-comment", opts.linkComment);
    }

    // Video/carousel need more processing time
    const timeout = opts.videoUrl || opts.carouselUrls ? 180000 : 30000;

    execFile(
      "python3",
      args,
      { timeout },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }

        try {
          const result = JSON.parse(stdout.trim());
          resolve(result);
        } catch {
          resolve({ id: stdout.trim(), permalink: "" });
        }
      }
    );
  });
}
