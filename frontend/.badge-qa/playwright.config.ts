import { defineConfig } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const evidence = process.env.APPROVAL_BADGE_EVIDENCE_DIR || path.join(here, "artifacts");
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (fs.existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
export default defineConfig({
  testDir: ".", testMatch: "badge.spec.ts", workers: 1, retries: 0,
  timeout: 60000, expect: { timeout: 15000 },
  outputDir: path.join(evidence, "playwright-results"),
  reporter: [["list"], ["json", { outputFile: path.join(evidence, "browser-report.json") }]],
  use: { baseURL: "http://127.0.0.1:4195", launchOptions: { executablePath, args: ["--no-sandbox"] }, trace: "retain-on-failure" },
  webServer: { cwd: path.resolve(here, ".."), command: "VITE_CACHE_DIR=.vite-badge-cache npx vite --host 127.0.0.1 --port 4195 --strictPort --configLoader runner", url: "http://127.0.0.1:4195", reuseExistingServer: false, timeout: 60000 },
});
