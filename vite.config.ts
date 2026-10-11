import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const apiPort = Number(process.env.PORT ?? 5178);

/**
 * The client imports shared types and helpers from server/, which lies outside
 * Vite's root and so is not watched; without this, edits there are served stale.
 */
function watchShared(): Plugin {
  return {
    name: "watch-shared-server-code",
    configureServer(server) {
      server.watcher.add([resolve("server/types.ts"), resolve("server/lib/format.ts")]);
    },
  };
}

export default defineConfig({
  root: "client",
  plugins: [react(), watchShared()],
  build: { outDir: "../dist/client", emptyOutDir: true },
  server: {
    port: 5179,
    // Fail loudly instead of silently moving to 5180 when an old dev server is still running.
    strictPort: true,
    proxy: {
      "/api": `http://127.0.0.1:${apiPort}`,
      "/files": `http://127.0.0.1:${apiPort}`,
    },
  },
});
