import { defineConfig, devices } from "@playwright/test";

const port = process.env.E2E_PORT || "8876";
const baseURL = process.env.E2E_BASE || `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  timeout: 60000,
  use: {
    baseURL,
    trace: "on-first-retry",
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: `LINGONG_PORT=${port} bash ../scripts/e2e-server.sh`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 180000,
    stdout: "pipe",
    stderr: "pipe",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
