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
}

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
}: {
  entry: FileEntry;
  depth: number;
  onSelect: (path: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(depth < 1);

  return (
    <div>
      <div
        className="flex items-center gap-1 py-0.5 px-1 hover:bg-gray-100 rounded cursor-pointer text-xs"
        style={{ paddingLeft: depth * 12 + 4 }}
        onClick={() => {
          if (entry.type === "directory") {
            setIsOpen(!isOpen);
          } else {
            onSelect(entry.path);
          }
        }}
      >
        {entry.type === "directory" && (
          <span className="text-gray-400 w-3 text-center">
            {isOpen ? "v" : ">"}
          </span>
        )}
        <FileIcon type={entry.type} name={entry.name} />
        <span className="truncate flex-1">{entry.name}</span>
        {entry.type === "file" && entry.size != null && (
          <span className="text-gray-400 text-[10px] shrink-0">
            {formatSize(entry.size)}
          </span>
        )}
      </div>
      {entry.type === "directory" && isOpen && entry.children && (
        <div>
          {entry.children.map((child) => (
            <FileTreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileExplorer({ sessionId, isVisible, onToggle }: FileExplorerProps) {
  const [tree, setTree] = useState<FileEntry[]>([]);
  const [workspace, setWorkspace] = useState("");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
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

  const handleSelectFile = async (filePath: string) => {
    setSelectedFile(filePath);
    setLoading(true);
    try {
      const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
      const res = await fetch(
        `/api/sessions/${encodeURIComponent(sessionId!)}/files/${encodedPath}`
      );
      if (!res.ok) {
        setFileContent(`[Error: ${res.status}]`);
      } else if (res.headers.get("content-type")?.includes("json")) {
        const data = await res.json();
        setFileContent(data.content);
      } else {
        setFileContent("[Binary file - preview not available]");
      }
    } catch {
      setFileContent("[Error loading file]");
    }
    setLoading(false);
  };

  if (!isVisible) return null;

  return (
    <div className="w-72 border-l border-gray-200 flex flex-col bg-white shrink-0">
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
      <div className="flex-1 overflow-y-auto p-1">
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
              onSelect={handleSelectFile}
            />
          ))
        )}
      </div>

      {/* File preview */}
      {selectedFile && (
        <div className="border-t border-gray-200 max-h-[40%] flex flex-col">
          <div className="px-3 py-1 text-[10px] text-gray-500 border-b border-gray-100 flex items-center justify-between">
            <span className="truncate">{selectedFile}</span>
            <button
              onClick={() => {
                setSelectedFile(null);
                setFileContent(null);
              }}
              className="text-gray-400 hover:text-gray-600 ml-1"
            >
              x
            </button>
          </div>
          <div className="flex-1 overflow-auto p-2">
            {loading ? (
              <div className="text-xs text-gray-400">Loading...</div>
            ) : (
              <pre className="text-[11px] text-gray-700 whitespace-pre-wrap break-words font-mono">
                {fileContent}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
