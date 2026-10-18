import { expect, test, type Page } from "@playwright/test";
import { homePoolReadonlyPayload, stubHomeFollowing } from "./kol-surface-stub";

/** Scored public-pool row: exercises the score summary, evidence link, metrics and claim action. */
const POOL_ITEM = {
  id: "kpi_density",
  company_id: "company:amperetime",
  kol_uid: "uid_density",
  handle: "户外充电君",
  display_name: "户外充电君",
  platform: "youtube",
  homepage_url: "https://www.youtube.com/@outdoor",
  avatar_url: "",
  followers: "120000",
  avg_plays: "30000",
  engagement: "0.042",
  direction: "vanlife",
  region: "北美",
  style: "",
  ingest_source: "starry",
  ingested_at: "2026-08-01T00:00:00Z",
  idle: true,
  public_stage: "公海",
  pool_status: "open",
  has_conversation: false,
  potential_score: 18,
  potential_confidence: 0.62,
  risk_score: 20,
  risk_confidence: 0.7,
  assessment_state: "scored",
  assessment_version: "jev-kol-v1",
  assessment_model: "jev-kol",
  assessed_at: "2026-10-09T01:01:00Z",
  assessment_criteria: "平台 youtube · 关键词 camping",
};

const FOLLOW_ITEM = {
  id: "col_density",
  kol_uid: "kol_density",
  handle: "红人1",
  display_name: "红人1",
  platform: "YouTube",
  brand: "LT",
  stage_code: "INITIAL_CONTACT",
  stage_label: "初步接触",
  days_in_stage: 3,
  source_kind: "kol_follow_index",
  status: "active",
  mail_threads: [{
    conversation_id: "thread_density",
    subject: "Re: collab",
    unread_count: 0,
    last_direction: "inbound",
    last_snippet: "想和贵品牌合作",
    last_at: "2026-09-12T10:00:00.000Z",
  }],
};

async function stubApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/api/health") return route.fulfill({ json: { ok: true } });
    if (path === "/api/auth/status") return route.fulfill({
      json: { authenticated: true, account: { id: "employee", name: "员工", available_modes: ["employee"] } },
    });
    if (path === "/api/me") return route.fulfill({ json: { id: "employee", name: "员工", available_modes: ["employee"] } });
    if (path === "/api/preferences") return route.fulfill({ json: { theme: "light" } });
    if (path === "/api/home/board") return route.fulfill({
      json: { kols: [], follow_scope: { required: false, bound: false }, workbench: {}, tasks: [] },
    });
    return route.fulfill({ json: [] });
  });
  // Register the authoritative pool/following reads after the catch-all so they win.
  await page.route(/\/api\/home\/pool(?:\?.*)?$/, (route) => route.fulfill({
    json: homePoolReadonlyPayload([POOL_ITEM], new URL(route.request().url()).searchParams),
  }));
  await stubHomeFollowing(page, [FOLLOW_ITEM]);
}

test("pool and followed rows stay compact at the narrow result rail", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await stubApi(page);

  await page.goto("/?tab=pool");
  const pool = page.locator("[data-pool-card]").first();
  await expect(pool).toBeVisible();
  const poolGeometry = await pool.evaluate((element) => {
    const box = (node: Element) => {
      const rect = node.getBoundingClientRect();
      return { x: +rect.x.toFixed(1), y: +rect.y.toFixed(1), w: +rect.width.toFixed(1), h: +rect.height.toFixed(1) };
    };
    const rect = (selector: string) => {
      const node = element.querySelector(selector);
      return node ? box(node) : null;
    };
    return {
      row: box(element),
      identity: rect(".kol-card-identity"),
      score: rect(".pool-score-section"),
      meta: rect(".kol-card-meta"),
      actions: rect("[data-pool-actions]"),
      overflowX: element.scrollWidth > element.clientWidth + 1,
    };
  });
  expect.soft(poolGeometry.overflowX).toBe(false);
  // 三行扫描单元：identity / score+evidence / meta+action 同行。
  expect.soft(poolGeometry.row!.h).toBeLessThanOrEqual(120);
  expect.soft(poolGeometry.score!.h).toBeLessThanOrEqual(28);
  expect.soft(Math.abs(poolGeometry.meta!.y - poolGeometry.actions!.y)).toBeLessThanOrEqual(6);
  expect.soft(poolGeometry.actions!.x).toBeGreaterThan(poolGeometry.meta!.x);

  await page.goto("/?tab=lifecycle");
  const followed = page.locator("[data-followed-kol]").first();
  await expect(followed).toBeVisible();
  const followedGeometry = await followed.evaluate((element) => {
    const box = (node: Element) => {
      const rect = node.getBoundingClientRect();
      return { x: +rect.x.toFixed(1), y: +rect.y.toFixed(1), w: +rect.width.toFixed(1), h: +rect.height.toFixed(1) };
    };
    const rect = (selector: string) => {
      const node = element.querySelector(selector);
      return node ? box(node) : null;
    };
    return {
      row: box(element),
      identity: rect('[data-kol-band="identity"]'),
      meta: rect(".kol-card-meta"),
      fact: rect('[data-kol-band="fact"]'),
      action: rect('[data-kol-band="action"]'),
      suggestion: rect(".kol-card-suggestion"),
      cta: rect('[data-kol-band="cta"]'),
      bands: element.querySelectorAll("[data-kol-band]").length,
      children: [...element.children].map((child) => ({ cls: child.className, h: +child.getBoundingClientRect().height.toFixed(1) })),
      overflowX: element.scrollWidth > element.clientWidth + 1,
    };
  });
  expect.soft(followedGeometry.overflowX).toBe(false);
  expect.soft(followedGeometry.bands).toBe(4);
  // 三行扫描单元：identity / meta+fact 同行 / suggestion+actions 同行。
  expect.soft(followedGeometry.row!.h).toBeLessThanOrEqual(112);
  expect.soft(Math.abs(followedGeometry.meta!.y - followedGeometry.fact!.y)).toBeLessThanOrEqual(6);
  expect.soft(Math.abs(followedGeometry.suggestion!.y - followedGeometry.cta!.y)).toBeLessThanOrEqual(6);
});
