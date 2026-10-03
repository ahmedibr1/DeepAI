/* Builds the standalone, offline DeepDive Builder as one self-contained HTML file (same code as the portal module). */
import { renameSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  plugins: [
    viteSingleFile(),
    {
      name: "rename-offline-output",
      closeBundle() {
        renameSync(resolve(__dirname, "dist-offline/offline.html"), resolve(__dirname, "dist-offline/DeepDive_Builder.html"));
      },
    },
  ],
  build: {
    outDir: "dist-offline",
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
    rollupOptions: { input: resolve(__dirname, "offline.html") },
  },
});
