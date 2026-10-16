import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
import { nativeRuntimeAuth } from "./e2e/fixtures/native-runtime-auth";

// Runtime permissions require a real local login even when the model is a stub.
// The global setup refuses absent/production database authority rather than
// falling back to a demo identity or an unprefixed database.
export default defineConfig({
  ...base,
  testMatch: ["**/runtime-actions.spec.ts", "**/discovery-accessibility.spec.ts", "**/fixtures/native-runtime-authority.test.mjs"],
  testIgnore: [],
  globalSetup: "./e2e/fixtures/native-runtime-auth.ts",
  use: {
    ...(base.use as Record<string, unknown>),
    storageState: nativeRuntimeAuth.storageState(),
  },
  webServer: {
    ...(base.webServer as Exclude<typeof base.webServer, unknown[] | undefined>),
    env: {
      ...(base.webServer as { env?: Record<string, string> }).env,
      NODE_ENV: "test",
      E2E_MODE: "stub",
      E2E_AUTH_MODE: "enabled",
      DATABASE_URL: process.env.DATABASE_URL || "",
      TEST_DB_PREFIX: process.env.TEST_DB_PREFIX || "",
    },
  },
});
