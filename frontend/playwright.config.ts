import { defineConfig, devices } from "@playwright/test";
import os from "node:os";
import path from "node:path";

const port = process.env.E2E_PORT || "8876";
const baseURL = process.env.E2E_BASE || `http://127.0.0.1:${port}`;
const channel = process.env.PW_CHANNEL;
const executablePath = process.env.PW_EXECUTABLE_PATH;
// Only the explicit native-auth partition command moves real-authority cases
// out of the legacy disabled-auth collection. Ordinary default E2E remains
// byte-for-byte the same coverage mode and still includes the original cases.
const nativeKnowledgePartition = process.env.E2E_NATIVE_AUTH_PARTITION === "1";

export default defineConfig({
  testDir: "./e2e",
  testIgnore: [
    "**/runtime-actions.spec.ts",
    "**/discovery-accessibility.spec.ts",
    // New native-authority controls are collected by runtime.config (not the
    // disabled-auth partition); all existing default cases remain unchanged.
    "**/fixtures/native-runtime-authority.test.mjs",
    ...(nativeKnowledgePartition ? [
      "**/knowledge-documents.spec.ts",
      "**/knowledge-usage.spec.ts",
      "**/knowledge-v2-home.spec.ts",
      "**/knowledge-question-template-flow.spec.ts",
      "**/product-knowledge.spec.ts",
    ] : []),
  ],
  // The two tagged normal-login cases need the isolated principal prepared by
  // playwright.native-knowledge.config.ts. Keep the anonymous 401 assertion
  // in this disabled-auth partition as its negative control.
  ...(nativeKnowledgePartition ? { grepInvert: /@native-knowledge-enabled-auth/ } : {}),
  fullyParallel: false,
  // Stub gate runs the full 72-case file on one worker. A single leftover
  // library-sync race should not fail the release gate; real mode stays strict.
  retries: process.env.E2E_MODE === "real" ? 0 : 1,
  // Real app-server + remote MCP flows can spend time on account/auth and
  // network retries. Keep the default deterministic suite fast, but give an
  // explicitly opted-in real staging run enough time to finish.
  timeout: process.env.E2E_MODE === "real" ? 120000 : 60000,
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR || "test-results",
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL,
    storageState: process.env.E2E_AUTH_STATE
      || path.join(process.env.PLAYWRIGHT_OUTPUT_DIR || os.tmpdir(), "lingong-e2e-auth", "user.json"),
    trace: "on-first-retry",
    viewport: { width: 1440, height: 900 },
    ...(channel ? { channel } : {}),
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
    ...(process.env.PW_HEADLESS === "0" ? { headless: false } : {}),
  },
  webServer: {
    command: `node ../scripts/e2e-server.mjs`,
    env: {
      LINGONG_PORT: port,
      E2E_MODE: process.env.E2E_MODE || "stub",
      E2E_AUTH_MODE: process.env.E2E_AUTH_MODE || (process.env.E2E_MODE === "real" ? "enabled" : "disabled"),
    },
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 180000,
    stdout: "pipe",
    stderr: "pipe",
  },
  // Cloud Linux Chromium is the acceptance browser. PW_CHANNEL / msedge is an
  // optional local override and is never selected automatically.
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
