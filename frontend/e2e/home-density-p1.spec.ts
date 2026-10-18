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

/** Full action set: confirm-stage primary, mail, release, and an evidence disclosure. */
const FOLLOW_FULL = {
  ...FOLLOW_ITEM,
  id: "col_density_full",
  handle: "红人全量",
  display_name: "红人全量",
  follow_id: "kfi_density_full",
  collaboration_id: "col_density_full",
  employee_id: "u_sriphy",
  employee_name: "Sriphy",
  scope_brand: "LT",
  suggested_stage: "已回复-有兴趣",
  suggested_stage_code: "INTERESTED",
  days_since_interaction: 12,
  last_interaction_at: "2026-09-12T10:00:00.000Z",
  release_due_at: "2026-09-26T00:00:00.000Z",
  countdown: true,
  cron_eligible: true,
  unread_count: 0,
};

type StubOptions = {
  pool?: typeof POOL_ITEM;
  follow?: typeof FOLLOW_ITEM;
  claimStatus?: number;
};

async function stubApi(page: Page, options: StubOptions = {}) {
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
    json: homePoolReadonlyPayload([options.pool || POOL_ITEM], new URL(route.request().url()).searchParams),
  }));
  await stubHomeFollowing(page, [options.follow || FOLLOW_ITEM]);
  if (options.claimStatus) {
    await page.route(/\/api\/kols\/[^/]+\/claim$/, (route) => route.fulfill({
      status: options.claimStatus,
      json: { error: "claim_failed", message: "归属写入失败，请刷新后重试" },
    }));
  }
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
      score: rect(".pool-score-section"),
      meta: rect(".kol-card-meta"),
      actions: rect("[data-pool-actions]"),
      overflowX: element.scrollWidth > element.clientWidth + 1,
    };
  });
  expect.soft(poolGeometry.overflowX).toBe(false);
  // 三行扫描单元：identity / score+evidence / meta+action 同行。
  expect.soft(poolGeometry.row!.h).toBeGreaterThanOrEqual(72);
  expect.soft(poolGeometry.row!.h).toBeLessThanOrEqual(112);
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
      meta: rect(".kol-card-meta"),
      fact: rect('[data-kol-band="fact"]'),
      suggestion: rect(".kol-card-suggestion"),
      cta: rect('[data-kol-band="cta"]'),
      bands: element.querySelectorAll("[data-kol-band]").length,
      overflowX: element.scrollWidth > element.clientWidth + 1,
    };
  });
  expect.soft(followedGeometry.overflowX).toBe(false);
  expect.soft(followedGeometry.bands).toBe(4);
  // 三行扫描单元：identity / meta+fact 同行 / suggestion+actions 同行。
  expect.soft(followedGeometry.row!.h).toBeLessThanOrEqual(112);
  expect.soft(Math.abs(followedGeometry.meta!.y - followedGeometry.fact!.y)).toBeLessThanOrEqual(6);
  expect.soft(Math.abs(followedGeometry.suggestion!.y - followedGeometry.cta!.y)).toBeLessThanOrEqual(6);

  // P0 的标签/首选项同行也在这里再守一次，确保它进入 release gate 的 P1 spec。
  await page.goto("/?tab=discovery");
  const discoveryCard = page.locator("[data-discovery-search-card]");
  await expect(discoveryCard).toBeVisible();
  const discoveryLabel = await discoveryCard.locator('[data-skill-param="platforms"] .ai-discovery-label').boundingBox();
  const discoveryChip = await discoveryCard.locator('[data-skill-param="platforms"] [data-discovery-chip]').first().boundingBox();
  expect.soft(discoveryLabel && discoveryChip
    && discoveryLabel.y >= discoveryChip.y - 1
    && discoveryLabel.y + discoveryLabel.height <= discoveryChip.y + discoveryChip.height + 1
    && discoveryChip.x >= discoveryLabel.x + discoveryLabel.width).toBeTruthy();
});

