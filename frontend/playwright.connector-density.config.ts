import { defineConfig, devices } from "@playwright/test";

// Mock-browser UI acceptance only. Default release/native-auth config is unchanged.
const port = process.env.E2E_DENSITY_PORT || "4187";
export default defineConfig({
  testDir: "./e2e",
  testMatch: ["connector-config-density.spec.ts", "connector-tabs-density.spec.ts", "connector-browse-density.spec.ts"],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR || "test-results/connector-density",
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1280, height: 720 },
  },
  webServer: {
    command: `npm run dev -- --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
