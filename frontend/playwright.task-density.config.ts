import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  testMatch: ['home-task-presentation.spec.ts'],
  outputDir: 'test-results-task-density',
  workers: 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  use: { baseURL: 'http://127.0.0.1:4202', ...devices['Desktop Chrome'] },
  webServer: { command: 'npx vite --host 127.0.0.1 --port 4202 --strictPort', url: 'http://127.0.0.1:4202', reuseExistingServer: false },
});
