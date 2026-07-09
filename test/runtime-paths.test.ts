import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import {
  getDbPath,
  getDefaultWorkspace,
  getOsUserDataDir,
  getSkillCandidatePaths,
  getSkillsDir,
  getUserDataDir,
  isInsideNodeModules,
  resolveWorkspaceFilePath,
  validateWorkspacePath,
} from "../server/runtime-paths.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function makeProjectTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(process.cwd(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("runtime paths", () => {
  it("uses packaged env overrides for user data, workspace, and skills", () => {
    const userDataDir = makeTempDir("studio-user-data-");
    const workspaceDir = path.join(makeTempDir("studio-workspace-"), "workspace");
    const skillsDir = path.join(makeTempDir("studio-skills-"), "skills");
    const bundledSkillsDir = path.join(makeTempDir("studio-bundled-skills-"), "skills");

    const env = {
      STUDIO_PACKAGED: "1",
      STUDIO_USER_DATA_PATH: userDataDir,
      STUDIO_DEFAULT_WORKSPACE: workspaceDir,
      STUDIO_SKILLS_PATH: skillsDir,
      STUDIO_BUNDLED_SKILLS_PATH: bundledSkillsDir,
    };

    assert.strictEqual(getUserDataDir(env), userDataDir);
    assert.strictEqual(getDbPath(env), path.join(userDataDir, "studio.db"));
    assert.strictEqual(getDefaultWorkspace(env), workspaceDir);
    assert.strictEqual(getSkillsDir(env), skillsDir);
    assert.deepStrictEqual(getSkillCandidatePaths("threads-viral-agent/SKILL.md", env), [
      path.join(skillsDir, "threads-viral-agent/SKILL.md"),
      path.join(bundledSkillsDir, "threads-viral-agent/SKILL.md"),
    ]);
  });

  it("honors STUDIO_USER_DATA_PATH without STUDIO_PACKAGED and creates the directory", () => {
    const base = makeTempDir("studio-unpackaged-data-");
    const userDataDir = path.join(base, "nested", "user-data");

    const env = { STUDIO_USER_DATA_PATH: userDataDir };

    assert.strictEqual(getUserDataDir(env), userDataDir);
    assert.strictEqual(getDbPath(env), path.join(userDataDir, "studio.db"));
    assert.equal(existsSync(userDataDir), true);
  });

  it("creates the DB directory for the default dev runtime", () => {
    const dbPath = getDbPath({});

    assert.equal(path.basename(dbPath), "studio.db");
    assert.equal(existsSync(path.dirname(dbPath)), true);
  });

  it("detects node_modules installs and picks an OS user-data dir", () => {
    assert.equal(
      isInsideNodeModules(
        path.join(path.sep, "usr", "lib", "node_modules", "@claude-world", "studio")
      ),
      true
    );
    assert.equal(
      isInsideNodeModules(path.join(path.sep, "home", "me", "claude-world-studio")),
      false
    );
    // The repo checkout itself must not be treated as a node_modules install
    assert.equal(isInsideNodeModules(), false);

    const osDir = getOsUserDataDir({});
    assert.equal(path.isAbsolute(osDir), true);
    assert.equal(path.basename(osDir), "Claude World Studio");
    if (process.platform === "darwin") {
      assert.equal(osDir.includes(path.join("Library", "Application Support")), true);
    }
  });

  it("rejects workspace paths that escape the workspace root", () => {
    const root = makeTempDir("studio-root-");

    assert.strictEqual(
      resolveWorkspaceFilePath(root, "downloads/card.png"),
      path.join(root, "downloads/card.png")
    );

    assert.throws(() => resolveWorkspaceFilePath(root, "../outside.txt"), {
      message: "Path escapes workspace boundary",
    });
  });

  it("validates workspace roots using realpath and directory checks", () => {
    const root = makeProjectTempDir(".studio-valid-workspace-");
    const tempRoot = makeTempDir("studio-temp-workspace-");
    const filePath = path.join(root, "file.txt");
    writeFileSync(filePath, "not a directory");

    assert.deepStrictEqual(validateWorkspacePath("relative/path"), {
      ok: false,
      error: "workspacePath must be an absolute path",
    });
    assert.deepStrictEqual(validateWorkspacePath(filePath), {
      ok: false,
      error: "workspacePath must be a directory",
    });

    const result = validateWorkspacePath(root);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.realPath, root);
    }

    assert.equal(validateWorkspacePath(tempRoot).ok, true);
  });

  it("rejects symlinks that resolve into blocked system roots", () => {
    const root = makeProjectTempDir(".studio-symlink-root-");
    const linkPath = path.join(root, "etc-link");
    symlinkSync("/etc", linkPath);

    assert.deepStrictEqual(validateWorkspacePath(linkPath), {
      ok: false,
      error: "workspacePath cannot be a system directory",
    });
  });
});
