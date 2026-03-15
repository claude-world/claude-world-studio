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
  imageUrl?: string;
  pollOptions?: string;   // pipe-separated: "A|B|C"
  linkComment?: string;
  tag?: string;
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

    if (opts.imageUrl) {
      args.push("--image", opts.imageUrl);
    }
    if (opts.pollOptions) {
      args.push("--poll", opts.pollOptions);
    }
    if (opts.linkComment) {
      args.push("--link-comment", opts.linkComment);
    }
    if (opts.tag) {
      args.push("--tag", opts.tag);
    }

    execFile(
      "python3",
      args,
      { timeout: 30000 },
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
