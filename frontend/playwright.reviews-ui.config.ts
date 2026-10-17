import { defineConfig, devices } from "@playwright/test";

process.env.GLOBAL_LAYOUT_TEST = "1";

// UI contracts use explicit API fixtures. Persistence and isolation are covered by backend tests.
export default defineConfig({
  testDir: "./e2e", testMatch: ["review-workflow.spec.ts", "review-redesign.spec.ts"], workers: 1,
  timeout: 45000, retries: 0,
  use: { baseURL: "http://127.0.0.1:4191", viewport: { width: 1440, height: 900 }, trace: "retain-on-failure" },
  webServer: {
    command: "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4191 --strictPort",
    url: "http://127.0.0.1:4191", reuseExistingServer: false, timeout: 60000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
