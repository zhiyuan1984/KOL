import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The tests execute durable jobs in their own process. Match the server's
// explicitly isolated stub engine; production still verifies real index files.
if (process.env.NODE_ENV === "test" && process.env.E2E_MODE === "stub") {
  process.env.KNOWLEDGE_ENGINE_MODE = "stub";
  process.env.KNOWLEDGE_NORMALIZE_MODE = "stub";
}

const frontend = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(frontend, "..");
const port = process.env.E2E_PORT || "8949";
const baseURL = process.env.E2E_BASE || `http://127.0.0.1:${port}`;
const outputDir = process.env.PLAYWRIGHT_OUTPUT_DIR
  || path.join(frontend, "test-results-native-knowledge");
const storageState = process.env.E2E_AUTH_STATE
  || path.join(outputDir, "native-knowledge-auth", "sriphy.json");
process.env.E2E_AUTH_STATE = storageState;
process.env.E2E_REVIEWER_AUTH_STATE ||= path.join(outputDir, "native-knowledge-auth", "reviewer.json");
process.env.CODEX_BIN ||= path.join(root, "backend", "tests", "support", "source-evidence-codex-fixture.mjs");

/**
 * Opt-in native authority acceptance. It never changes the default stub suite:
 * callers must provide the isolated test database and explicit enabled auth.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: [
    "knowledge-documents.spec.ts",
    "knowledge-usage.spec.ts",
    "knowledge-v2-home.spec.ts",
    "knowledge-question-template-flow.spec.ts",
    "product-knowledge.spec.ts",
    "native-knowledge-auth.spec.ts",
  ],
  outputDir,
  globalSetup: "./e2e/fixtures/native-knowledge-auth.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  use: {
    baseURL,
    storageState,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1440, height: 900 },
    ...(process.env.PW_EXECUTABLE_PATH ? { launchOptions: { executablePath: process.env.PW_EXECUTABLE_PATH } } : {}),
    ...(process.env.PW_HEADLESS === "0" ? { headless: false } : {}),
  },
  webServer: {
    command: "node ../scripts/e2e-server.mjs",
    env: {
      ...process.env,
      NODE_ENV: "test",
      E2E_MODE: "stub",
      E2E_AUTH_MODE: "enabled",
      LINGONG_PORT: port,
      LINGONG_DATA: process.env.LINGONG_DATA || path.join(outputDir, "data"),
      LINGONG_FRONTEND_DIST: process.env.LINGONG_FRONTEND_DIST || path.join(outputDir, "frontend-dist"),
      E2E_SKIP_BUILD: process.env.E2E_SKIP_BUILD || "0",
      VITE_E2E_FIXTURES: "1",
    },
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
