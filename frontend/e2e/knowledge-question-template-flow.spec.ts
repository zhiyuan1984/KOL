import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * 知识库问题模板：管理端操作 → 用户端可见（真实链路，不 stub 问题模板接口）。
 *
 * 链路：管理端 /admin/knowledge/bases/:id 归档旧模板 / 新建草稿（kind=question_template，
 * tags 带 pool-question:<slot>）/ 条目页「审批发布」→ 用户端 /?tab=pool 四入口与 /kb。
 * 断言的是契约本身：
 *   1) 槽位没有已发布模板 → 入口禁用，title 提示「问题模板未在管理端知识库发布…」，不用写死问题兜底；
 *   2) 草稿未审批 → 用户端照旧看不到；
 *   3) 审批发布 → 用户端入口恢复，点击只预填「名单 + 模板正文」，不调用 /api/home/pool/jev-assess；
 *   4) 员工知识库 /kb「全部资料」能看到这条已发布的问题模板。
 *
 * 数据卫生：beforeEach 先 POST /api/demo/reset 复位种子（被归档的 kb_q_pool_score 会重新变回已发布），
 * 再归档/删除本套件上一次运行残留的「E2E 样例」知识；afterEach 归档本用例刚发布的条目并再次复位，
 * 避免影响其它套件（已发布知识只能归档不能硬删，这是既有规则）。
 */

const MISSING_COPY = "问题模板未在管理端知识库发布，该入口暂不可用。";
const SEED_ID = "kb_q_pool_score";
const E2E_TITLE = "E2E 样例 · 公海评分提问模板";
const E2E_BODY = "请按公开资料给这些 KOL 打潜力与风险两个分（0-100），说明口径、依据与置信度，并列出资料缺口。";

const POOL_ITEM = {
  id: "kpi_outdoor",
  company_id: "company:amperetime",
  kol_uid: "uid_outdoor",
  handle: "户外充电君",
  display_name: "户外充电君",
  platform: "youtube",
  homepage_url: "https://www.youtube.com/@outdoor",
  avatar_url: "https://yt3.ggpht.com/outdoor-avatar.jpg",
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
};

/** 公海名单只 stub 到固定夹具；问题模板一律读真实后端。 */
async function stubPool(page: Page) {
  await page.route("https://yt3.ggpht.com/**", (route) => route.fulfill({
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 56"><rect width="56" height="56" fill="#dbeafe"/></svg>',
  }));
  await page.route(/\/api\/home\/pool(?:\?.*)?$/, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      json: {
        entry: "memory",
        kind: "memory",
        creates_session: false,
        calls_model: false,
        index: "公海",
        items: [POOL_ITEM],
        kols: [POOL_ITEM],
      },
    });
  });
  // 用例只断言「点击不执行」；即使真被调用也不做外部写入。
  await page.route("**/api/home/pool/jev-assess", (route) => route.fulfill({
    status: 202,
    json: { status: "running", accepted: true },
  }));
}

/** 清掉上一次运行残留的 E2E 自建知识（草稿可硬删；已发布只能归档，仍会从用户面消失）。 */
async function cleanupE2eRows(request: APIRequestContext) {
  const rows = await request.get("/api/admin/knowledge")
    .then((response) => response.json() as Promise<Array<Record<string, unknown>>>);
  for (const row of rows || []) {
    if (!String(row.title || "").startsWith("E2E 样例")) continue;
    const id = String(row.id || "");
    const status = String(row.status || "");
    if (!id || status === "archived") continue;
    if (status === "draft") await request.delete(`/api/admin/knowledge/${id}`);
    else await request.post(`/api/admin/knowledge/${id}/archive`);
  }
}

/** 管理端 UI 新建草稿 → 用管理端列表反查 id（草稿此时对用户端不可见）。 */
async function createDraftViaAdmin(page: Page, request: APIRequestContext): Promise<string> {
  // 新建条目挂在结构化库下（种子存量统一迁入默认库 kbase_legacy）。
  await page.goto("/admin/knowledge/bases/kbase_legacy");
  await expect(page.locator("[data-admin-kb-view='base']")).toBeVisible();
  await page.locator("[data-admin-kb-create-entry]").click();
  const form = page.locator("[data-admin-kb-create]");
  await expect(form).toBeVisible();
  await form.locator("input[name='title']").fill(E2E_TITLE);
  await form.locator("select[name='kind']").selectOption("question_template");
  await form.locator("input[name='tags']").fill("pool-question:score");
  // question_template 的必填结构化字段按 kind 字段表渲染。
  await form.locator("[name='structured:question']").fill("请分析这些 KOL 的公开资料。");
  await form.locator("[name='structured:answer']").fill("按潜力与风险给出评分、依据与资料缺口。");
  await form.locator("textarea[name='body']").fill(E2E_BODY);
  await form.locator("[data-admin-kb-create-submit]").click();
  await expect(page.locator("[data-admin-receipt]")).toContainText("草稿已创建");

  const rows = await request.get("/api/admin/knowledge")
    .then((response) => response.json() as Promise<Array<Record<string, unknown>>>);
  const hits = (rows || []).filter((row) => String(row.title) === E2E_TITLE && String(row.status) !== "archived");
  expect(hits.length, "管理端列表应恰好出现一条本次新建的草稿").toBe(1);
  expect(String(hits[0].status)).toBe("draft");
  return String(hits[0].id);
}

