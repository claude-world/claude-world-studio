const { execSync } = require("child_process");
const path = require("path");

exports.default = async function (context) {
  const appDir = context.appOutDir
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, "Contents", "Resources", "app")
    : context.electronPlatformName
    ? context.appDir
    : process.cwd();

  // Run npm prune in the project dir to remove devDependencies before packaging
  console.log("[before-pack] Pruning devDependencies...");
  try {
    execSync("npm prune --production", {
      cwd: process.cwd(),
      stdio: "inherit",
    });
    // Show resulting size
    const size = execSync("du -sm node_modules", { encoding: "utf-8" }).trim();
    console.log(`[before-pack] node_modules after prune: ${size}`);
  } catch (e) {
    console.warn("[before-pack] prune warning:", e.message);
  }
};
