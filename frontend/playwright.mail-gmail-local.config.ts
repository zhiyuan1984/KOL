import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
const baseURL = process.env.MAIL_LOCAL_BASE || 'http://127.0.0.1:8894';
const executablePath = process.env.PW_EXECUTABLE_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
export default defineConfig({
  testDir: './e2e', testMatch: 'mail-gmail-v2.spec.ts', timeout: 25_000, retries: 0, workers: 1,
  use: { baseURL, ...(executablePath ? { launchOptions: { executablePath } } : {}), viewport: { width: 1440, height: 900 } },
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR || 'test-results/mail-gmail-local', reporter: 'list',
  webServer: { command: 'node e2e/mail-static-server.mjs', url: baseURL, reuseExistingServer: false, timeout: 30_000 },
});
