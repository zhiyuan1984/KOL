import { defineConfig, devices } from "@playwright/test";
const port = Number(process.env.DISCOVERY_TEST_PORT || 4177);
const baseURL = `http://127.0.0.1:${port}`;

// Presentation regressions use intercepted API fixtures, without a database
// or external tool execution. They do not certify production integration.
export default defineConfig({
  testDir: "./e2e",
  testMatch: "discovery-presentation.spec.ts",
  fullyParallel: false,
  use: { baseURL, ...devices["Desktop Chrome"] },
  webServer: { command: `npm run dev -- --port ${port}`, url: baseURL, reuseExistingServer: false },
});
