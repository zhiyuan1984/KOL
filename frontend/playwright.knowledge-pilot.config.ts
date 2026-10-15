import { defineConfig, devices } from '@playwright/test';

// Explicit HTTP contract fixtures, no auth bypass or production server calls.
export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results/knowledge-pilot-runs',
  testMatch: ['knowledge-processing-pilot.spec.ts', ...(process.env.KNOWLEDGE_PILOT_REAL_PDF ? ['knowledge-original-reader.spec.ts'] : [])],
  workers: 1, retries: 0, timeout: 45000,
  use: {
    baseURL: 'http://127.0.0.1:4181', viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure', screenshot: 'only-on-failure',
    ...(process.env.PW_EXECUTABLE_PATH ? { launchOptions: { executablePath: process.env.PW_EXECUTABLE_PATH } } : {}),
  },
  webServer: { command: 'npm run dev -- --port 4181', url: 'http://127.0.0.1:4181', reuseExistingServer: false, timeout: 60000 },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
