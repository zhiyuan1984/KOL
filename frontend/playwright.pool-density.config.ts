import { defineConfig, devices } from "@playwright/test";

// Isolated real-Home UI fixture suite: Vite only, all /api/** calls are mocked
// inside the specs, so no application service or database can receive a write.
const port = Number(process.env.E2E_POOL_DENSITY_PORT || 4201);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["kol-home-fixture-regression.spec.ts", "pool-density-presentation.spec.ts"],
  timeout: 60_000,
  expect: { timeout: 12_000 },
  workers: 1,
  retries: 0,
  outputDir: process.env.POOL_DENSITY_TEST_OUTPUT || "test-results-pool-density",
  reporter: [["list"], ["html", { outputFolder: "playwright-report/pool-density", open: "never" }]],
  use: {
    baseURL,
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npx vite --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
