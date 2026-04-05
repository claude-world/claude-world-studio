# Changelog

## [2.1.0] - 2026-04-05

### Added (patterns from Claude Code v2.1.88 source)

**Server Infrastructure**

- **Cleanup registry** (`server/cleanup-registry.ts`) — modules self-register cleanup functions, shutdown runs all in parallel via `runAllCleanups()`. Pattern from Claude Code's `cleanupRegistry.ts`.
- **Error ring buffer** — logger keeps last 100 errors in memory. `GET /api/diagnostics/errors` for debugging, `POST /api/diagnostics/errors` receives client-side errors. Pattern from Claude Code's `log.ts`.
- **DB transaction helper** — `transaction<T>(fn)` wraps SQLite transactions for atomic multi-step operations.
- **Bounded LRU analytics cache** — max 64 entries with TTL + manual LRU eviction, replacing unbounded Map. Pattern from Claude Code's `memoize.ts`.

**Agent Execution Layer**

- **Typed SDK output** — `SDKOutputMessage` discriminated union replaces all `any` in agent output stream. Pattern from Claude Code's `query.ts` StreamEvent.
- **Stream retry with backoff** — `startListening()` retries transient errors (ECONNRESET, ETIMEDOUT) up to 3 times with 1s/2s/4s exponential backoff. Pattern from Claude Code's `withRetry.ts`.
- **Abort guard** — `getOutputStream()` checks `abortController.signal.aborted` before and after each `iterator.next()`. Pattern from Claude Code's `query.ts:839`.
- **Cumulative cost tracking** — `totalCostUsd` + `turnCount` accumulated per session, seeded from history on resume. Pattern from Claude Code's `cost-tracker.ts`.
- **Programmatic quality gate** — `publish_to_threads` MCP tool enforces `score >= minOverallScore` from settings. Agent cannot bypass via prompt.
- **Task failure detection** — scheduled task JSON parse failure now marked "failed" (was silently "completed"), raw output saved for audit.
- **auto_publish violation detection** — warns when agent publishes despite `auto_publish=off`.

**Client**

- **Single page state** — 5 boolean page flags → `activePage: Page` discriminated union. Pattern from Claude Code's `AppStateStore.ts`.
- **useApi hook** (`client/hooks/useApi.ts`) — typed `[data, error]` tuple replacing 12 scattered try/catch blocks.
- **LanguageContext** (`client/hooks/useLanguage.tsx`) — React context for future prop drilling removal.
- **ErrorBoundary reporting** — client-side React errors posted to server ring buffer.

### Fixed

- System prompt contradiction: MCP tool vs Python script publishing instructions now unified (MCP-first)
- Conversation Durability threshold was hardcoded 60 in scheduler, now reads from settings
- Session `close()` could be called twice (idle cleanup + shutdown race) — added `isClosed` guard
- Diagnostics POST endpoint accepted unsanitized input — now truncates tag/message/stack
- `fetchSessions` declared after `handleWSMessage` that references it — moved above callback

## [2.0.0] - 2026-03-29

### Breaking Changes

- **React 18 → 19** — `useRef` requires initial value, deprecated lifecycle methods removed
- **Express 4 → 5** — wildcard routes need named params (`*filepath`), `req.query` changes
- **TypeScript 5 → 6** — stricter module resolution
- **Tailwind 3 → 4** — CSS-based config replaces `tailwind.config.js`
- **Vite 5 → 8** — CJS/ESM interop changes for some libraries

### Added

- **ESLint + Prettier + Husky** — automated code quality with pre-commit hooks
- **Structured logger** (`server/logger.ts`) — replaces all `console.log` with leveled, timestamped, tagged output
- **Rate limiting** — 120 req/min sliding window with `X-RateLimit-*` headers
- **Zod validation** — 9 schemas covering all API routes (sessions, accounts, publish, tasks, batch)
- **React Error Boundaries** — 7 boundaries wrapping all page components with retry UI
- **Session search** — client-side filter in sidebar (i18n: zh-TW/en/ja)
- **Skeleton loaders** — animated placeholders for sessions, file tree, posts
- **Mobile responsive layout** — hamburger menu, collapsible sidebar, backdrop overlay
- **Accessibility** — `role`, `aria-label`, keyboard navigation, dialog semantics on modals
- **File explorer search** — recursive filename filter
- **220 tests** (was 32) — logger, rate-limiter, validation, analytics-cache, truncation, DB CRUD, schema edges
- **CI pipeline** — lint, format check, security audit, test steps added
- **Publish abort signal** — prevents duplicate posts on timeout via AbortController
- **Analytics query caching** — 60s TTL with invalidation on all write paths
- **Carousel skill instructions** — explicit step-by-step guide for multi-image publishing

