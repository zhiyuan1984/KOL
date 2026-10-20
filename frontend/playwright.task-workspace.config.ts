import { defineConfig } from "@playwright/test";

// Isolated HTTP fixtures exercise the actual app/components, without a live
// identity provider, production actions, or a PostgreSQL surrogate.
export default defineConfig({
  testDir: "./e2e", testMatch: ["task-workspace-terminal.spec.ts"], workers: 1, retries: 0,
  timeout: 30000,
  use: { baseURL: "http://127.0.0.1:4186", viewport: { width: 1440, height: 900 },
    launchOptions: { executablePath: process.env.PW_EXECUTABLE_PATH, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] } },
  webServer: { command: "npm run dev -- --port 4186", url: "http://127.0.0.1:4186", timeout: 60000 },
});
