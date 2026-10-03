/* Builds the Phase 1 demo as one self-contained HTML file (portal UI + builder + in-browser API). */
import { renameSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  plugins: [
    react(),
    viteSingleFile(),
    {
      name: "rename-demo-output",
      closeBundle() {
        renameSync(resolve(__dirname, "dist-demo/demo.html"), resolve(__dirname, "dist-demo/Presales_Portal_Phase1_Demo.html"));
      },
    },
  ],
  build: { outDir: "dist-demo", emptyOutDir: true, chunkSizeWarningLimit: 4000,
           rollupOptions: { input: resolve(__dirname, "demo.html") } },
});
