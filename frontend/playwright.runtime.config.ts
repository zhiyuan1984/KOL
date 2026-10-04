import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Runtime permissions require a real local login even when the model is a stub.
export default defineConfig({
  ...base,
  testMatch: ["**/runtime-actions.spec.ts", "**/discovery-accessibility.spec.ts"],
  testIgnore: [],
  webServer: {
    ...(base.webServer as Exclude<typeof base.webServer, unknown[] | undefined>),
    env: { ...(base.webServer as { env?: Record<string, string> }).env, E2E_AUTH_MODE: "enabled" },
  },
});
