import { expect, test, type Page } from "@playwright/test";

type Deferred = { promise: Promise<void>; resolve: () => void };
function deferred(): Deferred {
  let resolve!: () => void;
  return { promise: new Promise<void>((done) => { resolve = done; }), resolve };
}

const citation = { document: "规格书.pdf", title: "规格书", page: 3, document_id: "doc-a", engine_doc_id: "engine-a" };
const fullAnswer = `${"A".repeat(2000)}尾部实体`;

async function surface(page: Page) {
  const account = { id: "admin", name: "管理员", available_modes: ["admin", "employee"] };
  const bases = [
    { id: "legacy", code: "legacy", name: "历史知识", kind: "structured", status: "active" },
    { id: "specs", name: "产品规格", kind: "unstructured", status: "active", family_id: "ipd", family_name: "IPD", domain_id: "battery", domain_name: "电池" },
  ];
  const domains = [{ id: "ipd", name: "IPD", level: "family" }, { id: "battery", name: "电池", level: "domain", parent_id: "ipd" }];
  const documents = [
    { id: "doc-a", base_id: "specs", title: "产品 A 规格", filename: "a.pdf", media_type: "pdf", size_bytes: 1000, status: "published", updated_at: "2026-10-06T01:00:00Z" },
    { id: "doc-b", base_id: "specs", title: "产品 B 规格", filename: "b.pdf", media_type: "pdf", size_bytes: 1000, status: "published", updated_at: "2026-10-06T01:00:00Z" },
    { id: "doc-pending", base_id: "specs", title: "待审规格", filename: "pending.pdf", media_type: "pdf", size_bytes: 1000, status: "pending_review", updated_at: "2026-10-06T01:00:00Z" },
  ];
  const searchCalls: any[] = [];
  const maintenanceCalls: any[] = [];
  const errors: string[] = [];
  const slowSearch = deferred();
  const slowMaintenance = deferred();

  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    let json: any = [];
    if (path === "/api/auth/status") json = { authenticated: true, account };
    else if (path === "/api/me") json = account;
    else if (path === "/api/preferences") json = { theme: "light" };
    else if (path === "/api/health") json = { ok: true };
    else if (path === "/api/cron/jobs") json = { jobs: [] };
    else if (path === "/api/admin/knowledge/bases") json = { bases };
    else if (path === "/api/admin/knowledge/domains") json = { domains };
    else if (path === "/api/admin/knowledge/workspace-v1") {
      json = { tenant: "company", bases, domains, rows: documents.map((doc) => ({ ...doc, kind: "document", asset_type: "document" })) };
    } else if (path === "/api/admin/knowledge/documents" && method === "GET") {
      json = { documents };
    } else if (path === "/api/admin/knowledge/search" && method === "POST") {
      const body = route.request().postDataJSON();
      searchCalls.push(body);
      if (body.query === "失败问题") return route.fulfill({ status: 503, json: { detail: { message: "检索暂不可用" } } });
      if (body.query === "检索撤权") return route.fulfill({ status: 403, json: { detail: { message: "管理员权限已失效" } } });
      if (body.query === "慢搜索") await slowSearch.promise;
      json = {
        answer: body.query === "第一问" ? fullAnswer : `${body.query} 的回答。`,
        citations: [citation],
        rewrite: body.query === "第一问"
          ? { status: "applied", original_query: body.query, effective_query: "产品 A 支持什么？", resolved_entities: ["不得冒充实体"], reason: "指代消解" }
          : { status: "unchanged", original_query: body.query, effective_query: body.query, resolved_entities: [], reason: "无需改写" },
      };
    } else if (path === "/api/admin/knowledge/qa-context" && method === "POST") {
      const body = route.request().postDataJSON();
      maintenanceCalls.push(body);
      if (body.turn.query === "维护撤权") return route.fulfill({ status: 403, json: { detail: { message: "管理员权限已失效" } } });
      if (body.turn.query === "维护失败") return route.fulfill({ status: 503, json: { detail: { message: "维护不可用" } } });
      if (body.turn.query === "慢维护") await slowMaintenance.promise;
      json = {
        entities: body.turn.query === "第一问" ? ["尾部实体"] : ["维护实体"],
        history_summary: body.compress ? body.history_summary.slice(-1500) : body.history_summary,
        status: "ready",
        compressed: Boolean(body.compress),
        summary_truncated: false,
      };
    }
    await route.fulfill({ json });
  });

  await page.goto("/admin/knowledge/bases/specs?reviewCompany=company");
  await expect(page.locator("[data-admin-kb-trial]")).toBeVisible({ timeout: 15_000 });
  return {
    searchCalls,
    maintenanceCalls,
    errors,
    releaseSlowSearch: () => slowSearch.resolve(),
    releaseSlowMaintenance: () => slowMaintenance.resolve(),
  };
}

