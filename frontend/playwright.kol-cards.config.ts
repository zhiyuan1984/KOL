import { defineConfig, devices } from "@playwright/test";

// Rendering-only KOL card fixture: no backend, database, demo reset, or external API.
const port = 4186;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["kol-card-unify.spec.ts"],
  timeout: 90_000,
  workers: 1,
  retries: 0,
  outputDir: process.env.KOL_CARD_TEST_OUTPUT || "test-results/kol-cards",
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
