import { Router } from "express";
import fs from "fs";
import fsp from "fs/promises";
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

async function buildFileTree(
  dirPath: string,
  basePath: string,
  depth = 0,
  maxDepth = 3
): Promise<FileEntry[]> {
  if (depth >= maxDepth) return [];

  try {
    const entries = await fsp.readdir(dirPath, { withFileTypes: true });
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
          children: await buildFileTree(fullPath, basePath, depth + 1, maxDepth),
        });
      } else {
        try {
          const stat = await fsp.stat(fullPath);
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
router.get("/:sessionId/files", async (req, res) => {
  const session = store.getSession(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  const rawDepth = parseInt(req.query.depth as string) || 3;
  const depth = Math.min(Math.max(rawDepth, 1), MAX_DEPTH);
  const tree = await buildFileTree(session.workspace_path, session.workspace_path, 0, depth);

  res.json({
    workspace: session.workspace_path,
    tree,
  });
});

// Read file content
router.get("/:sessionId/files/*", async (req, res) => {
  const session = store.getSession(req.params.sessionId);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  // Extract the file path from the wildcard params
  const filePath = (req.params as Record<string, string>)[0] as string | undefined;
  if (!filePath) {
    return res.status(400).json({ error: "File path required" });
  }

  // Support absolute paths (e.g. ~/Downloads/card.pdf from NotebookLM)
  const isAbsolute = filePath.startsWith("/");
  const requestedPath = isAbsolute ? filePath : path.resolve(session.workspace_path, filePath);

  try {
    const resolvedPath = await fsp.realpath(requestedPath);

    if (isAbsolute) {
      // Absolute paths: restrict to workspace + user home subdirectories
      const home = process.env.HOME || "";
      const resolvedBase = await fsp.realpath(session.workspace_path);
      const allowedRoots = [
        resolvedBase,
        ...(home ? [
          path.join(home, "Downloads"),
          path.join(home, "Documents"),
          path.join(home, "Desktop"),
          path.join(home, "Pictures"),
        ] : []),
      ].filter((p) => { try { return fs.existsSync(p); } catch { return false; } });

      const isAllowed = allowedRoots.some((root) => {
        try {
          const resolvedRoot = fs.realpathSync(root);
          return resolvedPath === resolvedRoot || resolvedPath.startsWith(resolvedRoot + path.sep);
        } catch { return false; }
      });

      if (!isAllowed) {
        return res.status(403).json({ error: "Absolute path not in allowed directories" });
      }
    } else {
      // Relative paths: verify within workspace (original security check)
      const resolvedBase = await fsp.realpath(session.workspace_path);
      if (resolvedPath !== resolvedBase && !resolvedPath.startsWith(resolvedBase + path.sep)) {
        return res.status(403).json({ error: "Path traversal not allowed" });
      }
    }

    const stat = await fsp.stat(resolvedPath);
    if (stat.isDirectory()) {
      return res.status(400).json({ error: "Path is a directory" });
    }

    // For binary files, send raw; for text, send JSON
    const ext = path.extname(resolvedPath).toLowerCase();
    const binaryExts = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".pdf", ".mp3", ".mp4", ".wav", ".m4a", ".webm", ".ogg"];

    if (binaryExts.includes(ext)) {
      res.sendFile(resolvedPath);
    } else {
      // Text file - limit by byte size, then decode
      if (stat.size > MAX_TEXT_BYTES) {
        const fh = await fsp.open(resolvedPath, "r");
        try {
          const buf = Buffer.alloc(MAX_TEXT_BYTES);
          await fh.read(buf, 0, MAX_TEXT_BYTES, 0);
          const content = buf.toString("utf-8");
          res.json({ path: filePath, content, truncated: true, size: stat.size });
        } finally {
          await fh.close();
        }
      } else {
        const content = await fsp.readFile(resolvedPath, "utf-8");
        res.json({ path: filePath, content, truncated: false, size: stat.size });
      }
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return res.status(404).json({ error: "File not found" });
    if (code === "EACCES") return res.status(403).json({ error: "Permission denied" });
    return res.status(500).json({ error: "Failed to read file" });
  }
});

export default router;
