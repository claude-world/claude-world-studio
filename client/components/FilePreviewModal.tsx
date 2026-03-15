import React, { useState, useEffect } from "react";

interface FilePreviewModalProps {
  sessionId: string;
  filePath: string; // relative path from workspace
  onClose: () => void;
}

const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp", "svg"];

/** Normalize path: resolve ".." by popping parent segments, strip "." */
function sanitizePath(p: string): string {
  const parts: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === ".." ) { parts.pop(); }
    else if (seg !== "." && seg !== "") { parts.push(seg); }
  }
  return parts.join("/");
}

export function FilePreviewModal({ sessionId, filePath, onClose }: FilePreviewModalProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fileType, setFileType] = useState<"image" | "pdf" | "audio" | "video" | "text" | "binary">("text");

  const safePath = sanitizePath(filePath);
  const ext = safePath.split(".").pop()?.toLowerCase() || "";
  const encodedPath = safePath.split("/").map(encodeURIComponent).join("/");
  const fileUrl = `/api/sessions/${encodeURIComponent(sessionId)}/files/${encodedPath}`;

  useEffect(() => {
    const controller = new AbortController();

    const load = async () => {
      setLoading(true);

      if (IMAGE_EXTS.includes(ext)) {
        setFileType("image");
        setContent(fileUrl);
        setLoading(false);
        return;
      }

      if (ext === "pdf") {
        setFileType("pdf");
        setContent(fileUrl);
        setLoading(false);
        return;
      }

      if (["mp3", "wav", "m4a", "ogg"].includes(ext)) {
        setFileType("audio");
        setContent(fileUrl);
        setLoading(false);
        return;
      }

      if (["mp4", "webm"].includes(ext)) {
        setFileType("video");
        setContent(fileUrl);
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(fileUrl, { signal: controller.signal });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          setFileType("text");
          setContent(`[Error: ${err.error || res.statusText}]`);
          setLoading(false);
          return;
        }
        if (res.headers.get("content-type")?.includes("json")) {
          const data = await res.json();
          setFileType("text");
          setContent(data.content ?? "[No content]");
        } else {
          setFileType("binary");
          setContent(fileUrl);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setFileType("text");
        setContent("[Error loading file]");
      }
      setLoading(false);
    };

    load();
    return () => controller.abort();
  }, [sessionId, filePath]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  const fileName = safePath.split("/").pop() || safePath;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div role="dialog" aria-modal="true" aria-label={fileName} className="bg-white rounded-xl shadow-2xl max-w-5xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-mono px-2 py-0.5 rounded bg-gray-100 text-gray-500 uppercase shrink-0">
              {ext}
            </span>
            <span className="text-sm font-medium text-gray-700 truncate">{fileName}</span>
            <span className="text-xs text-gray-400 truncate hidden sm:inline">{safePath}</span>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-lg px-2 shrink-0"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="text-center text-gray-400 py-16">Loading...</div>
          ) : fileType === "image" ? (
            <div className="flex items-center justify-center p-6 bg-gray-50">
              <img
                src={content!}
                alt={fileName}
                className="max-w-full max-h-[75vh] rounded shadow-lg"
              />
            </div>
          ) : fileType === "pdf" ? (
            <iframe src={content!} className="w-full h-[80vh]" title={fileName} />
          ) : fileType === "audio" ? (
            <div className="flex items-center justify-center p-12">
              <audio controls src={content!} className="w-full max-w-lg" />
            </div>
          ) : fileType === "video" ? (
            <div className="flex items-center justify-center p-6 bg-black">
              <video controls src={content!} className="max-w-full max-h-[75vh]" />
            </div>
          ) : fileType === "binary" ? (
            <div className="text-center py-16">
              <p className="text-gray-500 mb-3">Binary file — preview not available</p>
              <a
                href={content!}
                download={fileName}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 text-sm"
              >
                Download {fileName}
              </a>
            </div>
          ) : (
            <pre className="text-sm text-gray-700 whitespace-pre-wrap break-words font-mono p-6 leading-relaxed">
              {content}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
