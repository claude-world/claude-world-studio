---
name: threads-viral-agent
description: >
  Full-autopilot AI agent for Meta 3-platform viral content (Threads + Instagram + Facebook).
  Searches real-time trending topics, analyzes them against Meta's 7 patent-based ranking algorithms
  (EdgeRank, Andromeda, Dear Algo, Conversation Durability), generates optimized text/image/video
  content, adapts for each platform, and publishes automatically with scheduling support.
  Use this skill whenever the user mentions: Threads posting, Instagram content, Facebook page management,
  cross-platform social media, viral posts, social media automation, content scheduling, Threads marketing,
  Meta algorithm optimization, growing on Threads/IG/FB, or automating their social media workflow.
  Also trigger for: quote cards, carousel generation, Reels scripts, social media images, or any
  Meta platform content creation task.
---

# Meta 3-Platform Viral Agent

Autonomous agent: trend discovery → source verification → patent-optimized creation → quality gate → publishing.

**Core Principle:** MCP provides briefs/frameworks, LLM creates original content, scripts handle publishing.

## Accounts & Tokens

Tokens in `.env` at skill root (auto-loaded by all scripts, no manual export needed):

| Account              | Threads ID          | IG ID               | Token vars                        |
| -------------------- | ------------------- | ------------------- | --------------------------------- |
| @claude.world.taiwan | `26105870269107920` | `26911598668443478` | `THREADS_TOKEN_CW`, `IG_TOKEN_CW` |
| @lucasfutures        | `25104893002544779` | `25337739812567565` | `THREADS_TOKEN_LF`, `IG_TOKEN_LF` |

- **App ID**: `875447821838410` (`THREADS_APP_ID`)
- **Token expiry**: 60 days, current ~2026-05-11
- **Renew**: `python3 scripts/threads_oauth.py auth-url` → authorize → `full --code CODE`
- **Select account**: `--account cw` or `--account lf`

## MCP Tools (3 servers, 34 tools)

### trend-pulse (11 tools) — 趨勢發現 + 內容優化框架

| Tool                                                     | Purpose                                      | When to use              |
| -------------------------------------------------------- | -------------------------------------------- | ------------------------ |
| `get_trending(sources, geo, count, save)`                | 即時趨勢，20 個免費來源                      | Step 1: 找主題           |
| `search_trends(query, sources, geo)`                     | 關鍵字搜尋跨來源                             | Step 1: 搜特定話題       |
| `list_sources()`                                         | 可用來源及 rate limit                        | 確認哪些來源可用         |
| `get_trend_history(keyword, days, source)`               | 歷史趨勢數據                                 | Step 3: 驗證話題熱度變化 |
| `take_snapshot(sources, geo, count)`                     | 存快照到 DB，追蹤 velocity                   | 定期追蹤趨勢加速度       |
| `get_content_brief(topic, content_type, platform, lang)` | 寫作指南：hook/CTA/策略                      | Step 4a: 取 brief        |
| `get_scoring_guide(lang, topic)`                         | 5 維度評分框架                               | Step 5: 自評分數         |
| `get_review_checklist(platform, lang, topic)`            | 審稿清單                                     | Step 5: 品質門檻         |
| `get_platform_specs(platform, lang)`                     | 平台規格（字數/功能/演算法）                 | Step 4d: 平台適配        |
| `get_reel_guide(style, duration, lang, topic)`           | Reel/短影片腳本指南                          | 做 Reel 時               |
| `render_page(url, format)`                               | CF Browser 渲染頁面（markdown/content/json） | Step 2: 讀 JS-heavy 頁面 |

Sources: google_trends, hackernews, mastodon, bluesky, wikipedia, github, pypi, google_news, lobsters, devto, npm, reddit, coingecko, dockerhub, stackoverflow, arxiv, producthunt, lemmy, dcard, ptt

### cf-browser (10 tools) — 瀏覽器渲染 + 截圖 + 爬蟲

