# Claude World Studio

Content pipeline app: trend discovery, deep research, social publishing — with agentic memory, goals, and strategy (v2.2).

## Architecture

- `server/` — Express + WebSocket server, Claude Agent SDK integration
- `server/services/` — Scheduler, social publisher, Studio MCP tools
- `server/services/memory-service.ts` — Long-term memory store (SQLite FTS5); singleton `memoryService`
- `server/services/agent-orchestrator.ts` — Goal state machine (PLAN→EXECUTE→REFLECT→COMPLETE); singleton `orchestrator`
- `server/services/strategy-agent.ts` — Analytics-driven content strategy; singleton `strategyAgent`
- `server/routes/agent.ts` — REST API for goals, memories, reflections, workflows, matrix-run
- `server/cleanup-registry.ts` — Centralized cleanup (pattern from Claude Code)
- `client/` — React 19 + Tailwind UI (Vite build)
- `client/components/AgentDashboard.tsx` — Goals/Memories/Workflows dashboard page
- `client/hooks/` — `useApi` (typed fetch), `useLanguage` (context)
- `electron/` — Electron desktop wrapper
- `scripts/` — Build scripts only (no runtime scripts)
- `.claude/skills/` — Skill definitions for Claude Code

## Agentic Subsystem (v2.2)

### DB Tables

| Table                | Purpose                                                     |
| -------------------- | ----------------------------------------------------------- |
| `agent_goals`        | Persistent goal tracking — status, progress, sub-tasks JSON |
| `agent_memories`     | Long-term knowledge store — FTS5 indexed, type-tagged       |
| `agent_memories_fts` | FTS5 virtual table — kept in sync via DB triggers           |
| `agent_reflections`  | Per-session self-evaluation records                         |
| `agent_workflows`    | Reusable prompt template library                            |

### Key Patterns

- `searchMemoriesStmtCache` (db.ts) — bounded Map (max 8 SQL variants) caches dynamic FTS5 statements
- `evictionScheduled` flag (OrchestratorGoalRun) — prevents duplicate 10-min eviction timers
- Yield-point guard in `executeStateMachine` — checks `run.state` after every `await` so abort/pause isn't overridden
- `markStaleGoalsFailed()` on orchestrator startup — reconciles orphaned active goals from previous server runs
- `getMemoriesByType()` store method — DB-level `WHERE memory_type = ?` filter; never fetch-then-filter in JS

### MCP Tools (all 8)

| Tool                               | Purpose                                           |
| ---------------------------------- | ------------------------------------------------- |
| `publish_to_threads`               | Publish post (quality gate enforced)              |
| `get_publish_history`              | Fetch recent publish records                      |
| `upload_image`                     | Upload workspace image (path traversal protected) |
| `create_goal_session`              | Create agent_goals record                         |
| `run_reflection_loop`              | Save reflection → improvement memory              |
| `search_memory`                    | FTS5 search with goalId/accountId/type filters    |
| `generate_strategy_from_analytics` | Inline analytics strategy (number[] hours)        |
| `run_strategy_agent`               | Full StrategyAgent pipeline with calendar         |

## Key Design Rules

1. **No Python runtime dependencies**: Publishing uses native TypeScript `fetch()`, not Python scripts. The `threads_api.py` is a dev-only tool, not used by the server.
2. **Workspace containment**: The AI agent operates within the session workspace only. Never reference `~/Downloads` or paths outside workspace in prompts or examples. Use relative paths like `downloads/card.pdf`.
3. **Credentials from DB**: All tokens and API keys are stored in SQLite DB and loaded automatically by Studio MCP tools. Never search the filesystem for credentials.
4. **MCP-first publishing**: Publishing goes through the `publish_to_threads` Studio MCP tool, which reads tokens from DB. No direct API calls from the agent. The system prompt's embedded SKILL.md is for content strategy only — all execution uses MCP tools.
5. **Timeout safety**: All MCP tool calls have timeouts to prevent hanging sessions.
6. **Programmatic quality gates**: The `publish_to_threads` MCP tool enforces `score >= minOverallScore` from settings. The agent cannot bypass this via prompt manipulation.
7. **Cleanup registry**: Modules register cleanup functions via `registerCleanup()`. Shutdown runs all cleanups in parallel. Sessions auto-register on creation and unregister on close.
8. **Typed SDK output**: Agent output stream uses `SDKOutputMessage` discriminated union (not `any`). Defined in `server/cli-session.ts`.
9. **Error diagnostics**: Logger keeps a 100-entry ring buffer. `GET /api/diagnostics/errors` exposes it. Client ErrorBoundary reports to `POST /api/diagnostics/errors`.

## Dev Commands

```bash
npm run dev              # Start dev server + Vite
npm run build            # Build client
npm run typecheck        # TypeScript check
npm run electron:dev     # Electron dev mode
npm run electron:build   # Production .dmg
```
