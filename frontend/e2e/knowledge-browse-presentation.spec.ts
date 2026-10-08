import { expect, test, type Page } from "@playwright/test";

// HTTP fixtures prove layout/interaction contracts, not production data or external delivery.
async function surface(page: Page, options: { long?: boolean; empty?: boolean; failure?: boolean } = {}) {
  const writes: string[] = [], errors: string[] = [], reads: string[] = [];
  const account = { id: "employee", name: "员工", available_modes: ["employee"] };
  const rows = Array.from({ length: options.empty ? 0 : 14 }, (_, i) => ({
    id: `kb-${i}`, title: i === 0 && options.long ? "很长的知识标题".repeat(30) : `合作知识 ${i + 1}`,
    body: i === 0 && options.long ? "首标题前的原文\n# 第一节\n完整第一节\n# 第二节\n完整第二节" : "Hi,\n\nPlease review the outline.\n\nBest,\nCreator Desk",
    subject: `邮件主题 ${i + 1}`, kind: "mail_template", status: "published", brand: i % 2 ? "RO" : "LT",
    stage_codes: [i % 2 ? "TESTING" : "INITIAL_CONTACT"], current_version: 1, created_by: "publisher",
    updated_at: "2026-10-08T01:00:00Z", family_id: "growth", domain_id: "history", base_id: "legacy", favorite: false,
  }));
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    if (req.method() !== "GET") writes.push(`${req.method()} ${path}`);
    else reads.push(path);
    let json: unknown = [];
    if (path === "/api/auth/status") json = { authenticated: true, account };
    else if (path === "/api/me") json = account;
    else if (path === "/api/preferences") json = { theme: "light" };
    else if (path === "/api/cron/jobs") json = { jobs: [] };
    else if (path === "/api/knowledge/taxonomy") json = {
      domains: [{ id: "growth", name: "品牌与用户增长中心", level: "family" }, { id: "history", name: "历史知识", level: "domain", parent_id: "growth" }],
      bases: [{ id: "legacy", name: "历史知识", domain_id: "history" }],
    };
    else if (path === "/api/knowledge") {
      if (options.failure) return route.fulfill({ status: 503, json: { error: "知识服务不可用" } });
      const q = url.searchParams.get("q") || "";
      json = q ? rows.filter(row => `${row.title} ${row.subject} ${row.body}`.includes(q)) : rows;
    } else if (/\/knowledge\/kb-\d+\/(favorite|cite)$/.test(path)) json = rows.find(row => path.includes(`/${row.id}/`));
    await route.fulfill({ json });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/kb");
  await expect(page.locator("[data-kb-page]")).toBeVisible();
  return { writes, errors, reads, recover: () => { options.failure = false; } };
}

test("first visit reserves detail; selecting preserves columns and controls measure compact", async ({ page }) => {
  const state = await surface(page);
  const list = page.locator("[data-kbv-list]"), detail = page.locator("[data-kb-detail]");
  await expect(detail).toContainText("从列表选择一条知识");
  const before = await detail.boundingBox();
  await page.locator('[data-kb-open="kb-0"]').click();
  const after = await detail.boundingBox(), left = await list.boundingBox();
  expect(before!.x).toBe(after!.x); expect(before!.width).toBe(after!.width);
  expect(left!.x + left!.width).toBeLessThanOrEqual(after!.x + 1);
  expect(after!.width).toBeGreaterThanOrEqual(360);
  for (const selector of ['[data-kb-row-favorite="kb-0"]', '[data-kb-favorite="kb-0"]', '[data-kb-filter="stage"] button']) {
    const sizes = await page.locator(selector).evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height));
    expect(sizes.every(height => height === 24), selector).toBe(true);
  }
  expect((await page.locator('[data-kb-use="kb-0"]').boundingBox())!.height).toBe(28);
  expect((await page.locator('[data-kb-search]').boundingBox())!.height).toBe(28);
  expect((await page.locator('.knowledge-status').boundingBox())!.height).toBe(20);
  expect((await page.locator('[data-kb-row="kb-0"]').boundingBox())!.height).toBe(44);
  const metadata = page.locator("[data-kb-provenance]");
  await expect(metadata.locator("dd").filter({ hasText: "v1" })).toHaveCount(1);
  await expect(detail).not.toContainText("第 1 版");
  await expect(detail.locator("[data-kb-preview-body]")).not.toHaveCSS("font-family", /monospace/);
  await expect(detail.locator("[data-kb-preview-body]")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(page.locator("[data-kb-skill-templates]")).toHaveCount(0);
  expect(state.reads).not.toContain("/api/knowledge/skill-templates");
  expect(state.errors).toEqual([]);
  await page.screenshot({ path: "test-results/knowledge-browse-desktop.png", fullPage: true });
});