| Tool                                     | Purpose              | When to use                     |
| ---------------------------------------- | -------------------- | ------------------------------- |
| `browser_markdown(url)`                  | 網頁 → 乾淨 Markdown | **Step 2: 讀原文（首選）**      |
| `browser_json(url, prompt)`              | AI 結構化抽取        | Step 1: 從任何頁面抽取數據      |
| `browser_content(url)`                   | 渲染後完整 HTML      | 需要原始 HTML 時                |
| `browser_screenshot(url, width, height)` | 網頁截圖             | **圖卡生成：HTML → 截圖 → PNG** |
| `browser_pdf(url, format, landscape)`    | 網頁轉 PDF           | 生成可下載報告                  |
| `browser_scrape(url, selectors)`         | CSS 選擇器精準抓取   | 抓特定元素（價格/標題/數據）    |
| `browser_links(url)`                     | 抽取所有連結         | 發現相關來源                    |
| `browser_a11y(url)`                      | 無障礙樹（低 token） | 快速理解頁面結構                |
| `browser_crawl(url, limit)`              | 非同步爬蟲           | 批量抓取多頁                    |
| `browser_crawl_status(job_id, wait)`     | 爬蟲進度             | 等待爬蟲完成                    |

### notebooklm (13 tools) — 研究引擎 + 圖卡/音訊/影片生成

| Tool                                                       | Purpose                                       | When to use            |
| ---------------------------------------------------------- | --------------------------------------------- | ---------------------- |
| `nlm_create_notebook(title, sources, text_sources)`        | 建立筆記本，可餵 URL/文字                     | 深度研究前建立知識庫   |
| `nlm_list()`                                               | 列出所有筆記本                                | 查看已有研究           |
| `nlm_delete(notebook)`                                     | 刪除筆記本                                    | 清理舊研究             |
| `nlm_add_source(notebook, url/text/file)`                  | 新增來源（URL/文字/檔案）                     | 補充研究材料           |
| `nlm_ask(notebook, query)`                                 | 對來源提問（含引用）                          | Step 2: 深度理解來源   |
| `nlm_summarize(notebook)`                                  | 摘要所有來源                                  | 快速掌握全貌           |
| `nlm_list_sources(notebook)`                               | 列出來源                                      | 確認已餵入的材料       |
| `nlm_generate(notebook, type, lang, instructions)`         | **生成 9 種 artifact**（⚠️ infographic 除外） | **圖卡/音訊/影片生成** |
| `nlm_download(notebook, type, output_path)`                | 下載 artifact（audio/slides/video）           | 取得生成檔案           |
| `nlm_list_artifacts(notebook)`                             | 列出 artifact                                 | 查看已生成內容         |
| `nlm_research(notebook, query, mode)`                      | 網路研究（fast/deep）                         | Step 2: 自動搜集資料   |
| `nlm_research_pipeline(sources, questions, output_format)` | 完整研究 → 內容 pipeline                      | 一鍵從 URL 到文章      |
| `nlm_trend_research(geo, count, platform)`                 | 趨勢 → 研究 → 內容 pipeline                   | 全自動趨勢內容         |

**nlm_generate 支援的 artifact 類型：**

| Type          | 用途                | 下載方法                      | 輸出格式                  |
| ------------- | ------------------- | ----------------------------- | ------------------------- |
| `audio`       | Podcast 風格音檔    | `nlm_download(type="audio")`  | `.m4a`                    |
| `video`       | 影片（音訊+幻燈片） | `nlm_download(type="video")`  | `.mp4`                    |
| `slides`      | 簡報                | `nlm_download(type="slides")` | `.pdf`                    |
| `report`      | 報告文件            | `get_report_content()`        | Markdown 文字             |
| `study-guide` | 學習指南            | `get_report_content()`        | Markdown（report 子類型） |
| `quiz`        | 測驗題              | `get_quiz_data()`             | JSON 結構化               |
| `flashcards`  | 閃卡                | `get_flashcard_data()`        | JSON 結構化               |
| `mind-map`    | 心智圖              | `get_mind_map_data()`         | JSON 樹狀結構             |
| `data-table`  | 數據表              | `get_data_table()`            | CSV / JSON                |
| `infographic` | 資訊圖卡            | **❌ 無 API 方法**            | 只能在 NotebookLM UI 檢視 |

**注意：** audio/video/slides 是二進位檔案下載；report/quiz/flashcards 等透過 API 取得文字/結構化資料。
我們的 wrapper CLI (`notebooklm_client.py download`) 已統一包裝。唯一無法下載的是 infographic。

---

## Pipeline: 7 Steps (每步都是 BLOCKING，不可跳過)

### Step 1: DISCOVER — 找主題

