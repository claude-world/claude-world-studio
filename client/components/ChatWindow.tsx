import React, { useState, useRef, useEffect, useMemo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { ToolUseBlock } from "./ToolUseBlock";
import type { Language } from "../App";

interface Message {
  id: string;
  role: "user" | "assistant" | "tool_use" | "tool_result" | "result";
  content: string | null;
  timestamp?: string;
  created_at?: string;
  toolName?: string;
  tool_name?: string;
  toolInput?: Record<string, any>;
  tool_input?: string;
  toolId?: string;
  tool_id?: string;
  cost_usd?: number;
}

interface SocialAccount {
  id: string;
  name: string;
  handle: string;
  platform: string;
}

interface ChatWindowProps {
  sessionId: string | null;
  messages: Message[];
  isConnected: boolean;
  isLoading: boolean;
  onSendMessage: (content: string) => void;
  onInterrupt: () => void;
  onShowFiles: () => void;
  onShowPublish: () => void;
  onNewSession: () => void;
  onPreviewFile?: (absolutePath: string) => void;
  workspacePath?: string;
  showFilesActive: boolean;
  language: Language;
  accounts?: SocialAccount[];
  targetAccountId?: string;
  onTargetAccountChange?: (id: string) => void;
  cliName?: string;
}

// --- i18n strings ---

interface QuickChip {
  label: string;
  prompt: string;
  color: string;
}

const QUICK_CHIPS: Record<Language, QuickChip[]> = {
  "zh-TW": [
    {
      label: "探索趨勢",
      prompt:
        '用 get_trending(sources="", geo="TW", count=20) 查詢全部 20 個來源的即時趨勢。注意確認資料的時間線，今天是幾號？只保留最近 48 小時內的資料，列出前 10 名最熱門的話題。',
      color: "text-emerald-600 bg-emerald-50 border-emerald-200 hover:bg-emerald-100",
    },
    {
      label: "截圖網頁",
      prompt: "截圖以下網站並描述內容：",
      color: "text-blue-600 bg-blue-50 border-blue-200 hover:bg-blue-100",
    },
    {
      label: "抓取網頁",
      prompt: "抓取以下網頁的內容並轉成 Markdown：",
      color: "text-cyan-600 bg-cyan-50 border-cyan-200 hover:bg-cyan-100",
    },
    {
      label: "內容評分",
      prompt: "用 get_scoring_guide 評估以下內容的互動分數：",
      color: "text-orange-600 bg-orange-50 border-orange-200 hover:bg-orange-100",
    },
    {
      label: "NotebookLM",
      prompt: "用 NotebookLM 研究以下主題，產生音頻摘要：",
      color: "text-violet-600 bg-violet-50 border-violet-200 hover:bg-violet-100",
    },
    {
      label: "深度研究",
      prompt: "研究以下主題，搜尋網路並總結關鍵發現：",
      color: "text-red-600 bg-red-50 border-red-200 hover:bg-red-100",
    },
  ],
  en: [
    {
      label: "Trends",
      prompt:
        'Use get_trending(sources="", geo="US", count=20) to query ALL 20 sources for real-time trends. Check timestamps — what\'s today\'s date? Keep only items from the last 48 hours. Show the top 10 hottest topics.',
      color: "text-emerald-600 bg-emerald-50 border-emerald-200 hover:bg-emerald-100",
    },
    {
      label: "Screenshot",
      prompt: "Take a screenshot of this website and describe it: ",
      color: "text-blue-600 bg-blue-50 border-blue-200 hover:bg-blue-100",
    },
    {
      label: "Scrape Page",
      prompt: "Scrape this webpage and convert to markdown: ",
      color: "text-cyan-600 bg-cyan-50 border-cyan-200 hover:bg-cyan-100",
    },
    {
      label: "Score Content",
      prompt: "Use get_scoring_guide to score this content: ",
      color: "text-orange-600 bg-orange-50 border-orange-200 hover:bg-orange-100",
    },
    {
      label: "NotebookLM",
      prompt: "Use NotebookLM to research this topic and generate an audio summary: ",
      color: "text-violet-600 bg-violet-50 border-violet-200 hover:bg-violet-100",
    },
    {
      label: "Research",
      prompt: "Research this topic, search the web and summarize key findings: ",
      color: "text-red-600 bg-red-50 border-red-200 hover:bg-red-100",
    },
  ],
  ja: [
    {
      label: "トレンド",
      prompt:
        'get_trending(sources="", geo="JP", count=20) で全20ソースのリアルタイムトレンドを取得。タイムスタンプを確認して48時間以内のデータのみ表示。上位10件を表示。',
      color: "text-emerald-600 bg-emerald-50 border-emerald-200 hover:bg-emerald-100",
    },
    {
      label: "スクショ",
      prompt: "このWebサイトのスクリーンショットを撮って説明してください：",
      color: "text-blue-600 bg-blue-50 border-blue-200 hover:bg-blue-100",
    },
    {
      label: "ページ取得",
      prompt: "このWebページの内容を取得してMarkdownに変換してください：",
      color: "text-cyan-600 bg-cyan-50 border-cyan-200 hover:bg-cyan-100",
    },
    {
      label: "スコア評価",
      prompt: "get_scoring_guideで以下のコンテンツを評価してください：",
      color: "text-orange-600 bg-orange-50 border-orange-200 hover:bg-orange-100",
    },
    {
      label: "NotebookLM",
      prompt: "NotebookLMでこのトピックを調査し、音声サマリーを生成してください：",
      color: "text-violet-600 bg-violet-50 border-violet-200 hover:bg-violet-100",
    },
    {
      label: "調査",
      prompt: "このトピックを調査し、Webを検索して要点をまとめてください：",
      color: "text-red-600 bg-red-50 border-red-200 hover:bg-red-100",
    },
  ],
};

// --- Pipeline action cards for the empty chat state ---

interface PipelineAction {
  icon: string;
  label: string;
  description: string;
  mode: "send" | "fill";
  prompt: string;
  hint?: string;
}

const PIPELINE_ACTIONS: Record<Language, PipelineAction[]> = {
  "zh-TW": [
    {
      icon: "🔥",
      label: "自動發文 (Freestyle)",
      description: "一鍵完成：趨勢 → 研究 → 圖卡 → 發文（全自動）",
      mode: "send",
      prompt:
        '執行完整 7 步驟內容產線（按照 threads-viral-agent skill 的流程，包含圖卡生成、curl 上傳 catbox.moe 取得公開圖片 URL、使用 publish_to_threads MCP 工具發布）。geo="TW"，全部 20 來源。開始！',
    },
    {
      icon: "🎯",
      label: "指定主題發文",
      description: "主題 → 研究 → 圖卡 → 發文",
      mode: "fill",
      prompt:
        "針對以下主題執行 threads-viral-agent skill 的完整 7 步驟產線（跳過 Step 1 趨勢探索，直接從 Step 2 讀原文開始）。包含圖卡生成、curl 上傳 catbox.moe 取得圖片 URL、使用 publish_to_threads MCP 工具發布。\n\n主題：",
      hint: "輸入主題，例如：Claude Code 新功能、AI Agent 趨勢...",
    },
    {
      icon: "🎬",
      label: "指定主題 + 多媒體",
      description: "主題 → 研究 → 圖卡 + 簡報 + Podcast → 發文",
      mode: "fill",
      prompt:
        "針對以下主題執行 threads-viral-agent skill 的完整 7 步驟產線 + 多媒體生成（跳過 Step 1）。Step 4e 生成 slides 圖卡 + podcast 音頻。圖片用 curl 上傳 catbox.moe 取得公開 URL，使用 publish_to_threads MCP 工具發布（支援 imageUrl、carouselUrls、linkComment 參數）。\n\n主題：",
      hint: "輸入主題，例如：AI 程式碼助手比較...",
    },
  ],
  en: [
    {
      icon: "🔥",
      label: "Auto Post (Freestyle)",
      description: "One click: Trends → Research → Visual → Publish (fully automatic)",
      mode: "send",
      prompt:
        'Run the full 7-step pipeline following the threads-viral-agent skill (including image generation, curl upload to catbox.moe for image URL, and publish_to_threads MCP tool for publishing). geo="US", all 20 sources. Go!',
    },
    {
      icon: "🎯",
      label: "Custom Topic Post",
      description: "Topic → Research → Visual → Publish",
      mode: "fill",
      prompt:
        "Run the threads-viral-agent skill's full 7-step pipeline for this topic (skip Step 1, start from Step 2 read sources). Include image generation, curl upload to catbox.moe for image URL, and publish_to_threads MCP tool for publishing.\n\nTopic: ",
      hint: "Enter a topic, e.g. Claude Code new features, AI Agent trends...",
    },
    {
      icon: "🎬",
      label: "Custom Topic + Media",
      description: "Topic → Research → Visual + Slides + Podcast → Publish",
      mode: "fill",
      prompt:
        "Run the threads-viral-agent skill's full 7-step pipeline + multimedia for this topic (skip Step 1). Step 4e: generate slides + podcast. Upload images via curl to catbox.moe for public URLs, then publish via publish_to_threads MCP tool (supports imageUrl, carouselUrls, linkComment).\n\nTopic: ",
      hint: "Enter a topic, e.g. AI coding assistants comparison...",
    },
  ],
  ja: [
    {
      icon: "🔥",
      label: "自動投稿 (Freestyle)",
      description: "ワンクリック：トレンド → 調査 → 図解 → 投稿（全自動）",
      mode: "send",
      prompt:
        'threads-viral-agent skillのフル7ステップパイプライン実行（図解生成、curl catbox.moeアップロードで画像URL取得、publish_to_threads MCPツールで投稿）。geo="JP"、全20ソース。開始！',
    },
    {
      icon: "🎯",
      label: "トピック指定投稿",
      description: "トピック → 調査 → 図解 → 投稿",
      mode: "fill",
      prompt:
        "このトピックでthreads-viral-agent skillのフル7ステップパイプライン実行（Step 1スキップ、Step 2原文読解から開始）。図解生成、curl catbox.moeアップロードで画像URL取得、publish_to_threads MCPツールで投稿。\n\nトピック：",
      hint: "トピックを入力、例：Claude Codeの新機能、AIエージェントのトレンド...",
    },
    {
      icon: "🎬",
      label: "トピック + マルチメディア",
      description: "トピック → 調査 → 図解 + スライド + Podcast → 投稿",
      mode: "fill",
      prompt:
        "このトピックでthreads-viral-agent skillのフル7ステップ + マルチメディアパイプライン実行（Step 1スキップ）。Step 4e: slides + podcast生成。curl catbox.moeアップロードで画像URLを取得し、publish_to_threads MCPツールで投稿（imageUrl、carouselUrls、linkComment対応）。\n\nトピック：",
      hint: "トピックを入力、例：AIコーディングアシスタント比較...",
    },
  ],
};

const UI_TEXT: Record<
  Language,
  {
    welcomeTitle: string;
    welcomeSubtitle: string;
    welcomeCta: string;
    welcomeHint: string;
    emptyTitle: string;
    emptySubtitle: string;
    advancedTools: string;
    placeholder: string;
    placeholderOffline: string;
    sendBtn: string;
    stopBtn: string;
    filesBtn: string;
    publishBtn: string;
    shiftEnter: string;
    poweredBy: (cli: string) => string;
    thinkingLabel: (cli: string) => string;
    chatTitle: string;
    liveStatus: string;
    offlineStatus: string;
    startConversation: string;
    steps: string[];
    stepsDesc: string[];
  }
> = {
  "zh-TW": {
    welcomeTitle: "Claude World Studio",
    welcomeSubtitle: "AI 驅動的內容產線：從趨勢發現到社群發文",
    welcomeCta: "開始新 Session",
    welcomeHint: "或從左側選擇現有的 Session",
    emptyTitle: "你想做什麼？",
    emptySubtitle: "選擇快速操作，或在下方輸入你的需求",
    advancedTools: "進階工具",
    placeholder: "請輸入指令：發現趨勢、研究主題、撰寫內容...",
    placeholderOffline: "正在連線至伺服器...",
    sendBtn: "送出",
    stopBtn: "停止",
    filesBtn: "檔案",
    publishBtn: "發文",
    shiftEnter: "Shift+Enter 換行",
    poweredBy: (cli: string) => `由 ${cli} + MCP 驅動`,
    thinkingLabel: (cli: string) => `${cli} 正在思考...`,
    chatTitle: "聊天",
    liveStatus: "連線中",
    offlineStatus: "離線",
    startConversation: "開始對話",
    steps: ["發現", "研究", "發佈"],
    stepsDesc: [
      "從 Google Trends、Hacker News、GitHub 等 15+ 來源發現熱門話題",
      "透過網頁擷取、NotebookLM、AI 分析深入研究主題",
      "評分優化後一鍵發佈到 Threads 和 Instagram",
    ],
  },
  en: {
    welcomeTitle: "Claude World Studio",
    welcomeSubtitle: "AI-powered content pipeline: from trend discovery to social publishing",
    welcomeCta: "Start a New Session",
    welcomeHint: "Or select an existing session from the sidebar",
    emptyTitle: "What would you like to do?",
    emptySubtitle: "Choose a quick action or type your own request below",
    advancedTools: "Advanced Tools",
    placeholder: "Ask Claude to discover trends, research topics, create content...",
    placeholderOffline: "Connecting to server...",
    sendBtn: "Send",
    stopBtn: "Stop",
    filesBtn: "Files",
    publishBtn: "Publish",
    shiftEnter: "Shift+Enter for newline",
    poweredBy: (cli: string) => `Powered by ${cli} + MCP`,
    thinkingLabel: (cli: string) => `${cli} is working...`,
    chatTitle: "Chat",
    liveStatus: "Live",
    offlineStatus: "Offline",
    startConversation: "Start a conversation",
    steps: ["Discover", "Research", "Publish"],
    stepsDesc: [
      "Find trending topics from Google Trends, Hacker News, GitHub, Reddit, and 11 more sources",
      "Deep dive with web scraping, NotebookLM, and AI-powered analysis",
      "Score-optimized content published to Threads and Instagram with one click",
    ],
  },
  ja: {
    welcomeTitle: "Claude World Studio",
    welcomeSubtitle: "AI搭載コンテンツパイプライン：トレンド発見からSNS投稿まで",
    welcomeCta: "新しいセッションを開始",
    welcomeHint: "またはサイドバーから既存のセッションを選択",
    emptyTitle: "何をしますか？",
    emptySubtitle: "クイックアクションを選択するか、下にリクエストを入力してください",
    advancedTools: "高度なツール",
    placeholder: "トレンド発見、トピック調査、コンテンツ作成を依頼...",
    placeholderOffline: "サーバーに接続中...",
    sendBtn: "送信",
    stopBtn: "停止",
    filesBtn: "ファイル",
    publishBtn: "投稿",
    shiftEnter: "Shift+Enterで改行",
    poweredBy: (cli: string) => `${cli} + MCP 搭載`,
    thinkingLabel: (cli: string) => `${cli} が作業中...`,
    chatTitle: "チャット",
    liveStatus: "接続中",
    offlineStatus: "オフライン",
    startConversation: "会話を始めましょう",
    steps: ["発見", "調査", "公開"],
    stepsDesc: [
      "Google Trends、Hacker News、GitHub、Redditなど15+ソースからトレンドを発見",
      "Webスクレイピング、NotebookLM、AI分析で深掘り調査",
      "スコア最適化後ワンクリックでThreadsとInstagramに投稿",
    ],
  },
};

const STEP_TOOLS = ["trend-pulse", "cf-browser + notebooklm", "publish_to_threads"];
const STEP_COLORS = ["bg-emerald-500", "bg-blue-500", "bg-pink-500"];

// --- Inline image support ---

/** Allow img tags through rehype-sanitize with safe protocols only */
const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames || []), "img"],
  attributes: {
    ...defaultSchema.attributes,
    img: ["src", "alt", "title", "width", "height"],
  },
  protocols: {
    ...defaultSchema.protocols,
    src: ["http", "https"],
  },
};

