import { spawn, execSync, type ChildProcess } from "child_process";
import readline from "readline";
import type { ICliSession } from "./cli-session.js";
import type { CliCommand } from "./types.js";
import { logger } from "./logger.js";

/**
 * Async queue for normalized SDK-format events.
 * Consumers iterate with `for await (const event of queue)`.
 */
class EventQueue {
  private buffer: any[] = [];
  private waiting: { resolve: (v: IteratorResult<any>) => void } | null = null;
  private done = false;

  push(event: any) {
    if (this.done) return;
    if (this.waiting) {
      const w = this.waiting;
      this.waiting = null;
      w.resolve({ value: event, done: false });
    } else {
      this.buffer.push(event);
    }
  }

  finish() {
    this.done = true;
    if (this.waiting) {
      const w = this.waiting;
      this.waiting = null;
      w.resolve({ value: undefined, done: true });
    }
  }

  reset() {
    this.done = false;
    this.buffer = [];
    this.waiting = null;
  }

  [Symbol.asyncIterator]() {
    return {
      next: (): Promise<IteratorResult<any>> => {
        if (this.buffer.length > 0) {
          return Promise.resolve({ value: this.buffer.shift()!, done: false });
        }
        if (this.done) {
          return Promise.resolve({ value: undefined, done: true });
        }
        return new Promise((resolve) => {
          this.waiting = { resolve };
        });
      },
    };
  }
}

/** CLI-specific command builders */
const CLI_CONFIGS: Record<
  string,
  {
    buildArgs: (
      prompt: string,
      cwd: string,
      mcpConfigPath?: string
    ) => { cmd: string; args: string[]; stdin?: string };
  }
> = {
  claude: {
    buildArgs: (prompt, cwd, mcpConfigPath) => ({
      cmd: "claude",
      args: [
        "-p",
        prompt,
        "--output-format",
        "stream-json",
        "--verbose",
        "--permission-mode",
        "auto",
        "-C",
        cwd,
        ...(mcpConfigPath ? ["--mcp-config", mcpConfigPath] : []),
      ],
    }),
  },
  codex: {
    buildArgs: (prompt, cwd) => ({
      cmd: "codex",
      args: ["exec", "--json", "--full-auto", "-C", cwd, "-"],
      stdin: prompt,
    }),
  },
  gemini: {
    buildArgs: (prompt, cwd) => ({
      cmd: "gemini",
      args: ["-p", prompt, "--output-format", "stream-json", "--yolo"],
    }),
  },
  opencode: {
    buildArgs: (prompt, cwd) => ({
      cmd: "opencode",
      args: ["exec", prompt],
    }),
  },
};

/**
 * Parse a JSONL line from each CLI into normalized SDK-format events.
 * Returns an array because one line can produce multiple events (e.g. tool_use + text).
 */
function parseClaudeLine(data: any): any[] {
  // Claude stream-json format is already close to SDK format
  if (data.type === "assistant") return [data];
  if (data.type === "result") return [data];
  return [];
}

function parseCodexLine(data: any): any[] {
  const events: any[] = [];

  if (data.type === "item.completed" && data.item) {
    const item = data.item;

    if (item.type === "agent_message" || item.type === "message") {
      // Text message
      const text = item.text || item.content?.[0]?.text || "";
      if (text) {
        events.push({
          type: "assistant",
          message: { content: [{ type: "text", text }] },
        });
      }
    } else if (item.type === "command_execution" || item.type === "function_call") {
      // Tool use (Bash command)
      const cmd = item.command || item.name || "";
      const output = item.aggregated_output || item.output || "";
      const toolId = item.id || `codex-${Date.now()}`;

      // Emit tool_use
      events.push({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: toolId,
              name: "Bash",
              input: { command: cmd },
            },
          ],
        },
      });
      // Emit tool_result
      events.push({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: toolId,
              content: output,
            },
          ],
        },
      });
    }
  } else if (data.type === "turn.completed") {
    events.push({
      type: "result",
      subtype: "success",
      total_cost_usd: data.usage?.total_cost || 0,
      duration_ms: data.usage?.duration_ms || 0,
    });
  }

  return events;
}

