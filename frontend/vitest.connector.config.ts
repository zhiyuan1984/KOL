import { defineConfig } from "vitest/config";
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    setupFiles: ["src/test/knowledge-browser-env.ts"],
    include: [
      "src/admin/connector/*.test.ts",
      "src/admin/connector/*.test.tsx",
      "src/runtimeConnectorUi.test.ts",
      "src/connectorUse.test.ts",
    ],
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
