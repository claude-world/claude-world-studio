/**
 * Guards the desktop packaging contract.
 *
 * The packaged app ships a single esbuild bundle (`server-dist/server.mjs`)
 * instead of the TypeScript sources plus tsx, so `build.files` in package.json
 * excludes every production dependency that only our own code imported. That
 * list is only correct as long as it never touches a package the *runtime*
 * still resolves from disk: better-sqlite3's native addon, the Claude Agent
 * SDK (which locates its CLI binary by package path), their dependency
 * closures, and electron-updater for the main process.
 *
 * These tests recompute that closure from the installed tree and fail if an
 * exclusion starts covering something the app needs, or if a newly added
 * dependency is shipped without being either needed or excluded.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf-8"));
const { EXTERNAL } = require("../scripts/build-server.cjs") as { EXTERNAL: string[] };

/**
 * Packages the packaged app resolves from node_modules at runtime. Everything
 * else is either bundled into server-dist/server.mjs or build-time only.
 */
const RUNTIME_ROOTS = [
  ...EXTERNAL,
  // Required by electron/main.cjs, which Electron loads from the asar.
  "electron-updater",
  // The Agent SDK imports "@modelcontextprotocol/sdk/server/mcp.js" at runtime
  // but declares it as a peer, so the dependency walk below cannot find it.
  "@modelcontextprotocol/sdk",
];

/**
 * The Agent SDK's other peer, "@anthropic-ai/sdk" (19 MB), is deliberately not
 * shipped: it appears only in sdk.d.ts, never in the SDK's runtime JavaScript.
 * The test below re-checks that on every SDK upgrade.
 */
const TYPES_ONLY_PEER = "@anthropic-ai/sdk";

