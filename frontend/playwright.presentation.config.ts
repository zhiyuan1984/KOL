import { defineConfig, devices } from "@playwright/test";

// Presentation regressions use intercepted API fixtures, without a database
// or external tool execution. They do not certify production integration.
export default defineConfig({
  testDir: "./e2e",
  testMatch: "discovery-presentation.spec.ts",
  fullyParallel: false,
  use: { baseURL: "http://127.0.0.1:4177", ...devices["Desktop Chrome"] },
  webServer: { command: "npm run dev", url: "http://127.0.0.1:4177", reuseExistingServer: false },
});
