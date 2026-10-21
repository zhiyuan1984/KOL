import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";
import path from "node:path";

// 构建号：角落角标用它核对「线上跑的是哪一版」。没有 .git 的环境回落到环境变量。
const buildCommit = (() => {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return process.env.VITE_BUILD_COMMIT || "dev";
  }
})();

export default defineConfig({
  define: {
    __BUILD_COMMIT__: JSON.stringify(buildCommit),
  },
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
      ...(process.env.VITE_E2E_FIXTURES === "1" ? {
        input: {
          app: path.resolve("index.html"),
          kolCardFixture: path.resolve("e2e/kol-card-fixture.html"),
        },
      } : {}),
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
