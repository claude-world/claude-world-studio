import React, { useState } from "react";

interface ToolUseBlockProps {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolId: string;
  onPreviewFile?: (absolutePath: string) => void;
}

// Color mapping for MCP server tools
function getToolColor(name: string): string {
  if (name.startsWith("mcp__trend-pulse") || name.startsWith("mcp__trend_pulse")) {
    return "border-emerald-300 bg-emerald-50";
  }
  if (name.startsWith("mcp__cf-browser") || name.startsWith("mcp__cf_browser")) {
    return "border-blue-300 bg-blue-50";
  }
  if (name.startsWith("mcp__notebooklm")) {
    return "border-purple-300 bg-purple-50";
  }
  return "border-gray-200 bg-gray-50";
}

function getToolBadge(name: string): { label: string; color: string } | null {
  if (name.startsWith("mcp__trend-pulse") || name.startsWith("mcp__trend_pulse")) {
    return { label: "trend-pulse", color: "bg-emerald-100 text-emerald-700" };
  }
  if (name.startsWith("mcp__cf-browser") || name.startsWith("mcp__cf_browser")) {
    return { label: "cf-browser", color: "bg-blue-100 text-blue-700" };
  }
  if (name.startsWith("mcp__notebooklm")) {
    return { label: "notebooklm", color: "bg-purple-100 text-purple-700" };
  }
  return null;
}

function getToolDisplayName(name: string): string {
  return name
    .replace(/^mcp__(trend[-_]pulse|cf[-_]browser|notebooklm)__/, "")
    .replace(/_/g, " ");
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
  "png", "jpg", "jpeg", "gif", "webp", "svg",
  "pdf", "md", "txt", "json", "ts", "tsx", "js", "jsx", "py", "html", "css",
  "mp3", "wav", "m4a", "mp4", "webm",
];

function isPreviewable(filePath: string): boolean {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  return PREVIEWABLE_EXTS.includes(ext);
}

export function ToolUseBlock({ toolName, toolInput, toolId, onPreviewFile }: ToolUseBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const colorClass = getToolColor(toolName);
  const badge = getToolBadge(toolName);

  const filePath = toolInput.file_path as string | undefined;
  const canPreview = onPreviewFile && filePath && isPreviewable(filePath) &&
    (toolName === "Write" || toolName === "Read" || toolName === "Edit");

  return (
    <div className={`my-2 border rounded ${colorClass}`}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full p-2 flex items-center justify-between text-left hover:opacity-80"
      >
        <div className="flex items-center gap-2 min-w-0">
          {badge && (
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${badge.color}`}>
              {badge.label}
            </span>
          )}
          <span className="text-xs font-semibold text-gray-600 uppercase shrink-0">
            {getToolDisplayName(toolName)}
          </span>
          <span className="text-xs text-gray-500 truncate">
            {getToolSummary(toolName, toolInput)}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          {canPreview && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onPreviewFile!(filePath!);
              }}
              className="text-[10px] px-2 py-0.5 rounded bg-blue-100 text-blue-600 hover:bg-blue-200 transition-colors"
            >
              Preview
            </button>
          )}
          <span className="text-xs text-gray-400">
            {isExpanded ? "▼" : "▶"}
          </span>
        </div>
      </button>
      {isExpanded && (
        <div className="p-2 border-t border-gray-200/50">
          <pre className="text-xs bg-white p-2 rounded overflow-x-auto max-h-64 overflow-y-auto">
            {JSON.stringify(toolInput, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