/** Extract unique image file paths from text, ignoring code blocks/backticks */
function extractImagePaths(text: string): string[] {
  // Strip fenced code blocks and inline backticks to avoid false positives
  const stripped = text.replace(/```[\s\S]*?```/g, "").replace(/`[^`]+`/g, "");
  const re = /\/[^\s"'<>()]+\.(?:png|jpg|jpeg|gif|webp|svg)/gi;
  const matches = stripped.match(re);
  return matches ? [...new Set(matches)] : [];
}

/** Convert absolute path to file API URL; supports any absolute path */
function toFileApiUrl(absPath: string, sessionId: string, _workspacePath?: string): string | null {
  if (!sessionId || !absPath.startsWith("/")) return null;
  const encoded = absPath.split("/").map(encodeURIComponent).join("/");
  return `/api/sessions/${encodeURIComponent(sessionId)}/files/${encoded}`;
}

/** Inline image thumbnail — clickable to open preview */
function InlineImage({ src, alt, onClick }: { src: string; alt: string; onClick?: () => void }) {
  const [error, setError] = useState(false);
  useEffect(() => {
    setError(false);
  }, [src]);
  if (error) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="block mt-2 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 hover:border-blue-400 hover:shadow-md transition-all cursor-pointer bg-gray-50 dark:bg-gray-800"
    >
      <img
        src={src}
        alt={alt}
        onError={() => setError(true)}
        className="max-w-full max-h-72 object-contain"
        loading="lazy"
      />
    </button>
  );
}

// Detect if text inside backticks looks like a workspace file path with a previewable extension
const PREVIEW_EXT_RE =
  /\.(png|jpg|jpeg|gif|webp|svg|pdf|mp3|wav|m4a|mp4|webm|md|txt|json|html|css|py|ts|tsx|js|jsx)$/i;
function isPreviewablePath(text: string, _workspacePath?: string): boolean {
  if (!text.startsWith("/") || !PREVIEW_EXT_RE.test(text) || text.includes(" ")) return false;
  // Allow any absolute path with a previewable extension (e.g. downloads/)
  return true;
}

// Hoisted component: renders inline code with clickable file path support
function InlineCode({
  children,
  className,
  onPreviewFile,
  workspacePath,
}: {
  children: React.ReactNode;
  className?: string;
  onPreviewFile: (path: string) => void;
  workspacePath?: string;
}) {
  // Only handle inline code (className present = fenced code block language)
  if (className) {
    return <code className={className}>{children}</code>;
  }
  const text = String(children);
  if (isPreviewablePath(text, workspacePath)) {
    return (
      <button
        type="button"
        className="text-blue-600 bg-blue-50 px-1 py-0.5 rounded text-xs cursor-pointer hover:bg-blue-100 hover:underline transition-colors font-mono inline"
        onClick={() => onPreviewFile(text)}
        title="Click to preview"
        aria-label={`Preview file ${text.split("/").pop()}`}
      >
        {children}
      </button>
    );
  }
  return <code>{children}</code>;
}

function MessageBubble({
  message,
  onPreviewFile,
  workspacePath,
  sessionId,
}: {
  message: Message;
  onPreviewFile?: (path: string) => void;
  workspacePath?: string;
  sessionId?: string;
}) {
  const isUser = message.role === "user";
  const content = message.content || "";

  // Detect image file paths in assistant messages (skip those already in ![](path) markdown)
  const inlineImages = useMemo(() => {
    if (isUser || !sessionId || !workspacePath) return [];
    // Collect paths used in markdown image syntax to avoid duplicates
    const mdImagePaths = new Set<string>();
    const mdImageRe = /!\[[^\]]*\]\(([^)]+)\)/g;
    let m;
    while ((m = mdImageRe.exec(content)) !== null) mdImagePaths.add(m[1]);

    return extractImagePaths(content)
      .filter((p) => !mdImagePaths.has(p))
      .map((p) => ({ path: p, url: toFileApiUrl(p, sessionId, workspacePath) }))
      .filter((x): x is { path: string; url: string } => x.url !== null);
  }, [content, isUser, sessionId, workspacePath]);

  const markdownComponents = useMemo(() => {
    const components: Record<string, React.ComponentType<any>> = {};

    // Inline code with file preview
    if (onPreviewFile) {
      components.code = (props: any) => (
        <InlineCode {...props} onPreviewFile={onPreviewFile} workspacePath={workspacePath} />
      );
    }

    // Custom img: resolve local workspace paths through file API
    // rehype-sanitize runs before component substitution, but guard protocols defensively
    if (sessionId && workspacePath) {
      components.img = (props: any) => {
        const { src, alt } = props;
        const apiUrl = src ? toFileApiUrl(src, sessionId, workspacePath) : null;
        // Only allow workspace API URLs or safe http(s) URLs
        const resolvedSrc = apiUrl || (src?.match(/^https?:\/\//) ? src : null);
        if (!resolvedSrc) return null;
        return (
          <InlineImage
            src={resolvedSrc}
            alt={alt || ""}
            onClick={apiUrl ? () => onPreviewFile?.(src) : undefined}
          />
        );
      };
    }

    return Object.keys(components).length > 0 ? components : undefined;
  }, [onPreviewFile, workspacePath, sessionId]);

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-lg px-4 py-2 ${
          isUser
            ? "bg-blue-600 text-white"
            : "bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100"
        }`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap break-words">{content}</p>
        ) : (
          <>
            <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-pre:my-2 prose-code:text-violet-700 dark:prose-code:text-violet-300 prose-code:bg-violet-50 dark:prose-code:bg-violet-900/40 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-pre:bg-gray-800 prose-pre:text-gray-100 prose-pre:rounded-lg prose-a:text-blue-600 dark:prose-a:text-blue-400">
              <Markdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[[rehypeSanitize, sanitizeSchema]]}
                components={markdownComponents}
              >
                {content}
              </Markdown>
            </div>
            {/* Auto-detected inline images */}
            {inlineImages.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-1">
                {inlineImages.map(({ path: imgPath, url }) => (
                  <InlineImage
                    key={imgPath}
                    src={url}
                    alt={imgPath.split("/").pop() || "image"}
                    onClick={() => onPreviewFile?.(imgPath)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ResultBlock({ message }: { message: Message }) {
  let data: { success?: boolean; cost?: number; duration?: number } = {};
  try {
    data = JSON.parse(message.content || "{}");
  } catch {
    return null;
  }

  return (
    <div className="flex justify-center my-2">
      <div className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-3 bg-gray-50 dark:bg-gray-800 px-3 py-1 rounded-full">
        <span className={data.success ? "text-green-500" : "text-red-500"}>
          {data.success ? "Completed" : "Failed"}
        </span>
        {data.cost != null && <span>${data.cost.toFixed(4)}</span>}
        {data.duration != null && <span>{(data.duration / 1000).toFixed(1)}s</span>}
      </div>
    </div>
  );
}

function ToolResultBlock({
  message,
  sessionId,
  workspacePath,
  onPreviewFile,
}: {
  message: Message;
  sessionId?: string;
  workspacePath?: string;
  onPreviewFile?: (path: string) => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const content = message.content || "";
  const preview = content.length > 120 ? content.slice(0, 120) + "..." : content;

  // Detect image paths in tool result
  const resultImages = useMemo(() => {
    if (!sessionId || !workspacePath) return [];
    return extractImagePaths(content)
      .map((p) => ({ path: p, url: toFileApiUrl(p, sessionId, workspacePath) }))
      .filter((x): x is { path: string; url: string } => x.url !== null);
  }, [content, sessionId, workspacePath]);

  return (
    <div className="my-1">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setIsExpanded(!isExpanded)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setIsExpanded(!isExpanded);
          }
        }}
        className="text-[11px] text-gray-400 dark:text-gray-500 hover:text-gray-500 cursor-pointer flex items-center gap-1 px-1"
      >
        <span>{isExpanded ? "▼" : "▶"}</span>
        <span className="font-medium">result</span>
        {!isExpanded && <span className="truncate max-w-xs">{preview}</span>}
      </div>
      {isExpanded && (
        <pre className="text-[11px] text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 rounded p-2 mt-1 mx-1 max-h-48 overflow-auto whitespace-pre-wrap break-words">
          {content}
        </pre>
      )}
      {/* Image thumbnails from tool result */}
      {resultImages.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-1 px-1">
          {resultImages.map(({ path: imgPath, url }) => (
            <InlineImage
              key={imgPath}
              src={url}
              alt={imgPath.split("/").pop() || "image"}
              onClick={() => onPreviewFile?.(imgPath)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TypingIndicator({
  language,
  cliLabel = "Claude",
}: {
  language: Language;
  cliLabel?: string;
}) {
  const t = UI_TEXT[language];
  return (
    <div className="flex items-center gap-1.5 py-2 px-1">
      <div className="flex gap-1">
        <span className="typing-dot w-2 h-2 bg-gray-400 rounded-full inline-block" />
        <span className="typing-dot w-2 h-2 bg-gray-400 rounded-full inline-block" />
        <span className="typing-dot w-2 h-2 bg-gray-400 rounded-full inline-block" />
      </div>
      <span className="text-sm text-gray-400 ml-1">{t.thinkingLabel(cliLabel)}</span>
    </div>
  );
}

// --- Welcome screen (no session selected) ---

function WelcomeScreen({
  onNewSession,
  language,
}: {
  onNewSession: () => void;
  language: Language;
}) {
  const t = UI_TEXT[language];
  return (
    <div className="flex-1 flex flex-col bg-gradient-to-b from-gray-50 to-white dark:from-gray-950 dark:to-gray-900 px-6">
      {/* Drag region for Electron window */}
      {navigator.userAgent.includes("Electron") && (
        <div className="h-10 shrink-0" style={{ WebkitAppRegion: "drag" } as React.CSSProperties} />
      )}
      <div className="flex-1 flex items-center justify-center">
        <div className="max-w-2xl w-full text-center">
          <div className="mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 text-white text-2xl font-bold mb-4 shadow-lg">
              CW
            </div>
            <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">
              {t.welcomeTitle}
            </h1>
            <p className="text-gray-500 dark:text-gray-400 mt-2">{t.welcomeSubtitle}</p>
          </div>

          <div className="grid grid-cols-3 gap-4 mb-8 max-w-lg mx-auto">
            {t.steps.map((title, i) => (
              <div key={i} className="relative text-center">
                {i > 0 && (
                  <div className="absolute left-0 top-5 -translate-x-1/2 w-full h-[2px]">
                    <div className="h-full bg-gray-200 dark:bg-gray-700 mx-2" />
                  </div>
                )}
                <div
                  className={`relative inline-flex items-center justify-center w-10 h-10 rounded-full ${STEP_COLORS[i]} text-white text-sm font-bold mb-2 shadow`}
                >
                  {i + 1}
                </div>
                <div className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                  {title}
                </div>
                <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-1 leading-tight px-1">
                  {t.stepsDesc[i]}
                </div>
                <div className="mt-1.5">
                  <span className="inline-block text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                    {STEP_TOOLS[i]}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={onNewSession}
            className="px-8 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors shadow-md hover:shadow-lg"
          >
            {t.welcomeCta}
          </button>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">{t.welcomeHint}</p>
        </div>
      </div>
    </div>
  );
}

// --- Empty chat (session selected but no messages) ---

function EmptyChat({
  onFillInput,
  onSendMessage,
  language,
}: {
  onFillInput: (prompt: string, hint: string) => void;
  onSendMessage: (content: string) => void;
  language: Language;
}) {
  const t = UI_TEXT[language];
  const actions = PIPELINE_ACTIONS[language];
  const chips = QUICK_CHIPS[language];

  return (
    <div className="flex-1 flex items-center justify-center px-6">
      <div className="max-w-xl w-full">
        <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-200 text-center mb-1">
          {t.emptyTitle}
        </h2>
        <p className="text-sm text-gray-400 dark:text-gray-500 text-center mb-6">
          {t.emptySubtitle}
        </p>

        {/* Pipeline action cards */}
        <div className="space-y-3">
          {actions.map((action) => (
            <button
              key={action.label}
              onClick={() => {
                if (action.mode === "send") {
                  onSendMessage(action.prompt);
                } else {
                  onFillInput(action.prompt, action.hint || "");
                }
              }}
              className="group w-full text-left p-4 rounded-xl border border-gray-200 hover:border-blue-300 hover:shadow-md transition-all bg-white dark:border-gray-700 dark:hover:border-blue-600 dark:bg-gray-800"
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl shrink-0">{action.icon}</span>
                <div className="min-w-0">
                  <div className="font-medium text-gray-800 dark:text-gray-100 group-hover:text-blue-600 transition-colors">
                    {action.label}
                  </div>
                  <div className="text-sm text-gray-400 dark:text-gray-500 mt-0.5">
                    {action.description}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3 mt-6 mb-3">
          <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
          <span className="text-xs text-gray-400 font-medium">{t.advancedTools}</span>
          <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
        </div>

        {/* Compact chips */}
        <div className="flex flex-wrap justify-center gap-1.5">
          {chips.map((chip) => (
            <button
              key={chip.label}
              onClick={() => {
                if (chip.prompt.endsWith("：") || chip.prompt.endsWith(": ")) {
                  onFillInput(chip.prompt, "");
                } else {
                  onSendMessage(chip.prompt);
                }
              }}
              className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors font-medium ${chip.color}`}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// --- Main ChatWindow ---

export function ChatWindow({
  sessionId,
  messages,
  isConnected,
  isLoading,
  onSendMessage,
  onInterrupt,
  onShowFiles,
  onShowPublish,
  onNewSession,
  onPreviewFile,
  workspacePath,
  showFilesActive,
  language,
  accounts,
  targetAccountId,
  onTargetAccountChange,
  cliName = "claude",
}: ChatWindowProps) {
  const t = UI_TEXT[language];
  const cliLabel =
    cliName === "claude"
      ? "Claude"
      : cliName === "codex"
        ? "Codex"
        : cliName === "gemini"
          ? "Gemini"
          : cliName === "opencode"
            ? "OpenCode"
            : cliName;
  const [input, setInput] = useState("");
  const [inputHint, setInputHint] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleFillInput = (prompt: string, hint: string) => {
    setInput(prompt);
    setInputHint(hint);
    // Focus at end of text after React re-render
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.selectionStart = prompt.length;
        textareaRef.current.selectionEnd = prompt.length;
      }
    }, 0);
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + "px";
    }
  }, [input]);

  // Wrap send to prepend current timestamp + target account context
  const sendWithAccount = (content: string) => {
    const now = new Date();
    const dateStr = now.toISOString().split("T")[0];
    const timeStr = now.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    });
    const tzName = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const timestamp = `[Current Time: ${dateStr} ${timeStr} ${tzName}]`;

    let prefix = timestamp + "\n";

    if (targetAccountId === "__all__" && accounts && accounts.length > 0) {
      const accountList = accounts
        .map((a) => `- ${a.handle} (${a.platform}, ID: ${a.id})`)
        .join("\n");
      prefix += `[Matrix Publishing: Generate UNIQUE content for EACH account based on their style/persona. Publish to ALL accounts below.]\n${accountList}\n\n`;
    } else {
      const account = accounts?.find((a) => a.id === targetAccountId);
      if (account) {
        prefix += `[Target Account: ${account.handle} (${account.platform}, ID: ${account.id})]\n\n`;
      } else {
        prefix += "\n";
      }
    }

    onSendMessage(prefix + content);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !sessionId || isLoading || !isConnected) return;
    sendWithAccount(input.trim());
    setInput("");
    setInputHint("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Skip if IME is composing (e.g. selecting Chinese/Japanese characters)
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  // No session selected -> welcome
  if (!sessionId) {
    return <WelcomeScreen onNewSession={onNewSession} language={language} />;
  }

  return (
    <div className="flex-1 flex flex-col bg-white dark:bg-gray-900 min-w-0">
      {/* Header toolbar — drag region for Electron window */}
      <div
        className="px-4 py-2.5 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between shrink-0"
        style={
          navigator.userAgent.includes("Electron")
            ? ({ WebkitAppRegion: "drag" } as React.CSSProperties)
            : undefined
        }
      >
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100 text-sm">{t.chatTitle}</h2>
          {isConnected ? (
            <span className="flex items-center gap-1 text-[10px] text-green-600 bg-green-50 px-1.5 py-0.5 rounded-full dark:bg-green-900/30">
              <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
              {t.liveStatus}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full dark:bg-red-900/30">
              <span className="w-1.5 h-1.5 bg-red-500 rounded-full" />
              {t.offlineStatus}
            </span>
          )}
        </div>

        <div
          className="flex items-center gap-1.5"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          {/* Target account selector */}
          {accounts && accounts.length > 0 && onTargetAccountChange && (
            <select
              value={targetAccountId || ""}
              onChange={(e) => onTargetAccountChange(e.target.value)}
              className={`text-[11px] pl-2 pr-6 py-1 rounded-lg border transition-colors font-medium cursor-pointer appearance-none bg-no-repeat bg-right ${
                targetAccountId === "__all__"
                  ? "bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-700"
                  : targetAccountId
                    ? "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-700"
                    : "bg-gray-50 text-gray-500 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-600"
              }`}
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3E%3Cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3E%3C/svg%3E")`,
                backgroundSize: "16px",
                backgroundPosition: "right 4px center",
              }}
              title={
                language === "zh-TW"
                  ? "發佈目標帳號"
                  : language === "ja"
                    ? "投稿先アカウント"
                    : "Target account for publishing"
              }
            >
              <option value="">
                {language === "zh-TW"
                  ? "-- 帳號 --"
                  : language === "ja"
                    ? "-- アカウント --"
                    : "-- Account --"}
              </option>
              {accounts.length > 1 && (
                <option value="__all__">
                  {language === "zh-TW"
                    ? "全部帳號 (矩陣發文)"
                    : language === "ja"
                      ? "全アカウント (マトリックス)"
                      : "All Accounts (Matrix)"}
                </option>
              )}
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.handle} ({a.platform})
                </option>
              ))}
            </select>
          )}
          {isLoading && (
            <button
              onClick={onInterrupt}
              className="text-xs px-2.5 py-1 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors border border-red-200"
            >
              {t.stopBtn}
            </button>
          )}
          <button
            onClick={onShowFiles}
            className={`hidden md:inline-flex text-xs px-2.5 py-1 rounded-lg transition-colors border ${
              showFilesActive
                ? "bg-blue-50 text-blue-600 border-blue-200"
                : "bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-700"
            }`}
            title="Toggle workspace file explorer"
          >
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                />
              </svg>
              {t.filesBtn}
            </span>
          </button>
          <button
            onClick={onShowPublish}
            className="text-xs px-2.5 py-1 rounded-lg bg-gray-50 text-gray-600 border border-gray-200 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-700 transition-colors"
            title={t.publishBtn}
          >
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                />
              </svg>
              {t.publishBtn}
            </span>
          </button>
        </div>
      </div>

      {/* Messages or Empty state */}
      {messages.length === 0 ? (
        <EmptyChat
          onFillInput={handleFillInput}
          onSendMessage={sendWithAccount}
          language={language}
        />
      ) : (
        <div className="flex-1 overflow-y-auto p-4 space-y-3" role="log" aria-live="polite">
          {messages.map((msg) => {
            if (msg.role === "tool_use") {
              const toolName = msg.toolName || msg.tool_name || "unknown";
              const toolId = msg.toolId || msg.tool_id || msg.id;
              let toolInput = msg.toolInput || {};
              if (!msg.toolInput && msg.tool_input) {
                try {
                  toolInput = JSON.parse(msg.tool_input);
                } catch {
                  toolInput = {};
                }
              }
              return (
                <ToolUseBlock
                  key={msg.id}
                  toolName={toolName}
                  toolId={toolId}
                  toolInput={toolInput}
                  onPreviewFile={onPreviewFile}
                />
              );
            }
            if (msg.role === "tool_result") {
              return (
                <ToolResultBlock
                  key={msg.id}
                  message={msg}
                  sessionId={sessionId || undefined}
                  workspacePath={workspacePath}
                  onPreviewFile={onPreviewFile}
                />
              );
            }
            if (msg.role === "result") {
              return <ResultBlock key={msg.id} message={msg} />;
            }
            if (msg.role === "user" || msg.role === "assistant") {
              return (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  onPreviewFile={onPreviewFile}
                  workspacePath={workspacePath}
                  sessionId={sessionId || undefined}
                />
              );
            }
            return null;
          })}
          {isLoading && <TypingIndicator language={language} cliLabel={cliLabel} />}
          <div ref={messagesEndRef} />
        </div>
      )}

      {/* Input + Quick Chips */}
      <div className="border-t border-gray-200 dark:border-gray-700 shrink-0 bg-white dark:bg-gray-900">
        {/* Quick action chips — hide when empty chat shows its own chips */}
        {messages.length > 0 && (
          <div className="px-4 pt-3 pb-1.5 flex flex-wrap gap-1.5">
            {QUICK_CHIPS[language].map((chip) => (
              <button
                key={chip.label}
                disabled={!isConnected || isLoading}
                onClick={() => {
                  if (chip.prompt.endsWith("：") || chip.prompt.endsWith(": ")) {
                    setInput(chip.prompt);
                    textareaRef.current?.focus();
                  } else {
                    sendWithAccount(chip.prompt);
                  }
                }}
                className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors font-medium disabled:opacity-40 disabled:cursor-not-allowed ${chip.color}`}
              >
                {chip.label}
              </button>
            ))}
          </div>
        )}

        {/* Input */}
        <div className="px-4 pb-3">
          <form onSubmit={handleSubmit} className="flex gap-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                if (inputHint && e.target.value.length > input.length) {
                  setInputHint("");
                }
              }}
              onKeyDown={handleKeyDown}
              placeholder={isConnected ? t.placeholder : t.placeholderOffline}
              aria-label="Message input"
              disabled={!isConnected || isLoading}
              rows={1}
              className="flex-1 px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 dark:bg-gray-800 dark:text-gray-100 dark:disabled:bg-gray-700 resize-none text-sm"
            />
            <button
              type="submit"
              disabled={!input.trim() || !isConnected || isLoading}
              className="px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors self-end text-sm font-medium"
            >
              {t.sendBtn}
            </button>
          </form>
          {inputHint && (
            <div className="mt-1.5 px-1 flex items-center gap-1.5">
              <span className="text-[11px] text-blue-500 animate-pulse">&#x25B6;</span>
              <span className="text-[11px] text-blue-500">{inputHint}</span>
            </div>
          )}
          <div className="flex items-center justify-between mt-1.5 px-1">
            <span className="text-[10px] text-gray-400 dark:text-gray-500">{t.shiftEnter}</span>
            <span className="text-[10px] text-gray-400 dark:text-gray-500">
              {t.poweredBy(cliLabel)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