```
# trend-pulse — 即時趨勢
get_trending(geo="TW", count=20)             # 20 sources, zero auth
search_trends(query="Claude Code")           # keyword search
get_trend_history(keyword="AI", days=7)      # 歷史趨勢追蹤

# cf-browser — 從任何頁面抽取
browser_json(url, prompt="Extract...")       # AI 結構化抽取
browser_links(url)                           # 發現相關來源

# notebooklm — 趨勢研究一鍵 pipeline
nlm_trend_research(geo="TW", count=3, platform="threads")  # 自動：趨勢→研究→內容
```

Default niches: AI, 創業, 自媒體, 投資理財, 職場, 科技, 個人成長, 副業
Heat score: `heat = likes + (replies × 3) + (reposts × 5)`

### Step 2: READ SOURCE — 讀原文（MANDATORY）

**NEVER write content based on titles/metadata alone.**

For every candidate topic, MUST read the original source:

| Source Type           | Tool（優先順序）                            | Minimum to read              |
| --------------------- | ------------------------------------------- | ---------------------------- |
| Article/blog          | `browser_markdown(url)`                     | 全文                         |
| HN discussion         | `browser_markdown(hn_url)`                  | 原文 + top comments          |
| Reddit post           | `browser_markdown(reddit_url)`              | 原文 + top comments          |
| GitHub repo           | `browser_markdown(github_url)`              | README 全文                  |
| Official announcement | `browser_markdown(url)`                     | 公告全文                     |
| JS-heavy/SPA 頁面     | `render_page(url, format="markdown")`       | 全文（trend-pulse 備用渲染） |
| 多來源深度研究        | `nlm_research_pipeline(sources, questions)` | NotebookLM 自動摘要+引用     |

**深度研究模式（多來源）：**

1. `nlm_create_notebook(title, sources=[url1, url2, ...])` — 餵入所有來源
2. `nlm_ask(notebook, "關鍵問題")` — 對來源交叉提問（含引用）
3. `nlm_summarize(notebook)` — 取得全貌摘要
4. 用 `nlm_research(notebook, query, mode="deep")` 自動搜集更多相關資料

**快速模式（單來源）：** 直接用 `browser_markdown(url)` 讀原文。

**來源充足性標準：**

- 單一主題：至少讀 1 個一手來源（原文/公告/README）
- 爭議性主題：至少讀 2 個來源（正反觀點各一）
- 數據型主題：必須找到數據的原始出處（不接受二手引用）

**批量主題：用 parallel agents 同時讀多個來源。**

**Exception:** 僅當用戶明確表示「這是官方原文，不需要再查」時才跳過。
**注意：** 用戶提供的翻譯/轉述不算原文。涉及數字、時間、範圍的資訊 → 永遠讀原文，無例外。

### Step 3: VERIFY TIMELINE — 驗證時間線（MANDATORY）

**每一個事實都必須標注時間，且驗證時效性。**

| 檢查項       | 方法                                  | 不合格處理                                   |
| ------------ | ------------------------------------- | -------------------------------------------- |
| 事件發生日期 | 從原文抓取 published date             | 無日期 → 不引用具體時間詞                    |
| 數據新鮮度   | 比對 trend search 的 `published` 欄位 | 超過 7 天 → 不用「剛」「最新」               |
| 數字即時性   | upvotes/stars/comments 會變           | 用「超過 X」而非精確數字，或加「截至發文時」 |
| 版本號       | 從原文確認                            | 必須與原文一致                               |
| **時區換算** | **寫出完整公式驗算**                  | **必須 ET 和 PT 交叉驗證**                   |

**時區換算規則（曾因此出錯）：**

1. 寫出公式：`原始時間 + UTC offset + 8 = 台灣時間`
2. 注意日光節約：3-11月 PDT=UTC-7 / EDT=UTC-4，11-3月 PST=UTC-8 / EST=UTC-5
3. 「以外」「outside of」→ 特別小心，容易把尖峰/離峰搞反
4. 用 ET 和 PT 兩組數字各算一次，確認結果一致

**時間詞對照表（以發文時間為基準）：**

| 原文時間   | 可用詞               | 禁用詞           |
| ---------- | -------------------- | ---------------- |
| 今天       | 「今天」「剛剛」     | —                |
| 昨天~3天前 | 「這兩天」「前幾天」 | 「剛」「最新」   |
| 4-7天前    | 「上週」「這週」     | 「剛」「昨天」   |
| 8-30天前   | 「最近」「這個月」   | 「上週」「剛」   |
| >30天      | 「之前」「今年」     | 任何暗示新鮮的詞 |

### Step 4: CREATE — 寫文案

