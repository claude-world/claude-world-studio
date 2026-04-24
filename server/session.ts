import type { WSClient, Language, Message, CliCommand } from "./types.js";
import type { ICliSession, SDKOutputMessage } from "./cli-session.js";
import { AgentSession, buildSystemPrompt } from "./ai-client.js";
import { SubprocessCliSession } from "./subprocess-cli-session.js";
import { getSettings, writeMcpConfigFile } from "./mcp-config.js";
import store from "./db.js";
import { logger } from "./logger.js";
import { registerCleanup } from "./cleanup-registry.js";

/**
 * Build a compact conversation recap from previous messages.
 * Keeps last N user/assistant exchanges, skips verbose tool details.
 */
function buildResumeContext(messages: Message[], maxMessages = 30): string | undefined {
  if (messages.length === 0) return undefined;

  // Filter to user + assistant text messages (skip tool_use/tool_result/result noise)
  const relevant = messages.filter(
    (m) => (m.role === "user" || m.role === "assistant") && m.content
  );

  if (relevant.length === 0) return undefined;

  // Take the last N messages to stay within reasonable token limits
  const recent = relevant.slice(-maxMessages);

  const lines = recent.map((m) => {
    const role = m.role === "user" ? "User" : "Assistant";
    // Truncate very long messages (e.g. full articles)
    const content =
      m.content!.length > 800 ? m.content!.slice(0, 800) + "... [truncated]" : m.content!;
    return `**${role}**: ${content}`;
  });

  return lines.join("\n\n");
}

// Cap tool results at 100KB to prevent database bloat
const MAX_TOOL_RESULT_SIZE = 100_000;
export function truncateResult(content: string): string {
  if (content.length <= MAX_TOOL_RESULT_SIZE) return content;
  return content.slice(0, MAX_TOOL_RESULT_SIZE) + "\n...[truncated]";
}

export class Session {
  public readonly sessionId: string;
  public readonly cliName: string;
  private subscribers: Set<WSClient> = new Set();
  private cliSession: ICliSession;
  private isListening = false;
  private hasResult = false;
  private unregisterCleanup: (() => void) | null = null;
  private isClosed = false;
  /** Consecutive stream errors — inspired by Claude Code's retry backoff pattern */
  private consecutiveErrors = 0;
  private static readonly MAX_STREAM_RETRIES = 3;
  /** Cumulative session cost tracking — inspired by Claude Code's cost-tracker.ts */
  private totalCostUsd = 0;
  private turnCount = 0;

  constructor(
    sessionId: string,
    workspacePath?: string,
    language?: Language,
    previousMessages?: Message[]
  ) {
    this.sessionId = sessionId;
    const settings = getSettings();
    const ALLOWED_CLIS: CliCommand[] = [
      "claude",
      "codex",
      "gemini",
      "opencode",
      "aider",
      "gh-copilot",
    ];
    const rawCli = (settings as any).cliPrimary || "claude";
    const cliPrimary: CliCommand = ALLOWED_CLIS.includes(rawCli) ? rawCli : "claude";

    if (cliPrimary === "claude") {
      const resumeContext = previousMessages ? buildResumeContext(previousMessages) : undefined;
      this.cliSession = new AgentSession(workspacePath, language, resumeContext, sessionId);
      this.cliName = "claude";
    } else {
      const lang = language || settings.language || "zh-TW";
      const accounts = store.getAllAccounts();
      const systemPrompt = buildSystemPrompt(
        lang,
        accounts,
        settings.minOverallScore,
        settings.minConversationScore
      );
      const cwd = workspacePath || settings.defaultWorkspace || process.cwd();

      let mcpConfigPath: string | undefined;
      try {
        mcpConfigPath = writeMcpConfigFile(settings);
      } catch (err) {
        logger.warn("Session", "MCP config write failed, MCP tools unavailable", {
          error: (err as Error).message,
        });
      }

      this.cliSession = new SubprocessCliSession(cliPrimary, cwd, systemPrompt, mcpConfigPath);
      this.cliName = cliPrimary;
    }

    // Seed cumulative cost/turn from history on resume (Claude Code cost-tracker pattern)
    if (previousMessages) {
      for (const m of previousMessages) {
        if (m.role === "result" && m.cost_usd) {
          this.totalCostUsd += m.cost_usd;
          this.turnCount++;
        }
      }
    }

    // Register with cleanup registry so shutdown kills this session
    this.unregisterCleanup = registerCleanup(() => this.close());
  }

