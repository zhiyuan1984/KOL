import { defineConfig } from "vitest/config";

export default defineConfig({
  cacheDir: process.env.VITE_CACHE_DIR || ".vite-cache",
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "../frontend/src/connectorUse.test.ts"],
    setupFiles: ["./tests/setup.ts"],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