**4a: Get brief** → `get_content_brief(topic, content_type, platform, lang)`

**4b: LLM writes** original content based on source + brief

**4c: Patent check** → `get_scoring_guide()` then verify EACH dimension against the draft:

| #   | Check                     | Patent      | What to verify                 | Common fix           |
| --- | ------------------------- | ----------- | ------------------------------ | -------------------- |
| 1   | Hook 第一行有數字或反差？ | EdgeRank    | 數字前置、好奇心缺口、10-45 字 | 把關鍵數據搬到第一行 |
| 2   | CTA 人人都能回答？        | Dear Algo   | 直接稱呼「你」、低門檻提問     | 避免預設專業知識     |
| 3   | 有轉折/正反兩面？         | 72hr window | 「但是」「不過」製造討論空間   | 加限制/爭議/Beta 面  |
| 4   | 是即時熱點？夠短？        | Andromeda   | 50-300 字、緊迫感用語          | 刪冗字、加時間標記   |
| 5   | 手機可掃描？              | Multi-modal | 換行、箭頭列表、無文字牆       | 拆長句、加分隔       |

**Conversation Durability < 55 → 必須加轉折再發。這是最常被忽略的維度。**

**4d: Adapt** → `get_platform_specs("")` for platform-specific constraints

Platform targets:

- **Threads**: ≤500 chars, strong Hook + CTA, no hashtags, 用 `--poll` 做投票
- **Instagram**: ≤2200 chars, hashtags at end, carousel for depth
- **Facebook**: Long-form with sections, personal angle

**4e: Post Type Decision** — 根據內容特性選擇最佳發文方式：

| 內容特性            | 發文方式                             | 理由                                                            |
| ------------------- | ------------------------------------ | --------------------------------------------------------------- |
| 有 2+ 張圖/視覺素材 | `--carousel URL1 URL2 ...`           | 輪播觸及 > 單張                                                 |
| 有 1 張圖           | `--image URL`                        | 圖文並茂 >> 純文字（官方數據）                                  |
| 有影片素材          | `--video URL`                        | 影片完播率是演算法重點信號                                      |
| A/B/C 選擇題        | `--poll "A\|B\|C"`                   | **永遠**用原生投票，不用文字版                                  |
| 需附連結            | `--link-comment URL`                 | URL 放本文降觸及，放回覆不影響                                  |
| 想要連結預覽卡      | `--link-attachment URL`              | 適合官方公告/文章分享                                           |
| 引用/回應他人貼文   | `--quote-post-id ID`                 | 引用貼借力，蹭原帖互動                                          |
| 含劇透/敏感內容     | `--spoiler-media` / `--spoiler-text` | 尊重讀者，防劇透同時引發好奇                                    |
| 輕鬆幽默/限時活動   | `--ghost`                            | 24hr 消失的限時感製造 FOMO                                      |
| 搞笑/反應           | `--gif-id GIPHY_ID`                  | GIF 提升停留時間和趣味性（僅 GIPHY，Tenor 已於 2026/3/31 停止） |
| 深度長文 (>500 字)  | `--text-attachment file.txt`         | 本文寫摘要 + 長文附件放完整版                                   |
| 爭議話題/避免吵架   | `--reply-control mentioned_only`     | 控制回覆品質                                                    |
| 粉絲專屬內容        | `--reply-control followers_only`     | 增加追蹤動機                                                    |
| 所有有圖的貼文      | `--alt-text "描述"`                  | 無障礙 + SEO 信號                                               |
| 想被探索頁推薦      | `--topic-tag "主題"`                 | 幫演算法分類，觸及感興趣受眾                                    |

**組合規則：**

- 有圖/影片 → 一律加 `--topic-tag` + `--alt-text`
- 有 URL 要分享 → 用 `--link-comment`（不放本文），除非需要預覽卡才用 `--link-attachment`
- Carousel + Spoiler → 所有圖片一起模糊
- Carousel + alt-text → **不可組合**（API 限制：alt_text 無法用於 CAROUSEL 類型）
- Ghost + 文字 Spoiler → 可以組合，但 Ghost 不支援媒體 Spoiler
- Poll + Image → 不可組合（Poll 僅支援 TEXT 類型）

**4f: Generate Image (MANDATORY — NotebookLM ONLY)** — 每篇貼文都必須有圖。純文字僅限純投票或極短問題（<50字）。

**⚠️ 必須用 NotebookLM 生圖卡。不准跳過 NLM 直接用 HTML+Playwright。**

