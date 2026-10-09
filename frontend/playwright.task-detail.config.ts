import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
const executablePath = process.env.PW_EXECUTABLE_PATH || (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
const baseURL = process.env.TASK_DETAIL_TEST_URL || "http://127.0.0.1:4177";
export default defineConfig({
  testDir: "./e2e",
  testMatch: "task-detail-redesign.spec.ts",
  timeout: 30_000,
  retries: 0,
  workers: 1,
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR || "test-results/task-detail",
  use: {
    baseURL,
    viewport: { width: 1440, height: 900 },
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
    trace: "retain-on-failure",
  },
  webServer: process.env.TASK_DETAIL_TEST_URL ? undefined : {
    command: "npx vite --host 127.0.0.1 --port 4177 --strictPort",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
});
