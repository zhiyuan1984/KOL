import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

const port = 4248;
const baseURL = `http://127.0.0.1:${port}`;
const executablePath = process.env.PW_EXECUTABLE_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);

// API-intercepted presentation coverage only: no live company directory, connector,
// credential, PostgreSQL, or import action is used by this suite.
export default defineConfig({
  testDir: './e2e',
  testMatch: 'wecom-ontology.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  outputDir: 'test-results/wecom-ontology',
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/wecom-ontology', open: 'never' }]],
  use: {
    baseURL,
    ...devices['Desktop Chrome'],
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npx vite --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
