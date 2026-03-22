# Changelog

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
