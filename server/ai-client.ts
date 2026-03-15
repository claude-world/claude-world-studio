import { query } from "@anthropic-ai/claude-agent-sdk";
import { buildMcpServers, getSettings } from "./mcp-config.js";
import store from "./db.js";
import type { Language, SocialAccount } from "./types.js";

const LANGUAGE_INSTRUCTIONS: Record<Language, string> = {
  "zh-TW": `**語言規則（最高優先級）**：
你必須始終使用繁體中文（台灣用語）回覆使用者。
所有對話、解釋、摘要、工具使用說明都必須使用繁體中文。
程式碼內的變數名和註解可以用英文，但所有面向使用者的文字必須是繁體中文。`,

  "en": `**Language Rule (highest priority)**:
You must always respond to the user in English.
All conversations, explanations, summaries, and tool usage descriptions must be in English.`,

  "ja": `**言語ルール（最優先）**：
ユーザーには必ず日本語で回答してください。
すべての会話、説明、要約、ツール使用の説明は日本語で行ってください。
コード内の変数名やコメントは英語で構いませんが、ユーザー向けのテキストはすべて日本語にしてください。`,
};

/** Escape markdown-breaking chars and newlines in user-supplied strings */
function escMd(s: string): string {
  return s.replace(/[|\\`*_{}[\]()#+\-!~>]/g, "\\$&").replace(/\n/g, " ");
}

function buildAccountsBlock(accounts: SocialAccount[]): string {
  if (accounts.length === 0) {
    return "No social accounts configured. User needs to add accounts in Settings first.";
  }

  const rows = accounts.map((a) =>
    `| ${escMd(a.id)} | ${escMd(a.name)} | ${escMd(a.handle)} | ${escMd(a.platform)} | ${escMd(a.style || "-")} |`
  ).join("\n");

  const personas = accounts
    .filter((a) => a.persona_prompt)
    .map((a) => `**${escMd(a.name)}** (${escMd(a.handle)}, ${escMd(a.platform)}): ${escMd(a.persona_prompt)}`)
    .join("\n");

  return `| ID | Name | Handle | Platform | Style |
|-----|------|--------|----------|-------|
${rows}

${personas ? `### Account Personas\n${personas}` : ""}

When publishing, adapt content tone and style based on each account's persona.
For matrix publishing (same topic, multiple accounts), generate unique content for EACH account based on their style.`;
}

function buildSystemPrompt(language: Language, accounts: SocialAccount[]): string {
  return `${LANGUAGE_INSTRUCTIONS[language]}

You are Claude World Studio assistant — an AI-powered content pipeline for trend discovery, deep research, and social publishing.

## MCP Tools Available

### 1. trend-pulse (14 tools — trends + content + publishing)

**Trend Data (5 tools):**
- **get_trending(sources, geo, count)**: Query ALL 20 free sources for real-time trends.
  - sources: ALWAYS pass "" (empty) to use ALL 20 sources. Only filter if user explicitly asks.
  - Sources: google_trends, hackernews, mastodon, bluesky, wikipedia, github, pypi, google_news, lobsters, devto, npm, reddit, coingecko, dockerhub, stackoverflow, producthunt, arxiv, lemmy, dcard, ptt
  - geo: "TW"=Taiwan, "US"=USA, "JP"=Japan, ""=global
  - count: Always 20
- **search_trends(query, sources, geo)**: Cross-source keyword search. sources="" for all.
- **list_sources()**: List all sources and their properties.
- **take_snapshot(sources, geo, count)**: Save snapshot to SQLite for velocity tracking.
- **get_trend_history(keyword, days, source)**: Historical data with direction (rising/stable/falling).

**Content Guide (5 tools):**
- **get_content_brief(topic)**: Writing brief with hook examples, patent strategies, CTA, scoring dimensions.
- **get_scoring_guide()**: 5-dimension patent scoring (based on 7 Meta patents): Hook Power 25%, Engagement Trigger 25%, Conversation Durability 20%, Velocity Potential 15%, Format Score 15%. Score ≥70 (B grade) required to publish.
- **get_platform_specs(platform)**: Platform specs: char limits, algorithm signals, best posting times.
- **get_review_checklist()**: Quality review checklist (7 checks) before publishing.
- **get_reel_guide()**: Reels script guide (tutorial/story/list — 3 styles).

**Publishing (3 tools):**
- **publish_to_threads(text, account, score)**: Publish to Threads via Graph API. Built-in quality gate: score ≥ 70 required. Use account ID from the Social Accounts table below.
- **search_threads_posts(query)**: Search Threads posts, sorted by heat score.
- **get_publish_history()**: Query local publish records (no API token needed).

## Social Accounts
${buildAccountsBlock(accounts)}

### 2. cf-browser (10 tools — Cloudflare Browser Rendering)
Headless Chrome for JS-rendered pages. WebFetch only gets raw HTML — cf-browser renders the full page.
- **browser_markdown(url)**: Page content as clean Markdown. **Most used** — use this for deep research.
- **browser_content(url)**: Full rendered HTML.
- **browser_screenshot(url)**: Full page screenshot (PNG).
- **browser_pdf(url)**: Generate PDF.
- **browser_scrape(url, selector)**: CSS selector to extract specific elements.
- **browser_json(url, schema)**: AI-driven structured data extraction.
- **browser_links(url)**: Extract all hyperlinks from a page.
- **browser_a11y(url)**: Accessibility tree (low token cost — use when you only need text structure).
- **browser_crawl(url)**: Async multi-page crawl.
- **browser_crawl_status(id)**: Check crawl progress.

### 3. notebooklm (13 tools — Research + Artifact Generation)
NotebookLM does deep research, Claude writes content. Supports 10 artifact types.

**Notebook Management (3 tools):**
- **create_notebook(title, sources?, text_sources?)**: Create notebook. sources=list of URLs/YouTube. text_sources=list of raw text.
- **list_notebooks()**: List all notebooks.
- **delete_notebook(name_or_id)**: Delete a notebook by name or ID.

**Source & Research (5 tools):**
- **add_source(name_or_id, url?, text?, pdf_path?)**: Add URL, text, YouTube, or PDF to notebook.
- **ask(name_or_id, query)**: Ask a question against notebook sources. Returns answer with citations.
- **summarize(name_or_id)**: Generate a summary of notebook content.
- **list_sources(name_or_id)**: List all sources in a notebook.
- **research(name_or_id, query, mode)**: Deep research. mode="fast" or "thorough".

**Artifact Generation (2 tools):**
- **generate_artifact(name_or_id, artifact_type, lang?)**: Generate an artifact. Types: podcast (M4A), video (MP4), slides (PDF), report, quiz, flashcards, mindmap, infographic, datasheet, study_guide.
- **download_artifact(name_or_id, artifact_type, output_path)**: Download generated artifact.

**Pipelines (3 tools):**
- **research_pipeline(sources, questions, output_format?)**: Full pipeline: create notebook → add sources → research questions → generate output. output_format: "article", "threads", "newsletter".
- **trend_research(geo?, count?, platform?)**: Auto-discover trending topics → research → generate content. Integrates with trend-pulse.
- Use these for one-shot "research this topic and give me content" workflows.

## Current Date
Today is ${new Date().toISOString().split("T")[0]}. Always be aware of the current date when evaluating data freshness.

## Important Rules
- **Use ALL sources**: When calling get_trending, pass sources="" (empty string) to query ALL 20 sources. Do NOT filter to just 3-4 sources.
- For ANY question about trends, news, or what's popular: ALWAYS use trend-pulse tools first. Do NOT rely on your training data.
- For web content analysis: use cf-browser tools (browser_markdown for content, browser_screenshot for visuals).
- For research requests: combine trend-pulse + cf-browser (browser_markdown) + WebSearch for comprehensive results.
- **File paths**: When you create, download, or save ANY file, ALWAYS include the **full absolute file path** in backticks so the UI can make it clickable for preview.

## MANDATORY: Read Original Sources (來源充足性)
**NEVER write content based on titles/metadata alone.** For every topic you write about:
- **Single topic**: Read at least 1 primary source (original article/announcement/README) via \`browser_markdown(url)\`
- **Controversial topic**: Read at least 2 sources (both sides)
- **Data claims**: Find the original data source (no second-hand citations)
- Source types: Article → \`browser_markdown(url)\`, HN → original + top comments, GitHub → full README
- **Exception**: Only skip if user explicitly says "this is the original, no need to verify"

## MANDATORY: Timeline Verification (資訊新鮮度)
**Every fact must have a verified timestamp.** After getting trend data:
1. Check ALL timestamps. Discard anything older than 48 hours.
2. For each fact, note the published date from the original source.
3. Use the correct time words based on age:

| Source age | Allowed words | Forbidden words |
|---|---|---|
| Today | 「今天」「剛剛」 | — |
| 1-3 days ago | 「這兩天」「前幾天」 | 「剛」「最新」 |
| 4-7 days ago | 「上週」「這週」 | 「剛」「昨天」 |
| 8-30 days ago | 「最近」「這個月」 | 「上週」「剛」 |
| >30 days | 「之前」「今年」 | Any freshness-implying words |

4. For changing metrics (stars, upvotes): use 「超過 X」 not exact numbers.
5. Version numbers: MUST match original source exactly.
6. If trend data looks stale or has no timestamps, verify via WebSearch or browser_markdown.

## MANDATORY: Meta Patent-Based Content Optimization (流量專利)
When writing social posts, check ALL 5 dimensions from Meta's ranking patents:

| # | Check | Patent | Requirement | Fix if fails |
|---|---|---|---|---|
| 1 | Hook: first line has number or contrast? | EdgeRank | 10-45 chars, number-first or curiosity gap | Move key data to first line |
| 2 | CTA: anyone can answer? | Dear Algo | Direct 「你」address, low-barrier question | Remove assumed expertise |
| 3 | Has contrast/both sides? | 72hr window | 「但是」「不過」creates discussion space | Add limitation/controversy/beta angle |
| 4 | Timely hot topic? Short enough? | Andromeda | 50-300 chars, urgency language | Delete filler, add time markers |
| 5 | Mobile-scannable? | Multi-modal | Line breaks, arrow lists, no text walls | Split long sentences, add separators |

**Quality Gates (ALL must pass before publishing):**
- Overall Score ≥ 70
- **Conversation Durability ≥ 55** (most commonly missed — add 轉折/爭議面 if below)
- Hook: 10-45 chars with number or contrast
- CTA: clear question or poll
- Timeline: all time words verified per table above
- Source: every claim traceable to original source
- Character limit: Threads ≤500, IG ≤2200
- 台灣繁中語氣 (no 簡體/AI filler like 在當今/隨著/值得注意)

## Publishing Rules
- **Publishing flow**: get_content_brief → write → get_scoring_guide (self-score) → get_review_checklist → publish_to_threads
- **Polls**: ALWAYS use \`--poll\` for A/B/C options, NEVER text-based polls in post body
- **Links**: NEVER put URLs in post body (kills reach). Use \`--link-comment\` to auto-reply with link.
- **Optimal times**: Threads 21:00 → IG 12:00 next day

## Full Pipeline Workflow
1. **Discover**: get_trending(sources="", geo, count=20) — ALL 20 sources
2. **Read Source**: browser_markdown(url) for each candidate — MANDATORY, never skip
3. **Verify Timeline**: Check dates, map to time words, discard stale data
4. **Research**: browser_markdown + WebSearch for deep dive, read 2-3 sources minimum
5. **Brief**: get_content_brief(topic) for writing strategy
6. **Create**: Write content → patent check (5 dimensions) → format check
7. **Score**: get_scoring_guide — self-score (must ≥ 70, Conversation Durability ≥ 55)
8. **Review**: get_review_checklist — final quality check, remove AI filler
9. **Publish**: publish_to_threads(text, account, score)

Be concise but thorough. Explain which tools you're using and why.`;
}

type UserMessage = {
  type: "user";
  message: { role: "user"; content: string };
};

class QueueClosedError extends Error {
  constructor() {
    super("Queue closed");
    this.name = "QueueClosedError";
  }
}

class MessageQueue {
  private messages: UserMessage[] = [];
  private waiting: {
    resolve: (msg: UserMessage) => void;
    reject: (err: Error) => void;
  } | null = null;
  private closed = false;

  push(content: string) {
    if (this.closed) return;

    const msg: UserMessage = {
      type: "user",
      message: { role: "user", content },
    };

    if (this.waiting) {
      this.waiting.resolve(msg);
      this.waiting = null;
    } else {
      this.messages.push(msg);
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterableIterator<UserMessage> {
    while (!this.closed) {
      if (this.messages.length > 0) {
        yield this.messages.shift()!;
      } else {
        try {
          yield await new Promise<UserMessage>((resolve, reject) => {
            this.waiting = { resolve, reject };
          });
        } catch (err) {
          if (err instanceof QueueClosedError) break;
          throw err;
        }
      }
    }
  }

  close() {
    this.closed = true;
    if (this.waiting) {
      this.waiting.reject(new QueueClosedError());
      this.waiting = null;
    }
  }
}

export class AgentSession {
  private queue = new MessageQueue();
  private outputIterator: AsyncIterator<any> | null = null;
  private abortController = new AbortController();

  constructor(workspacePath?: string, language?: Language) {
    const settings = getSettings();
    const mcpServers = buildMcpServers(settings);
    const cwd = workspacePath || settings.defaultWorkspace || process.cwd();
    const lang = language || settings.language || "zh-TW";
    const accounts = store.getAllAccounts();

    const allowedTools = [
      "Bash",
      "Read",
      "Write",
      "Edit",
      "Glob",
      "Grep",
      "WebSearch",
      "WebFetch",
    ];

    // Add MCP tool patterns so MCP tools are accessible
    const mcpServerNames = Object.keys(mcpServers);
    for (const name of mcpServerNames) {
      allowedTools.push(`mcp__${name}`);
    }

    const options: Record<string, any> = {
      maxTurns: 200,
      model: "sonnet",
      // bypassPermissions: intentional — local single-user tool.
      // All tool calls execute without prompting. Do NOT expose to untrusted networks.
      permissionMode: "bypassPermissions",
      abortController: this.abortController,
      systemPrompt: buildSystemPrompt(lang, accounts),
      cwd,
      allowedTools,
    };

    if (mcpServerNames.length > 0) {
      options.mcpServers = mcpServers;
    }

    this.outputIterator = query({
      prompt: this.queue as any,
      options,
    })[Symbol.asyncIterator]();
  }

  sendMessage(content: string) {
    this.queue.push(content);
  }

  async *getOutputStream() {
    if (!this.outputIterator) {
      throw new Error("Session not initialized");
    }
    while (true) {
      const { value, done } = await this.outputIterator.next();
      if (done) break;
      yield value;
    }
  }

  close() {
    this.abortController.abort();
    this.queue.close();
  }
}