async function ask(page: Page, question: string) {
  await page.locator("[data-admin-kb-trial-question]").fill(question);
  await page.locator("[data-admin-kb-trial-run]").click();
}

async function waitForMaintenance(page: Page) {
  await expect(page.locator("[data-admin-kb-trial-context]")).toContainText("已保留", { timeout: 15_000 });
  await expect(page.locator("[data-admin-kb-trial-run]")).toBeEnabled({ timeout: 15_000 });
}

test("单实体两轮携带临时 context，维护传完整回答且保留引用和次级清空动作", async ({ page }) => {
  const s = await surface(page);
  await ask(page, "第一问");
  await expect(page.locator("[data-admin-kb-trial-answer]")).toHaveText(fullAnswer);
  await expect(page.locator("[data-admin-kb-trial-effective-query]")).toHaveText("实际检索问题：产品 A 支持什么？");
  await expect(page.locator("[data-admin-kb-trial-citation]")).toHaveCount(1);
  await expect(page.locator("[data-admin-kb-trial-clear]")).toHaveText("清空上下文");
  await waitForMaintenance(page);

  expect(s.searchCalls[0].context).toMatchObject({ version: "knowledge-qa-context.v1", last_turn: null, history_summary: "" });
  expect(s.maintenanceCalls[0].turn.answer).toBe(fullAnswer);
  expect(s.maintenanceCalls[0].turn.entities).toEqual([]);
  expect(s.maintenanceCalls[0].turn.citations).toEqual([citation]);

  await ask(page, "第二问");
  await waitForMaintenance(page);
  expect(s.searchCalls[1].context.last_turn.answer).toHaveLength(2000);
  expect(s.searchCalls[1].context.last_turn.entities).toEqual(["尾部实体"]);
  expect(s.searchCalls[1].context.last_turn.citations).toEqual([citation]);
  expect(s.searchCalls[1].context.history_summary).toBe("");
  expect(s.errors).toEqual([]);
});

test("切换范围、清空和刷新都会建立新临时会话", async ({ page }) => {
  const s = await surface(page);
  await ask(page, "范围前");
  await waitForMaintenance(page);

  await page.locator("[data-admin-kb-trial-scope]").selectOption("doc-b");
  await ask(page, "范围后");
  await waitForMaintenance(page);
  expect(s.searchCalls.at(-1)).toMatchObject({ doc_ids: ["doc-b"], context: { last_turn: null, history_summary: "" } });

  await page.locator("[data-admin-kb-trial-clear]").click();
  await ask(page, "清空后");
  await waitForMaintenance(page);
  expect(s.searchCalls.at(-1).context).toMatchObject({ last_turn: null, history_summary: "" });

  await page.reload();
  await expect(page.locator("[data-admin-kb-trial]")).toBeVisible();
  await ask(page, "刷新后");
  await waitForMaintenance(page);
  expect(s.searchCalls.at(-1).context).toMatchObject({ last_turn: null, history_summary: "" });
  expect(s.errors).toEqual([]);
});

test("迟到 search 与 maintenance 不污染新 scope 或清空后的会话", async ({ page }) => {
  const s = await surface(page);
  await ask(page, "慢搜索");
  await page.locator("[data-admin-kb-trial-scope]").selectOption("doc-b");
  await expect(page.locator("[data-admin-kb-trial-context]")).toContainText("尚无上下文");
  s.releaseSlowSearch();
  await expect(page.locator("[data-admin-kb-trial-answer]")).toHaveCount(0);

  await ask(page, "慢维护");
  await expect(page.locator("[data-admin-kb-trial-answer]")).toContainText("慢维护 的回答。");
  await page.locator("[data-admin-kb-trial-clear]").click();
  s.releaseSlowMaintenance();
  await expect(page.locator("[data-admin-kb-trial-answer]")).toHaveCount(0);
  await expect(page.locator("[data-admin-kb-trial-context]")).toContainText("尚无上下文");
  expect(s.errors).toEqual([]);
});

