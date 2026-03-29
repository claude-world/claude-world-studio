---
name: studio
description: Claude World Studio CLI - full command reference for all CLI operations
user_invocable: false
---

# Claude World Studio CLI

Full CLI for Claude World Studio. Maps 1:1 to the REST API + WebSocket.

## Install

```bash
# Option A: npm global (recommended)
npm install -g @claude-world/studio
studio <command>

# Option B: From source
git clone https://github.com/claude-world/claude-world-studio.git
cd claude-world-studio && npm install
node bin/cli.js <command>
# or: npm link && studio <command>

# Option C: Electron Desktop App
npm run electron:dev            # development
npm run electron:build          # production (.app + .dmg)
```

## MCP Server Setup

```bash
# One-command setup (uvx preferred, auto-cached)
npx @claude-world/studio setup-mcp

# Or legacy venv mode
npx @claude-world/studio setup-mcp --venv

# Update installed servers
npx @claude-world/studio setup-mcp --update
```

## Quick Reference

```bash
# Server
studio serve                    # Start web UI
studio status                   # Check if running

# Sessions
studio session list
studio session create --title "Research" --workspace /path
studio session get <ID>
studio session rename <ID> --title "New Title"
studio session delete <ID>
studio session messages <ID> --limit 20

# Chat (WebSocket streaming)
studio chat --message "Find trends" --json
studio chat --session <ID> --message "Publish the best"
echo "What's trending?" | studio chat --json
studio interrupt <ID>

# Accounts
studio account list
studio account create --name "Main" --handle "@me" --platform threads --token TOKEN
studio account update <ID> --token NEW_TOKEN
studio account delete <ID>

# Settings
studio settings get
studio settings detect          # Scan system for MCP tools
studio settings apply           # Apply detected values
studio settings set --language en --default-workspace /path

# Publishing (supports all Threads post types)
studio publish --account <ID> --text "Hello!" --score 85
studio publish --account <ID> --text "Vote!" --poll "Option A|Option B"
studio publish --account <ID> --text "Look!" --image "https://url/img.png"
studio publish --account <ID> --text "Watch" --video "https://url/vid.mp4"
studio publish --account <ID> --text "Slides" --carousel URL1 URL2 URL3
studio publish --account <ID> --text "Mood" --gif-id "GIPHY_ID"
studio publish --account <ID> --text "Read" --link-attachment "https://url"
studio publish --account <ID> --text "TL;DR" --text-attachment article.txt
studio publish --account <ID> --text "Spoiler!" --image URL --spoiler-media
studio publish --account <ID> --text "Secret text" --spoiler-text "7:4"
studio publish --account <ID> --text "24hr only" --ghost
studio publish --account <ID> --text "My take" --quote-post-id "12345"
studio publish --account <ID> --text "Post" --reply-control mentioned_only
studio publish --account <ID> --text "Post" --topic-tag "AI" --alt-text "desc"
studio publish --account <ID> --text "Post" --link-comment "https://url"
studio history --limit 10

# Files
studio file list <SESSION_ID> --depth 2
studio file read <SESSION_ID> src/index.ts
```

## Global Flags

| Flag       | Env Var       | Default   | Description                  |
| ---------- | ------------- | --------- | ---------------------------- |
| `--json`   | —             | false     | JSON output for all commands |
| `--port N` | `STUDIO_PORT` | 3001      | Server port                  |
| `--host H` | `STUDIO_HOST` | 127.0.0.1 | Server host                  |

## Chat Command

The `chat` command connects via WebSocket for real-time streaming.

**Auto-create session**: Omit `--session` to auto-create. Session ID is printed to stderr.

**Input sources** (priority order):

1. `--message "text"` flag
2. stdin pipe: `echo "text" | studio chat`

**Output modes**:

- Default: assistant text → stdout, tool calls → stderr (with `--verbose`)
- `--json`: NDJSON — one JSON object per event line

**NDJSON event types**:

```jsonl
{"type":"assistant_message","content":"Here are the trends..."}
{"type":"tool_use","toolName":"get_trending","toolId":"..."}
{"type":"tool_result","content":"..."}
{"type":"result","success":true,"cost_usd":0.03}
```

**Ctrl+C** sends an interrupt to the session and exits with code 130.

## Production Pipeline Examples

### Headless: Research → Publish

```bash
SESSION=$(studio session create --title "Auto Pipeline" --json | jq -r '.id')
studio chat --session $SESSION --message "Find top 3 trending AI topics in Taiwan" --json > trends.jsonl
RESPONSE=$(grep '"type":"assistant_message"' trends.jsonl | tail -1 | jq -r '.content')
studio publish --account acc123 --text "$RESPONSE" --score 80 --json
```

### Freestyle: Full Autopilot

```bash
studio chat --message "Freestyle: find trending topics, research the best, \
  write a Threads post, score it, and publish to @mybrand" --json
```

### Scheduled: Daily Content via Cron

```bash
# System cron (daily 9 AM)
0 9 * * * studio chat --message "Freestyle pipeline for @mybrand" --json >> ~/studio.log 2>&1
```

Or use Studio's built-in scheduler: **Settings > Scheduled Tasks** with per-account targeting and quality gates.

### Multi-Account: Different Personas

```bash
studio publish --account brand-tech --text "Technical deep-dive..." --score 85
studio publish --account brand-casual --text "Hey did you hear..." --score 75
```

## Settings Keys

| CLI Flag               | API Key              | Description                         |
| ---------------------- | -------------------- | ----------------------------------- |
| `--language`           | language             | UI language (en, zh-TW, ja)         |
| `--theme`              | theme                | UI theme (light, dark, system)      |
| `--trend-pulse-python` | trendPulseVenvPython | trend-pulse venv python path        |
| `--cf-browser-python`  | cfBrowserVenvPython  | cf-browser venv python path         |
| `--notebooklm-path`    | notebooklmServerPath | NotebookLM server.py path           |
| `--cf-browser-url`     | cfBrowserUrl         | CF Browser worker URL               |
| `--cf-browser-key`     | cfBrowserApiKey      | CF Browser API key                  |
| `--cf-account-id`      | cfAccountId          | Cloudflare account ID (cf-api mode) |
| `--cf-api-token`       | cfApiToken           | Cloudflare API token (cf-api mode)  |
| `--default-workspace`  | defaultWorkspace     | Default workspace path              |

## Instructions for Claude Code

When operating Studio via CLI:

1. **Always use `--json`** for programmatic access
2. **Check status first**: `studio status --json` before other commands
3. **Chat auto-creates sessions** — no need to manually create unless reusing
4. **Parse NDJSON** line by line for chat output
5. **Use stdin pipe** for long messages or multi-line content
6. **Interrupt via CLI** rather than killing the process: `studio interrupt <ID>`
