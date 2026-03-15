import React, { useState, useEffect } from "react";

interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  modified?: string;
  children?: FileEntry[];
}

interface FileExplorerProps {
  sessionId: string | null;
  isVisible: boolean;
  onToggle: () => void;
  onPreviewFile: (relativePath: string) => void;
}

const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp", "svg"];

function FileIcon({ type, name }: { type: string; name: string }) {
  if (type === "directory") return <span className="text-yellow-500">D</span>;
  const ext = name.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "ts":
    case "tsx":
      return <span className="text-blue-400">T</span>;
    case "js":
    case "jsx":
      return <span className="text-yellow-400">J</span>;
    case "py":
      return <span className="text-green-400">P</span>;
    case "md":
      return <span className="text-gray-400">M</span>;
    case "json":
      return <span className="text-orange-400">{"{}"}</span>;
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
    case "svg":
      return <span className="text-pink-400">I</span>;
    case "pdf":
      return <span className="text-red-400">P</span>;
    case "mp3":
    case "wav":
    case "m4a":
      return <span className="text-purple-400">A</span>;
    case "mp4":
    case "webm":
      return <span className="text-indigo-400">V</span>;
    default:
      return <span className="text-gray-400">F</span>;
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + "B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + "KB";
  return (bytes / (1024 * 1024)).toFixed(1) + "MB";
}

function FileTreeNode({
  entry,
  depth,
  onSelect,
  sessionId,
}: {
  entry: FileEntry;
  depth: number;
  onSelect: (path: string) => void;
  sessionId: string;
}) {
  const [isOpen, setIsOpen] = useState(depth < 1);
  const ext = entry.name.split(".").pop()?.toLowerCase() || "";
  const isImage = IMAGE_EXTS.includes(ext);

  return (
    <div>
      <button
        type="button"
        aria-expanded={entry.type === "directory" ? isOpen : undefined}
        className="w-full flex items-center gap-1.5 py-1 px-1.5 hover:bg-gray-100 rounded cursor-pointer text-xs group text-left"
        style={{ paddingLeft: depth * 14 + 6 }}
        onClick={() => {
          if (entry.type === "directory") {
            setIsOpen(!isOpen);
          } else {
            onSelect(entry.path);
          }
        }}
      >
        {entry.type === "directory" && (
          <span className="text-gray-400 w-3 text-center text-[10px]">
            {isOpen ? "▼" : "▶"}
          </span>
        )}
        <FileIcon type={entry.type} name={entry.name} />
        <span className="truncate flex-1">{entry.name}</span>
        {entry.type === "file" && entry.size != null && (
          <span className="text-gray-400 text-[10px] shrink-0">
            {formatSize(entry.size)}
          </span>
        )}
      </button>

      {/* Inline image thumbnail for image files */}
      {entry.type === "file" && isImage && (
        <button
          type="button"
          className="ml-8 mr-2 my-1 cursor-pointer block"
          onClick={() => onSelect(entry.path)}
          aria-label={`Preview ${entry.name}`}
        >
          <img
            src={`/api/sessions/${encodeURIComponent(sessionId)}/files/${entry.path.split("/").map(encodeURIComponent).join("/")}`}
            alt={entry.name}
            className="max-h-16 rounded border border-gray-200 hover:border-blue-300 transition-colors"
            loading="lazy"
          />
        </button>
      )}

      {entry.type === "directory" && isOpen && entry.children && (
        <div>
          {entry.children.map((child) => (
            <FileTreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              onSelect={onSelect}
              sessionId={sessionId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileExplorer({ sessionId, isVisible, onToggle, onPreviewFile }: FileExplorerProps) {
  const [tree, setTree] = useState<FileEntry[]>([]);
  const [workspace, setWorkspace] = useState("");
  const [loadingTree, setLoadingTree] = useState(false);

  useEffect(() => {
    if (!sessionId || !isVisible) return;

    const controller = new AbortController();
    setLoadingTree(true);

    fetch(`/api/sessions/${encodeURIComponent(sessionId)}/files`, {
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load");
        return res.json();
      })
      .then((data) => {
        setTree(data.tree || []);
        setWorkspace(data.workspace || "");
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          console.error("Failed to load file tree:", err);
        }
      })
      .finally(() => setLoadingTree(false));

    return () => controller.abort();
  }, [sessionId, isVisible]);

  if (!isVisible) return null;

  return (
    <div className="w-96 border-l border-gray-200 flex flex-col bg-white shrink-0">
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-200 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-600 uppercase">Files</h3>
        <button
          onClick={onToggle}
          className="text-xs text-gray-400 hover:text-gray-600"
        >
          Close
        </button>
      </div>

      {/* Workspace path */}
      <div className="px-3 py-1 text-[10px] text-gray-400 truncate border-b border-gray-100">
        {workspace}
      </div>

      {/* Tree */}
      <div role="list" aria-label="File explorer" className="flex-1 overflow-y-auto p-1.5">
        {loadingTree ? (
          <div className="text-xs text-gray-400 text-center mt-4">
            Loading...
          </div>
        ) : tree.length === 0 ? (
          <div className="text-xs text-gray-400 text-center mt-4">
            No files found
          </div>
        ) : (
          tree.map((entry) => (
            <FileTreeNode
              key={entry.path}
              entry={entry}
              depth={0}
              onSelect={onPreviewFile}
              sessionId={sessionId!}
            />
          ))
        )}
      </div>
    </div>
  );
}
