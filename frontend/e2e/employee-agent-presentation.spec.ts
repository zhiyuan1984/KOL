import { expect, test, type Page } from "@playwright/test";
import { assertFullRowLayout } from "./fixtures/knowledge-fullrow-layout";

// HTTP fixtures verify the UI contract, not real Codex or external actions.
async function surface(page: Page, options: { failure?: boolean; browseFailure?: boolean; browseMissingIdentity?: boolean; preferenceFailure?: boolean; summonFailure?: boolean; recentSession?: boolean; long?: boolean } = {}) {
  const writes: string[] = [], errors: string[] = [];
  const account = { id: "employee-agent-fixture", name: "员工", available_modes: ["employee"] };
  const rows = [
    { id: "expert:kol", display_name: "KOL推广", kind: "business", primary_entry: "think", mission: "理解往来邮件并给出跟进建议", tags: ["合作", "邮件"], quick_prompts: ["分析这封邮件", "准备建联草稿", "查合作资料", "帮我核对下一步的工作"], how_to_start: "提供合作对象与工作目标" },
    { id: "expert:crawler", display_name: "海外平台采集", kind: "collector", primary_entry: "job_console", mission: "按目标采集并展示候选", quick_prompts: [] },
    { id: "expert:approver", display_name: "审批协作", kind: "governance", primary_entry: "approval_queue", mission: "展示待人决定的审批", quick_prompts: [] },
    ...Array.from({ length: 9 }, (_, i) => ({ id: `agent_fixture_${i}`, display_name: `产品专家 ${i + 1}`, kind: "business", primary_entry: "think", mission: i === 0 && options.long ? "复杂岗位职责".repeat(200) : "查询产品规格与使用方法", quick_prompts: ["查询规格"] })),
  ].map(row => ({ version: "2", status: "published", profession: row.display_name, description: "根据当前工作目标整理信息、准备可编辑草稿", good_at: ["资料查询", "起草"],
    can_finish: ["理解往来邮件", "准备沟通草稿", "查询已发布资料", "核对后续工作"], skill_ids: ["fixture_skill"], tool_ids: [], ...row }));
  const taxonomy = {
    domains: [{ id: "growth", name: "品牌与用户增长中心", level: "family", parent_id: null }, { id: "promotion", name: "推广", level: "domain", parent_id: "growth" },
      { id: "products", name: "产品中心", level: "family", parent_id: null }, { id: "product-domain", name: "产品咨询", level: "domain", parent_id: "products" },
      { id: "empty-family", name: "待归类业务", level: "family", parent_id: null }],
    bases: [{ id: "coop", name: "KOL合作", domain_id: "promotion" }, { id: "product-base", name: "产品资料", domain_id: "product-domain" }],
  };
  const browseRows = rows.map((row, i) => ({ expert_id: row.id, published_by: "组织发布", updated_at: "2026-10-13T00:00:00Z",
    scopes: [{ family_id: i < 3 ? "growth" : "products", domain_id: i < 3 ? "promotion" : "product-domain", base_id: i < 3 ? "coop" : "product-base",
      brand: i % 2 ? "RO" : "LT", stage_codes: [i % 2 ? "INTERESTED" : "INITIAL_CONTACT"] }] }))
    .filter(row => !options.browseMissingIdentity || row.expert_id !== "agent_fixture_8");
  const preferences = new Map<string, { expert_id: string; favorite: boolean; viewed_at: string | null }>();
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", async route => {
    const req = route.request(), url = new URL(req.url()), path = decodeURIComponent(url.pathname);
    if (req.method() !== "GET") writes.push(`${req.method()} ${path}`);
    let json: unknown = [];
    if (path === "/api/health") json = { runtime_mode: "legacy" };
    else if (path === "/api/auth/status") json = { authenticated: true, account };
    else if (path === "/api/me") json = account;
    else if (path === "/api/preferences") json = { theme: "light" };
    else if (path === "/api/cron/jobs") json = { jobs: [] };
    else if (path === "/api/queries/runtime.actions") json = { actions: [] };
    else if (/\/api\/tasks\/by-session\//.test(path)) return route.fulfill({ status: 404, json: { message: "普通会话尚无正式任务" } });
    else if (path === "/api/experts") {
      if (options.failure) return route.fulfill({ status: 503, json: { message: "目录服务暂不可用" } });
      json = rows;
    } else if (path === "/api/experts/browse") {
      if (options.browseFailure) return route.fulfill({ status: 503, json: { message: "分类范围暂不可用" } });
      json = { rows: browseRows, taxonomy };
    } else if (path === "/api/experts/preferences") {
      if (options.preferenceFailure) return route.fulfill({ status: 503, json: { message: "个人偏好暂不可用" } });
      json = [...preferences.values()];
    } else if (/\/api\/experts\/[^/]+\/preference$/.test(path)) {
      const id = path.split("/")[3], body = req.postDataJSON();
      if (options.preferenceFailure) return route.fulfill({ status: 503, json: { message: "收藏保存失败" } });
      const previous = preferences.get(id) || { expert_id: id, favorite: false, viewed_at: null };
      json = { ...previous, ...(typeof body.favorite === "boolean" ? { favorite: body.favorite } : {}), ...(body.viewed ? { viewed_at: new Date().toISOString() } : {}) };
      preferences.set(id, json as typeof previous);
    } else if (/\/api\/experts\/[^/]+\/workspace$/.test(path)) {
      const product = path.includes("agent_fixture_");
      json = { skills: [{ id: "fixture_skill", name: product ? "产品资料查询" : "合作资料查询", summary: "检索已发布资料并返回来源" }],
        knowledge: [{ skill_id: "fixture_skill", skill_name: product ? "产品资料查询" : "合作资料查询",
          bases: [{ id: "base", name: product ? "产品知识" : "KOL合作", document_count: 2, summaries: [product ? "电池规格与安装条件" : "沟通要求与合作准备"] }] }],
        recent_session: options.recentSession ? { id: "ses_existing", title: "已有工作", updated_at: "2026-10-13T00:00:00Z" } : null };
    } else if (/\/api\/experts\/[^/]+\/(summon|resume)$/.test(path)) {
      if (options.summonFailure) return route.fulfill({ status: 404, json: { message: "当前 Agent 使用资格已变化" } });
      await new Promise(resolve => setTimeout(resolve, 150));
      json = { session_id: path.endsWith("/resume") ? "ses_existing" : "ses_created", expert_id: path.split("/")[3], expert_version: "2", intro: "工作说明" };
    } else if (/\/api\/experts\/[^/]+$/.test(path)) {
      const row = rows.find(row => row.id === path.split("/")[3]);
      if (!row) return route.fulfill({ status: 404, json: { message: "Agent 未发布或当前账号没有使用资格" } });
      json = row;
    } else if (path === "/api/home/discovery/requests") json = { requests: [] };
    else if (/\/api\/sessions\/[^/]+$/.test(path)) json = { messages: [], agent_status: "listening", expert_id: "expert:kol", expert_version: "2" };
    else if (/\/api\/sessions\/[^/]+\/task-context$/.test(path)) return route.fulfill({ status: 404, json: { code: "task_context_not_found" } });
    else if (/\/api\/tasks\/[^/]+$/.test(path)) return route.fulfill({ status: 404, json: { code: "task_not_found" } });
    else if (path === "/api/agent-manifest") json = { id: "agent:kol", name: "KOL推广", skills: [], experts: [], quick_prompts: [] };
    else if (path === "/api/knowledge/taxonomy") json = taxonomy;
    else if (path === "/api/knowledge") json = [{ id: "kb-fixture", title: "合作知识", body: "资料原文", kind: "document", status: "published", current_version: 1, favorite: false,
      family_id: "growth", domain_id: "promotion", base_id: "coop", brand: "LT", stage_codes: ["INITIAL_CONTACT"], created_by: "system", updated_at: "2026-10-13T00:00:00Z" }];
    await route.fulfill({ json });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/agents");
  await expect(page.locator("[data-agent-list]")).toBeVisible();
  return { writes, errors, rows, options, browseRows };
}

test("knowledge geometry, initial detail and selection reuse the same compact components", async ({ page }) => {
  const state = await surface(page);
  const detail = page.locator("[data-agent-detail]");
  await expect(detail).toContainText("从列表选择一位 Agent");
  const before = await detail.boundingBox();
  await page.locator('[data-expert-open="expert:kol"]').click();
  await expect(page.locator('[data-agent-preview="expert:kol"]')).toBeVisible();
  const after = await detail.boundingBox();
  expect(after!.x).toBe(before!.x); expect(after!.width).toBe(before!.width);
  expect(after!.width).toBeGreaterThanOrEqual(360);
  expect((await page.locator('[data-agent-row="expert:kol"]').boundingBox())!.height).toBe(36);
  expect((await page.locator(".knowledge-filter-bar .workspace-search-input").boundingBox())!.height).toBe(32);
  expect((await page.locator('[data-agent-favorite="expert:kol"]').boundingBox())!.height).toBe(32);
  expect((await page.locator('[data-expert-primary="expert:kol"]').boundingBox())!.height).toBe(28);
  await expect(detail.locator("h2")).toHaveCSS("font-size", "13px");
  const filterLabels = await page.locator(".knowledge-filter-row > .kbv-scope-name").allTextContents();
  expect(filterLabels).toEqual(["业务族", "业务域", "知识库", "适用品牌", "适用阶段", "类型"]);
  const propertyLabels = await detail.locator(".knowledge-detail-properties dt").allTextContents();
  expect(propertyLabels).toEqual(["状态", "发布人", "版本", "更新时间", "适用"]);
  for (const selector of [".knowledge-detail-header", ".kbv-rail-body", ".knowledge-detail-actions"]) {
    await expect(detail.locator(selector)).toHaveCSS("padding-left", "24px");
    await expect(detail.locator(selector)).toHaveCSS("padding-right", "24px");
  }
  const provenanceBox = await detail.locator(".knowledge-detail-properties").boundingBox();
  const propertyStyles = await detail.locator(".knowledge-detail-properties .ui-property-row").first().evaluate(node => ({
    columns: getComputedStyle(node).gridTemplateColumns, minHeight: getComputedStyle(node).minHeight, gap: getComputedStyle(node).columnGap,
  }));
  await expect(page.locator('[data-expert-prompt="expert:kol"]')).toHaveCount(4);
  await expect(detail).toContainText("核对后续工作");
  await page.locator("[data-agent-background] summary").click();
  await expect(detail).toContainText("提供合作对象与工作目标");
  await page.locator("[data-agent-background] summary").click();
  await page.locator("[data-agent-knowledge] summary").click();
  await expect(detail).toContainText("沟通要求与合作准备");
  await page.locator("[data-agent-knowledge] summary").click();
  expect(state.writes.every(write => write.endsWith("/preference"))).toBe(true);
  const measurements = { row: (await page.locator("[data-agent-row]").first().boundingBox())!.height, search: (await page.locator(".workspace-search-input").boundingBox())!.height };
  await page.screenshot({ path: "test-results/employee-agent-desktop.png", fullPage: true });
  await page.goto("/kb");
  await expect(page.locator("[data-kb-row]")).toBeVisible();
  expect((await page.locator("[data-kb-row]").first().boundingBox())!.height).toBe(measurements.row);
  expect((await page.locator(".workspace-search-input").boundingBox())!.height).toBe(measurements.search);
  expect(await page.locator(".knowledge-filter-row > .kbv-scope-name").allTextContents()).toEqual(filterLabels);
  await page.locator('[data-kb-open="kb-fixture"]').click();
  expect(await page.locator(".knowledge-detail-properties dt").allTextContents()).toEqual(propertyLabels);
  expect((await page.locator(".knowledge-detail-properties").boundingBox())!.x).toBe(provenanceBox!.x);
  expect(await page.locator(".knowledge-detail-properties .ui-property-row").first().evaluate(node => ({
    columns: getComputedStyle(node).gridTemplateColumns, minHeight: getComputedStyle(node).minHeight, gap: getComputedStyle(node).columnGap,
  }))).toEqual(propertyStyles);
  await page.screenshot({ path: "test-results/employee-knowledge-comparison.png", fullPage: true });
  await page.setViewportSize({ width: 1210, height: 664 });
  await page.locator(".knowledge-browse").screenshot({ path: "test-results/employee-knowledge-reference-layout.png" });
  await page.goto("/agents?agent=expert%3Akol");
  await expect(page.locator("[data-agent-scope]")).toContainText("初步接触");
  await expect(page.locator("[data-agent-draft]")).toBeVisible();
  await page.locator(".agent-browser").screenshot({ path: "test-results/employee-agent-reference-layout.png" });
  expect(state.errors).toEqual([]);
});

test("classification, brands and stages use conditional distinct Agent counts and restore after reload", async ({ page }) => {
  const state = await surface(page);
  await expect(page.locator('[data-kb-scope-family="empty-family"]')).toHaveCount(0);
  await page.locator("[data-kbv-empty-taxonomy]").click();
  await expect(page.locator('[data-kb-scope-family="empty-family"]')).toBeVisible();
  await page.locator('[data-kb-scope-family="growth"]').click();
  await expect(page.locator("[data-agent-count]")).toHaveText("3 位 Agent");
  await page.locator('[data-kb-scope-domain="promotion"]').click();
  await page.locator('[data-kb-scope-base="coop"]').click();
  await page.locator('[data-kb-filter="brand"] [data-kb-filter-value="LT"]').click();
  await expect(page.locator("[data-agent-count]")).toHaveText("2 位 Agent");
  await page.locator('[data-kb-filter="stage"] [data-kb-filter-value="INTERESTED"]').click();
  await expect(page.locator("[data-expert-empty]")).toContainText("没有符合条件");
  await expect(page.locator('[data-kb-scope-family="growth"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-kb-filter="brand"] [data-kb-filter-value="RO"] .knowledge-filter-count')).toHaveText("1");
  await page.reload();
  await expect(page.locator('[data-kb-filter="stage"] [data-kb-filter-value="INTERESTED"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-kb-filter="brand"] [data-kb-filter-value="LT"]')).toHaveAttribute("aria-pressed", "true");
  await page.locator('[data-kb-filter="brand"] [data-kb-filter-value="RO"]').click();
  await expect(page.locator("[data-agent-count]")).toHaveText("1 位 Agent");
  await page.locator("[data-kbv-empty-taxonomy]").click();
  await page.locator('[data-kb-scope-family="products"]').click();
  expect(new URL(page.url()).searchParams.has("domain")).toBe(false);
  expect(new URL(page.url()).searchParams.has("base")).toBe(false);
  await page.locator("[data-agent-clear]").click();
  await expect(page.locator("[data-agent-count]")).toHaveText("12 位 Agent");
  const layout = await assertFullRowLayout(page.locator(".knowledge-filter-bar"));
  expect(layout.rowCount).toBe(6);
  expect(layout.continuationLines).toBeGreaterThan(0);
  expect(state.writes.filter(write => /summon|messages|\/sessions$/.test(write))).toEqual([]);
});

test("scope read failure does not fabricate facet counts or empty applicability", async ({ page }) => {
  const state = await surface(page, { browseFailure: true });
  await expect(page.locator("[data-agent-list]")).toContainText("分类范围暂不可用");
  await expect(page.locator(".knowledge-filter-bar .knowledge-filter-count")).toHaveCount(0);
  await page.locator('[data-expert-open="expert:kol"]').click();
  await expect(page.locator("[data-agent-scope]")).toHaveCount(0);
  await expect(page.locator("[data-agent-detail]")).toContainText("范围暂不可用");
  state.options.browseFailure = false;
  await page.locator("[data-agent-browse-retry]").click();
  await expect(page.locator("[data-agent-count]")).toHaveText("12 位 Agent");
  expect(state.errors).toEqual([]);
});

test("an authorized roster row remains visible when its optional applicability projection is absent", async ({ page }) => {
  const state = await surface(page, { browseMissingIdentity: true });
  await page.locator("[data-kb-load-more]").click();
  await page.locator("[data-kb-load-more]").click();
  await expect(page.locator('[data-expert-open="agent_fixture_8"]')).toBeVisible();
  await page.locator('[data-expert-open="agent_fixture_8"]').click();
  await expect(page.locator("[data-agent-detail]")).toContainText("适用范围暂未返回，无法确认");
  await expect(page.locator("[data-agent-scope]")).toHaveCount(0);
  await expect(page.locator('[data-kb-scope-family="__none__"]')).toHaveCount(0);
  expect(state.errors).toEqual([]);
});

test("search, type, favorites and recent views have same-source counts and persist", async ({ page }) => {
  const state = await surface(page);
  await page.locator('[data-expert-open="expert:kol"]').click();
  await page.locator('[data-agent-favorite="expert:kol"]').click();
  await expect(page.locator('[data-agent-favorite="expert:kol"]')).toHaveAttribute("aria-pressed", "true");
  await page.locator('[data-agent-view="favorites"]').click();
  await expect(page.locator("[data-agent-count]")).toHaveText("1 位 Agent");
  await page.locator('[data-expert-open="expert:kol"]').click();
  await page.reload();
  await expect(page.locator('[data-agent-favorite="expert:kol"]')).toHaveAttribute("aria-pressed", "true");
  await page.locator('[data-agent-view="recent"]').click();
  await expect(page.locator("[data-agent-count]")).toHaveText("1 位 Agent");
  await page.locator('[data-agent-kind="collector"]').click();
  await expect(page.locator("[data-expert-empty]")).toContainText("没有符合条件");
  await expect(page.locator('[data-agent-kind="collector"]')).toHaveAttribute("aria-pressed", "true");
  await page.locator("[data-agent-clear]").click();
  await page.locator("[data-agent-search]").fill("产品规格");
  await expect(page.locator("[data-agent-count]")).toHaveText("9 位 Agent");
  expect(state.errors).toEqual([]);
});

test("examples only prefill; switching and reloading preserve unsent drafts; startup is single submission", async ({ page }) => {
  const state = await surface(page);
  await page.locator('[data-expert-open="expert:kol"]').click();
  await page.locator('[data-expert-prompt="expert:kol"]').first().click();
  await expect(page.locator("[data-agent-draft]")).toHaveValue("分析这封邮件");
  await page.locator("[data-agent-draft]").fill("保留我编辑的工作目标");
  await page.locator('[data-expert-open="expert:crawler"]').click();
  await page.locator('[data-expert-open="expert:kol"]').click();
  await expect(page.locator("[data-agent-draft]")).toHaveValue("保留我编辑的工作目标");
  await page.reload();
  await expect(page.locator("[data-agent-draft]")).toHaveValue("保留我编辑的工作目标");
  expect(state.writes.filter(write => /summon|messages|\/sessions$/.test(write))).toEqual([]);
  await page.locator('[data-expert-primary="expert:kol"]').dblclick();
  await expect(page).toHaveURL(/\/s\/ses_created$/);
  expect(state.writes.filter(write => write.endsWith("/summon"))).toHaveLength(1);
  expect(state.writes.filter(write => /messages|\/sessions$/.test(write))).toEqual([]);
});

test("an unavailable Agent never falls back to an unbound session and retains the draft", async ({ page }) => {
  const state = await surface(page, { summonFailure: true });
  await page.locator('[data-expert-open="expert:kol"]').click();
  await page.locator("[data-agent-draft]").fill("失败后保留");
  await page.locator('[data-expert-primary="expert:kol"]').click();
  await expect(page.getByRole("alert")).toContainText("使用资格已变化");
  await expect(page).toHaveURL(/\/agents\?/);
  await expect(page.locator("[data-agent-draft]")).toHaveValue("失败后保留");
  expect(state.writes.filter(write => write === "POST /api/sessions")).toEqual([]);
});

test("a failed favorite save stays unselected and can be retried", async ({ page }) => {
  const state = await surface(page);
  await page.locator('[data-expert-open="expert:kol"]').click();
  state.options.preferenceFailure = true;
  await page.locator('[data-agent-favorite="expert:kol"]').click();
  await expect(page.locator('[data-agent-favorite="expert:kol"]')).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("[data-agent-detail]")).toContainText("收藏保存失败");
  state.options.preferenceFailure = false;
  await page.locator('[data-agent-favorite="expert:kol"]').click();
  await expect(page.locator('[data-agent-favorite="expert:kol"]')).toHaveAttribute("aria-pressed", "true");
});

