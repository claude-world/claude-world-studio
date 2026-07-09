import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  // Match the API server port (server/server.ts reads the same PORT). Load it
  // from the shell env AND .env files (empty prefix) so the dev proxy honors a
  // PORT set the same way the documented `.env` config sets it for the server.
  const env = loadEnv(mode, process.cwd(), "");
  const serverPort = env.PORT || process.env.PORT || "3001";

  return {
    plugins: [react(), tailwindcss()],
    root: "client",
    server: {
      proxy: {
        "/api": `http://localhost:${serverPort}`,
        "/ws": {
          target: `ws://localhost:${serverPort}`,
          ws: true,
        },
      },
    },
    build: {
      outDir: "../dist",
      // outDir is outside root, so Vite won't clean it unless told to —
      // without this, stale hashed bundles accumulate and get shipped.
      // Safe for electron:build: vite build runs before electron-builder.
      emptyOutDir: true,
    },
  };
});
