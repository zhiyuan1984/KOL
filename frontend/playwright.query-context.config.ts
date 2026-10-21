import { defineConfig, devices } from "@playwright/test";

// UI-only HTTP fixtures; this suite does not access a production service.
export default defineConfig({
  testDir: "./e2e", testMatch: "creator-query-context.spec.ts",
  outputDir: "./test-results/query-context", workers: 1, retries: 0, timeout: 45000,
  use: { baseURL: "http://127.0.0.1:4188", viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure", screenshot: "only-on-failure",
    ...(process.env.PW_EXECUTABLE_PATH ? { launchOptions: { executablePath: process.env.PW_EXECUTABLE_PATH } } : {}),
  },
  webServer: { command: "node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4188 --strictPort --configLoader runner",
    url: "http://127.0.0.1:4188", reuseExistingServer: !process.env.CI, timeout: 60000 },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