test("stages use dictionary, zero results keep selection, multiple stages are a union", async ({ page }) => {
  await surface(page);
  const stages = page.locator('[data-kb-filter="stage"]');
  await expect(stages.locator("button")).toHaveCount(6);
  await expect(stages.locator('[data-kb-filter-value=""]')).toHaveAttribute("aria-pressed", "true");
  await stages.locator('[data-kb-filter-value="INITIAL_CONTACT"]').click();
  await expect(page.locator("[data-kbv-count]")).toHaveText("7 条知识");
  await stages.locator('[data-kb-filter-value="EVALUATING"]').click();
  await expect(page.locator("[data-kbv-count]")).toHaveText("7 条知识");
  await stages.locator('[data-kb-filter-value="INITIAL_CONTACT"]').click();
  await expect(page.locator("[data-kb-empty]")).toBeVisible();
  await expect(stages.locator('[data-kb-filter-value="EVALUATING"]')).toHaveAttribute("aria-pressed", "true");
  await stages.locator('[data-kb-filter-value=""]').click();
  await stages.getByRole("combobox", { name: "更多阶段" }).selectOption("TESTING");
  await expect(stages.locator('[data-kb-filter-value="TESTING"]')).toHaveAttribute("aria-pressed", "true");
  await page.locator('[data-kb-filter="brand"] [data-kb-filter-value="LT"]').click();
  await expect(page.locator("[data-kb-empty]")).toBeVisible();
});

