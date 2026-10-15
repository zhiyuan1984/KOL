import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE || "http://127.0.0.1:4188";

/**
 * 治理审批页面只做浏览器网络 mock：不启动 stub DB/globalSetup，
 * 也不携带真实认证 storage state。CI 或父进程可预先提供纯 Vite 服务。
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: ["governance-approvals.spec.ts"],
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR || "test-results-governance",
  use: {
    baseURL,
    viewport: { width: 1440, height: 900 },
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 4188",
    url: baseURL,
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
