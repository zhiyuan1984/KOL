import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "jsdom",
    include: [
      "src/settings*.test.ts",
      "src/pages/AccountSettings.test.tsx",
      "src/components/StarryBindForm.test.tsx",
      "src/components/InformationLayout.test.tsx",
    ],
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
