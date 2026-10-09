import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "jsdom",
    include: ["src/components/ComposerDock.clear.test.tsx"],
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
