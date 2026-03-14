import React, { useState } from "react";

interface ToolUseBlockProps {
  toolName: string;
  toolInput: Record<string, any>;
  toolId: string;
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
  // Strip MCP prefix for cleaner display
  return name
    .replace(/^mcp__(trend[-_]pulse|cf[-_]browser|notebooklm)__/, "")
    .replace(/_/g, " ");
}

function getToolSummary(name: string, input: Record<string, any>): string {
  const displayName = getToolDisplayName(name);

  // Built-in tools
  switch (name) {
    case "Read":
      return input.file_path || "";
    case "Write":
    case "Edit":
      return input.file_path || "";
    case "Bash":
      return input.command?.slice(0, 80) + (input.command?.length > 80 ? "..." : "") || "";
    case "Grep":
      return `"${input.pattern}" in ${input.path || "."}`;
    case "Glob":
      return input.pattern || "";
    case "WebSearch":
      return input.query || "";
    case "WebFetch":
      return input.url || "";
  }

  // MCP tools - show key params
  if (input.topic) return input.topic;
  if (input.query) return input.query;
  if (input.url) return input.url;
  if (input.keyword) return input.keyword;
  if (input.sources) return `sources: ${input.sources}`;

  return JSON.stringify(input).slice(0, 60);
}

export function ToolUseBlock({ toolName, toolInput, toolId }: ToolUseBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const colorClass = getToolColor(toolName);
  const badge = getToolBadge(toolName);

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
        <span className="text-xs text-gray-400 shrink-0 ml-2">
          {isExpanded ? "v" : ">"}
        </span>
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