### Fixed

- **59 issues** found across 7 review passes (5 Claude + 2 Codex 6-thread)
- Loading indicator stuck after pipeline completion (`hasResult` flag)
- Analytics timestamp format mismatch (ISO vs SQLite `datetime()`)
- Dark mode broken in Tailwind 4 (`@custom-variant` syntax)
- Sidebar overflow blocking main content clicks
- `react-use-websocket` CJS/ESM double-wrap with Vite 8
- Express 5 unnamed wildcard route crash
- Negative `limit` query param bypassing SQL cap
- `source_url` silently set to `link_comment` value
- Scheduler retry allowing concurrent task execution during backoff
- TaskForm/AccountForm showing stale data when switching items
- MCP tool results unbounded (now capped at 100KB)
- Readline interfaces not explicitly closed on process kill
- Multiple dead code removals and unused import cleanups
- Electron `systemNode` variable shadowing

### Upgraded

| Package                        | From   | To     |
| ------------------------------ | ------ | ------ |
| react / react-dom              | 18.3   | 19.2   |
| express                        | 4.21   | 5.2    |
| typescript                     | 5.5    | 6.0    |
| tailwindcss                    | 3.4    | 4.2    |
| vite                           | 5.4    | 8.0    |
| @anthropic-ai/claude-agent-sdk | 0.1.28 | 0.2.85 |
| better-sqlite3                 | 11.7   | 12.8   |
| uuid                           | 10.0   | 13.0   |
| dotenv                         | 16.4   | 17.3   |
| electron                       | 41.0.2 | 41.1.0 |

### SDK 0.2 Lifecycle

- Added `allowDangerouslySkipPermissions` flag for bypass mode
- Stored query handles for proper `.close()` on interrupt/shutdown
- Scheduler tracks running query handles for clean teardown

## [1.8.0] - 2026-03-24

### Added

- **Account Posts page** — view publish history per account with insights (views, likes, replies, reposts)
- **Traffic Dashboard page** — aggregated traffic metrics across all accounts
- **Post insights cache** — SQLite table caches Threads API insights data, with batch fetch and per-account queries
- **Sidebar navigation** — Posts and Traffic buttons in sidebar for quick access
- **Test suite** — 32 process lifecycle tests covering all shutdown paths (`npm test`)

### Fixed

