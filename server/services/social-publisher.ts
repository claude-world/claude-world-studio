import { execFile } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCRIPTS_DIR = path.join(__dirname, "../../scripts");
const MAX_TEXT_LENGTH = 500;

export async function publishToThreads(
  text: string,
  token: string
): Promise<{ id: string; permalink: string }> {
  if (text.length > MAX_TEXT_LENGTH) {
    throw new Error(`Text too long: ${text.length} chars (max ${MAX_TEXT_LENGTH})`);
  }

  return new Promise((resolve, reject) => {
    const scriptPath = path.join(SCRIPTS_DIR, "threads_api.py");

    execFile(
      "python3",
      [scriptPath, "publish", "--text", text],
      {
        env: {
          ...process.env,
          THREADS_TOKEN: token,
        },
        timeout: 30000,
      },
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