test("existing work continues the same session without creating another session", async ({ page }) => {
  const state = await surface(page, { recentSession: true });
  await page.locator('[data-expert-open="expert:kol"]').click();
  await page.locator("[data-agent-resume]").click();
  await expect(page).toHaveURL(/\/s\/ses_existing$/);
  expect(state.writes.filter(write => write.endsWith("/resume"))).toHaveLength(1);
  expect(state.writes.filter(write => /summon|\/sessions$/.test(write))).toEqual([]);
});

test("opening the directory from a session preserves its address and unsent composer", async ({ page }) => {
  const state = await surface(page);
  await page.goto("/s/ses_existing");
  const composer = page.locator('[data-ai-prompt-input] textarea').first();
  await expect(composer).toBeVisible();
  await composer.fill("原任务中尚未提交的草稿");
  await page.locator('[data-nav="agents"]').click();
  await expect(page).toHaveURL(/\/agents\?from_session=ses_existing/);
  await page.locator('[data-expert-open="expert:kol"]').click();
  await page.locator("[data-agent-return-source]").click();
  await expect(page).toHaveURL(/\/s\/ses_existing$/);
  await expect(composer).toHaveValue("原任务中尚未提交的草稿");
  expect(state.writes.filter(write => /summon|messages|\/sessions$/.test(write))).toEqual([]);
});

