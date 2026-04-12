import React, { useState } from "react";

interface ToolUseBlockProps {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolId: string;
  onPreviewFile?: (absolutePath: string) => void;
  /** Optional improvement notes from a following reflection message */
  reflectionContent?: string;
}

// Color mapping for MCP server tools
function getToolColor(name: string): string {
  if (name.startsWith("mcp__trend-pulse") || name.startsWith("mcp__trend_pulse")) {
    return "border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950";
  }
  if (name.startsWith("mcp__cf-browser") || name.startsWith("mcp__cf_browser")) {
    return "border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-950";
  }
  if (name.startsWith("mcp__notebooklm")) {
    return "border-purple-300 bg-purple-50 dark:border-purple-700 dark:bg-purple-950";
  }
  return "border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800";
}

function getToolBadge(name: string): { label: string; color: string } | null {
  if (name.startsWith("mcp__trend-pulse") || name.startsWith("mcp__trend_pulse")) {
    return {
      label: "trend-pulse",
      color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-400",
    };
  }
  if (name.startsWith("mcp__cf-browser") || name.startsWith("mcp__cf_browser")) {
    return {
      label: "cf-browser",
      color: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-400",
    };
  }
  if (name.startsWith("mcp__notebooklm")) {
    return {
      label: "notebooklm",
      color: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-400",
    };
  }
  return null;
}

function getToolDisplayName(name: string): string {
  return name.replace(/^mcp__(trend[-_]pulse|cf[-_]browser|notebooklm)__/, "").replace(/_/g, " ");
}

function str(val: unknown): string {
  return typeof val === "string" ? val : "";
}

function getToolSummary(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "Read":
    case "Write":
    case "Edit":
      return str(input.file_path);
    case "Bash": {
      const cmd = str(input.command);
      return cmd.length > 80 ? cmd.slice(0, 80) + "..." : cmd;
    }
    case "Grep":
      return `"${str(input.pattern)}" in ${str(input.path) || "."}`;
    case "Glob":
      return str(input.pattern);
    case "WebSearch":
      return str(input.query);
    case "WebFetch":
      return str(input.url);
  }

  if (input.topic) return str(input.topic);
  if (input.query) return str(input.query);
  if (input.url) return str(input.url);
  if (input.keyword) return str(input.keyword);
  if (input.sources) return `sources: ${str(input.sources)}`;

  return JSON.stringify(input).slice(0, 60);
}

const PREVIEWABLE_EXTS = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "pdf",
  "md",
  "txt",
  "json",
  "ts",
  "tsx",
  "js",
  "jsx",
  "py",
  "html",
  "css",
  "mp3",
  "wav",
  "m4a",
  "mp4",
  "webm",
];

function isPreviewable(filePath: string): boolean {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  return PREVIEWABLE_EXTS.includes(ext);
}

export function ToolUseBlock({
  toolName,
  toolInput,
  toolId,
  onPreviewFile,
  reflectionContent,
}: ToolUseBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const colorClass = getToolColor(toolName);
  const badge = getToolBadge(toolName);

  // Agentic studio tools (v2.0) — show a subtle indicator
  const isAgenticTool =
    toolName === "mcp__studio__create_goal_session" ||
    toolName === "mcp__studio__run_reflection_loop" ||
    toolName === "mcp__studio__search_memory" ||
    toolName === "mcp__studio__generate_strategy_from_analytics";

  const filePath = toolInput.file_path as string | undefined;
  const canPreview =
    onPreviewFile &&
    filePath &&
    isPreviewable(filePath) &&
    (toolName === "Write" || toolName === "Read" || toolName === "Edit");

  return (
    <div className={`my-2 border rounded ${colorClass}`}>
      <div className="p-2 flex items-center justify-between">
        {/* Collapse toggle — clickable label area */}
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
          className="flex items-center gap-2 min-w-0 cursor-pointer hover:opacity-80 flex-1"
        >
          <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">
            {isExpanded ? "▼" : "▶"}
          </span>
          {badge && (
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${badge.color}`}>
              {badge.label}
            </span>
          )}
          {isAgenticTool && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-400">
              agent
            </span>
          )}
          <span className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase shrink-0">
            {getToolDisplayName(toolName)}
          </span>
          <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
            {getToolSummary(toolName, toolInput)}
          </span>
        </div>
        {/* Preview button — separate from toggle, no nesting */}
        {canPreview && (
          <button
            type="button"
            onClick={() => onPreviewFile!(filePath!)}
            className="text-[10px] px-2 py-0.5 rounded bg-blue-100 text-blue-600 hover:bg-blue-200 transition-colors shrink-0 ml-2"
          >
            Preview
          </button>
        )}
      </div>
      {isExpanded && (
        <div className="p-2 border-t border-gray-200/50 dark:border-gray-700">
          <pre className="text-xs bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 p-2 rounded overflow-x-auto max-h-64 overflow-y-auto">
            {JSON.stringify(toolInput, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