function parseGeminiLine(data: any): any[] {
  const events: any[] = [];

  if (data.type === "message" && data.role === "assistant") {
    const text = data.content || "";
    if (text) {
      events.push({
        type: "assistant",
        message: { content: [{ type: "text", text }] },
      });
    }
  } else if (data.type === "tool_use") {
    events.push({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: data.tool_id || `gemini-${Date.now()}`,
            name: data.tool_name || "unknown",
            input: data.parameters || {},
          },
        ],
      },
    });
  } else if (data.type === "tool_result") {
    events.push({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: data.tool_id || "",
            content: data.output || "",
          },
        ],
      },
    });
  } else if (data.type === "result") {
    events.push({
      type: "result",
      subtype: data.status === "error" ? "error" : "success",
      total_cost_usd: data.stats?.cost || 0,
      duration_ms: data.stats?.duration_ms || 0,
    });
  }

  return events;
}

/** Cached shell PATH — resolved once at module load to avoid blocking event loop */
let _cachedShellPath: string | null = null;
function getShellPath(): string {
  if (_cachedShellPath !== null) return _cachedShellPath;
  try {
    _cachedShellPath = execSync("/bin/zsh -lc 'echo $PATH'", {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
  } catch {
    _cachedShellPath = process.env.PATH || "/usr/local/bin:/usr/bin:/bin";
  }
  return _cachedShellPath!;
}

const PARSERS: Record<string, (data: any) => any[]> = {
  claude: parseClaudeLine,
  codex: parseCodexLine,
  gemini: parseGeminiLine,
  opencode: parseCodexLine, // opencode uses similar format
};

/**
 * CLI session that spawns external CLI subprocesses (codex, gemini, claude CLI, opencode).
 * Parses their JSONL output and normalizes to SDK-compatible events.
 */
export class SubprocessCliSession implements ICliSession {
  readonly cliName: string;
  private eventQueue = new EventQueue();
  private process: ChildProcess | null = null;
  private forceKillTimer: ReturnType<typeof setTimeout> | null = null;
  private rlStdout: readline.Interface | null = null;
  private rlStderr: readline.Interface | null = null;
  private workspacePath: string;
  private systemPrompt: string;
  private mcpConfigPath?: string;
  private conversationHistory: string[] = [];

  constructor(
    cli: CliCommand,
    workspacePath: string,
    systemPrompt: string,
    mcpConfigPath?: string
  ) {
    this.cliName = cli;
    this.workspacePath = workspacePath;
    this.systemPrompt = systemPrompt;
    this.mcpConfigPath = mcpConfigPath;
  }

  sendMessage(content: string) {
    // Kill previous process if still running
    this.killProcess();
    // Reset event queue for new turn
    this.eventQueue.reset();

    // Build full prompt with system prompt + conversation history
    this.conversationHistory.push(`User: ${content}`);
    const fullPrompt = this.buildFullPrompt(content);

    const config = CLI_CONFIGS[this.cliName];
    if (!config) {
      this.eventQueue.push({
        type: "result",
        subtype: "error",
        error: `Unsupported CLI: ${this.cliName}`,
      });
      this.eventQueue.finish();
      return;
    }

    const { cmd, args, stdin } = config.buildArgs(
      fullPrompt,
      this.workspacePath,
      this.mcpConfigPath
    );

    logger.info("SubprocessCLI", `Spawning: ${cmd} ${args.slice(0, 3).join(" ")}...`, {
      cli: this.cliName,
    });

    this.process = spawn(cmd, args, {
      cwd: this.workspacePath,
      env: { ...process.env, PATH: getShellPath() },
      stdio: ["pipe", "pipe", "pipe"],
    });

    // If CLI reads from stdin, write prompt and close
    if (stdin && this.process.stdin) {
      this.process.stdin.write(stdin);
      this.process.stdin.end();
    }

    const parser = PARSERS[this.cliName] || parseClaudeLine;
    // Capture queue reference so stale exit handlers from a killed process
    // don't corrupt a reset queue belonging to the next sendMessage() call.
    const queue = this.eventQueue;

    // Parse stdout JSONL line by line
    if (this.process.stdout) {
      const rl = readline.createInterface({ input: this.process.stdout });
      this.rlStdout = rl;
      rl.on("line", (line) => {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("{")) return;
        try {
          const data = JSON.parse(trimmed);
          const events = parser(data);
          for (const event of events) {
            queue.push(event);
          }
        } catch {
          // Non-JSON line, ignore
        }
      });
    }

    // Log stderr
    if (this.process.stderr) {
      const rlErr = readline.createInterface({ input: this.process.stderr });
      this.rlStderr = rlErr;
      rlErr.on("line", (line) => {
        if (line.trim()) {
          logger.debug("SubprocessCLI", line, { cli: this.cliName });
        }
      });
    }

    this.process.on("exit", (code) => {
      logger.info("SubprocessCLI", `Process exited with code ${code}`, { cli: this.cliName });
      this.process = null;
      if (this.forceKillTimer) {
        clearTimeout(this.forceKillTimer);
        this.forceKillTimer = null;
      }

      // If no result event was emitted, create one
      queue.push({
        type: "result",
        subtype: code === 0 ? "success" : "error",
        total_cost_usd: 0,
        duration_ms: 0,
      });
      queue.finish();
    });

    this.process.on("error", (err) => {
      logger.error("SubprocessCLI", `Spawn error for ${this.cliName}`, err);
      queue.push({
        type: "assistant",
        message: {
          content: [
            {
              type: "text",
              text: `Error: Could not start ${this.cliName} CLI. Is it installed?\n\nInstall with:\n- codex: \`npm i -g @openai/codex\`\n- gemini: \`npm i -g @anthropic-ai/gemini-cli\` or \`npm i -g @anthropic-ai/gemini\`\n- opencode: \`go install github.com/opencode-ai/opencode@latest\``,
            },
          ],
        },
      });
      queue.push({
        type: "result",
        subtype: "error",
        total_cost_usd: 0,
        duration_ms: 0,
      });
      queue.finish();
    });
  }

  getOutputStream(): AsyncIterable<any> {
    return this.eventQueue;
  }

  close() {
    this.killProcess();
    this.eventQueue.finish();
  }

  /** Kill the current subprocess with SIGTERM → 3s SIGKILL fallback */
  private killProcess() {
    this.rlStdout?.close();
    this.rlStdout = null;
    this.rlStderr?.close();
    this.rlStderr = null;
    if (this.forceKillTimer) {
      clearTimeout(this.forceKillTimer);
      this.forceKillTimer = null;
    }
    if (this.process) {
      const proc = this.process;
      this.process = null;
      try {
        proc.kill("SIGTERM");
      } catch {}
      this.forceKillTimer = setTimeout(() => {
        this.forceKillTimer = null;
        try {
          proc.kill("SIGKILL");
        } catch {}
      }, 3000);
      this.forceKillTimer.unref(); // Don't block server shutdown
    }
  }

  private buildFullPrompt(userMessage: string): string {
    const parts: string[] = [];

    // System prompt
    if (this.systemPrompt) {
      parts.push(`<system>\n${this.systemPrompt}\n</system>`);
    }

    // Conversation history (for multi-turn continuity)
    if (this.conversationHistory.length > 1) {
      const history = this.conversationHistory.slice(0, -1).join("\n\n");
      parts.push(`<conversation_history>\n${history}\n</conversation_history>`);
    }

    // Current message
    parts.push(userMessage);

    return parts.join("\n\n");
  }
}
