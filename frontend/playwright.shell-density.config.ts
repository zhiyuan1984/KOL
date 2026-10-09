import { defineConfig, devices } from "@playwright/test";

// Isolated UI fixture regression: every /api/** request is intercepted by the
// two target specs, so Vite is the only local process this runner starts.
const port = 4203;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["session-workspace-presentation.spec.ts", "discovery-presentation.spec.ts"],
  fullyParallel: true,
  workers: 2,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: 0,
  outputDir: "test-results-shell-density",
  reporter: [["list"], ["html", { outputFolder: "playwright-report/shell-density", open: "never" }]],
  use: {
    baseURL,
    ...devices["Desktop Chrome"],
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
