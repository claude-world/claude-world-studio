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

- **Node.js** >= 18
- **Claude Code CLI** installed and authenticated (`npm install -g @anthropic-ai/claude-code`)
- **Python** 3.10+ (for MCP servers)

## Setup Guide

### Step 1: Install Claude World Studio

```bash
git clone https://github.com/claude-world/claude-world-studio.git
cd claude-world-studio
npm install
cp .env.example .env
```

### Step 2: Set Up MCP Servers

The app uses 3 MCP servers — **all optional**, the app works with any combination. Set up what you need:

#### trend-pulse (Trend Discovery) — Recommended

Real-time trends from 20 sources (Google Trends, HN, Reddit, GitHub, etc). **Zero API keys needed.**

```bash
git clone https://github.com/claude-world/trend-pulse.git
cd trend-pulse
python3 -m venv .venv
.venv/bin/pip install -e ".[mcp]"
```

Add to `.env`:
```
TREND_PULSE_PYTHON=/absolute/path/to/trend-pulse/.venv/bin/python
```

#### cf-browser (Web Scraping) — Recommended

Cloudflare Browser Rendering for reading JS-rendered pages. Requires a free Cloudflare account.

```bash
git clone https://github.com/claude-world/cf-browser.git
cd cf-browser
bash setup.sh    # Deploys Worker + installs MCP server
```

Add to `.env`:
```
CF_BROWSER_PYTHON=/absolute/path/to/cf-browser/mcp-server/.venv/bin/python
CF_BROWSER_URL=https://your-cf-browser.workers.dev
CF_BROWSER_API_KEY=your-api-key
```

See [cf-browser README](https://github.com/claude-world/cf-browser) for Cloudflare Worker setup.

#### notebooklm-skill (Research + Media) — Optional

Google NotebookLM integration for podcast, slides, video generation. Requires a Google account.

```bash
git clone https://github.com/claude-world/notebooklm-skill.git
cd notebooklm-skill
pip install -r requirements.txt
python3 scripts/auth_helper.py    # One-time Google login
```

Add to `.env`:
```
NOTEBOOKLM_SERVER_PATH=/absolute/path/to/notebooklm-skill/mcp-server/server.py
```

### Step 3: Start

```bash
npm run dev
# Frontend: http://localhost:5173
# Backend:  http://127.0.0.1:3001
```

The app auto-detects which MCP servers are configured and enables them. Unconfigured servers are silently skipped.

### Step 4: Configure Social Accounts (Optional)

To publish to Threads/Instagram, add accounts via **Settings > Social Accounts** in the UI. You'll need:
- A Meta Developer App with Threads/Instagram API access
- An access token (60-day expiry, renewable via OAuth)

## Security

This is a **local-only development tool**. It runs Claude with full tool access on your machine.

- Binds to `127.0.0.1` only (not exposed to network)
- WebSocket origin verification (exact port whitelist)
- CORS restricted to localhost dev ports
- File API: async realpath + workspace containment check (TOCTOU-safe)
- Path traversal rejected on both client and server
- XSS protection via `rehype-sanitize`
- Session isolation: WS messages filtered by sessionId
- Idle session eviction (30min TTL)
- Query cancellation via AbortController on interrupt/eviction

> **Warning**: Do NOT expose this server to the internet. The AI agent has `Bash`, `Read`, `Write`, and `Edit` access to your filesystem.

## Contributing

Issues and PRs welcome. Please open an issue first to discuss major changes.

## License

MIT