- **Orphan process prevention** — comprehensive fix across all process lifecycle paths (4 rounds of review):
  - **Server shutdown**: `shutdown()` now closes all active sessions, clears intervals, and calls `process.exit()` with 5s forced-exit backstop. Added `SIGHUP` handler for terminal close.
  - **Electron quit**: `killServer()` is now Promise-based — `before-quit` waits for server process to actually exit before allowing quit. 6s safety timer prevents hang if exit event is missed.
  - **CLI subprocesses**: unified `killProcess()` with SIGTERM → 3s SIGKILL fallback (`.unref()`'d). Captured `queue` ref prevents stale exit handlers from corrupting the next turn's EventQueue.
  - **Task scheduler**: `stop()` aborts all running Agent SDK sessions via tracked AbortControllers. `executeTask()` has stopped guard. Retry logic skips when scheduler is stopping (pre-sleep + post-sleep checks).

### Changed

- **threads-viral-agent skill** — mandatory `link_comment` for source URLs, clearer checklist formatting

## [1.7.0] - 2026-03-22

### Added

- **threads-viral-agent skill integration** — system prompt now loads the complete, battle-tested SKILL.md at runtime. Publishing uses `python3 scripts/threads_api.py` via Bash (same as Claude Code CLI) instead of fragmented MCP tool instructions.
- **Image upload via curl + catbox.moe** — same approach as the working skill: `curl -F "reqtype=fileupload" ... https://litterbox.catbox.moe/...` (24h temp hosting)
- **All Threads post types via script** — carousel, image, video, poll, GIF, spoiler, ghost, quote, link-comment, reply-control, topic-tag, alt-text, text-attachment, thread

### Changed

- **Quick-chip prompts simplified** — pipeline cards now reference the skill directly instead of duplicating 7-step instructions. Claude follows the skill's tested flow.
- **Clean Electron build** — dist/ is now cleaned before build to prevent stale JS bundles from accumulating

## [1.6.1] - 2026-03-22

### Added

- **`upload_image` MCP tool** — upload workspace images to temporary public hosting (catbox.moe litterbox, 24h). Returns public URL for Threads publishing.
- **Auto image pipeline** — system prompt now instructs full automatic flow: NotebookLM PDF → pdftoppm PNG → upload_image → publish_to_threads with image_url. No manual steps.

## [1.6.0] - 2026-03-22

### Added

- **Native TypeScript publishing** — complete rewrite of Threads Graph API client from Python `execFile` to native `fetch()`. Zero Python dependency. Supports all post types: text, image, video, carousel, poll, GIF, spoiler, ghost, quote, link-comment, reply-control, topic-tag, alt-text
- **Workspace containment** — AI agent restricted to session workspace directory. No access to ~/Downloads, ~/Desktop, ~/Documents, or system paths
- **Session workspace validation** — workspace path validated at creation: must exist, must be absolute, blocks system directories (/etc, /usr, /bin, /System, etc.)
- **Publish timeout** — 60s timeout on MCP publish tool with proper timer cleanup (no leaks)
- **IME support** — Chinese/Japanese input method composition no longer triggers message send on Enter
- **Project CLAUDE.md** — architectural rules: no Python deps, workspace containment, credentials from DB, MCP-first publishing

### Fixed

- **Publishing hangs** — replaced Python subprocess with native fetch; added AbortSignal.timeout on all API calls
- **Carousel video children** — video items in carousel now wait for container processing before publish
- **Post ID validation** — throw error if Threads API returns no post ID after publish
- **Insights timeout** — `fetchThreadsInsights` now has 15s timeout (was unbounded)
- **Quick-chip prompts** — removed all ~/Downloads references from 9 prompt strings (3 languages)
- **System prompt contradictions** — removed "full absolute file path" instruction, replaced with workspace-relative path examples
- **Files API** — removed ~/Downloads, ~/Documents, ~/Desktop, ~/Pictures from path whitelist; workspace-only access
- **Dead code** — removed unused `home` variable and stale comments in files.ts
- **Duplicate instruction** — removed duplicate `pdftoppm` step in system prompt
- **maxTurns** — reduced from 200 to 50 to prevent runaway loops

### Security

- All credentials pre-loaded from SQLite DB; AI instructed not to search filesystem for tokens
- Publishing exclusively through built-in MCP tool; no external script execution
- File API restricted to workspace root with symlink-safe realpath check
- npm package excludes `threads_api.py` and account handles

## [1.5.1] - 2026-03-22

### Fixed

- **npm package security** — exclude `threads_api.py` from npm package, sanitize account handles in help text

## [1.5.0] - 2026-03-22

### Added

- **Mac Desktop App release** — `.dmg` download available on GitHub Releases for macOS Apple Silicon. No terminal or Node.js required.
- **5 installation methods** — README updated: Mac Desktop download, npm, source, build desktop, MCP-only
- **MCP uvx migration** — switched from local venv to uvx auto-detection for all 3 MCP servers (trend-pulse, cf-browser, notebooklm)
- **Social accounts sync** — Electron app now shares accounts and settings with development DB

### Fixed

- **TypeScript strict null** — fix `string | null` return type in `subprocess-cli-session.ts`

## [1.4.0] - 2026-03-22

### Added

- **Documentation overhaul** — README rewritten with 4 clear installation methods (npm, source, Electron, MCP-only) and end-to-end production pipeline guide
- **cf-browser dual mode** — support for both `cf-api` (Cloudflare API direct) and `worker` (deployed Worker) modes, configurable via Settings UI
- **Infographic download warning** — NotebookLM docs updated to flag unreliable infographic downloads, recommending `slides` instead

### Fixed

- **esbuild CVE** — override esbuild to >=0.25.0 to resolve security vulnerability

## [1.3.0] - 2026-03-19

### Added

- **Scheduled tasks** — cron-based task scheduling with prompt templates, per-account targeting, quality gate enforcement, and execution history
- **Session resume** — reconnect to existing agent sessions without losing context
- **Account targeting** — scheduled tasks can target specific social accounts with persona prompts
- **Task execution tracking** — SQLite tables for scheduled_tasks and task_executions with status, cost, duration, and retry tracking

## [1.2.0] - 2026-03-17

### Added

- **i18n (Multi-language)** — full UI localization for Traditional Chinese (zh-TW), English (en), and Japanese (ja). All pipeline cards, chips, labels, system prompts, and placeholders adapt
- **Opus model support** — switch between Claude Sonnet 4.6 and Opus 4.6 models
- **Dark mode** — system/light/dark theme with persistent preference
- **Inline images** — image URLs rendered inline in chat responses
- **Draft publishing** — save posts as drafts before publishing
- **Social accounts page** — dedicated UI for managing Threads/Instagram accounts with persona prompts and auto-publish toggles
- **Electron stability** — improved server lifecycle, PATH resolution for nvm/homebrew, native module rebuilds

### Fixed

- **Electron title bar** — padding only applied in Electron mode, not web

## [1.1.0] - 2026-03-15

### Added

- **Full CLI support** — `bin/cli.js` with 23 commands mapping 1:1 to REST API + WebSocket
  - `session list|create|get|rename|delete|messages` — full session CRUD
  - `chat --message|--session|--json` — WebSocket streaming with auto-session-create and stdin pipe
  - `account list|create|update|delete` — social account management
  - `settings get|detect|apply|set` — MCP tool auto-detection and configuration
  - `file list|read` — workspace file browsing with URL-encoded paths
  - `publish|history` — content publishing (existing, now CLI-accessible)
  - `interrupt` — stop running sessions via WebSocket
- **`--json` global flag** — all commands support JSON output for programmatic use (NDJSON for chat streaming)
- **`--port` / `--host` global flags** — override server connection (env: `STUDIO_PORT`, `STUDIO_HOST`)
- **`studio` bin entry** — `npm install -g @claude-world/studio` then `studio <command>`
- **CLI skill file** — `.claude/skills/studio/SKILL.md` with complete command reference
- **CI/CD** — GitHub Actions workflow: typecheck + build + CLI smoke test (~30s)
- **uvx MCP support** — auto-detect and fallback to uvx for MCP server resolution (no path config needed)
- **Full Threads post types** — image, video, carousel, spoiler, ghost, quote, reply-control, topic-tag, alt-text, link-comment
- **setup-mcp wizard** — interactive MCP server setup (`npx @claude-world/studio setup-mcp`) with uvx preferred mode and legacy venv fallback
- **Electron desktop app** — native macOS app with embedded server, npm CLI distribution

### Security

- File paths URL-encoded per segment to prevent malformed HTTP requests
- `parseGlobalFlags` validates `--port` requires numeric value, won't consume flags as values
- `getFlag` won't consume `--flag` tokens as values for other flags
- API requests timeout after 30 seconds (prevents indefinite hangs)
- SIGINT handler flushes interrupt message before exit (ws.send callback + 500ms fallback)
- WebSocket close handler exits 1 on unexpected disconnect (not silent exit 0)
- Cost field handles both `event.cost_usd` and `event.cost` from server

## [1.0.0] - 2026-03-14

### Added

- Initial release: Web UI, REST API, WebSocket, MCP tools
- Agent SDK integration with Claude for AI-powered sessions
- Social publishing to Threads with poll, image, link-comment support
- Settings auto-detection for trend-pulse, cf-browser, notebooklm MCP tools
- Workspace file browsing with path traversal protection
- SQLite storage for sessions, messages, accounts, settings, publish history
