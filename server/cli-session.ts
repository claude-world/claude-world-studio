/**
 * Common interface for all CLI session backends.
 * Implementations: AgentSession (Claude SDK), SubprocessCliSession (codex/gemini/opencode)
 */

/**
 * Typed SDK output messages — replaces `any` with discriminated union.
 * Inspired by Claude Code's StreamEvent types in query.ts.
 */
export type SDKAssistantBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string | unknown[] };

export type SDKOutputMessage =
  | {
      type: "assistant";
      message: { role: "assistant"; content: string | SDKAssistantBlock[] };
    }
  | {
      type: "result";
      /** SDK emits specific error subtypes; subprocess parsers emit "error" as catch-all */
      subtype:
        | "success"
        | "error"
        | "error_during_execution"
        | "error_max_turns"
        | "error_max_budget_usd";
      total_cost_usd?: number;
      duration_ms?: number;
    };

export interface ICliSession {
  readonly cliName: string;
  sendMessage(content: string): void;
  getOutputStream(): AsyncIterable<SDKOutputMessage>;
  close(): void;
}
