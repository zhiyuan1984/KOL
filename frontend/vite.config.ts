import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  cacheDir: process.env.VITE_CACHE_DIR || ".vite-cache",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 4177,
    proxy: {
      "/api": "http://127.0.0.1:8765",
      "/mock": "http://127.0.0.1:8765",
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 4177,
  },
  build: {
    outDir: process.env.VITE_OUT_DIR || "dist",
    emptyOutDir: process.env.VITE_EMPTY_OUT_DIR !== "false",
    rollupOptions: {
      output: {
        // Framework and markdown renderer ride in their own long-lived chunks:
        // route chunks stay small and the slow uplink can cache the rest.
        manualChunks: {
          vendor: ["react", "react-dom", "react-router-dom"],
          markdown: ["react-markdown", "remark-gfm"],
        },
      },
    },
  },
});