test("crawler and approval deep links keep their original address and real consoles", async ({ page }) => {
  const state = await surface(page);
  for (const id of ["crawler", "approver"]) {
    await page.goto(`/agents/${id}`);
    await expect(page).toHaveURL(new RegExp(`/agents/${id}$`));
    await expect(page.locator(`[data-expert-page="${id}"]`)).toBeVisible();
    if (id === "crawler") await expect(page.locator("[data-crawl-console]")).toBeVisible();
    else await expect(page.locator('[data-approval-queue="embedded"]')).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`/agents/${id}$`));
    await expect(page.locator(`[data-expert-page="${id}"]`)).toBeVisible();
  }
  expect(state.writes.filter(write => /summon|\/sessions$/.test(write))).toEqual([]);
});

test("container, short viewport, scroll and keyboard keep actions and return reachable", async ({ page }) => {
  const state = await surface(page, { long: true });
  await page.locator("[data-kb-load-more]").click();
  await page.locator("[data-kb-load-more]").click();
  await page.locator(".agent-browser").evaluate(node => { (node as HTMLElement).style.width = "600px"; });
  await expect(page.locator("[data-agent-detail]")).toBeHidden();
  await page.locator("[data-agent-list]").evaluate(node => { node.scrollTop = 70; });
  const scroll = await page.locator("[data-agent-list]").evaluate(node => node.scrollTop);
  await page.locator('[data-expert-open="agent_fixture_0"]').focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-agent-list]")).toBeHidden();
  await expect(page.locator("#agent-preview-title")).toBeFocused();
  await page.getByRole("button", { name: "← 返回列表" }).click();
  await expect(page.locator('[data-expert-open="agent_fixture_0"]')).toBeFocused();
  expect(await page.locator("[data-agent-list]").evaluate(node => node.scrollTop)).toBe(scroll);
  await page.locator('[data-expert-open="agent_fixture_0"]').click();
  await page.setViewportSize({ width: 1024, height: 589 });
  await expect(page.locator('[data-expert-primary="agent_fixture_0"]')).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/employee-agent-compact.png", fullPage: true });
  expect(state.errors).toEqual([]);
});

test("read failure is not an empty directory; preference failure has explicit recovery", async ({ page }) => {
  const state = await surface(page, { failure: true, preferenceFailure: true });
  await expect(page.locator("[data-agent-list]").getByRole("alert")).toHaveCount(2);
  await expect(page.locator("[data-expert-empty]")).toHaveCount(0);
  await expect(page.locator("[data-agent-detail]")).toBeVisible();
  await expect(page.locator('[data-agent-view="favorites"]')).toBeDisabled();
  state.options.failure = false; state.options.preferenceFailure = false;
  await page.locator("[data-agent-retry]").click();
  await page.getByRole("button", { name: "重试个人偏好" }).click();
  await expect(page.locator("[data-agent-row]")).toHaveCount(5);
  await expect(page.locator('[data-agent-view="favorites"]')).toBeEnabled();
});
