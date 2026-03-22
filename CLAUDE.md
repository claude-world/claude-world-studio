# Claude World Studio

Content pipeline app: trend discovery, deep research, social publishing.

## Architecture

- `server/` — Express + WebSocket server, Claude Agent SDK integration
- `client/` — React + Tailwind UI (Vite build)
- `electron/` — Electron desktop wrapper
- `scripts/` — Build scripts only (no runtime scripts)
- `.claude/skills/` — Skill definitions for Claude Code

## Key Design Rules

1. **No Python runtime dependencies**: Publishing uses native TypeScript `fetch()`, not Python scripts. The `threads_api.py` is a dev-only tool, not used by the server.
2. **Workspace containment**: The AI agent operates within the session workspace only. Never reference `~/Downloads` or paths outside workspace in prompts or examples. Use relative paths like `downloads/card.pdf`.
3. **Credentials from DB**: All tokens and API keys are stored in SQLite DB and loaded automatically by Studio MCP tools. Never search the filesystem for credentials.
4. **MCP-first publishing**: Publishing goes through the `publish_to_threads` Studio MCP tool, which reads tokens from DB. No direct API calls from the agent.
5. **Timeout safety**: All MCP tool calls have timeouts to prevent hanging sessions.

## Dev Commands

```bash
npm run dev              # Start dev server + Vite
npm run build            # Build client
npm run typecheck        # TypeScript check
npm run electron:dev     # Electron dev mode
npm run electron:build   # Production .dmg
```
