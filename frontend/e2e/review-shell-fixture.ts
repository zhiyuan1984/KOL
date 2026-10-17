import type { Page } from "@playwright/test";

/** Explicit UI-only identity and shell fixture, never used by production code. */
export async function reviewShellFixture(page: Page) {
  const account = { id: "employee", username: "review-ui", name: "测试员工", roles: ["admin"], brands: [], available_modes: ["employee", "admin"] };
  await page.route("**/api/**", async route => {
    const p = new URL(route.request().url()).pathname;
    let json: unknown = [];
    if (p === "/api/auth/status") json = { authenticated: true, account };
    else if (p === "/api/me") json = account;
    else if (p === "/api/me/preferences") json = {};
    else if (p === "/api/health") json = { ok: true };
    else if (p === "/api/version") json = { version: "review-ui-test" };
    await route.fulfill({ json });
  });
}
