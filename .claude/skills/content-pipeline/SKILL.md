---
name: content-pipeline
description: Full-autopilot trend discovery, deep research, and social publishing pipeline. Uses trend-pulse (20 sources), cf-browser (headless Chrome), and notebooklm (research + artifacts) MCP servers. Generates algorithm-optimized content based on Meta's 7 patent-based ranking algorithms. Use when user mentions trending topics, content creation, social media publishing, trend analysis, research pipeline, viral content, content scoring, or Threads posting.
user_invocable: true
---

# Content Pipeline

AI-powered content pipeline: trend discovery -> deep research -> algorithm-optimized writing -> social publishing.

## MCP Servers Required

Install via uvx (one-time, auto-cached):

```bash
uvx --from 'trend-pulse[mcp]' trend-pulse-server
uvx --from cf-browser-mcp cf-browser-mcp
uvx --from notebooklm-skill notebooklm-mcp
```

## MCP Tools Reference

### trend-pulse (12 tools)

**Trend Data:**

- **get_trending(sources, geo, count)**: Query ALL 20 free sources. sources="" for all. geo: "TW"/"US"/"JP"/"". count: 20.
  - Sources: google_trends, hackernews, mastodon, bluesky, wikipedia, github, pypi, google_news, lobsters, devto, npm, reddit, coingecko, dockerhub, stackoverflow, producthunt, arxiv, lemmy, dcard, ptt
- **search_trends(query, sources, geo)**: Cross-source keyword search.
- **list_sources()**: List all sources.
- **take_snapshot(sources, geo, count)**: Save snapshot for velocity tracking.
- **get_trend_history(keyword, days, source)**: Historical data with direction.

**Content Guide:**

- **get_content_brief(topic)**: Writing brief with hook examples, patent strategies, CTA.
- **get_scoring_guide()**: 5-dimension patent scoring. Score >= 70 required.
- **get_platform_specs(platform)**: Platform specs (char limits, algorithm signals, posting times).
- **get_review_checklist()**: Quality review checklist (7 checks).
- **get_reel_guide()**: Reels script guide (3 styles).

**Search:**

- **search_threads_posts(query)**: Search Threads posts by heat score.

### cf-browser (10 tools)

Headless Chrome via Cloudflare Browser Rendering. Use instead of WebFetch for JS-rendered pages.

- **browser_markdown(url)**: Clean Markdown. **Most used** for deep research.
- **browser_content(url)**: Full rendered HTML.
- **browser_screenshot(url)**: Full page screenshot (PNG).
- **browser_pdf(url)**: Generate PDF.
- **browser_scrape(url, selector)**: CSS selector extraction.
- **browser_json(url, schema)**: AI-driven structured data extraction.
- **browser_links(url)**: Extract all hyperlinks.
- **browser_a11y(url)**: Accessibility tree (low token cost).
- **browser_crawl(url)**: Async multi-page crawl.
- **browser_crawl_status(id)**: Check crawl progress.

### notebooklm (13 tools)

Deep research + 9 downloadable artifact types (podcast, slides, report, quiz, flashcards, mindmap, datasheet, study_guide).
⚠️ `infographic` download is unreliable — use `slides` instead.

**Management:** create_notebook, list_notebooks, delete_notebook
**Research:** add_source, ask, summarize, list_sources, research(mode="fast"|"thorough")
**Artifacts:** generate_artifact(type, lang?), download_artifact(type, output_path)
**Pipelines:** research_pipeline(sources, questions, output_format), trend_research(geo?, count?, platform?)

**Video Synthesis (slides + podcast -> MP4):**

1. Generate slides (PDF) + audio (podcast M4A) — sequentially
2. Download both
3. `pdftoppm -png -r 300 slides.pdf slides_page`
4. `ffmpeg -framerate 1/$per_slide -pattern_type glob -i 'slides_page-*.png' -i audio.mp3 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest output.mp4`

## Visual Content Generation

Use **NotebookLM** to generate all visual content. It produces professional-quality slides and mind maps — far better than HTML/CSS artifacts.
⚠️ Do NOT use `infographic` (download unreliable). Use `slides` for all visual content.

### Image Cards & Slides (圖卡 / 簡報)

**Workflow:** Create a NotebookLM notebook with the content as a text source, then generate the visual artifact.

```
1. create_notebook(title="Post Visual", text_sources=["<post content + key data points>"])
2. generate_artifact(name_or_id, "slides", lang="zh-TW")   → PDF slides (best for cards)
3. download_artifact(name_or_id, "slides", "downloads/card.pdf")
```

