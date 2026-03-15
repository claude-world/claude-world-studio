# Claude World Studio

AI-powered content pipeline: from trend discovery to social publishing.

Built with **Claude Agent SDK + MCP** (Model Context Protocol), featuring 3 integrated MCP servers for real-time trends, web scraping, and research automation.

![Welcome Screen](demo/01-welcome.png)

## Features

### One-Stop Pipeline

Three clear entry points — no complex menus, just pick and go:

![Pipeline Cards](demo/02-pipeline-cards.png)

| Card | Action | What happens |
|------|--------|-------------|
| **Freestyle** | One click, zero input | Auto: trends → read source → verify timeline → patent score → publish |
| **Custom Topic** | Type your topic | Deep research → score → publish |
| **Custom + Media** | Type your topic | Research → NotebookLM slides/video/podcast → publish |

### Smart Input Fill

Click "Custom Topic" and the input auto-fills with a template prompt. A hint guides what to type:

![Custom Topic](demo/03-custom-topic-fill.png)

### Live Agent Execution

Watch Claude work in real-time — tool calls shown as collapsible blocks with MCP server badges. Loading state keeps the Stop button visible throughout long operations:

![Loading State](demo/05-loading-state.png)

![Tool Calls](demo/06-tool-calls.png)

- **trend-pulse** (green) — 20 real-time trend sources, zero auth
- **cf-browser** (blue) — Cloudflare Browser Rendering for JS pages
- **notebooklm** (purple) — Research + artifact generation (podcast/slides/video)

### Rich Markdown Responses

Full markdown rendering with syntax highlighting, clickable source links, cost/duration tracking, and inline file path previews:

![Rich Content](demo/07-history-rich.png)

### File Explorer + Preview

Browse workspace files with inline image thumbnails. Click any file to open a full-screen preview modal supporting images, PDFs, audio, video, and text:

![File Explorer](demo/08-file-explorer.png)

### Multi-Language (i18n)

Full support for Traditional Chinese, English, and Japanese — all pipeline cards, chips, UI labels, system prompts, and placeholder text adapt:

<table>
<tr>
<td><img src="demo/09-en-cards.png" alt="EN" width="400"/></td>
<td><img src="demo/10-ja-cards.png" alt="JA" width="400"/></td>
</tr>
<tr>
<td align="center">English</td>
<td align="center">Japanese</td>
</tr>
</table>

### Social Publishing

Built-in publish flow with Meta's patent-based scoring. Every post is checked against 5 ranking dimensions before publishing:

| Dimension | Patent | What it checks |
|-----------|--------|---------------|
| Hook Power | EdgeRank | First line has number or contrast? (10-45 chars) |
| Engagement Trigger | Dear Algo | CTA anyone can answer? |
| Conversation Durability | 72hr window | Has both sides / contrast? |
| Velocity Potential | Andromeda | Short enough? Timely? |
| Format Score | Multi-modal | Mobile-scannable? |

Quality gates: Overall >= 70, Conversation Durability >= 55. Supports `--poll` for native polls, `--link-comment` to avoid URL reach penalty.

### Source Verification & Timeline Rules

Content integrity is enforced at the system level:

- **Read original sources** — Never write from titles/metadata alone. At least 1 primary source per topic, 2+ for controversial topics.
- **Timeline verification** — Every fact gets a verified timestamp. Time words are mapped by age (today = "just now", 1-3 days = "recently", etc.).
- **No AI filler** — System prompt blocks generic phrases like "in today's world" / "it's worth noting".

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  React UI   │────▶│  Express + WS    │────▶│  Claude Agent   │
│  (Vite)     │◀────│  Server          │◀────│  SDK            │
└─────────────┘     └──────────────────┘     └────────┬────────┘
                                                      │
                           ┌──────────────────────────┤
                           │            │             │
                    ┌──────▼──┐  ┌──────▼───┐  ┌─────▼──────┐
                    │ trend-  │  │ cf-      │  │ notebooklm │
                    │ pulse   │  │ browser  │  │            │
                    │ (MCP)   │  │ (MCP)    │  │ (MCP)      │
                    └─────────┘  └──────────┘  └────────────┘
                    20 sources    Cloudflare    Podcast/Slides
                    zero auth     Browser       /Video/Report
```

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React 18 + Vite + Tailwind CSS |
| Backend | Express + WebSocket + Claude Agent SDK |
| AI Model | Claude Sonnet 4.6 |
| MCP Servers | trend-pulse, cf-browser, notebooklm |
| Database | SQLite (better-sqlite3) |
| Markdown | react-markdown + rehype-sanitize |

## Prerequisites

- Node.js >= 18
- Claude Code CLI installed and authenticated
- Python 3.10+ (for MCP servers)
- MCP servers set up: [trend-pulse](https://github.com/claude-world/trend-pulse), [cf-browser](https://github.com/claude-world/cf-browser), [notebooklm-skill](https://github.com/claude-world/notebooklm-skill)

## Quick Start

```bash
# Install dependencies
npm install

# Configure MCP server paths
cp .env.example .env
# Edit .env — set TREND_PULSE_PYTHON, CF_BROWSER_PYTHON, NOTEBOOKLM_SERVER_PATH

# Start dev server (frontend + backend)
npm run dev

# Open http://localhost:5173
```

## Security

- Binds to `127.0.0.1` only (local use, not network-exposed)
- WebSocket origin verification (exact port whitelist)
- CORS restricted to localhost dev ports
- File API: async realpath + workspace containment check (TOCTOU-safe)
- Path traversal rejected on both client and server
- XSS protection via `rehype-sanitize`
- Session isolation: WS messages filtered by sessionId
- Idle session eviction (30min TTL)
- Query cancellation via AbortController on interrupt/eviction
