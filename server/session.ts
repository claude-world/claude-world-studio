import type { WSClient, Language, Message } from "./types.js";
import { AgentSession } from "./ai-client.js";
import store from "./db.js";

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
    const content = m.content!.length > 800
      ? m.content!.slice(0, 800) + "... [truncated]"
      : m.content!;
    return `**${role}**: ${content}`;
  });

  return lines.join("\n\n");
}

export class Session {
  public readonly sessionId: string;
  private subscribers: Set<WSClient> = new Set();
  private agentSession: AgentSession;
  private isListening = false;

  constructor(sessionId: string, workspacePath?: string, language?: Language, previousMessages?: Message[]) {
    this.sessionId = sessionId;
    const resumeContext = previousMessages ? buildResumeContext(previousMessages) : undefined;
    this.agentSession = new AgentSession(workspacePath, language, resumeContext);
  }

  private async startListening() {
    if (this.isListening) return;
    this.isListening = true;

    try {
      for await (const message of this.agentSession.getOutputStream()) {
        this.handleSDKMessage(message);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`Error in session ${this.sessionId}:`, errorMsg);
      this.broadcastError(errorMsg);
    } finally {
      this.isListening = false;
    }
  }

  sendMessage(content: string) {
    store.addMessage(this.sessionId, { role: "user", content });

    this.broadcast({
      type: "user_message",
      content,
      sessionId: this.sessionId,
    });

    this.agentSession.sendMessage(content);

    if (!this.isListening) {
      this.startListening();
    }
  }

  private handleSDKMessage(message: any) {
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
          } else if (block.type === "tool_use" && block.name) {
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
            const resultContent =
              typeof block.content === "string"
                ? block.content
                : JSON.stringify(block.content);
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
      const costUsd = message.total_cost_usd;
      const durationMs = message.duration_ms;

      store.addMessage(this.sessionId, {
        role: "result",
        content: JSON.stringify({
          success: message.subtype === "success",
          cost: costUsd,
          duration: durationMs,
        }),
        cost_usd: costUsd,
      });

      this.broadcast({
        type: "result",
        success: message.subtype === "success",
        sessionId: this.sessionId,
        cost: costUsd,
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
    return this.isListening;
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
    this.agentSession.close();
  }
}
