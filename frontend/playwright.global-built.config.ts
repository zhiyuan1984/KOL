import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', testMatch: ['settings-redesign.spec.ts','global-layout.spec.ts','task-operations-presentation.spec.ts','admin-employees.spec.ts','admin-agents.spec.ts','review-workflow.spec.ts'],
  fullyParallel: false, workers: 1, retries: 0, timeout: 90000, expect: { timeout: 15000 },
  outputDir: 'test-results/global-built',
  use: { baseURL: 'http://127.0.0.1:4196', viewport: { width: 1280, height: 900 }, trace: 'retain-on-failure', launchOptions: { args: ['--no-sandbox'] } },
  webServer: { command: 'npx vite preview --host 127.0.0.1 --port 4196 --strictPort --outDir dist.global-final --config vite.global-layout.config.ts --configLoader runner', url: 'http://127.0.0.1:4196', reuseExistingServer: false, timeout: 90000 },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