  /**
   * Listen to the agent output stream with retry for transient errors.
   * Inspired by Claude Code's withRetry.ts — uses a loop (not recursion)
   * to avoid the finally-block overwriting isListening during retries.
   */
  private async startListening(): Promise<void> {
    if (this.isListening) return;
    this.isListening = true;

    try {
      while (!this.isClosed && this.consecutiveErrors < Session.MAX_STREAM_RETRIES) {
        try {
          for await (const message of this.cliSession.getOutputStream()) {
            this.handleSDKMessage(message);
            this.consecutiveErrors = 0;
          }
          break; // clean end of stream
        } catch (error) {
          this.consecutiveErrors++;
          const errorMsg = error instanceof Error ? error.message : String(error);
          logger.error(
            "Session",
            `Stream error in session ${this.sessionId} (attempt ${this.consecutiveErrors})`,
            error
          );

          if (
            !this.isTransientError(error) ||
            this.consecutiveErrors >= Session.MAX_STREAM_RETRIES
          ) {
            this.broadcastError(errorMsg);
            break;
          }

          // Exponential backoff: 1s, 2s, 4s
          const delay = 1000 * Math.pow(2, this.consecutiveErrors - 1);
          logger.info("Session", `Retrying stream for session ${this.sessionId} in ${delay}ms...`);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    } finally {
      this.isListening = false;
    }
  }

  /** Check if an error is transient (worth retrying) */
  private isTransientError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const msg = error.message.toLowerCase();
    return (
      msg.includes("econnreset") ||
      msg.includes("econnrefused") ||
      msg.includes("etimedout") ||
      msg.includes("socket hang up") ||
      msg.includes("network") ||
      msg.includes("overloaded")
    );
  }

  sendMessage(content: string) {
    store.addMessage(this.sessionId, { role: "user", content });
    this.hasResult = false; // Reset on new user message

    this.broadcast({
      type: "user_message",
      content,
      sessionId: this.sessionId,
    });

    this.cliSession.sendMessage(content);

    if (!this.isListening) {
      this.startListening();
    }
  }

  /**
   * Handle typed SDK output messages.
   * Inspired by Claude Code's query.ts streaming event processing.
   */
  private handleSDKMessage(message: SDKOutputMessage) {
    if (message.type === "assistant") {
      const content = message.message?.content;
      if (!content) return;

      if (typeof content === "string") {
        store.addMessage(this.sessionId, { role: "assistant", content });
        this.broadcast({
          type: "assistant_message",
          content,
          sessionId: this.sessionId,
        });
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text" && block.text) {
            store.addMessage(this.sessionId, {
              role: "assistant",
              content: block.text,
            });
            this.broadcast({
              type: "assistant_message",
              content: block.text,
              sessionId: this.sessionId,
            });
          } else if (block.type === "tool_use") {
            store.addMessage(this.sessionId, {
              role: "tool_use",
              tool_name: block.name,
              tool_id: block.id,
              tool_input: JSON.stringify(block.input),
            });
            this.broadcast({
              type: "tool_use",
              toolName: block.name,
              toolId: block.id,
              toolInput: block.input,
              sessionId: this.sessionId,
            });
          } else if (block.type === "tool_result") {
            const rawContent =
              typeof block.content === "string" ? block.content : JSON.stringify(block.content);
            const resultContent = truncateResult(rawContent);
            store.addMessage(this.sessionId, {
              role: "tool_result",
              tool_id: block.tool_use_id,
              content: resultContent,
            });
            this.broadcast({
              type: "tool_result",
              toolId: block.tool_use_id,
              content: resultContent,
              sessionId: this.sessionId,
            });
          }
        }
      }
    } else if (message.type === "result") {
      this.hasResult = true;
      this.turnCount++;

      // Cumulative cost tracking (Claude Code's cost-tracker.ts pattern)
      const turnCost = message.total_cost_usd ?? 0;
      this.totalCostUsd += turnCost;
      const durationMs = message.duration_ms;

      store.addMessage(this.sessionId, {
        role: "result",
        content: JSON.stringify({
          success: message.subtype === "success",
          cost: turnCost,
          totalCost: this.totalCostUsd,
          duration: durationMs,
          turn: this.turnCount,
        }),
        cost_usd: turnCost,
      });

      this.broadcast({
        type: "result",
        success: message.subtype === "success",
        sessionId: this.sessionId,
        cost: turnCost,
        duration: durationMs,
      });
    }
  }

  subscribe(client: WSClient) {
    this.subscribers.add(client);
    client.sessionId = this.sessionId;
  }

  unsubscribe(client: WSClient) {
    this.subscribers.delete(client);
  }

  hasSubscribers(): boolean {
    return this.subscribers.size > 0;
  }

  /** Whether the agent is actively processing (listening for SDK output) */
  isRunning(): boolean {
    return this.isListening && !this.hasResult;
  }

  private broadcast(message: any) {
    const messageStr = JSON.stringify(message);
    for (const client of this.subscribers) {
      try {
        if (client.readyState === client.OPEN) {
          client.send(messageStr);
        }
      } catch {
        this.subscribers.delete(client);
      }
    }
  }

  private broadcastError(error: string) {
    this.broadcast({
      type: "error",
      error,
      sessionId: this.sessionId,
    });
  }

  close() {
    if (this.isClosed) return;
    this.isClosed = true;
    this.unregisterCleanup?.();
    this.unregisterCleanup = null;
    this.cliSession.close();
  }
}