**Choose artifact type by use case:**

| Need                 | Artifact Type                | Output                                              |
| -------------------- | ---------------------------- | --------------------------------------------------- |
| Single image card    | `slides` (1 slide)           | PDF → export as image                               |
| Multi-slide carousel | `slides` (N slides)          | PDF → split per page                                |
| Data visualization   | `slides`                     | ~~infographic~~ ⚠️ download unreliable — use slides |
| Topic overview       | `mindmap`                    | Mind map diagram                                    |
| Detailed report      | `report`                     | Formatted document                                  |
| Study material       | `flashcards` / `study_guide` | Learning cards                                      |

### Carousel Posts (輪播貼文)

For multi-image carousel (Threads supports 2-20 images):

1. Create notebook with content organized as numbered sections (one per slide)
2. `generate_artifact(name_or_id, "slides")` → multi-page PDF
3. Download and split: `pdftoppm -png -r 300 slides.pdf slide`
4. Each page becomes one carousel image
5. Publish with `carousel_urls`

### Video (影片)

Combine slides + podcast audio into MP4:

1. `generate_artifact(name_or_id, "slides")` → PDF
2. `generate_artifact(name_or_id, "podcast")` → M4A audio (run sequentially, NOT parallel)
3. Download both artifacts
4. `pdftoppm -png -r 300 slides.pdf slides_page`
5. `ffmpeg -framerate 1/$per_slide -pattern_type glob -i 'slides_page-*.png' -i audio.mp3 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest output.mp4`

### Tips for Better Visuals

- **Language**: Always pass `lang="zh-TW"` for Traditional Chinese content
- **Rich text sources**: The more context you feed into the notebook, the better the visual output
- **One topic per notebook**: Don't mix unrelated topics — create separate notebooks
- **Add URLs as sources**: `add_source(name_or_id, url="...")` for reference material — NotebookLM will incorporate key data into visuals

## Mandatory Rules

### 0. Workspace Containment

All files MUST be saved within the session workspace directory. Use relative paths like `downloads/card.pdf`. NEVER use ~/Downloads, ~/Desktop, or any absolute path outside the workspace.

### 1. Read Original Sources

NEVER write content based on titles/metadata alone.

- Single topic: read >= 1 primary source via browser_markdown(url)
- Controversial: read >= 2 sources (both sides)
- Data claims: find original data source

### 2. Timeline Verification

Every fact must have a verified timestamp. Discard anything > 48 hours old.

| Source age | Allowed                    | Forbidden           |
| ---------- | -------------------------- | ------------------- |
| Today      | "today" "just now"         | -                   |
| 1-3 days   | "recently" "the other day" | "just" "latest"     |
| 4-7 days   | "last week" "this week"    | "just" "yesterday"  |
| 8-30 days  | "this month"               | "last week" "just"  |
| >30 days   | "earlier" "this year"      | any freshness words |

### 3. Use ALL Sources

get_trending with sources="" to query ALL 20 sources. Do NOT filter unless user explicitly asks.

## Meta Patent-Based Scoring (5 Dimensions)

| #   | Dimension               | Weight | Check                                        |
| --- | ----------------------- | ------ | -------------------------------------------- |
| 1   | Hook Power              | 25%    | First line: number or contrast, 10-45 chars  |
| 2   | Engagement Trigger      | 25%    | CTA anyone can answer, direct "you" address  |
| 3   | Conversation Durability | 20%    | Has contrast/both sides, creates discussion  |
| 4   | Velocity Potential      | 15%    | Timely, 50-300 chars, urgency language       |
| 5   | Format Score            | 15%    | Mobile-scannable, line breaks, no text walls |

**Quality Gates (ALL must pass before publishing):**

- Overall Score >= 70
- Conversation Durability >= 55
- Hook: 10-45 chars with number or contrast
- CTA: clear question or poll
- Timeline: all time words verified
- Source: every claim traceable
- No AI filler words

## Pipeline Workflow

1. **Discover**: get_trending(sources="", geo, count=20)
2. **Read Source**: browser_markdown(url) — MANDATORY
3. **Verify Timeline**: Check dates, discard stale
4. **Research**: browser_markdown + WebSearch, 2-3 sources min
5. **Brief**: get_content_brief(topic)
6. **Create**: Write -> patent check (5 dimensions)
7. **Score**: get_scoring_guide — self-score (>= 70)
8. **Review**: get_review_checklist — final check
9. **NotebookLM** (optional): create notebook -> generate artifacts
10. **Publish**: provide ready-to-post content or use publish tool