interface PackageJsonLike {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

function resolvePackageDir(name: string, fromDir: string): string | null {
  let dir = fromDir;
  for (;;) {
    const candidate = path.join(dir, "node_modules", name);
    if (existsSync(path.join(candidate, "package.json"))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Package names reachable from `roots` through dependencies + optionalDependencies. */
function closureOf(roots: string[]): Set<string> {
  const seen = new Set<string>();

  function walk(name: string, fromDir: string) {
    const dir = resolvePackageDir(name, fromDir);
    // Platform-specific optional packages (fsevents, the Agent SDK's per-OS
    // binaries) are simply absent on other platforms — not an error.
    if (!dir || seen.has(name)) return;
    seen.add(name);

    const pkg: PackageJsonLike = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf-8"));
    for (const dep of [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.optionalDependencies ?? {}),
    ]) {
      walk(dep, dir);
    }
  }

  for (const root of roots) walk(root, projectRoot);
  return seen;
}

/** Every installed package reachable from the production dependencies. */
function installedProductionPackages(): Set<string> {
  return closureOf(Object.keys(packageJson.dependencies ?? {}));
}

/** The `!node_modules/<pkg>/…` entries of build.files, as package-name prefixes. */
function excludedPackagePatterns(): string[] {
  return (packageJson.build.files as string[])
    .filter((pattern) => pattern.startsWith("!node_modules/"))
    .map((pattern) => pattern.slice("!node_modules/".length));
}

/** Does `pattern` (e.g. "@babel/**\/*" or "tsx/**\/*") cover this package? */
function patternCoversPackage(pattern: string, packageName: string): boolean {
  const prefix = pattern.split("/**")[0];
  return prefix === packageName || packageName.startsWith(prefix + "/");
}

describe("desktop packaging", () => {
  it("runs the esbuild bundle, not the TypeScript sources", () => {
    const files = packageJson.build.files as string[];
    assert.ok(files.includes("server-dist/**/*"), "build.files must ship the bundled server");
    assert.ok(
      !files.some((pattern) => pattern === "server/**/*"),
      "build.files must not ship the TypeScript server sources"
    );
    assert.strictEqual(packageJson.scripts["build:server"], "node scripts/build-server.cjs");
    assert.ok(
      packageJson.scripts["electron:build"].includes("npm run build:server"),
      "electron:build must bundle the server before packaging"
    );
  });

  it("never excludes a package the packaged runtime resolves from disk", () => {
    const required = closureOf(RUNTIME_ROOTS);
    const patterns = excludedPackagePatterns();

    assert.ok(required.has("better-sqlite3"));
    assert.ok(required.has("@anthropic-ai/claude-agent-sdk"));
    assert.ok(required.has("zod"));

    for (const name of required) {
      const hit = patterns.find((pattern) => patternCoversPackage(pattern, name));
      assert.strictEqual(
        hit,
        undefined,
        `build.files excludes "${hit}", which drops "${name}" — the packaged app needs it at runtime`
      );
    }
  });

  it("excludes every production package nothing resolves at runtime", () => {
    const required = closureOf(RUNTIME_ROOTS);
    const patterns = excludedPackagePatterns();
    const unneededAndShipped: string[] = [];

    for (const name of installedProductionPackages()) {
      if (required.has(name)) continue;
      if (patterns.some((pattern) => patternCoversPackage(pattern, name))) continue;
      unneededAndShipped.push(name);
    }

    assert.deepStrictEqual(
      unneededAndShipped.sort(),
      [],
      "these production packages are bundled into server-dist/server.mjs but still shipped — " +
        'add "!node_modules/<name>/**/*" to build.files'
    );
  });

  it("drops @anthropic-ai/sdk only while the Agent SDK keeps it type-only", () => {
    const sdkDir = resolvePackageDir("@anthropic-ai/claude-agent-sdk", projectRoot);
    if (!sdkDir) throw new Error("@anthropic-ai/claude-agent-sdk must be installed");

    const runtimeFiles = readdirSync(sdkDir).filter(
      (name) => name.endsWith(".mjs") || (name.endsWith(".js") && !name.endsWith(".d.js"))
    );
    assert.ok(runtimeFiles.length > 0, "expected runtime JavaScript in the Agent SDK");

    for (const name of runtimeFiles) {
      const source: string = readFileSync(path.join(sdkDir, name), "utf-8");
      assert.ok(
        !source.includes(`"${TYPES_ONLY_PEER}"`) && !source.includes(`'${TYPES_ONLY_PEER}'`),
        `${name} now references ${TYPES_ONLY_PEER} at runtime — stop excluding it in build.files`
      );
    }
  });

  it("keeps better-sqlite3's native addon while dropping its build intermediates", () => {
    const patterns = packageJson.build.files as string[];
    const addon = "node_modules/better-sqlite3/build/Release/better_sqlite3.node";

    const dropsAddon = patterns
      .filter((pattern) => pattern.startsWith("!"))
      .map((pattern) => pattern.slice(1).split("/**")[0])
      .find((prefix) => addon === prefix || addon.startsWith(prefix + "/"));
    assert.strictEqual(dropsAddon, undefined, `"${dropsAddon}" would drop the native addon`);
    for (const heavy of [
      "!node_modules/better-sqlite3/deps/**/*",
      "!node_modules/better-sqlite3/build/Release/obj/**/*",
      "!node_modules/better-sqlite3/build/Release/obj.target/**/*",
    ]) {
      assert.ok(patterns.includes(heavy), `build.files should drop ${heavy}`);
    }
  });

  it("unpacks everything the server subprocess reads from disk", () => {
    // electron/main.cjs points the server at app.asar.unpacked, so anything it
    // opens by real path has to be unpacked rather than left inside the asar.
    const unpack = packageJson.build.asarUnpack as string[];
    for (const required of [
      "server-dist/**",
      "dist/**",
      ".claude/skills/**",
      "node_modules/**",
      "package.json",
    ]) {
      assert.ok(unpack.includes(required), `asarUnpack must include ${required}`);
    }
    assert.ok(!unpack.includes("**"), "asarUnpack should no longer unpack the whole app");
  });

  it("bundles the server one directory below the project root", () => {
    // server/runtime-paths.ts derives the project root as `<module dir>/..`.
    const { outfile } = require("../scripts/build-server.cjs") as { outfile: string };
    assert.strictEqual(path.dirname(path.dirname(outfile)), projectRoot);
  });

  it(
    "produces a bundle that imports only the declared externals",
    {
      skip: !existsSync(path.join(projectRoot, "server-dist", "server.mjs"))
        ? "run `npm run build:server` first"
        : false,
    },
    () => {
      const bundle = readFileSync(path.join(projectRoot, "server-dist", "server.mjs"), "utf-8");
      const imported = new Set(
        [...bundle.matchAll(/(?:^|\s)from\s*"([^".][^"]*)"/g)]
          .map((match) => match[1])
          .filter((specifier) => !specifier.startsWith("node:"))
          // Bare builtins (fs, path, http, …) resolve without node_modules.
          .filter((specifier) => !require("node:module").builtinModules.includes(specifier))
      );

      for (const specifier of imported) {
        const pkg = specifier.startsWith("@")
          ? specifier.split("/").slice(0, 2).join("/")
          : specifier.split("/")[0];
        assert.ok(
          EXTERNAL.includes(pkg),
          `bundle imports "${specifier}" but ${pkg} is not in scripts/build-server.cjs EXTERNAL`
        );
      }
    }
  );

  it("keeps the npm package shipping the TypeScript server", () => {
    // The npm distribution still runs `tsx server/server.ts` from bin/cli.js —
    // only the desktop build switched to the bundle.
    const npmFiles = packageJson.files as string[];
    assert.ok(npmFiles.includes("server/"), "npm package must keep the server sources");
    assert.ok(
      Object.keys(packageJson.dependencies).includes("tsx"),
      "npm package needs tsx at runtime"
    );
  });
});

describe("packaged bundle hygiene", () => {
  it(
    "has no stray files in server-dist",
    {
      skip: !existsSync(path.join(projectRoot, "server-dist"))
        ? "run `npm run build:server` first"
        : false,
    },
    () => {
      const dir = path.join(projectRoot, "server-dist");
      const entries = readdirSync(dir);
      assert.deepStrictEqual(entries.sort(), ["server.mjs"]);
      assert.ok(statSync(path.join(dir, "server.mjs")).size > 100_000);
    }
  );
});
