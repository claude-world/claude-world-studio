import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildServerSpawnConfig } = require("../electron/server-runtime.cjs");

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("electron packaged runtime", () => {
  it("uses the packaged Electron executable in node mode and writes packaged env paths", () => {
    const projectDir = makeTempDir("studio-project-");
    const appDataDir = makeTempDir("studio-app-data-");
    const documentsDir = makeTempDir("studio-docs-");
    const resourcesPath = makeTempDir("studio-resources-");
    const packagedExecPath = path.join(resourcesPath, "Claude World Studio");

    const app = {
      isPackaged: true,
      getPath(name: string) {
        if (name === "appData") return appDataDir;
        if (name === "userData") return path.join(appDataDir, "@claude-world", "studio");
        if (name === "documents") return documentsDir;
        throw new Error(`Unexpected path request: ${name}`);
      },
    };

    const result = buildServerSpawnConfig({
      app,
      projectDir,
      port: 3001,
      host: "127.0.0.1",
      env: {},
      resourcesPath,
      execPath: packagedExecPath,
    });

    assert.strictEqual(result.spawnCmd, packagedExecPath);
    assert.deepStrictEqual(result.spawnArgs, [
      path.join(projectDir, "node_modules", "tsx", "dist", "cli.mjs"),
      "server/server.ts",
    ]);
    assert.strictEqual(result.spawnEnv.ELECTRON_RUN_AS_NODE, "1");
    assert.strictEqual(result.spawnEnv.STUDIO_NODE_PATH, packagedExecPath);
    assert.strictEqual(
      result.spawnEnv.STUDIO_USER_DATA_PATH,
      path.join(appDataDir, "Claude World Studio")
    );
    assert.strictEqual(
      result.spawnEnv.STUDIO_DEFAULT_WORKSPACE,
      path.join(documentsDir, "Claude World Studio")
    );
    assert.strictEqual(
      result.spawnEnv.STUDIO_SKILLS_PATH,
      path.join(appDataDir, "Claude World Studio", "skills")
    );
    assert.strictEqual(
      result.spawnEnv.STUDIO_BUNDLED_SKILLS_PATH,
      path.join(projectDir, ".claude", "skills")
    );
  });

  it("uses the local tsx entry in dev mode", () => {
    const projectDir = makeTempDir("studio-dev-project-");
    const app = {
      isPackaged: false,
      getPath() {
        throw new Error("getPath should not be called in dev mode");
      },
    };

    const result = buildServerSpawnConfig({
      app,
      projectDir,
      port: 3001,
      host: "127.0.0.1",
      env: {},
      resourcesPath: makeTempDir("studio-dev-resources-"),
    });

    assert.strictEqual(result.spawnCmd, path.join(projectDir, "node_modules", ".bin", "tsx"));
    assert.deepStrictEqual(result.spawnArgs, ["server/server.ts"]);
    assert.strictEqual(result.spawnEnv.STUDIO_PACKAGED, undefined);
  });
});
