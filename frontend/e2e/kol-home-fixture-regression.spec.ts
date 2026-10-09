import { expect, test, type Page } from "@playwright/test";

const avatar = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="#456"/></svg>')}`;
const followed = ["阶段甲", "阶段乙"].map((handle, i) => ({
  id: `card-${i}`, kol_uid: `kol-${i}`, handle, platform: "YouTube", avatar_url: avatar,
  follow_id: `follow-${i}`, status: "active", source_kind: "local_follow",
  stage_code: "INITIAL_CONTACT", stage_label: "初步接触", suggested_stage: "已回复-有兴趣", suggested_stage_code: "INTERESTED", days_in_stage: 2,
  last_interaction_at: new Date().toISOString(), days_since_interaction: 2, followers: "76万",
  mail_threads: [{ conversation_id: `thread-${i}`, last_direction: "inbound", subject: "Re: 合作", last_snippet: "我对这次合作有兴趣", last_at: new Date().toISOString(), unread_count: 0 }],
}));
const pool = [{ kol_uid: "pool-a", handle: "City Prepping", platform: "youtube", avatar_url: avatar,
  followers: 1270000, avg_plays: 1010000, region: "United States", direction: "户外", potential_score: 18, potential_confidence: 0.62,
  ingested_at: "2026-09-23T00:00:00Z" }];
async function fixture(page: Page) {
  const writes: Array<{ method: string; path: string; body: Record<string, unknown> | null }> = [], errors: string[] = [];
  let claimed = false;
  page.on("pageerror", e => errors.push(e.message));
  await page.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const body = request.postDataJSON?.() as Record<string, unknown> | null;
    if (request.method() !== "GET") writes.push({ method: request.method(), path, body });
    let json: unknown = [];
    if (path === "/api/auth/status") json = { authenticated: true, account: { id: "employee", name: "员工", available_modes: ["employee"] } };
    else if (path === "/api/me") json = { id: "employee", name: "员工", available_modes: ["employee"] };
    else if (path === "/api/preferences") json = { theme: "light" };
    else if (path === "/api/home/following") json = { entry: "memory", kind: "memory", kols: claimed ? [...followed, {
      id: "follow-pool-a", follow_id: "follow-pool-a", kol_uid: "pool-a", handle: "City Prepping", platform: "youtube", status: "active",
      stage_code: "INITIAL_CONTACT", stage_label: "初步接触", last_interaction_at: null, countdown: false,
      source_kind: "local_follow",
    }] : followed, authority: "kol_follow_index+verified_starry_binding", completeness: "complete",
      follow_scope: { required: false, bound: false }, creates_session: false, calls_model: false };
    else if (path === "/api/home/board") json = { kols: followed, follow_scope: { required: false, bound: false }, workbench: {} };
    else if (path === "/api/home/pool") json = { entry: "memory", kind: "memory", items: pool, kols: pool, creates_session: false, calls_model: false };
    else if (path === "/api/kols/pool-a/claim" && request.method() === "POST") {
      claimed = true;
      json = { ok: true, created: true, follow: { follow_id: "follow-pool-a", kol_uid: "pool-a" } };
    } else if (path === "/api/follows/follow-pool-a/release" && request.method() === "POST") {
      claimed = false;
      json = { ok: true, follow_id: "follow-pool-a", kol_uid: "pool-a", stage_unchanged: true };
    }
    if (path.endsWith("/events")) return route.fulfill({ contentType: "text/event-stream", body: "" });
    await route.fulfill({ json });
  });
  return { writes, errors };
}

test("real Home routes use shared KOL geometry and selection never writes", async ({ page }, info) => {
  const f = await fixture(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const tab of ["pool", "lifecycle"]) {
    await page.goto(`/?tab=${tab}`);
    const card = page.locator("[data-kol-unified]").first();
    await expect(card).toBeVisible({ timeout: 20000 });
    await expect(card).toHaveAttribute("data-kol-unified", tab === "pool" ? "pool" : "followed");
    await expect(card.locator("[data-kol-avatar]")).toHaveCSS("width", "24px");
    await expect(card.locator("[data-kol-name]")).toHaveCSS("font-size", "13px");
    await expect(card.locator("[data-kol-name]")).toHaveCSS("font-weight", "500");
    await expect(card.locator(".ant-checkbox")).toHaveCSS("width", "14px");
    const metas = await card.locator('[data-kol-layout="meta"]').all();
    expect(metas.length).toBeGreaterThan(0);
    for (const meta of metas) await expect(meta).toHaveCSS("font-size", tab === "pool" ? "13px" : "12px");
    await expect(card.locator("[data-stage-label]").first()).toHaveCSS("font-size", tab === "pool" ? "13px" : "12px");
    await expect(card.locator(".kol-card-icon").first()).toHaveCSS("font-size", "14px");
    await card.getByRole("checkbox").check();
    await expect(card.getByRole("checkbox")).toBeChecked();
    expect(f.writes).toEqual([]);
    await page.screenshot({ path: info.outputPath(`home-${tab}-shared.png`) });
  }
  expect(f.errors).toEqual([]);
});

test("real pool direct claim posts confirm=true once and only switches to release after success", async ({ page }) => {
  const f = await fixture(page);
  await page.goto("/?tab=pool");
  const card = page.locator("[data-pool-kol=pool-a]");
  await expect(card).toBeVisible({ timeout: 20000 });
  await card.locator("[data-pool-claim]").click();
  await expect.poll(() => f.writes.length).toBe(1);
  expect(f.writes[0]).toMatchObject({ method: "POST", path: "/api/kols/pool-a/claim", body: { confirm: true } });
  await expect(card.locator("[data-claim-follow-confirm]")).toHaveCount(0);
  await expect(card.locator("[data-pool-release]")).toBeVisible();
  await expect(card.locator("[data-pool-claim]")).toHaveCount(0);
  expect(f.errors).toEqual([]);
});

test("real followed cards preserve keyboard emphasis and scroll hover does not steal focus", async ({ page }) => {
  const f = await fixture(page);
  await page.goto("/?tab=lifecycle");
  const a = page.locator('[data-followed-kol="阶段甲"]'), b = page.locator('[data-followed-kol="阶段乙"]');
  await expect(a).toBeVisible({ timeout: 20000 });
  await b.locator("[data-confirm-enter-stage]").focus();
  await expect(b).toHaveAttribute("data-cta-emphasis", "strong");
  await a.evaluate(el => el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
  await expect(b.locator("[data-confirm-enter-stage]")).toBeFocused();
  await expect(b).toHaveAttribute("data-cta-emphasis", "strong");
  await expect(a).toHaveAttribute("data-cta-emphasis", "quiet");
  await a.hover();
  await expect(a).toHaveAttribute("data-cta-emphasis", "strong");
  await expect(b).toHaveAttribute("data-cta-emphasis", "quiet");
  await expect(a.locator("[data-confirm-enter-stage]")).toHaveClass(/work/);
  expect(f.writes).toEqual([]);
  expect(f.errors).toEqual([]);
});
