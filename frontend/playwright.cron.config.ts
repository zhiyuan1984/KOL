import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

const port = 4188;
const baseURL = `http://127.0.0.1:${port}`;
const executablePath = process.env.PW_EXECUTABLE_PATH || (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);

// This suite starts only the React/Vite surface. Its tests route every /api/** call
// to in-memory fixtures, so it never reaches a database, scheduler, or production API.
export default defineConfig({
  testDir: "./e2e",
  testMatch: "cron-presentation.spec.ts",
  timeout: 30_000,
  retries: 0,
  workers: 1,
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR || "test-results/cron-presentation",
  use: {
    baseURL,
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    timezoneId: "America/Los_Angeles",
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `npx vite --host 0.0.0.0 --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { VITE_CACHE_DIR: "test-results/cron-presentation/vite-cache" },
  },
});
