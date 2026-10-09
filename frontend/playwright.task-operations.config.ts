import { defineConfig, devices } from "@playwright/test";
const port = Number(process.env.E2E_TASK_OPERATIONS_PORT || 4179);
export default defineConfig({
  testDir: "./e2e", testMatch: ["task-operations-presentation.spec.ts", "task-detail-redesign.spec.ts"], fullyParallel: false, workers: 1,
  timeout: 60000, reporter: [["list"]],
  use: { baseURL: `http://127.0.0.1:${port}`, ...devices["Desktop Chrome"], trace: "retain-on-failure" },
  webServer: { command: `npx vite --host 127.0.0.1 --port ${port} --strictPort`, url: `http://127.0.0.1:${port}`, reuseExistingServer: false },
});
