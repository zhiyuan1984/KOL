import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PRESENTATION_PORT || 4177);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid presentation test port");
const baseURL = `http://127.0.0.1:${port}`;

// Presentation regressions use intercepted API fixtures, without a database
// or external tool execution. They do not certify production integration.
export default defineConfig({
  testDir: "./e2e",
  testMatch: ["discovery-presentation.spec.ts", "knowledge-ingest-presentation.spec.ts", "session-workspace-presentation.spec.ts", "knowledge-browse-presentation.spec.ts"],
  fullyParallel: false,
  use: { baseURL, ...devices["Desktop Chrome"] },
  webServer: { command: `npx vite --host 127.0.0.1 --port ${port} --strictPort`, url: baseURL, reuseExistingServer: false },
});