test("load footer follows last row and actions work without hover or opening detail", async ({ page }) => {
  const state = await surface(page);
  await expect(page.locator("[data-kb-row]")).toHaveCount(5);
  const last = await page.locator("[data-kb-row]").last().boundingBox();
  const footer = await page.locator("[data-kb-load-footer]").boundingBox();
  expect(footer!.y).toBeGreaterThanOrEqual(last!.y + last!.height);
  const more = page.locator("[data-kb-load-more]");
  await expect(more).toHaveCSS("border-top-width", "0px");
  await expect(more).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await page.locator('[data-kb-row-favorite="kb-0"]').click();
  await expect(page.locator('[data-kb-row-favorite="kb-0"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-kb-preview]")).toHaveCount(0);
  await more.click(); await expect(page.locator("[data-kb-row]")).toHaveCount(10);
  await more.click(); await expect(page.locator("[data-kb-row]")).toHaveCount(14);
  await expect(more).toHaveCount(0);
  await page.locator('[data-kb-row-use="kb-0"]').click();
  await expect(page).toHaveURL(/knowledge_id=kb-0/);
  expect(state.writes).toEqual(["POST /api/knowledge/kb-0/favorite", "POST /api/knowledge/kb-0/cite"]);
});

test("container width switches views and restores filter, pagination, scroll and focus", async ({ page }) => {
  await surface(page);
  await page.locator("[data-kb-page]").evaluate(node => { (node as HTMLElement).style.width = "600px"; });
  await expect(page.locator("[data-kb-detail]")).toBeHidden();
  await page.locator('[data-kb-filter="brand"] [data-kb-filter-value="LT"]').click();
  await page.locator("[data-kb-load-more]").click();
  await page.locator("[data-kbv-list]").evaluate(node => { node.scrollTop = 50; });
  const scroll = await page.locator("[data-kbv-list]").evaluate(node => node.scrollTop);
  await page.locator('[data-kb-open="kb-4"]').click();
  await expect(page.locator("[data-kbv-list]")).toBeHidden();
  await expect(page.locator('[data-kb-preview="kb-4"]')).toBeVisible();
  await page.getByRole("button", { name: "← 返回列表" }).click();
  await expect(page.locator('[data-kb-open="kb-4"]')).toBeFocused();
  await expect(page.locator('[data-kb-filter="brand"] [data-kb-filter-value="LT"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-kb-row]")).toHaveCount(7);
  expect(await page.locator("[data-kbv-list]").evaluate(node => node.scrollTop)).toBe(scroll);
});

test("long text preserves introduction; TOC opens target; short viewport keeps footer reachable", async ({ page }) => {
  await surface(page, { long: true });
  await page.locator('[data-kb-open="kb-0"]').click();
  await expect(page.locator("[data-kb-preview-body]")).toContainText("首标题前的原文");
  await page.getByRole("link", { name: "第二节" }).click();
  await expect(page.locator("#kb-section-kb-0-2")).toHaveAttribute("open", "");
  await page.setViewportSize({ width: 1024, height: 589 });
  await expect(page.locator('[data-kb-use="kb-0"]')).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const body = await page.locator(".kbv-rail-body").boundingBox(), footer = await page.locator(".knowledge-detail-actions").boundingBox();
  expect(body!.y + body!.height).toBeLessThanOrEqual(footer!.y + 1);
  await page.screenshot({ path: "test-results/knowledge-browse-compact.png", fullPage: true });
});

test("empty and unavailable states stay honest with detail workspace reserved", async ({ page }) => {
  const state = await surface(page, { failure: true });
  await expect(page.locator('[data-kbv-list] .error')).toContainText("知识服务暂不可用");
  await expect(page.locator("[data-kb-row]")).toHaveCount(0);
  await expect(page.locator("[data-kb-detail]")).toBeVisible();
  await expect(page.locator('[data-kbv-list]')).not.toContainText("暂无已发布资料");
  state.recover();
  await page.locator("[data-kb-retry]").click();
  await expect(page.locator("[data-kb-row]")).toHaveCount(5);
  await expect(page.locator('[data-kbv-list] .error')).toHaveCount(0);
});

test("container breakpoint and narrow viewport have no horizontal overflow", async ({ page }) => {
  await surface(page);
  const host = page.locator("[data-kb-page]");
  await host.evaluate(node => { (node as HTMLElement).style.width = "720px"; });
  await expect(page.locator("[data-kb-detail]")).toBeVisible();
  expect((await page.locator("[data-kb-detail]").boundingBox())!.width).toBeGreaterThanOrEqual(360);
  await host.evaluate(node => { (node as HTMLElement).style.width = "719px"; });
  await expect(page.locator("[data-kb-detail]")).toBeHidden();
  await host.evaluate(node => { (node as HTMLElement).style.width = "100%"; });
  await page.setViewportSize({ width: 400, height: 630 });
  await page.locator('[data-kb-open="kb-0"]').click();
  await expect(page.locator("#kb-preview-title")).toBeFocused();
  await expect(page.locator('[data-kb-use="kb-0"]')).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("search preserves selected brand and dictionary stages when results disappear", async ({ page }) => {
  await surface(page);
  const brand = page.locator('[data-kb-filter="brand"] [data-kb-filter-value="LT"]');
  await brand.click();
  await page.locator('[data-kb-search]').fill("does-not-exist");
  await expect(page.locator("[data-kb-empty]")).toBeVisible();
  await expect(brand).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-kb-filter="stage"] button')).toHaveCount(6);
  await page.locator('[data-kb-search]').fill("");
  await expect(page.locator("[data-kbv-count]")).toHaveText("7 条知识");
});

test.describe("touch input", () => {
  test.use({ hasTouch: true, isMobile: true });
  test("actions remain discoverable with touch hit targets", async ({ page }) => {
    await surface(page);
    await page.setViewportSize({ width: 400, height: 700 });
    const favorite = page.locator('[data-kb-row-favorite="kb-0"]');
    await expect(favorite).toBeVisible();
    const box = await favorite.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await favorite.tap();
    await expect(favorite).toHaveAttribute("aria-pressed", "true");
    await page.locator('[data-kb-open="kb-0"]').tap();
    await expect(page.locator('[data-kb-use="kb-0"]')).toBeInViewport();
  });
});
