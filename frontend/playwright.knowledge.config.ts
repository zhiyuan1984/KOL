import { defineConfig, devices } from "@playwright/test";
// Isolated browser fixtures; does not certify production processing or approval.
export default defineConfig({
  testDir: "./e2e", testMatch: "admin-knowledge-presentation.spec.ts", fullyParallel: false,
  use: { baseURL: "http://127.0.0.1:4183", ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
  webServer: { command: "npm run dev -- --port 4183", url: "http://127.0.0.1:4183", reuseExistingServer: false },
});
