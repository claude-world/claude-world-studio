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

function buildAccountsBlock(accounts: SocialAccount[]): string {
  if (accounts.length === 0) {
    return "No social accounts configured. User needs to add accounts in Settings first.";
  }

  const rows = accounts.map((a) =>
    `| ${a.id} | ${a.name} | ${a.handle} | ${a.platform} | ${a.style || "-"} |`
  ).join("\n");

  const personas = accounts
    .filter((a) => a.persona_prompt)
    .map((a) => `**${a.name}** (${a.handle}, ${a.platform}): ${a.persona_prompt}`)
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
- **Time awareness**: After getting trend data, ALWAYS check the timestamps. Discard anything older than 48 hours. Prioritize the most recent items. Mention the date range of the data you're working with.
- **Use ALL sources**: When calling get_trending, pass sources="" (empty string) to query ALL 20 sources. Do NOT filter to just 3-4 sources — the power of trend-pulse is breadth across 20 real-time sources.
- **Verify freshness**: If trend data looks stale or doesn't have timestamps, use WebSearch or cf-browser to verify the topic is still current.
- For ANY question about trends, news, or what's popular: ALWAYS use trend-pulse tools first. Do NOT rely on your training data for current events.
- For web content analysis: use cf-browser tools (browser_markdown for content, browser_screenshot for visuals).
- For research requests: combine trend-pulse + cf-browser (browser_markdown) + WebSearch for comprehensive results.
- **Publishing flow**: ALWAYS use trend-pulse's publish_to_threads (it has built-in quality gate score ≥ 70). Steps: get_scoring_guide → score content → get_review_checklist → publish_to_threads.
- When writing social posts: use get_content_brief(topic) first for strategy, get_platform_specs("threads") for specs, then get_scoring_guide() to self-score before publishing.

## Full Pipeline Workflow
1. **Discover**: get_trending(sources="", geo, count=20) — ALL 20 sources
2. **Verify**: Check timestamps, filter ≤48h, verify with WebSearch if needed
3. **Research**: browser_markdown (cf-browser) + WebSearch for deep dive
4. **Audio** (optional): NotebookLM for audio summary
5. **Brief**: get_content_brief(topic) for writing strategy
6. **Create**: Write content following platform specs from get_platform_specs
7. **Score**: Self-score with get_scoring_guide (must ≥ 70 to publish)
8. **Review**: get_review_checklist for final quality check
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
      permissionMode: "bypassPermissions",
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
    this.queue.close();
  }
}