| #   | 方式                                  | 工具                                                       | 適用場景                                                                            |
| --- | ------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1   | **NotebookLM Slides（唯一正式方式）** | `nlm_generate(type="slides")` → `nlm_download` → PDF → PNG | **所有場景**                                                                        |
| 2   | HTML + Playwright（緊急備用）         | 寫 HTML → Playwright screenshot → PNG                      | **僅當 NLM MCP 完全不可用**（連線失敗、未安裝）才可降級。NLM 超時應重試，不算失敗。 |

**NLM Slides 流程（必須執行）：**

```bash
# 1. 建立筆記本，餵入來源 URL + 重點文字摘要
nlm_create_notebook(title, sources=[URLs], text_sources=[重點文字])

# 2. 生成 slides（指定頁數、風格、內容）
nlm_generate(notebook, type="slides", lang="zh-TW", instructions="製作 3-4 頁社群媒體圖卡...")

# 3. 下載 PDF
nlm_download(notebook, type="slides", output_path="/tmp/slides.pdf")

# 4. PDF → PNG 各頁截圖
pdftoppm -png -r 300 /tmp/slides.pdf /tmp/slide

# 5. 上傳取得公開 URL
curl -F "reqtype=fileupload" -F "time=24h" -F "fileToUpload=@/tmp/slide-1.png" \
  https://litterbox.catbox.moe/resources/internals/api.php
```

**NLM 超時處理：** 超時不等於失敗，重試 1-2 次。只有 MCP server 完全離線才降級到 Playwright。

**多頁圖卡 → Carousel（⚠️ 重要）：** NLM slides 產生多頁 PDF 時，必須：

1. `pdftoppm -png -r 300 slides.pdf slide` 拆成各頁 PNG
2. **逐張上傳**：對每張 PNG 呼叫 `upload_image(file_path="downloads/slide-N.png")` 取得公開 URL
3. **用 carousel 發文**：`publish_to_threads(text="...", carousel_urls=[url1, url2, ...])` — 不要用 `image`，那只發單張

**4g: Final check** — 發文前最後檢查：

- [ ] **有圖嗎？** 沒有 → 回 4f 製圖（除非純投票）
- [ ] 根據 4e 決策表，選對了發文方式？
- [ ] A/B/C 選項 → 用了 `--poll`？
- [ ] **有來源 URL → 用了 `link_comment` / `--link-comment`？（MANDATORY — 來源連結必須出現在留言）**
- [ ] 有圖 → 加了 `--alt-text`？
- [ ] 加了 `--topic-tag`？
- [ ] 時間詞與 Step 3 驗證結果一致？
- [ ] 所有數字都有原文出處？

### Step 5: REVIEW — 品質門檻

Use MCP tools for structured review:

1. `get_review_checklist(lang="zh-TW")` → LLM reviews against checklist（含 penalty pre-check）
2. Polish: remove AI filler ("在當今"/"隨著"/"值得注意"), strengthen hook, sharpen CTA
3. `get_scoring_guide(lang="zh-TW")` → LLM self-scores all 5 dimensions（penalty 已在 step 1 檢查）

**5a: Algorithm Penalty Pre-Check (BLOCKING — must pass before scoring)**

Source: https://creators.instagram.com/threads

| Penalty               | Detection                                | Auto-Reject Action         |
| --------------------- | ---------------------------------------- | -------------------------- |
| Clickbait             | Hook 承諾了正文沒兌現的東西              | 改寫 hook 對齊實際內容     |
| Engagement bait       | 含「按讚」「轉發」「追蹤」等直接要求互動 | 刪除，改用自然 CTA         |
| Contest/Giveaway 違規 | 活動要求互動行為作為參加條件             | 移除或改為不要求互動       |
| Unoriginal content    | 從其他平台原封不動搬運，無原創角度       | 加入個人觀點/在地化/新角度 |

**任何 penalty flag 觸發 → 必須改寫後才能進入評分。**

**5b: Tone & Authenticity Check (Official Threads Guidelines)**

| Check                 | Pass                             | Fail → Fix             |
| --------------------- | -------------------------------- | ---------------------- |
| 有個人觀點/經驗連結？ | 含「我」「自己」或具體經歷       | 加入個人角度或真實體驗 |
| 語氣自然有人味？      | 像跟朋友聊天                     | 去掉公司腔、AI 腔      |
| 幽默元素？            | 有趣/機智/意外感（非必要但加分） | 考慮加入輕鬆元素       |
| 能引發對話？          | 包含可討論的問題或觀點           | 加反問或開放式問題     |

