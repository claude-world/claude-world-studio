#!/usr/bin/env node
/**
 * Bundle the server into a single ESM file for the packaged desktop app.
 *
 * The packaged app used to spawn `tsx server/server.ts`, which forced
 * `asarUnpack: ["**"]` plus the entire production node_modules tree into the
 * release. Compiling the server ahead of time removes tsx (and esbuild, and
 * every dependency that only our own code imports) from the shipped app.
 *
 * Output layout matters: `server/runtime-paths.ts` derives the project root as
 * `<this module>/..`, so the bundle must stay exactly one directory below the
 * app root. See getProjectRoot() there.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const projectRoot = path.join(__dirname, "..");
const packageJson = require(path.join(projectRoot, "package.json"));
const outdir = path.join(projectRoot, "server-dist");
const outfile = path.join(outdir, "server.mjs");

/**
 * esbuild's `target` must match the Node that actually runs the bundle: the
 * packaged app spawns Electron in `ELECTRON_RUN_AS_NODE` mode, so it is
 * Electron's embedded Node, not the developer's. Verified by running the
 * packaged binary: Electron 44.9.2 reports process.versions.node 24.22.0.
 */
const ELECTRON_MAJOR_TO_NODE_TARGET = {
  44: "node24",
};

function resolveTarget() {
  const electronVersion = packageJson.build?.electronVersion;
  if (!electronVersion) {
    throw new Error("[build:server] package.json build.electronVersion is not set");
  }
  const major = Number.parseInt(electronVersion.split(".")[0], 10);
  const target = ELECTRON_MAJOR_TO_NODE_TARGET[major];
  if (!target) {
    throw new Error(
      `[build:server] No Node target known for Electron ${electronVersion}.\n` +
        `[build:server] Run \`ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron -p process.versions.node\`\n` +
        `[build:server] and add the mapping to ELECTRON_MAJOR_TO_NODE_TARGET in this file.`
    );
  }
  return target;
}

/**
 * Packages that must stay real directories in node_modules. Anything listed
 * here also has to survive the electron-builder `files` filter in package.json
 * — test/packaging.test.ts enforces that.
 */
const EXTERNAL = [
  // Native addon (build/Release/better_sqlite3.node, found via `bindings`).
  "better-sqlite3",
  // Locates its native CLI binary with createRequire(import.meta.url).resolve(),
  // so it only works from a real package directory, never from a bundle.
  "@anthropic-ai/claude-agent-sdk",
  // The SDK's tool() helper inspects schemas with its own zod instance; a
  // second, bundled copy would be a different realm and break tool registration.
  "zod",
];
// fsevents is deliberately absent: nothing in the server graph watches files,
// so leaving it bundleable makes esbuild fail loudly if that ever changes
// rather than shipping a .node the packaging config no longer includes.

/**
 * ESM output has no `require`, so esbuild's interop shim for bundled CommonJS
 * (`__require("stream")`, express's view-engine loader, ws's optional native
 * speedups) would throw "Dynamic require is not supported" the first time one
 * of those paths ran. Defining `require` before esbuild's prologue makes the
 * shim pick it up — see the `typeof require !== "undefined"` test it emits.
 */
const REQUIRE_BANNER = [
  'import { createRequire as __studioCreateRequire } from "node:module";',
  "const require = __studioCreateRequire(import.meta.url);",
].join("\n");

async function main() {
  // Required here, not at module scope: test/packaging.test.ts reads EXTERNAL
  // from this file and should not have to load esbuild to do it.
  const esbuild = require("esbuild");
  fs.rmSync(outdir, { recursive: true, force: true });

  const result = await esbuild.build({
    banner: { js: REQUIRE_BANNER },
    entryPoints: [path.join(projectRoot, "server", "server.ts")],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: resolveTarget(),
    external: EXTERNAL,
    // Keep names and line structure: the server reports stack traces through
    // /api/diagnostics/errors, and a minified bundle makes them unreadable.
    minify: false,
    sourcemap: false,
    legalComments: "none",
    logLevel: "info",
    metafile: true,
  });

  const bytes = fs.statSync(outfile).size;
  const moduleCount = Object.keys(result.metafile.inputs).length;
  console.log(
    `[build:server] ${path.relative(projectRoot, outfile)} — ` +
      `${(bytes / 1048576).toFixed(2)} MB from ${moduleCount} modules ` +
      `(target ${resolveTarget()}, external: ${EXTERNAL.join(", ")})`
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}

module.exports = { EXTERNAL, outfile, resolveTarget };
