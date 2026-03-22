/**
 * Common interface for all CLI session backends.
 * Implementations: AgentSession (Claude SDK), SubprocessCliSession (codex/gemini/opencode)
 */
export interface ICliSession {
  readonly cliName: string;
  sendMessage(content: string): void;
  getOutputStream(): AsyncIterable<any>;
  close(): void;
}
