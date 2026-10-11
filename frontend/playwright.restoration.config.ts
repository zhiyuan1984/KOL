import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
const port = 4198;
const executablePath = process.env.PW_EXECUTABLE_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
export default defineConfig({
  testDir: './e2e',
  testMatch: ['cron-presentation.spec.ts', 'skills-restoration.spec.ts', 'admin-skills-restoration.spec.ts'],
  timeout: 60_000, expect: { timeout: 15_000 }, retries: 0, workers: 1,
  outputDir: 'test-results/restoration',
  use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${port}`, viewport: { width: 1440, height: 900 }, timezoneId: 'America/Los_Angeles', ...(executablePath ? { launchOptions: { executablePath } } : {}), trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'node e2e/restoration-static-server.mjs', url: `http://127.0.0.1:${port}`, reuseExistingServer: false, timeout: 30_000 },
});
