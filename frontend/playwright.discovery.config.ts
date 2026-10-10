import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Browser presentation fixtures exercise the real UI without a database/server.
export default defineConfig({ ...base, globalSetup: undefined,
  testMatch: ["**/discovery-results-density.spec.ts", "**/discovery-empty-analysis.spec.ts"],
  retries: 0, workers: 1, use: { ...base.use, storageState: undefined, baseURL: "http://127.0.0.1:4177" },
  webServer: { command: "npm run preview", url: "http://127.0.0.1:4177", reuseExistingServer: false, timeout: 60000 },
});