**5c: Quality Gate (ALL must pass):**

| Gate                    | Threshold                       | Fail action                |
| ----------------------- | ------------------------------- | -------------------------- |
| Penalty pre-check       | All penalties clear             | Rewrite per 5a             |
| Overall Score           | ≥ 70                            | Rewrite weak dimensions    |
| Conversation Durability | ≥ 55                            | Add 轉折/爭議面            |
| Hook (first line)       | 10-45 字 + 數字或反差           | Rewrite first line         |
| CTA (last line)         | Clear question or poll          | Add or sharpen             |
| Timeline accuracy       | All time words verified         | Fix per Step 3 table       |
| Source grounding        | Every claim traceable to source | Remove unverifiable claims |
| Character limit         | Threads ≤500, IG ≤2200          | Trim                       |
| 台灣繁中語氣            | Natural, no 簡體/AI 腔          | Rewrite                    |
| Topic tag               | 每篇都有 `--topic-tag`          | 加上相關主題標籤           |
| 圖文並茂                | 有視覺素材（除純投票）          | 回 Step 4f 製圖            |

**A/B Variant Strategy** (for Viral Score ≥ 85):

- Variant A (@claude.world.taiwan): Opinion-first (帶觀點)
- Variant B (@lucasfutures): Question-first (提問式)

### Step 6: PUBLISH

**⚠️ MANDATORY: Source URL → link_comment**
If the content references ANY source URL (from Step 2), you MUST include it as `link_comment` (MCP tool) or `--link-comment` (CLI). This is NOT optional — every post that has a source gets the source URL auto-replied in comments. The source URL is the original article/repo/announcement URL you read in Step 2.

**When using MCP `publish_to_threads` tool:**

```
publish_to_threads(
  text: "...",
  account_id: "...",
  score: 85,
  link_comment: "https://source-url-from-step-2",  // ← MANDATORY if source exists
  ...
)
```

**When using CLI:**

```bash
# Threads — 支援所有發文類型 (auto-loads token from .env)
# 基本文字
python3 scripts/threads_api.py publish --account cw --text "content"
# 圖片
python3 scripts/threads_api.py publish --account cw --text "caption" --image "https://public-url/img.jpg"
# 影片 (max 5min, 9:16 or 16:9)
python3 scripts/threads_api.py publish --account cw --text "caption" --video "https://public-url/video.mp4"
# 輪播 (2-20 張)
python3 scripts/threads_api.py publish --account cw --text "caption" --carousel URL1 URL2 URL3
# 投票 (2-4 選項, max 25 chars each)
python3 scripts/threads_api.py publish --account cw --text "content" --poll "選項A|選項B|選項C"
# GIF (GIPHY only — Tenor 已於 2026/3/31 停止服務)
python3 scripts/threads_api.py publish --account cw --text "funny!" --gif-id "GIPHY_GIF_ID"
# 引用貼文
python3 scripts/threads_api.py publish --account cw --text "My take" --quote-post-id "12345"
# 連結預覽卡
python3 scripts/threads_api.py publish --account cw --text "Read this" --link-attachment "https://url"
# 長文 (up to 10,000 chars via text attachment, 支援 bold/italic/highlight/underline/strikethrough)
python3 scripts/threads_api.py publish --account cw --text "Summary" --text-attachment long_article.txt
# 防劇透 — 模糊媒體
python3 scripts/threads_api.py publish --account cw --text "Spoiler!" --image URL --spoiler-media
# 防劇透 — 遮蔽文字 (offset:length, 可重複)
python3 scripts/threads_api.py publish --account cw --text "The killer is John" --spoiler-text "15:4"
# 限時貼文 (24hr 後消失)
python3 scripts/threads_api.py publish --account cw --text "Vanishes!" --ghost
# 回覆控制
python3 scripts/threads_api.py publish --account cw --text "content" --reply-control mentioned_only
# Topic Tag
python3 scripts/threads_api.py publish --account cw --text "content" --topic-tag "AI tools"
# 無障礙描述
python3 scripts/threads_api.py publish --account cw --text "content" --image URL --alt-text "description"
# Link comment (自動回覆連結, 避免觸及下降)
python3 scripts/threads_api.py publish --account cw --text "content" --link-comment "https://url"
# 查看投票結果
python3 scripts/threads_api.py poll-results --account cw --post-id "12345"
# 串文 Thread (用 --- 分段, 第一篇可加圖)
python3 scripts/threads_api.py publish --account cw \
  --text "1/3 為什麼我從 VS Code 轉到 Claude Code？---2/3 最大的差別是...---3/3 結論：回不去了" \
  --thread --image "https://example.com/comparison.png" --topic-tag "開發工具"
# 功能可組合: 圖片 + 防劇透 + 回覆控制 + topic tag + alt text
python3 scripts/threads_api.py publish --account cw --text "content" \
  --image URL --spoiler-media --reply-control followers_only --topic-tag "spoiler" --alt-text "描述"

# Instagram image
source .env
CONTAINER=$(curl -s -X POST "https://graph.instagram.com/v21.0/$IG_USER_CW/media" \
  -d "image_url=PUBLIC_URL" --data-urlencode "caption=CAPTION" -d "access_token=$IG_TOKEN_CW")
CONTAINER_ID=$(echo "$CONTAINER" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
sleep 5
curl -s -X POST "https://graph.instagram.com/v21.0/$IG_USER_CW/media_publish" \
  -d "creation_id=$CONTAINER_ID" -d "access_token=$IG_TOKEN_CW"

# Instagram Reel (MP4) — use media_type=REELS + video_url, poll status_code until FINISHED
# Same pattern for LF accounts with IG_USER_LF / IG_TOKEN_LF

# Upload image for IG API
curl -F "reqtype=fileupload" -F "time=24h" -F "fileToUpload=@img.png" \
  https://litterbox.catbox.moe/resources/internals/api.php
```

