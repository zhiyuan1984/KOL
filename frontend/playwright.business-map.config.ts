import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.BUSINESS_MAP_E2E_PORT || 4289);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["business-map-browser.spec.ts"],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  outputDir: process.env.BUSINESS_MAP_E2E_OUTPUT_DIR || "test-results/business-map-browser",
  reporter: [["list"]],
  use: {
    baseURL,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    launchOptions: {
      executablePath: process.env.PW_EXECUTABLE_PATH,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    },
  },
  webServer: {
    command: `npx vite preview --host 127.0.0.1 --port ${port} --strictPort --config vite.business-map.config.ts --configLoader runner`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 90_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
