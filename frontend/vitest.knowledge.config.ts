import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    setupFiles: ["src/test/knowledge-browser-env.ts"],
    include: [
      "src/agents/*.test.ts",
      "src/admin/knowledge/*.test.ts",
      "src/admin/knowledge/*.test.tsx",
      "src/components/LifecycleNavigation*.test.tsx",
      "src/components/workspace/LifecycleNavigation*.test.tsx",
      "src/reviews/*.test.tsx",
      "src/layout/Approval*.test.tsx",
    ],
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
