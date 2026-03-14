import { Router } from "express";
import fs from "fs";
import path from "path";
import store from "../db.js";

const MAX_DEPTH = 5;
const MAX_TEXT_BYTES = 100 * 1024;

/**
 * Check that `target` is strictly within `base` directory.
 * Both paths must exist on disk so realpathSync can resolve symlinks.
 * Returns false if either path doesn't exist (deny by default).
 */
function isWithinWorkspace(base: string, target: string): boolean {
  try {
    const resolvedBase = fs.realpathSync(base);
    const resolvedTarget = fs.realpathSync(target);
    return (
      resolvedTarget === resolvedBase ||
      resolvedTarget.startsWith(resolvedBase + path.sep)
    );
  } catch {
    return false;
  }
}

const router = Router();

interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  modified?: string;
  children?: FileEntry[];
}

function buildFileTree(
  dirPath: string,
  basePath: string,
  depth = 0,
  maxDepth = 3
): FileEntry[] {
  if (depth >= maxDepth) return [];

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const result: FileEntry[] = [];

    for (const entry of entries) {
      // Skip hidden files and common non-useful dirs
      if (
        entry.name.startsWith(".") ||
        entry.name === "node_modules" ||
        entry.name === "__pycache__"
      ) {
        continue;
      }

      const fullPath = path.join(dirPath, entry.name);
      const relativePath = path.relative(basePath, fullPath);

      if (entry.isDirectory()) {
        result.push({
          name: entry.name,
          path: relativePath,
          type: "directory",
          children: buildFileTree(fullPath, basePath, depth + 1, maxDepth),
        });
      } else {
        try {
          const stat = fs.statSync(fullPath);
          result.push({
            name: entry.name,
            path: relativePath,
            type: "file",
            size: stat.size,
            modified: stat.mtime.toISOString(),
          });
        } catch {
          // Skip files we can't stat (broken symlinks, permission issues)
        }
      }
    }

    // Sort: directories first, then alphabetical
    return result.sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  } catch {
    return [];
  }
}

// List workspace file tree
router.get("/:sessionId/files", (req, res) => {
  const session = store.getSession(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  const rawDepth = parseInt(req.query.depth as string) || 3;
  const depth = Math.min(Math.max(rawDepth, 1), MAX_DEPTH);
  const tree = buildFileTree(session.workspace_path, session.workspace_path, 0, depth);

  res.json({
    workspace: session.workspace_path,
    tree,
  });
});

// Read file content
router.get("/:sessionId/files/*", (req, res) => {
  const session = store.getSession(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  // Extract the file path from the wildcard params
  const filePath = (req.params as any)[0] as string | undefined;
  if (!filePath) {
    return res.status(400).json({ error: "File path required" });
  }

  const fullPath = path.resolve(session.workspace_path, filePath);

  // Security: both paths must exist and resolve through symlinks
  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ error: "File not found" });
  }

  if (!isWithinWorkspace(session.workspace_path, fullPath)) {
    return res.status(403).json({ error: "Path traversal not allowed" });
  }

  const stat = fs.statSync(fullPath);
  if (stat.isDirectory()) {
    return res.status(400).json({ error: "Path is a directory" });
  }

  // For binary files, send raw; for text, send JSON
  const ext = path.extname(fullPath).toLowerCase();
  const binaryExts = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf", ".mp3", ".mp4", ".wav", ".m4a"];

  if (binaryExts.includes(ext)) {
    res.sendFile(fullPath);
  } else {
    // Text file - limit by byte size, then decode
    if (stat.size > MAX_TEXT_BYTES) {
      const buf = Buffer.alloc(MAX_TEXT_BYTES);
      const fd = fs.openSync(fullPath, "r");
      try {
        fs.readSync(fd, buf, 0, MAX_TEXT_BYTES, 0);
      } finally {
        fs.closeSync(fd);
      }
      const content = buf.toString("utf-8");
      res.json({ path: filePath, content, truncated: true, size: stat.size });
    } else {
      const content = fs.readFileSync(fullPath, "utf-8");
      res.json({ path: filePath, content, truncated: false, size: stat.size });
    }
  }
});

export default router;
