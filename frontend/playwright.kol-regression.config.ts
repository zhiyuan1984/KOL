import { defineConfig, devices } from "@playwright/test";
const port = Number(process.env.E2E_KOL_REGRESSION_PORT || 4192);
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: "./e2e",
  testMatch: ["discovery-results-density.spec.ts", "session-workspace-presentation.spec.ts", "home-task-presentation.spec.ts", "discovery-presentation.spec.ts", "kol-home-fixture-regression.spec.ts", "mail-evidence-presentation.spec.ts"],
  workers: 2,
  timeout: 45000,
  expect: { timeout: 10000 },
  use: { baseURL, ...devices["Desktop Chrome"] },
  webServer: { command: `npx vite --host 127.0.0.1 --port ${port} --strictPort`, url: baseURL, reuseExistingServer: false },
});
