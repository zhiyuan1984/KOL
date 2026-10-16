import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { request, type FullConfig } from "@playwright/test";

/**
 * Internal E2E only: establish the same test account regardless of whether
 * the server is running with demo auth disabled or the real auth middleware.
 * The application still enforces all runtime gates; this only prevents every
 * browser case from stopping at the login page.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = String(config.projects[0]?.use?.baseURL || process.env.E2E_BASE || "http://127.0.0.1:8876");
  const username = process.env.E2E_TEST_USERNAME || "jeffrey";
  const password = process.env.E2E_TEST_PASSWORD || "123456789";
  const authFile = process.env.E2E_AUTH_STATE
    || path.join(process.env.PLAYWRIGHT_OUTPUT_DIR || os.tmpdir(), "lingong-e2e-auth", "user.json");
  await fs.mkdir(path.dirname(authFile), { recursive: true });

  const context = await request.newContext({ baseURL });
  try {
    let response = await context.post("/api/auth/login", {
      data: { username, email: username, password },
    });
    // An auth-enabled E2E server runs against an empty, isolated PostgreSQL
    // clone. Seed the native administrator only when its own status endpoint
    // explicitly says setup is required; the setup response creates the same
    // HttpOnly session that subsequent browser requests must present.
    if (!response.ok()) {
      const status = await context.get("/api/auth/status");
      const auth = status.ok() ? await status.json() as { setup_required?: boolean } : {};
      if (auth.setup_required) {
        response = await context.post("/api/auth/setup", {
          data: { username, email: username, password },
        });
      }
    }
    // Stub mode intentionally disables the native session endpoint. Only in
    // that mode may the legacy internal persona endpoint provide the fixture
    // identity; auth-enabled runs must keep the PostgreSQL session above.
    if (!response.ok() && process.env.E2E_AUTH_MODE !== "enabled") {
      response = await context.post("/api/login", {
        data: { username, password },
      });
    }
    if (!response.ok()) {
      throw new Error(`E2E test account login failed: ${response.status()} ${await response.text()}`);
    }
    await context.storageState({ path: authFile });
  } finally {
    await context.dispose();
  }
}
