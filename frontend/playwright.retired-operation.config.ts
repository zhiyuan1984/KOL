import { defineConfig } from '@playwright/test';
export default defineConfig({
 testDir: './e2e', testMatch: 'retired-operation-page.spec.ts', workers: 1, retries: 0, timeout: 30000,
 use: { baseURL: 'http://127.0.0.1:4196', viewport: { width: 1440, height: 900 }, ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}), headless: true },
 webServer: { command: 'npm run preview -- --port 4196', url: 'http://127.0.0.1:4196', reuseExistingServer: false, timeout: 60000 },
});