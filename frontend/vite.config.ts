import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const api = process.env.PORTAL_API_URL ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input: { portal: resolve(__dirname, "index.html"), builder: resolve(__dirname, "builder.html") },
    },
  },
  server: { proxy: { "/api": { target: api, changeOrigin: false } } },
  preview: { proxy: { "/api": { target: api, changeOrigin: false } } },
});
