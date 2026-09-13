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
  },
});
