import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', testMatch: 'settings-redesign.spec.ts', fullyParallel: false, workers: 1, retries: 0,
  timeout: 60000, expect: { timeout: 20000 }, outputDir: 'test-results/settings',
  use: { baseURL: 'http://127.0.0.1:4189', viewport: { width: 1280, height: 900 }, trace: 'retain-on-failure', launchOptions: { args: ['--no-sandbox'] } },
  webServer: { command: 'npx vite --host 127.0.0.1 --port 4189 --strictPort --configLoader runner', url: 'http://127.0.0.1:4189', reuseExistingServer: false, timeout: 90000 },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