**Publishing order** (Andromeda-optimized): Threads 21:00 → IG 12:00 next day → FB 09:00 next day

**Rate limits:**

| 操作         | 上限               |
| ------------ | ------------------ |
| Threads 發文 | 250 篇 / 24 小時   |
| Threads 回覆 | 1,000 則 / 24 小時 |
| Threads 刪除 | 100 次 / 24 小時   |
| IG 發文      | 25 / 24hr          |
| FB 發文      | 50 / 24hr          |

### Step 7: REPORT — 輸出摘要

每次發文後輸出：

```
## 發文報告
- 主題：
- 來源：[URL] (published: YYYY-MM-DD)
- 帳號：CW post_id / LF post_id
- Penalty 檢查：✅ 無觸發 / ⚠️ [clickbait|engagement-bait|contest|unoriginal]
- 語氣檢查：✅ 有人味 / ⚠️ [缺個人觀點|公司腔|無幽默]
- 專利評分：Hook=X Engage=X Convo=X Velocity=X Format=X → Overall=X (Grade)
- 時間詞驗證：✅ / ⚠️ [哪些需注意]
- 來源留言：✅ link_comment=[URL] / ❌ 無來源 URL
- 附加功能：✅ --poll / --spoiler / --carousel / --ghost / --quote / N/A
- Topic Tag：✅ [tag name] / ❌ 缺
```

---

## Mandatory Content Rules

### 1. Polls: Always Use Native `--poll`

**NEVER use text-based A/B/C in post body.** Always use `--poll`:

```bash
python3 scripts/threads_api.py publish --account cw \
  --text "AI 該不該拒絕指令？" --poll "應該|不應該|看情況"
```

Constraints: 2-4 options, each ≤25 chars, total JSON ≤200 chars → use 2-3 short options (2-5 字)

### 2. Links: Always Use `--link-comment` (or `--link-attachment`)

Never put URLs in post body (kills reach).

- **一般連結** → `--link-comment URL` (自動回覆，不影響觸及)
- **需要預覽卡** → `--link-attachment URL` (嵌入連結卡片，適合官方公告)

### 3. Spoiler: 劇透/敏感內容必用防劇透

| 內容類型        | 方式                             | 範例                                         |
| --------------- | -------------------------------- | -------------------------------------------- |
| 圖片/影片含劇透 | `--spoiler-media`                | `--image URL --spoiler-media`                |
| 文字含劇透      | `--spoiler-text offset:length`   | `--text "兇手是王小明" --spoiler-text "3:3"` |
| 輪播含劇透      | `--carousel ... --spoiler-media` | 所有圖片一起模糊                             |

### 4. Media: 優先圖文並茂

官方數據確認圖文並茂效果顯著優於純文字。決策順序：