/** 管理端详情页「审批发布」（L3 确认框）。 */
async function approveViaAdmin(page: Page, id: string) {
  await page.goto(`/admin/knowledge/entries/${id}`);
  await expect(page.locator("[data-admin-kb-view='entry']")).toBeVisible();
  await page.locator("[data-admin-kb-approve]").click();
  await expect(page.locator("[data-admin-confirm='knowledge-publish']")).toBeVisible();
  await page.locator("[data-admin-confirm-ok]").click();
  await expect(page.locator("[data-admin-receipt]")).toContainText("已审批发布");
}

/** 让 score 槽位只剩「本次要发布的那一条」，避免同槽位多条已发布模板互相覆盖。 */
async function archiveSeedScore(request: APIRequestContext) {
  const response = await request.post(`/api/admin/knowledge/${SEED_ID}/archive`);
  expect(response.ok(), `归档种子 ${SEED_ID} 失败：${response.status()}`).toBeTruthy();
}

test.beforeEach(async ({ page, request }) => {
  await request.post("/api/demo/reset", { data: { workbench: true } });
  await request.post("/api/me/persona", { data: { persona: "sriphy" } });
  await cleanupE2eRows(request);
  await stubPool(page);
});

test.afterEach(async ({ request }) => {
  // 先归档本用例刚发布的知识，再复位种子（被归档的 kb_q_pool_score 变回已发布），保持套件可重复运行。
  await cleanupE2eRows(request).catch(() => undefined);
  await request.post("/api/demo/reset", { data: { workbench: true } }).catch(() => undefined);
});

test("归档槽位模板后，公海入口禁用并如实提示", async ({ page }) => {
  await page.goto("/admin/knowledge/bases/kbase_legacy");
  await expect(page.locator("[data-admin-kb-view='base']")).toBeVisible();
  await page.locator("[data-admin-kb-filter='kind']").selectOption("question_template");
  const seedRow = page.locator(`[data-admin-knowledge-id='${SEED_ID}']`);
  await expect(seedRow).toBeVisible();
  await seedRow.locator(`[data-kb-archive='${SEED_ID}']`).click();
  await expect(page.locator("[data-admin-confirm='knowledge-archive']")).toBeVisible();
  await page.locator("[data-admin-confirm-ok]").click();
  await expect(page.locator("[data-admin-receipt]")).toContainText("已归档");

  await page.goto("/?tab=pool");
  await expect(page.locator('[data-home-pane="pool"]')).toBeVisible();
  const scoreEntry = page.locator("[data-pool-jev-assess]");
  await expect(scoreEntry).toBeDisabled();
  await expect(scoreEntry).toHaveAttribute("title", MISSING_COPY);
  // 归档只影响被归档的槽位：risk 仍可用（未选 KOL 时提示选择，而不是「未发布」）。
  const riskEntry = page.locator("[data-pool-analysis='risk']");
  await expect(riskEntry).toBeVisible();
  await expect(riskEntry).not.toHaveAttribute("title", MISSING_COPY);
});

test("草稿未审批用户端不可见；发布后入口恢复并预填模板正文，点击不执行", async ({ page, request }) => {
  const jevPosts: string[] = [];
  page.on("request", (item) => {
    if (item.method() === "POST" && new URL(item.url()).pathname === "/api/home/pool/jev-assess") {
      jevPosts.push(new URL(item.url()).pathname);
    }
  });

  await archiveSeedScore(request);
  const id = await createDraftViaAdmin(page, request);

  // 草稿还没审批：用户端该入口照旧禁用。
  await page.goto("/?tab=pool");
  const scoreEntry = page.locator("[data-pool-jev-assess]");
  await expect(scoreEntry).toBeDisabled();
  await expect(scoreEntry).toHaveAttribute("title", MISSING_COPY);

  await approveViaAdmin(page, id);

  await page.goto("/?tab=pool");
  await expect(scoreEntry).toBeEnabled();
  await page.locator("[data-pool-kol='uid_outdoor'] [data-pool-select]").check();
  await scoreEntry.click();

  const input = page.locator("[data-home] [data-composer-input]");
  await expect(input).toHaveValue(/户外充电君/);
  await expect(input).toHaveValue(/打潜力与风险两个分/);
  await expect(input).toHaveValue(/资料缺口/);
  await expect(page.locator("[data-pool-score-confirm]")).toBeVisible();
  expect(jevPosts, "点击只预填草稿，不得直接调用评分接口").toEqual([]);
});

test("员工知识库能看到这条已发布的问题模板", async ({ page, request }) => {
  await archiveSeedScore(request);
  const id = await createDraftViaAdmin(page, request);
  await approveViaAdmin(page, id);

  await page.goto("/kb");
  const kb = page.locator("[data-kb-page='mine']");
  const row = kb.locator(`[data-knowledge='${id}']`);
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute("data-kind", "question_template");
  await expect(row).toContainText("问题模板");
  await expect(row).toContainText(E2E_TITLE);
});
