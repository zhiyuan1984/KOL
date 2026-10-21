import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "jsdom",
    setupFiles: ["src/test/knowledge-browser-env.ts"],
    include: ["src/admin/business-map/*.test.ts", "src/admin/business-map/*.test.tsx", "src/layout/sidebarNav.test.ts"],
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
