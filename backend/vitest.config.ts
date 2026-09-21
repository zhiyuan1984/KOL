import { defineConfig } from "vitest/config";

export default defineConfig({
  cacheDir: process.env.VITE_CACHE_DIR || ".vite-cache",
  test: {
    environment: "node",
    include: [
      "tests/**/*.test.ts",
      "tests/discovery-packs.test.ts",
      "../frontend/src/connectorUse.test.ts",
      "../frontend/src/home/homeModel.test.ts",
      "../frontend/src/home/surfaceError.test.ts",
      "../frontend/src/home/todayPlan.test.ts",
      "../frontend/src/home/discoveryTemplate.test.ts",
      "../frontend/src/mail/digestView.test.ts",
      "../frontend/src/mail/fallback.test.ts",
      "../frontend/src/mail/client.test.ts",
      "../frontend/src/mail/selection.test.ts",
      "../frontend/src/home/kolContract.test.ts",
      "../frontend/src/layout/sidebarNav.test.ts",
      "../frontend/src/composer/catalog.test.ts",
      "../frontend/src/composer/draft.test.ts",
      "../frontend/src/composer/recents.test.ts",
      "../frontend/src/home/discoveryBriefForm.test.ts",
      "../frontend/src/home/discoveryLeadFields.test.ts",
      "../frontend/src/home/discoveryLeadRow.test.ts",
    ],
    setupFiles: ["./tests/setup.ts"],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