test("检索失败不追加 turn", async ({ page }) => {
  const s = await surface(page);
  await page.locator("[data-admin-kb-trial-question]").fill("失败问题");
  await page.locator("[data-admin-kb-trial-run]").click();
  await expect(page.locator("[data-admin-kb-trial-error]")).toBeVisible();
  expect(s.searchCalls).toHaveLength(1);

  await ask(page, "恢复问题");
  await waitForMaintenance(page);
  expect(s.searchCalls[1].context).toMatchObject({ last_turn: null, history_summary: "" });
  expect(s.maintenanceCalls).toHaveLength(1);
  expect(s.errors).toEqual([]);
});

test("快速双 submit 在同一临时会话中只发起一次搜索", async ({ page }) => {
  const s = await surface(page);
  await page.locator("[data-admin-kb-trial-question]").fill("慢搜索");
  await page.locator("[data-admin-kb-trial-run]").dblclick();
  await expect.poll(() => s.searchCalls.length).toBe(1);
  s.releaseSlowSearch();
  await waitForMaintenance(page);
  expect(s.searchCalls).toHaveLength(1);
  expect(s.maintenanceCalls).toHaveLength(1);
  expect(s.errors).toEqual([]);
});

for (const question of ["检索撤权", "维护撤权"]) {
  test(`${question}清空临时上下文且不再展示旧答案`, async ({ page }) => {
    const s = await surface(page);
    await ask(page, "初始问题");
    await waitForMaintenance(page);
    await ask(page, question);
    await expect(page.locator("[data-admin-kb-trial-error]")).toBeVisible();
    await expect(page.locator("[data-admin-kb-trial-context]")).toContainText("尚无上下文");
    await expect(page.locator("[data-admin-kb-trial-answer]")).toHaveCount(0);
    await ask(page, "权限恢复");
    await waitForMaintenance(page);
    expect(s.searchCalls.at(-1).context.last_turn).toBeNull();
  });
}

test("维护失败保留成功答案并允许按降级实体继续", async ({ page }) => {
  const s = await surface(page);
  await ask(page, "维护失败");
  await expect(page.locator("[data-admin-kb-trial-context-status]")).toContainText("失败");
  await expect(page.locator("[data-admin-kb-trial-answer]")).toContainText("维护失败 的回答");
  await expect(page.locator("[data-admin-kb-trial-run]")).toBeEnabled();
  await ask(page, "下一问");
  await waitForMaintenance(page);
  expect(s.searchCalls.at(-1).context.last_turn).toMatchObject({ query: "维护失败", entities: [] });
});

test("待审审核开关只在有效范围改变时重置会话", async ({ page }) => {
  const s = await surface(page);
  await page.locator("[data-admin-kb-trial-scope]").selectOption("doc-pending");
  await ask(page, "审核问题");
  await waitForMaintenance(page);
  expect(s.searchCalls.at(-1).include_pending).toBe(true);
  await page.locator("[data-admin-kb-trial-pending-audit]").uncheck();
  await expect(page.locator("[data-admin-kb-trial-context]")).toContainText("尚无上下文");
  await ask(page, "普通范围问题");
  await waitForMaintenance(page);
  expect(s.searchCalls.at(-1).include_pending).toBeUndefined();
  expect(s.searchCalls.at(-1).context.last_turn).toBeNull();
});

test("旧 search finally 不解除新维护请求的等待状态", async ({ page }) => {
  const s = await surface(page);
  await ask(page, "慢搜索");
  await expect.poll(() => s.searchCalls.length).toBe(1);
  await page.locator("[data-admin-kb-trial-clear]").click();
  await ask(page, "慢维护");
  await expect.poll(() => s.maintenanceCalls.length).toBe(1);
  const lateResponse = page.waitForResponse((r) => r.url().endsWith("/api/admin/knowledge/search") && r.request().postDataJSON().query === "慢搜索");
  s.releaseSlowSearch();
  await (await lateResponse).finished();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  await expect(page.locator("[data-admin-kb-trial-run]")).toBeDisabled();
  await expect(page.locator("[data-admin-kb-trial-answer]")).toContainText("慢维护 的回答");
  s.releaseSlowMaintenance();
  await waitForMaintenance(page);
});

test("试算长答案在窄屏和低高度不横向溢出，清空可键盘操作", async ({ page }) => {
  await surface(page);
  await ask(page, "第一问");
  await waitForMaintenance(page);
  for (const viewport of [{ width: 1024, height: 600 }, { width: 768, height: 900 }]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.locator("[data-admin-kb-trial-clear]")).toBeVisible();
  }
  await page.locator("[data-admin-kb-trial-clear]").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-admin-kb-trial-context]")).toContainText("尚无上下文");
});
