import { defineConfig } from "@playwright/test";

// API-intercepted presentation/interaction checks only, no production writes.
export default defineConfig({
  testDir: "./e2e", testMatch: "admin-work-orders.spec.ts", fullyParallel: false, workers: 1,
  use: { baseURL: "http://127.0.0.1:4181", viewport: { width: 1440, height: 900 }, timezoneId: "Asia/Shanghai",
    launchOptions: { executablePath: process.env.PW_EXECUTABLE_PATH } },
  webServer: { command: "npx vite --host 127.0.0.1 --port 4181 --strictPort", url: "http://127.0.0.1:4181", reuseExistingServer: false },
});
