# Claude World Studio

Content pipeline app: trend discovery, deep research, social publishing — with agentic memory, goals, and strategy (v2.3).

## Architecture

- `server/` — Express + WebSocket server, Claude Agent SDK integration
- `server/services/` — Scheduler, social publisher, Studio MCP tools
- `server/services/memory-service.ts` — Long-term memory store (SQLite FTS5); singleton `memoryService`
- `server/services/agent-orchestrator.ts` — Goal state machine (PLAN→EXECUTE→REFLECT→COMPLETE); singleton `orchestrator`
- `server/services/strategy-agent.ts` — Analytics-driven content strategy; singleton `strategyAgent`
- `server/routes/agent.ts` — REST API for goals, memories, reflections, workflows, matrix-run
- `server/cleanup-registry.ts` — Centralized cleanup (pattern from Claude Code)
- `client/` — React 19 + Tailwind UI (Vite build)
- `client/components/AgentDashboard.tsx` — Goals/Workflows/Memory/Strategy dashboard page
- `client/hooks/` — `useApi` (typed fetch), `useLanguage` (context)
- `electron/` — Electron desktop wrapper
- `server-dist/` — Build output: the packaged server bundle (git-ignored, see Desktop packaging)
- `scripts/` — Build/test tooling (`build-server.cjs`, `electron-build.cjs`, `desktop-smoke.cjs`, `ensure-native-abi.cjs`) plus dev-only `threads_api.py`; nothing here runs at server runtime
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
- **NULL-binding trap**: `WHERE (account_id = ? OR account_id IS NULL)` with a NULL bind collapses to global-only rows. When a filter param is `undefined`, use a dedicated no-filter statement (see `getContextMemoriesAllAccounts`, `getMemoriesByType`)
- **One-time migrations**: guard with a settings-table flag (e.g. `migration_publish_score_backfill`) — never write data backfills that re-run on every boot
- **Quality gate consistency**: every publish entry point (REST `/api/publish`, `/batch`, MCP tool, scheduler) must enforce `settings.minOverallScore` (70 fallback); scheduled tasks additionally raise the gate to `max(setting, task.min_score)` via `createStudioMcpServer({minScore})`. Gates raise, never lower
- **Never ship the `data` directory or `.env` via electron-builder `files`/`extraResources`** — the live dev DB holds real tokens; this leaked credentials in v1.3.0–v2.0.0 releases
- `scripts/ensure-native-abi.cjs` (pre dev/test/start + postinstall) — auto-rebuilds better-sqlite3 when `electron:build` leaves an Electron-ABI binary behind
- Test isolation: set `STUDIO_USER_DATA_PATH` to a mkdtemp dir **before** dynamically importing any DB-touching module (static imports hoist above the env assignment)
- **Agent SDK 0.3**: `query()` options are typed with the SDK's `Options`; the SDK spawns its bundled native Claude Code binary (no `executable`/Node path needed, even under Electron). Its peers `@anthropic-ai/sdk` and `@modelcontextprotocol/sdk` are declared as direct dependencies. Models use the `opus`/`sonnet` aliases so they track the current Claude family

### Known Limitations

- Goal pause/resume/abort works only for runs launched via `orchestrator.runGoal` (matrix-run); goals created by `POST /api/agent/goals` or the `create_goal_session` MCP tool return 409 (no in-memory run) and terminate via `markStaleGoalsFailed` on restart
- `agent_memories_fts` is external-content FTS5 keyed on the implicit rowid of a TEXT-PK table — running `VACUUM` may renumber rowids and desync the index. No code runs VACUUM; don't add one without rebuilding the FTS index afterwards

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

## Desktop Packaging

The packaged app runs **one esbuild bundle**, not the TypeScript sources. `scripts/build-server.cjs` compiles `server/server.ts` → `server-dist/server.mjs`; `electron/server-runtime.cjs` spawns that with Electron-as-node. Rules that keep it working:

- **Only `runtime-paths.ts` may read `import.meta.url`.** Bundling collapses every module's `import.meta.url` onto the bundle's path, so a per-file `__dirname` silently resolves to the wrong depth. Use `getProjectRoot()` instead. The bundle must stay exactly one directory below the app root for that to hold — `test/packaging.test.ts` asserts it
- **`EXTERNAL` in `scripts/build-server.cjs` is load-bearing.** `better-sqlite3` is a native addon; `@anthropic-ai/claude-agent-sdk` locates its CLI binary with `createRequire(import.meta.url).resolve()`, so it only works from a real package directory; `zod` must be a single instance shared with the SDK, whose `tool()` helper converts schemas with its own copy
- **`build.files` can only _exclude_ under `node_modules`.** electron-builder's `getNodeModuleFileMatcher` keeps just the `!` patterns and prepends `**/*`, so a re-include after `!node_modules/**/*` is silently dropped — write a deny-list, never an allow-list, for dependencies
- **esbuild's ESM output has no `require`.** `scripts/build-server.cjs` prepends a `createRequire` banner; without it, esbuild's `__require` shim throws the first time bundled CommonJS reaches a dynamic require
- `test/packaging.test.ts` recomputes the runtime dependency closure and fails if an exclusion covers something the app resolves on disk — or if a new dependency ships without being needed
- `npm run test:desktop-smoke` checks the shipped tree (bundle unpacked, `tsx`/`esbuild`/`@anthropic-ai/sdk` absent, better-sqlite3 addon present, Agent SDK loads) before exercising the running app
- The **npm package is separate** and still ships `server/` + runs `tsx server/server.ts`; `tsx` stays a production dependency for it

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
npm run build:server     # Bundle server/ → server-dist/server.mjs (esbuild)
npm run electron:dev     # Electron dev mode
npm run electron:build   # Production .dmg (build + build:server + package)
```
