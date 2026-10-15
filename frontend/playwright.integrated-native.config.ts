import { defineConfig, devices } from '@playwright/test';

// Regression of preserved native-production surfaces. All selected specs install
// explicit HTTP fixtures; no production account or backend side effect is used.
export default defineConfig({
  testDir: './e2e',
  testMatch: ['governance-approvals.spec.ts', 'mail-gmail-v2.spec.ts'],
  outputDir: './test-results/integrated-native',
  workers: 1,
  retries: 0,
  timeout: 60_000,
  use: {
    baseURL: 'http://127.0.0.1:4188',
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: { executablePath: process.env.PW_EXECUTABLE_PATH || '/usr/bin/chromium' },
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4188',
    url: 'http://127.0.0.1:4188',
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
