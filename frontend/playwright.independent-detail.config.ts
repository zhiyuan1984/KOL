import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
const port = Number(process.env.INDEPENDENT_DETAIL_PORT || 4187);
const external = process.env.INDEPENDENT_DETAIL_TEST_URL;
const executablePath = process.env.PW_EXECUTABLE_PATH || (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
export default defineConfig({
  testDir: "./e2e", testMatch: ["independent-task-detail.spec.ts", "task-detail-redesign.spec.ts"],
  timeout: 30_000, retries: 0, workers: 1,
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR || "test-results/independent-detail",
  use: { baseURL: external || `http://127.0.0.1:${port}`, viewport: { width: 1280, height: 800 },
    ...(executablePath ? { launchOptions: { executablePath } } : {}), trace: "retain-on-failure" },
  ...(!external ? { webServer: { command: `npm run dev -- --host 0.0.0.0 --port ${port}`, url: `http://127.0.0.1:${port}/tasks`, reuseExistingServer: !process.env.CI, timeout: 30_000 } } : {}),
});
