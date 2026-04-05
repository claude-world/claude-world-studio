import { query } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { buildMcpServers, getSettings } from "./mcp-config.js";
import { createStudioMcpServer } from "./services/studio-mcp.js";
import store from "./db.js";
import type { Language, SocialAccount } from "./types.js";
import type { ICliSession } from "./cli-session.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Load the threads-viral-agent SKILL.md on demand (strip frontmatter) */
function loadViralAgentSkill(): string {
  try {
    const skillPath = join(__dirname, "../.claude/skills/threads-viral-agent/SKILL.md");
    const raw = readFileSync(skillPath, "utf-8");
    // Strip YAML frontmatter (--- ... ---)
    return raw.replace(/^---[\s\S]*?---\n*/, "").trim();
  } catch {
    return "";
  }
}

const LANGUAGE_INSTRUCTIONS: Record<Language, string> = {
  "zh-TW": `**語言規則（最高優先級）**：
你必須始終使用繁體中文（台灣用語）回覆使用者。
所有對話、解釋、摘要、工具使用說明都必須使用繁體中文。
程式碼內的變數名和註解可以用英文，但所有面向使用者的文字必須是繁體中文。`,

  en: `**Language Rule (highest priority)**:
You must always respond to the user in English.
All conversations, explanations, summaries, and tool usage descriptions must be in English.`,

  ja: `**言語ルール（最優先）**：
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

  const rows = accounts
    .map(
      (a) =>
        `| ${escMd(a.id)} | ${escMd(a.name)} | ${escMd(a.handle)} | ${escMd(a.platform)} | ${escMd(a.style || "-")} |`
    )
    .join("\n");

  const personas = accounts
    .filter((a) => a.persona_prompt)
    .map(
      (a) =>
        `**${escMd(a.name)}** (${escMd(a.handle)}, ${escMd(a.platform)}): ${escMd(a.persona_prompt)}`
    )
    .join("\n");

  return `| ID | Name | Handle | Platform | Style |
|-----|------|--------|----------|-------|
${rows}

${personas ? `### Account Personas\n${personas}` : ""}

When publishing, adapt content tone and style based on each account's persona.
For matrix publishing (same topic, multiple accounts), generate unique content for EACH account based on their style.`;
}

export function buildSystemPrompt(
  language: Language,
  accounts: SocialAccount[],
  minOverall = 70,
  minConversation = 55
): string {
  const viralAgentSkill = loadViralAgentSkill();
  return `${LANGUAGE_INSTRUCTIONS[language]}

You are Claude World Studio assistant — an AI-powered content pipeline for trend discovery, deep research, and social publishing.

## MCP Tools Available

### 1. trend-pulse (11 tools — trends + content + rendering)

**Trend Data (5 tools):**
- **get_trending(sources, geo, count, save)**: Query ALL 20 free sources for real-time trends.
  - sources: ALWAYS pass "" (empty) to use ALL 20 sources. Only filter if user explicitly asks.
  - Sources: google_trends, hackernews, mastodon, bluesky, wikipedia, github, pypi, google_news, lobsters, devto, npm, reddit, coingecko, dockerhub, stackoverflow, producthunt, arxiv, lemmy, dcard, ptt
  - geo: "TW"=Taiwan, "US"=USA, "JP"=Japan, ""=global
  - count: Always 20
  - save: true to save snapshot for velocity tracking
- **search_trends(query, sources, geo)**: Cross-source keyword search. sources="" for all.
- **list_sources()**: List all sources and their properties.
- **take_snapshot(sources, geo, count)**: Save snapshot to SQLite for velocity tracking.
- **get_trend_history(keyword, days, source)**: Historical data with direction (rising/stable/falling).

**Content Guide (5 tools):**
- **get_content_brief(topic, content_type?, platform?, lang?)**: Writing brief with hook examples, patent strategies, CTA, scoring dimensions. content_type: opinion, story, debate, howto, list, question, news, meme (default: debate). platform: threads/instagram/facebook. lang: auto/en/zh-TW.
- **get_scoring_guide(lang?, topic?)**: 5-dimension patent scoring. Hook Power 25%, Engagement Trigger 25%, Conversation Durability 20%, Velocity Potential 15%, Format Score 15%. Score ≥${minOverall} required to publish.
- **get_platform_specs(platform?, lang?)**: Platform specs: char limits, algorithm signals, best posting times.
- **get_review_checklist(platform?, lang?, topic?)**: Quality review checklist (9 checks) before publishing.
- **get_reel_guide(style?, duration?, lang?, topic?)**: Reels script guide. style: educational/storytelling/listicle. duration: seconds (default 30).

**Browser Rendering (1 tool):**
- **render_page(url, format?)**: Render JS-heavy pages via Cloudflare Browser. format: markdown (default), content (HTML), json (structured).

### 4. studio (3 tools — publishing + image upload + history, in-process)
- **publish_to_threads(text, account_id, score, image_url?, video_url?, carousel_urls?, poll_options?, link_comment?, tag?)**: Publish to Threads via Graph API. Quality gate: score ≥ ${minOverall} required. Supports ALL post types:
  - \`image_url\`: single image post (pass 1 public URL)
  - \`video_url\`: single video post (pass 1 public URL)
  - \`carousel_urls\`: carousel post (pass array of 2-20 public URLs, mix of images/videos OK, .mp4/.mov auto-detected as video)
  - \`poll_options\`: native poll (pipe-separated "A|B|C")
  - \`link_comment\`: auto-reply with link (avoids reach penalty)
  - \`tag\`: topic tag
- **upload_image(file_path)**: Upload a local image (PNG/JPG/GIF/WebP, max 10MB) to 24h temporary public hosting. Returns a public URL. File path must be relative to workspace (e.g., \`downloads/card-1.png\`). Use this to get public URLs before calling publish_to_threads.
- **get_publish_history(limit?)**: Query local publish records (no API token needed).

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
NotebookLM does deep research, Claude writes content. Supports 9 downloadable artifact types (infographic excluded — download unreliable, use slides).

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
- **generate_artifact(name_or_id, artifact_type, lang?)**: Generate an artifact. Types: podcast (M4A), slides (PDF), report, quiz, flashcards, mindmap, infographic, datasheet, study_guide.
- **download_artifact(name_or_id, artifact_type, output_path)**: Download generated artifact.

**IMPORTANT: Video Synthesis (slides + podcast → MP4)**
NotebookLM does NOT produce usable video directly. To create a video:
1. Generate \`slides\` (PDF) + \`audio\` (podcast M4A) — run these sequentially, NOT in parallel (MCP is single-connection)
2. Download both artifacts to local files
3. Convert PDF pages to images: \`pdftoppm -png -r 300 slides.pdf slides_page\`
4. Combine with ffmpeg:
\`\`\`bash
# Calculate duration per slide: total_audio_duration / num_slides
duration=$(ffprobe -v error -show_entries format=duration -of csv=p=0 audio.mp3)
num_slides=$(ls slides_page-*.png | wc -l)
per_slide=$(echo "$duration / $num_slides" | bc -l)
# Create video with crossfade transitions
ffmpeg -framerate 1/$per_slide -pattern_type glob -i 'slides_page-*.png' -i audio.mp3 -c:v libx264 -profile:v baseline -pix_fmt yuv420p -c:a aac -shortest output.mp4
\`\`\`
5. Save the output MP4 inside the workspace (e.g., \`downloads/output.mp4\`). Include the file path in backticks.

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

## Workspace & Security Policy (MANDATORY)
- **Workspace containment**: ALL files you create, download, or save MUST go inside the workspace directory. Use relative paths like \`downloads/card.pdf\`. NEVER save files to ~/Downloads, ~/Desktop, ~/Documents, or any path outside the workspace. Include file paths in backticks so the UI can make them clickable.
- **No filesystem exploration**: Do NOT use Bash, Glob, or Grep to search for files, tokens, credentials, or configurations outside the workspace. Do NOT run \`find\`, \`ls ~/\`, or any command that accesses paths outside the workspace.
- **Credentials pre-loaded**: All account tokens, API keys, and settings are already loaded in the Studio database and available through Studio MCP tools. Do NOT search the filesystem for .env files, tokens, or credentials. Do NOT ask the user for tokens that are already configured in Settings.
- **Publishing**: ALWAYS use the \`publish_to_threads\` Studio MCP tool. It reads tokens from the database automatically. Do NOT attempt to call Python scripts, REST APIs via curl, or any other publishing method.
- **Bash usage**: Only use Bash for data processing within the workspace (ffmpeg, pdftoppm, etc.). Never use Bash to access paths outside the workspace.

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
- Overall Score ≥ ${minOverall}
- **Conversation Durability ≥ ${minConversation}** (most commonly missed — add 轉折/爭議面 if below)
- Hook: 10-45 chars with number or contrast
- CTA: clear question or poll
- Timeline: all time words verified per table above
- Source: every claim traceable to original source
- Character limit: Threads ≤500, IG ≤2200
- 台灣繁中語氣 (no 簡體/AI filler like 在當今/隨著/值得注意)

## Publishing Workflow (threads-viral-agent Skill Reference)

For content strategy (post type decision, quality gates, Meta patent scoring), follow the threads-viral-agent skill guidelines below.
**However, for ALL actual publishing and image upload operations, use Studio MCP tools:**
- **Publishing**: \`publish_to_threads\` MCP tool (reads tokens from DB, handles all post types)
- **Image upload**: \`upload_image\` MCP tool (uploads to temporary hosting, returns public URL)
- **Publish history**: \`get_publish_history\` MCP tool
- **Do NOT use**: \`python3 scripts/threads_api.py\`, \`curl\`, or any Bash-based publishing — those are for Claude Code CLI context only, not Studio.

**All files saved to workspace directory, not ~/Downloads.**

---

${viralAgentSkill}

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

export class AgentSession implements ICliSession {
  readonly cliName = "claude";
  private queue = new MessageQueue();
  private queryHandle: ReturnType<typeof query> | null = null;
  private outputIterator: AsyncIterator<any> | null = null;
  private abortController = new AbortController();

  constructor(workspacePath?: string, language?: Language, resumeContext?: string) {
    const settings = getSettings();
    const mcpServers = buildMcpServers(settings);
    const cwd = workspacePath || settings.defaultWorkspace || process.cwd();
    const lang = language || settings.language || "zh-TW";
    const accounts = store.getAllAccounts();

    // In-process Studio MCP server (direct DB access, no env vars)
    const studioServer = createStudioMcpServer();

    const allowedTools = ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebSearch", "WebFetch"];

    // Add MCP tool patterns so MCP tools are accessible
    const allMcpServers: Record<string, any> = { ...mcpServers, studio: studioServer };
    const mcpServerNames = Object.keys(allMcpServers);
    for (const name of mcpServerNames) {
      allowedTools.push(`mcp__${name}`);
    }

    let systemPrompt = buildSystemPrompt(
      lang,
      accounts,
      settings.minOverallScore,
      settings.minConversationScore
    );

    // Append conversation history for resumed sessions
    if (resumeContext) {
      systemPrompt += `\n\n## Resumed Session — Previous Conversation\nThis session was interrupted (app closed or server restarted). Below is the conversation history from before. Continue naturally from where it left off — do NOT repeat or summarize unless the user asks.\n\n${resumeContext}`;
    }

    const options: Record<string, any> = {
      maxTurns: 50,
      model: "opus",
      // bypassPermissions: intentional — local single-user tool.
      // All tool calls execute without prompting. Do NOT expose to untrusted networks.
      permissionMode: "bypassPermissions",
      // SDK 0.2 requires this flag alongside permissionMode: "bypassPermissions"
      allowDangerouslySkipPermissions: true,
      abortController: this.abortController,
      systemPrompt,
      cwd,
      allowedTools,
      // Prevent confusion: trend-pulse publish tool is superseded by studio
      disallowedTools: [
        "mcp__trend-pulse__publish_to_threads",
        "mcp__trend-pulse__get_publish_history",
      ],
      mcpServers: allMcpServers,
      // Use absolute node path — Electron's PATH doesn't include system node
      // STUDIO_NODE_PATH is set by electron/main.cjs; process.execPath may point to Electron binary
      executable: process.env.STUDIO_NODE_PATH || process.execPath,
    };

    // Store the Query handle so we can call .close() on interrupt
    this.queryHandle = query({
      prompt: this.queue as any,
      options,
    });
    this.outputIterator = this.queryHandle[Symbol.asyncIterator]();
  }

  sendMessage(content: string) {
    this.queue.push(content);
  }

  async *getOutputStream() {
    if (!this.outputIterator) {
      throw new Error("Session not initialized");
    }
    while (true) {
      // Abort guard — stop yielding after abort (Claude Code pattern from query.ts:839)
      if (this.abortController.signal.aborted) break;
      const { value, done } = await this.outputIterator.next();
      if (done || this.abortController.signal.aborted) break;
      yield value;
    }
  }

  close() {
    this.abortController.abort();
    this.queue.close();
    // Cleanly terminate the SDK subprocess and release resources
    this.queryHandle?.close();
  }
}