test("pool claim error stays readable in a full-width row", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await stubApi(page, { claimStatus: 500 });
  await page.goto("/?tab=pool");
  const pool = page.locator("[data-pool-card]").first();
  await expect(pool).toBeVisible();
  await pool.locator("[data-pool-claim]").click();
  const errorRow = pool.locator("[data-pool-claim-error]");
  await expect(errorRow).toBeVisible();
  await expect(errorRow).toContainText("归属写入失败");
  const geometry = await pool.evaluate((element) => {
    const rect = (node: Element | null) => {
      if (!node) return null;
      const box = node.getBoundingClientRect();
      return { x: +box.x.toFixed(1), right: +box.right.toFixed(1), w: +box.width.toFixed(1), h: +box.height.toFixed(1) };
    };
    const row = rect(element)!;
    return {
      row,
      meta: rect(element.querySelector(".kol-card-meta")),
      error: rect(element.querySelector("[data-pool-claim-error]")),
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    };
  });
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
  expect(geometry.row.h).toBeLessThan(240);
  expect(geometry.meta && geometry.meta.w).toBeGreaterThan(100);
  expect(geometry.error
    && geometry.error.x >= geometry.row.x - 1
    && geometry.error.right <= geometry.row.right + 1).toBe(true);
});

test.describe("touch narrow", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("full followed action set wraps inside the row", async ({ page }) => {
    await stubApi(page, { follow: FOLLOW_FULL });
    await page.goto("/?tab=lifecycle");
    const row = page.locator("[data-followed-kol]").first();
    await expect(row).toBeVisible();
    await expect(row.locator("[data-open-kol-detail]")).toBeVisible();
    const evidence = row.locator("[data-action-evidence]");
    if (await evidence.count()) {
      await evidence.locator("summary").click();
      await expect(evidence.locator(".kol-card-evidence-body")).toBeVisible();
    }
    const geometry = await row.evaluate((element) => {
      const box = (node: Element) => {
        const rect = node.getBoundingClientRect();
        return { x: +rect.x.toFixed(1), right: +rect.right.toFixed(1), w: +rect.width.toFixed(1) };
      };
      return {
        row: box(element),
        boxes: [...element.querySelectorAll("[data-kol-band], [data-open-kol-detail], [data-open-original-mail], [data-release-follow], [data-action-evidence] > summary")].map(box),
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      };
    });
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
    for (const box of geometry.boxes) {
      expect(box.x).toBeGreaterThanOrEqual(geometry.row.x - 1);
      expect(box.right).toBeLessThanOrEqual(geometry.row.right + 1);
    }
    await expect(row.locator("[data-open-kol-detail]")).toBeVisible();
    await expect(row.locator("[data-action-evidence]")).toBeVisible();

    // 触摸模态下评分依据仍是 44px 命中区（P1 曾因行高覆盖降到 40px）。
    await page.goto("/?tab=pool");
    const scoreSummary = page.locator("[data-pool-score-evidence] summary").first();
    await expect(scoreSummary).toBeVisible();
    expect(await scoreSummary.evaluate((node) => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);

    // 触摸模态下 AI发现条件卡仍保持标签与首个 chip 同行，chip 命中区 44px。
    await page.goto("/?tab=discovery");
    const discoveryCard = page.locator("[data-discovery-search-card]");
    await expect(discoveryCard).toBeVisible();
    const discoveryLabel = await discoveryCard.locator('[data-skill-param="platforms"] .ai-discovery-label').boundingBox();
    const discoveryChip = await discoveryCard.locator('[data-skill-param="platforms"] [data-discovery-chip]').first().boundingBox();
    expect(discoveryLabel && discoveryChip
      && discoveryLabel.y >= discoveryChip.y - 1
      && discoveryLabel.y + discoveryLabel.height <= discoveryChip.y + discoveryChip.height + 1
      && discoveryChip.x >= discoveryLabel.x + discoveryLabel.width
      && discoveryChip.height >= 44).toBeTruthy();
  });
});
