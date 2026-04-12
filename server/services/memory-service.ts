/**
 * Memory Service — long-term knowledge store for agentic sessions (v2.0).
 *
 * Uses SQLite FTS5 for full-text search over agent_memories. The FTS5 virtual
 * table is kept in sync via database triggers (see db.ts). No external vector
 * DB dependency — plain better-sqlite3 prepared statements throughout.
 *
 * Design mirrors the Claude Code cleanup-registry pattern: singleton export so
 * every module shares the same prepared-statement cache.
 */

import store from "../db.js";
import type {
  AgentGoalStatus,
  AgentMemory,
  AgentMemoryType,
  AgentReflection,
  ReflectionTrigger,
} from "../types.js";

class MemoryService {
  /**
   * Persist a new memory entry.
   * The FTS5 trigger in db.ts automatically indexes content + tags.
   */
  saveMemory(params: {
    content: string;
    goalId?: string;
    accountId?: string;
    tags?: string[];
    memoryType?: AgentMemoryType;
    relevanceScore?: number;
  }): AgentMemory {
    return store.createMemory(params);
  }

  /**
   * Full-text search across memory content and tags.
   * Uses SQLite FTS5 MATCH syntax — supports phrase queries like "goal strategy".
   * Sanitizes the query so special FTS5 chars don't cause parse errors.
   */
  searchMemory(
    query: string,
    options?: {
      goalId?: string;
      accountId?: string;
      memoryType?: AgentMemoryType;
      limit?: number;
    }
  ): AgentMemory[] {
    const safe = this.sanitizeFtsQuery(query);
    if (!safe) return [];
    let results: AgentMemory[];
    try {
      results = store.searchMemories(safe, options);
    } catch {
      // FTS5 parse errors (e.g. complex queries) — return empty rather than throw
      return [];
    }
    // Touch accessed memories to boost future relevance ranking.
    // Runs outside the FTS catch so a touch failure doesn't discard valid results.
    for (const m of results) {
      try {
        store.touchMemory(m.id);
      } catch {
        // Non-fatal — skip touch on error
      }
    }
    return results;
  }

  /**
   * Load the most relevant context memories for a session start.
   * Returns top N by access_count DESC (most frequently recalled = most useful).
   */
  loadContextMemories(accountId?: string, limit = 10): AgentMemory[] {
    return store.getContextMemories(accountId, limit);
  }

  /**
   * Remove stale, low-value memories older than daysOld with < 3 accesses.
   * Returns count of deleted rows.
   */
  autoClean(daysOld = 90): number {
    // Guard against 0 or negative values deleting all recent memories
    const safeDays = Math.max(1, Math.floor(daysOld));
    return store.cleanOldMemories(safeDays);
  }

  /**
   * Persist a self-reflection record. Optionally extracts improvement notes
   * and auto-saves them as a 'reflection' memory for future retrieval.
   */
  saveReflection(params: {
    sessionId: string;
    goalId?: string;
    trigger: ReflectionTrigger;
    reflectionContent: string;
    improvementNotes?: string;
    scoreBefore?: number;
    scoreAfter?: number;
    accountId?: string;
  }): AgentReflection {
    const reflection = store.createReflection({
      sessionId: params.sessionId,
      goalId: params.goalId,
      trigger: params.trigger,
      reflectionContent: params.reflectionContent,
      improvementNotes: params.improvementNotes,
      scoreBefore: params.scoreBefore,
      scoreAfter: params.scoreAfter,
    });

    // Auto-persist improvement notes as a 'reflection' memory so future sessions
    // can recall lessons learned without replaying full reflection transcripts.
    if (params.improvementNotes) {
      store.createMemory({
        goalId: params.goalId,
        accountId: params.accountId,
        content: params.improvementNotes,
        tags: ["reflection", params.trigger],
        memoryType: "reflection",
      });
    }

    return reflection;
  }

  /**
   * Retrieve reflections for a session, newest first.
   */
  getReflections(sessionId: string, limit = 20): AgentReflection[] {
    return store.getReflectionsBySession(sessionId, limit);
  }

  /**
   * Build a compact memory context block for injection into system prompts.
   * Returns a markdown section or empty string if no memories exist.
   */
  buildMemoryBlock(accountId?: string, limit = 10): string {
    const memories = this.loadContextMemories(accountId, limit);
    if (memories.length === 0) return "";

    const lines = memories.map((m) => {
      let tagStr = "";
      if (m.tags) {
        try {
          tagStr = ` [${(JSON.parse(m.tags) as string[]).join(", ")}]`;
        } catch {
          // malformed tags — skip rather than crash system prompt injection
        }
      }
      return `- ${m.content}${tagStr}`;
    });

    return `\n\n## Long-Term Memory (${memories.length} entries)\nLessons learned from previous sessions — use these to improve quality:\n${lines.join("\n")}`;
  }

  // FTS5 special characters that must be escaped or stripped
  private sanitizeFtsQuery(query: string): string {
    // Wrap in double quotes for phrase search if query contains spaces
    // Strip characters that break FTS5 parser
    const stripped = query.replace(/['"*^:()]/g, " ").trim();
    if (!stripped) return "";
    // If multi-word, wrap as phrase
    return stripped.includes(" ") ? `"${stripped}"` : stripped;
  }
}

export const memoryService = new MemoryService();
export type { MemoryService };