1. 有 2+ 張圖 → **Carousel** (`--carousel`)
2. 有 1 張圖 → **Image** (`--image`) + `--alt-text`
3. 有影片 → **Video** (`--video`) + `--alt-text`
4. 搞笑/反應 → **GIF** (`--gif-id`)
5. 純文字 → 考慮是否用 `--text-attachment` 放長文

### 5. Topic Tag + Alt Text: 預設都加

- **`--topic-tag`**: 每篇都加，幫演算法分類
- **`--alt-text`**: 所有含圖/影片的貼文都加，無障礙 + SEO

### 6. Reply Control: 根據話題性質選擇

| 場景              | 設定                                      |
| ----------------- | ----------------------------------------- |
| 一般貼文          | 不設（預設 everyone）                     |
| 爭議性高/怕吵架   | `--reply-control mentioned_only`          |
| 粉絲專屬          | `--reply-control followers_only`          |
| 官方公告/不需回覆 | `--reply-control parent_post_author_only` |

### 7. Ghost Post: 限時感行銷

適用場景：限時優惠、活動預告、幕後花絮。`--ghost` 24hr 自動消失。

### 8. Quote Post: 借力互動

看到值得回應的熱門貼文 → `--quote-post-id ID` 加上自己的觀點。

### 9. Source + Timeline: Read and Verify Before Writing

Every post must satisfy:

- **Source**: Read original via `browser_markdown(url)` — see Step 2
- **Timeline**: Verify dates and use correct time words — see Step 3
- **Numbers**: Traceable to source, use "超過 X" for changing metrics

---

## Full Auto-Pilot Mode

Trigger: "自動發文", "auto post", "幫我發三個平台", "排程發文"

Execute ALL 7 steps in order:

1. **DISCOVER** → `get_trending(geo="TW", count=20)` → pick top candidates
2. **READ SOURCE** → `browser_markdown(url)` for each candidate (parallel agents for batch)
3. **VERIFY TIMELINE** → check published dates, map to time words
4. **CREATE** → `get_content_brief()` → LLM writes → patent check → **post type decision (4e)** → **generate image (4f, MANDATORY)** → final check (4g)
5. **REVIEW** → `get_review_checklist()` + `get_scoring_guide()` → quality gate (≥70, convo ≥55)
6. **PUBLISH** → 根據 4e 決策結果組合 CLI 參數 → Threads → IG → FB
7. **REPORT** → output summary with scores, sources, timeline verification, features used

**Auto-Pilot 發文方式自動決策：**

- 有圖卡 → `--image` + `--alt-text` + `--topic-tag`
- 多張圖 → `--carousel` + `--alt-text` + `--topic-tag`
- 選擇題 → `--poll`，不用文字版
- **有來源 URL（Step 2 讀的原文） → 必須用 `link_comment` 發到留言**
- 爭議話題 → `--reply-control mentioned_only`
- 劇透/洩露 → `--spoiler-media` 或 `--spoiler-text`
- 限時活動 → `--ghost`
- 回應熱帖 → `--quote-post-id`

**Auto-Pilot 圖卡：見 Step 4f（不重複，以 4f 為準）。**

**Video pipeline:**

- Video: PNGs → `ffmpeg ... -f lavfi -i anullsrc ... -profile:v baseline -c:a aac -movflags +faststart output.mp4`
- CRITICAL: IG Reels must have silent audio track + H.264 baseline profile, otherwise black/unplayable
- NLM Audio: `nlm_generate(type="audio")` → `.m4a` / NLM Video: `nlm_generate(type="video")` → `.mp4`
- Reel scripts: `get_reel_guide(style, duration, lang)` — styles: educational, storytelling, listicle

**Upload（取得公開 URL）：**

```bash
curl -F "reqtype=fileupload" -F "time=24h" -F "fileToUpload=@img.png" \
  https://litterbox.catbox.moe/resources/internals/api.php
```

## Quick Reference

| Script                          | Purpose                                        |
| ------------------------------- | ---------------------------------------------- |
| `scripts/threads_api.py`        | Threads: search, publish, batch, schedule      |
| `scripts/threads_oauth.py`      | OAuth token renewal (60-day cycle)             |
| `scripts/content_engine.py`     | Legacy content CLI (quote-card, reel-script)   |
| `scripts/meta_platforms_api.py` | Unified 3-platform: verify, cross-post, status |
| `references/patent_database.md` | Full 7-patent analysis reference               |
