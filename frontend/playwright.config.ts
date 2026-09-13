import { defineConfig, devices } from "@playwright/test";
import os from "node:os";
import path from "node:path";

const port = process.env.E2E_PORT || "8876";
const baseURL = process.env.E2E_BASE || `http://127.0.0.1:${port}`;
const channel = process.env.PW_CHANNEL;
const executablePath = process.env.PW_EXECUTABLE_PATH;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  timeout: 60000,
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR || "test-results",
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL,
    storageState: process.env.E2E_AUTH_STATE
      || path.join(process.env.PLAYWRIGHT_OUTPUT_DIR || os.tmpdir(), "lingong-e2e-auth", "user.json"),
    trace: "on-first-retry",
    viewport: { width: 1440, height: 900 },
    ...(channel ? { channel } : {}),
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
    ...(process.env.PW_HEADLESS === "0" ? { headless: false } : {}),
  },
  webServer: {
    command: `node ../scripts/e2e-server.mjs`,
    env: {
      LINGONG_PORT: port,
      E2E_MODE: process.env.E2E_MODE || "stub",
      E2E_AUTH_MODE: process.env.E2E_AUTH_MODE || (process.env.E2E_MODE === "real" ? "enabled" : "disabled"),
    },
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 180000,
    stdout: "pipe",
    stderr: "pipe",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
