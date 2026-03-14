import type { WSClient, Language } from "./types.js";
import { AgentSession } from "./ai-client.js";
import store from "./db.js";

export class Session {
  public readonly sessionId: string;
  private subscribers: Set<WSClient> = new Set();
  private agentSession: AgentSession;
  private isListening = false;

  constructor(sessionId: string, workspacePath?: string, language?: Language) {
    this.sessionId = sessionId;
    this.agentSession = new AgentSession(workspacePath, language);
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
