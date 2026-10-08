import { expect, test, type Page } from "@playwright/test";

// HTTP fixtures exercise frontend state and layout only; they do not prove production data.
async function surface(page: Page, path = "/admin/knowledge") {
  const writes: string[] = [], reads: URL[] = [], errors: string[] = [];
  const domains = [
    { id: "product", name: "产品与解决方案", code: "product", level: "family" },
    { id: "growth", name: "品牌与用户增长中心", code: "growth", level: "family" },
    { id: "legacy", name: "未分类", code: "legacy", level: "family" },
    { id: "battery-domain", parent_id: "product", name: "产品管理", code: "battery", level: "domain" },
    { id: "growth-domain", parent_id: "growth", name: "内容增长", code: "growth-content", level: "domain" },
    { id: "legacy-domain", parent_id: "legacy", name: "未分类", code: "legacy-content", level: "domain" },
  ];
  const bases = [
    { id: "battery", domain_id: "battery-domain", family_id: "product", name: "电池", code: "battery", kind: "structured", status: "active" },
    { id: "brand", domain_id: "growth-domain", family_id: "growth", name: "品牌资料", code: "brand", kind: "structured", status: "active" },
    { id: "legacy-base", domain_id: "legacy-domain", family_id: "legacy", name: "未分类", code: "legacy", kind: "structured", status: "active" },
  ];
  const rows = Array.from({ length: 13 }, (_, index) => {
    const base = index === 12 ? null : bases[index % bases.length];
    return {
      id: `kb-filter-${index}`, title: `知识筛选记录 ${index + 1}`, body: "只读测试资料", kind: index > 10 ? "document" : index % 2 ? "mail_template" : "pattern",
      status: index < 2 ? "draft" : index < 8 ? "pending_review" : index < 11 ? "published" : index === 11 ? "uploaded" : "indexing",
      asset_type: index > 10 ? "document" : "entry", base_id: base?.id || null, family_id: base?.family_id || null, domain_id: base?.domain_id || null,
      base_name: base?.name || null, brand: index % 2 ? "LT" : "RO", stage_codes: [index % 2 ? "INITIAL_CONTACT" : "EVALUATING"], current_version: 1,
      updated_at: "2026-10-08T12:00:00Z", created_by: "knowledge-admin",
    };
  });
  const statuses: Record<string, string> = { draft: "draft", pending: "pending_review", published: "published", disabled: "archived" };
  const matching = (url: URL, skip = "") => rows.filter(row => {
    const p = url.searchParams;
    if (skip !== "view" && p.get("view") && row.status !== statuses[p.get("view")!]) return false;
    if (skip !== "kind" && p.get("kind") && row.kind !== p.get("kind")) return false;
    for (const axis of ["family", "domain", "base"] as const) {
      const value = p.get(`${axis}_id`);
      if (skip !== axis && value && (row[`${axis}_id`] || "__none__") !== value) return false;
    }
    if (skip !== "brand" && p.get("brands") && !p.get("brands")!.split(",").includes(row.brand)) return false;
    if (skip !== "stage" && p.get("stages") && !p.get("stages")!.split(",").some(stage => row.stage_codes.includes(stage))) return false;
    return !p.get("q") || row.title.includes(p.get("q")!);
  });
  const response = (url: URL) => {
    const facets: Record<string, { all: number; values: Record<string, number>; empty?: number; unbranded?: number }> = {};
    for (const axis of ["view", "kind", "family", "domain", "base", "brand", "stage"]) {
      const relevant = matching(url, axis), values: Record<string, number> = {};
      for (const row of relevant) {
        const value = axis === "view" ? row.status : axis === "stage" ? row.stage_codes[0] : axis === "family" || axis === "domain" || axis === "base" ? row[`${axis}_id`] || "__none__" : axis === "brand" ? row.brand : row.kind;
        values[value] = (values[value] || 0) + 1;
      }
      facets[axis] = { all: relevant.length, values, empty: 0, unbranded: 0 };
    }
    const filtered = matching(url);
    return { tenant: "fixture", rows: filtered, total: filtered.length, page: 1, page_size: 20, page_count: 1, facets, domains, bases,
      // Deliberately different from list facets, so a global-count regression is visible.
      stats: { status: { published: 91 }, pending_review: { count: 0, max_wait_days: 0 }, pending_documents: { count: 0, max_wait_days: 0 }, expiring: { count: 0, nearest: null } } };
  };
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (request.method() === "GET") reads.push(url); else writes.push(`${request.method()} ${path}`);
    const account = { id: "knowledge-admin", name: "知识管理员", roles: ["admin"], available_modes: ["employee", "admin"] };
    let json: unknown = [];
    if (path === "/api/health") json = { ok: true };
    else if (path === "/api/auth/status") json = { authenticated: true, account };
    else if (path === "/api/me") json = account;
    else if (path === "/api/preferences") json = { theme: "light" };
    else if (path === "/api/cron/jobs") json = { jobs: [] };
    else if (path === "/api/admin/knowledge/workspace-v1") json = response(url);
    else if (path === "/api/admin/knowledge/bases") json = bases;
    else if (path === "/api/admin/knowledge/domains") json = domains;
    else if (path === "/api/admin/retention-policy") json = {};
    await route.fulfill({ json });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(path);
  await expect(page.locator("[data-admin-knowledge]")).toBeVisible();
  await expect(page.locator('[data-kbv-view="all"] small')).toHaveText("13");
  return { writes, reads, errors };
}

