import { existsSync, mkdirSync, realpathSync, statSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, "..");

const BLOCKED_WORKSPACE_ROOTS = [
  "/etc",
  "/usr",
  "/bin",
  "/sbin",
  "/var",
  "/System",
  "/Library",
  "/private",
];

const ALLOWED_TEMP_WORKSPACE_ROOTS = [
  "/tmp",
  "/private/tmp",
  "/var/folders",
  "/private/var/folders",
];

function ensureDir(dirPath: string): string {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}

export function isPackagedRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.STUDIO_PACKAGED === "1" || __dirname.includes("app.asar");
}

export function getLocalDataDir(): string {
  return path.join(projectRoot, "data");
}

export function getBundledDbPath(): string {
  return path.join(projectRoot, "data", "studio.db");
}

export function getUserDataDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.STUDIO_USER_DATA_PATH) {
    return ensureDir(env.STUDIO_USER_DATA_PATH);
  }

  if (isPackagedRuntime(env)) {
    return ensureDir(path.join(homedir(), "Library", "Application Support", "Claude World Studio"));
  }

  return ensureDir(getLocalDataDir());
}

export function getDbPath(env: NodeJS.ProcessEnv = process.env): string {
  if (isPackagedRuntime(env)) {
    return path.join(getUserDataDir(env), "studio.db");
  }

  return path.join(getLocalDataDir(), "studio.db");
}

export function getDefaultWorkspace(env: NodeJS.ProcessEnv = process.env): string {
  const workspace = env.STUDIO_DEFAULT_WORKSPACE || env.DEFAULT_WORKSPACE || process.cwd();
  return ensureDir(workspace);
}

export function getBundledSkillsDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.STUDIO_BUNDLED_SKILLS_PATH || path.join(projectRoot, ".claude", "skills");
}

export function getSkillsDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.STUDIO_SKILLS_PATH) {
    return ensureDir(env.STUDIO_SKILLS_PATH);
  }

  if (isPackagedRuntime(env)) {
    return ensureDir(path.join(getUserDataDir(env), "skills"));
  }

  return path.join(projectRoot, ".claude", "skills");
}

export function getSkillCandidatePaths(
  relativePath: string,
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const seen = new Set<string>();
  const candidates = [
    path.join(getSkillsDir(env), relativePath),
    path.join(getBundledSkillsDir(env), relativePath),
  ];

  return candidates.filter((candidate) => {
    if (seen.has(candidate)) return false;
    seen.add(candidate);
    return true;
  });
}

export function resolveWorkspaceFilePath(workspaceRoot: string, relativePath: string): string {
  const normalizedRoot = path.resolve(workspaceRoot);
  const resolved = path.resolve(normalizedRoot, relativePath);
  if (resolved !== normalizedRoot && !resolved.startsWith(normalizedRoot + path.sep)) {
    throw new Error("Path escapes workspace boundary");
  }
  return resolved;
}

export type WorkspacePathValidation =
  | { ok: true; path: string; realPath: string }
  | { ok: false; error: string };

function isInsideBlockedRoot(realPath: string): boolean {
  const normalized = path.resolve(realPath);
  if (
    ALLOWED_TEMP_WORKSPACE_ROOTS.some((root) => {
      const allowed = path.resolve(root);
      return normalized === allowed || normalized.startsWith(allowed + path.sep);
    })
  ) {
    return false;
  }

  return BLOCKED_WORKSPACE_ROOTS.some((root) => {
    const blocked = path.resolve(root);
    return normalized === blocked || normalized.startsWith(blocked + path.sep);
  });
}

export function validateWorkspacePath(workspacePath: string): WorkspacePathValidation {
  if (!path.isAbsolute(workspacePath)) {
    return { ok: false, error: "workspacePath must be an absolute path" };
  }

  let realPath: string;
  try {
    realPath = realpathSync(workspacePath);
  } catch {
    return { ok: false, error: "workspacePath does not exist" };
  }

  try {
    if (!statSync(realPath).isDirectory()) {
      return { ok: false, error: "workspacePath must be a directory" };
    }
  } catch {
    return { ok: false, error: "workspacePath does not exist" };
  }

  if (isInsideBlockedRoot(realPath)) {
    return { ok: false, error: "workspacePath cannot be a system directory" };
  }

  return { ok: true, path: workspacePath, realPath };
}
