import { defineConfig, devices } from '@playwright/test';

// Isolated rendering fixtures: no backend, database or external tool execution.
const port = 4199;
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: './e2e',
  testMatch: ['ui-unify-smoke.spec.ts'],
  timeout: 90000,
  workers: 1,
  use: { baseURL, ...devices['Desktop Chrome'] },
  webServer: {
    command: `npx vite --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
  },
});
