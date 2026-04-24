const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}

function getMergedShellPath() {
  try {
    return execSync("/bin/zsh -lc 'echo $PATH'", {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
  } catch {
    return process.env.PATH || "/usr/local/bin:/usr/bin:/bin";
  }
}

function getSystemNodePath() {
  try {
    return execSync("/bin/zsh -lc 'which node'", {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
  } catch {
    return "";
  }
}

function getPackagedWorkspaceDir(app, env = process.env) {
  if (env.STUDIO_DEFAULT_WORKSPACE) {
    return ensureDir(env.STUDIO_DEFAULT_WORKSPACE);
  }

  let baseDir = "";
  try {
    baseDir = app.getPath("documents");
  } catch {
    baseDir = "";
  }
  if (!baseDir) {
    baseDir = app.getPath("userData");
  }

  return ensureDir(path.join(baseDir, "Claude World Studio"));
}

function getPackagedUserDataDir(app, env = process.env) {
  if (env.STUDIO_USER_DATA_PATH) {
    return ensureDir(env.STUDIO_USER_DATA_PATH);
  }

  let baseDir = "";
  try {
    baseDir = app.getPath("appData");
  } catch {
    baseDir = "";
  }
  if (!baseDir) {
    baseDir = app.getPath("userData");
  }

  return ensureDir(path.join(baseDir, "Claude World Studio"));
}

function getPackagedRuntimePaths(
  app,
  projectDir,
  env = process.env,
  resourcesPath = process.resourcesPath
) {
  const userDataDir = getPackagedUserDataDir(app, env);
  const skillsDir = ensureDir(env.STUDIO_SKILLS_PATH || path.join(userDataDir, "skills"));
  const workspaceDir = getPackagedWorkspaceDir(app, env);
  const bundledSkillsDir = path.join(projectDir, ".claude", "skills");
  const bundledNodePath = path.join(resourcesPath, "runtime", "node");

  return {
    userDataDir,
    skillsDir,
    workspaceDir,
    bundledSkillsDir,
    bundledNodePath,
  };
}

function buildServerSpawnConfig({
  app,
  projectDir,
  port,
  host,
  env = process.env,
  resourcesPath = process.resourcesPath,
  execPath = process.execPath,
}) {
  const mergedPath = getMergedShellPath() || process.env.PATH || "/usr/local/bin:/usr/bin:/bin";

  if (!app.isPackaged) {
    return {
      spawnCmd: path.join(projectDir, "node_modules", ".bin", "tsx"),
      spawnArgs: ["server/server.ts"],
      spawnEnv: {
        ...env,
        PORT: String(port),
        HOST: host,
        PATH: mergedPath,
      },
      mergedPath,
      runtimeNodePath: getSystemNodePath() || process.execPath,
    };
  }

  const runtimePaths = getPackagedRuntimePaths(app, projectDir, env, resourcesPath);
  const runtimeNodePath = execPath;
  const tsxCli = path.join(projectDir, "node_modules", "tsx", "dist", "cli.mjs");

  return {
    spawnCmd: runtimeNodePath,
    spawnArgs: [tsxCli, "server/server.ts"],
    spawnEnv: {
      ...env,
      ELECTRON_RUN_AS_NODE: "1",
      PORT: String(port),
      HOST: host,
      PATH: mergedPath,
      STUDIO_PACKAGED: "1",
      STUDIO_USER_DATA_PATH: runtimePaths.userDataDir,
      STUDIO_DEFAULT_WORKSPACE: runtimePaths.workspaceDir,
      STUDIO_SKILLS_PATH: runtimePaths.skillsDir,
      STUDIO_BUNDLED_SKILLS_PATH: runtimePaths.bundledSkillsDir,
      STUDIO_NODE_PATH: runtimeNodePath,
    },
    mergedPath,
    runtimeNodePath,
  };
}

module.exports = {
  buildServerSpawnConfig,
  ensureDir,
  getMergedShellPath,
  getPackagedRuntimePaths,
  getPackagedUserDataDir,
  getPackagedWorkspaceDir,
  getSystemNodePath,
};
