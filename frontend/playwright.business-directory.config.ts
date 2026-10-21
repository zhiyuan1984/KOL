import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: "./e2e", testMatch: ["knowledge-business-directory.spec.ts"], workers: 1, retries: 0, timeout: 30000,
  use: { baseURL: "http://127.0.0.1:4191", viewport: { width: 1440, height: 900 }, trace: "retain-on-failure", launchOptions: { executablePath: process.env.PW_EXECUTABLE_PATH || "/usr/bin/chromium" } },
  webServer: { command: "npm run dev -- --port 4191", url: "http://127.0.0.1:4191", reuseExistingServer: false, timeout: 60000 } });