test("compact groups fill the option column with top-aligned labels and authoritative counts", async ({ page }) => {
  const state = await surface(page);
  const middle = page.locator("[data-knowledge-middle]");
  await expect(middle.locator('[data-kb-filter="taxonomy"] .kbv-scope-row')).toHaveCount(3);
  await expect(middle.locator('.knowledge-filter-bar > .knowledge-browse-filter-group')).toHaveCount(4);
  await expect(middle.locator('[data-kb-filter="kind"]')).toBeVisible();
  await expect(middle.locator('details')).toHaveCount(0);
  await expect(middle).not.toContainText("更多筛选");
  await expect(middle.locator('[data-kb-scope-family="legacy"]')).toContainText("未分类");
  await expect(middle.locator('[data-kb-scope-family="__none__"]')).toContainText("未归属业务族");
  await expect(middle.locator('[data-kbv-view]')).toHaveText(["全部13", "草稿2", "待审批6", "已发布3", "已下架0"]);
  await expect(page.locator('[data-kb-lifecycle-tabs] [role="tab"]')).toHaveText(["知识规划", "知识创作", "知识加工", "发布审批", "知识资产"]);
  const geometry = await middle.locator('.knowledge-filter-bar').evaluate(bar => {
    const rows = [...bar.querySelectorAll('.kbv-scope-row, .kbv-chip-row')];
    return rows.map(row => {
      const label = row.querySelector('.kbv-scope-name')!.getBoundingClientRect();
      const options = row.querySelector('.kbv-scope-tabs, .knowledge-filter-options, .knowledge-stage-chips')!.getBoundingClientRect();
      return { labelTop: label.top, optionTop: options.top, optionRight: options.right, rowRight: row.getBoundingClientRect().right };
    });
  });
  for (const row of geometry) {
    expect(Math.abs(row.labelTop - row.optionTop)).toBeLessThanOrEqual(1);
    expect(Math.abs(row.optionRight - row.rowRight)).toBeLessThanOrEqual(1);
  }
  expect(state.errors).toEqual([]);
  expect(state.writes).toEqual([]);
  await page.screenshot({ path: "test-results/knowledge-planning-compact-filters.png", fullPage: true });
});

test("scope cascade, types and stage remove/add stay interactive without writes", async ({ page }) => {
  const state = await surface(page);
  await page.locator('[data-kb-scope-family="product"]').click();
  await page.locator('[data-kb-scope-domain="battery-domain"]').click();
  await page.locator('[data-kb-scope-base="battery"]').click();
  await page.locator('[data-kb-scope-family="growth"]').click();
  await expect(page.locator('[data-kb-scope-domain=""]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-kb-scope-base=""]')).toHaveAttribute("aria-pressed", "true");
  await page.locator('[data-kb-kind="mail_template"]').click();
  await expect(page.locator('[data-kb-kind="mail_template"]')).toHaveAttribute("aria-pressed", "true");
  const stages = page.locator('[data-kb-filter="stage"]');
  await stages.locator('[data-kb-filter-value="INITIAL_CONTACT"]').click();
  await stages.getByRole("button", { name: "移除阶段：初步接触", exact: true }).click();
  await expect(stages.locator('[data-kb-filter-value="INITIAL_CONTACT"]')).toHaveCount(0);
  await stages.getByRole("button", { name: "添加阶段", exact: true }).click();
  await stages.getByRole("group", { name: "可添加阶段" }).getByRole("button", { name: "初步接触", exact: true }).click();
  await expect(stages.locator('[data-kb-filter-value="INITIAL_CONTACT"]')).toHaveAttribute("aria-pressed", "true");
  await page.locator('[data-kb-stage="create"]').click();
  await expect(page.locator('[data-kb-kind="mail_template"]')).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => state.reads.some(url => url.searchParams.get("family_id") === "growth" && url.searchParams.get("kind") === "mail_template" && !url.searchParams.has("base_id"))).toBe(true);
  expect(state.writes).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("hidden stage deep links keep their path and accessible keyboard navigation", async ({ page }) => {
  await surface(page, "/admin/knowledge/bindings");
  await expect(page).toHaveURL(/\/admin\/knowledge\/bindings$/);
  await expect(page.locator('[data-knowledge-right]')).toHaveAttribute("data-kb-active-stage", "bindings");
  await expect(page.getByRole("tabpanel", { name: "查询技能" })).toBeVisible();
  await expect(page.locator('[data-kb-stage="bindings"]')).toHaveCount(0);
  const nav = page.locator('[data-kb-lifecycle-tabs]');
  await expect(nav.locator('[aria-selected="true"]')).toHaveCount(0);
  await expect(nav.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
  await page.reload();
  await expect(page).toHaveURL(/\/admin\/knowledge\/bindings$/);
  await nav.locator('[role="tab"][tabindex="0"]').focus();
  await page.keyboard.press("End");
  await expect(page.locator('[data-kb-stage="published"]')).toBeFocused();
  await expect(page.locator('[data-knowledge-right]')).toHaveAttribute("data-kb-active-stage", "published");
});
