import { defineConfig, devices } from "@playwright/test";
const port = Number(process.env.E2E_TASK_OPERATIONS_PORT || 4179);
const target = process.env.TASK_OPERATIONS_TEST_URL;
export default defineConfig({
  testDir: "./e2e", testMatch: ["task-operations-presentation.spec.ts", "task-detail-redesign.spec.ts"], fullyParallel: false, workers: 1,
  timeout: 60000, reporter: [["list"]],
  use: { baseURL: target || `http://127.0.0.1:${port}`, ...devices["Desktop Chrome"], trace: "retain-on-failure" },
  webServer: target ? undefined : { command: `npx vite --host 127.0.0.1 --port ${port} --strictPort`, url: `http://127.0.0.1:${port}`, reuseExistingServer: false },
});
