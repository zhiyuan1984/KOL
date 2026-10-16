import { createHash, randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type APIResponse, type Browser, type Page } from "@playwright/test";
import { processExecutionJobById } from "../../backend/src/execution-jobs/dispatcher";
import { nativeKnowledgeAuth, reviewerContext } from "./fixtures/native-knowledge-auth";
import { nativeKnowledgeReviewer, prepareNativeKnowledgeAdmin } from "./fixtures/native-knowledge-admin";
import { employeeExecutionWriteSnapshot, prepareEmployeeKnowledgeSeedOwners } from "./fixtures/native-employee-seed-owner";

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
 * 原生模式没有 demo/reset。beforeEach 只在隔离 employee DB 修复旧 seed 缺失 author，
 * 然后经合法端点停用本套件旧 score 夹具，并以相同 seed 正文新建真实草稿、独立审批、队列发布。
 * 每例使用本 run 的已发布 score fixture；afterEach 只清理本 run，审批冻结与指纹历史始终保留。
 */

const MISSING_COPY = "问题模板未在管理端知识库发布，该入口暂不可用。";
// This run's titles cannot collide with previous approval history. The set is
// intentionally process-local: it never sweeps frozen rows from another run.
const E2E_TITLE_PREFIX = `E2E 样例 · 公海评分提问模板 · ${randomUUID()}`;
const OWN_TITLES = new Set<string>();
const E2E_BODY = "请按公开资料给这些 KOL 打潜力与风险两个分（0-100），说明口径、依据与置信度，并列出资料缺口。";
const SEED_BODY = "请对这些 KOL 的公开资料做潜力/风险评分，说明口径、依据与置信度。";
let ownScoreFixture: { id: string; title: string };

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
  // Never invent a successful execution receipt. The negative assertions also
  // observe requests; an accidental execution is aborted and fails the test.
  await page.route("**/api/home/pool/jev-assess", (route) => route.abort("blockedbyclient"));
}

/** Only remove an ordinary draft from this run; retained approval history remains auditable. */
async function cleanupE2eRows(request: APIRequestContext) {
  const rows = await request.get("/api/admin/knowledge")
    .then((response) => response.json() as Promise<Array<Record<string, unknown>>>);
  for (const row of rows || []) {
    if (!OWN_TITLES.has(String(row.title || ""))) continue;
    const id = String(row.id || "");
    const status = String(row.status || "");
    if (!id || status !== "draft") continue;
    const deleted = await request.delete(`/api/admin/knowledge/${id}`);
    if (deleted.ok()) continue;
    const detail = await deleted.text();
    // A server-side approval-history guard is a required preservation result,
    // not a license to archive or delete the frozen entry through another path.
    expect(deleted.status() === 500 && detail.includes("knowledge_entry_history_retained"), `清理本运行草稿 ${id} 失败：${deleted.status()} ${detail}`).toBeTruthy();
  }
}

/** 管理端 UI 新建草稿 → 用管理端列表反查 id（草稿此时对用户端不可见）。 */
async function createDraftViaAdmin(page: Page, request: APIRequestContext): Promise<{ id: string; title: string }> {
  const title = `${E2E_TITLE_PREFIX} · ${randomUUID()}`;
  OWN_TITLES.add(title);
  // Current v2 creation remains in the governance home; the retired base URL
  // is intentionally not revived just to satisfy this native acceptance flow.
  await page.goto("/admin/knowledge?stage=create");
  await expect(page.locator('[data-admin-kb-v2="home"]')).toBeVisible();
  await page.locator("[data-kbv-new]").click();
  const form = page.locator("form.kbw-editor");
  await expect(form).toBeVisible();
  await form.locator("input[name='title']").fill(title);
  await form.locator("select[name='kind']").selectOption("question_template");
  await form.locator("select[name='base_id']").selectOption("kbase_legacy");
  await expect(form.locator("select[name='base_id']")).toHaveValue("kbase_legacy");
  await form.locator("input[name='tags']").fill("pool-question:score");
  // question_template 的必填结构化字段按 kind 字段表渲染。
  await form.locator("[name='structured:question']").fill("请分析这些 KOL 的公开资料。");
  await form.locator("[name='structured:answer']").fill("按潜力与风险给出评分、依据与资料缺口。");
  await form.locator("textarea[name='body']").fill(E2E_BODY);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator("[data-admin-receipt]")).toContainText("草稿已保存");

  const rows = await request.get("/api/admin/knowledge")
    .then((response) => response.json() as Promise<Array<Record<string, unknown>>>);
  const hits = (rows || []).filter((row) => String(row.title) === title && String(row.status) !== "archived");
  expect(hits.length, "管理端列表应恰好出现一条本次新建的草稿").toBe(1);
  expect(String(hits[0].status)).toBe("draft");
  return { id: String(hits[0].id), title };
}

/** Archive this run's independently published seed-equivalent through the current admin UI. */
async function archiveSeedScoreTemplate(page: Page): Promise<void> {
  await page.goto(`/?tab=pool`);
  await page.locator("[data-pool-kol='uid_outdoor'] [data-pool-select]").check();
  await expect(page.locator("[data-pool-jev-assess]")).toBeEnabled();
  await page.goto(`/admin/knowledge?stage=published&mode=detail&assetType=entry&assetId=${ownScoreFixture.id}`);
  const detail = page.locator("[data-knowledge-right][data-workspace-mode='detail']");
  await expect(detail.locator(".kbw-identity")).toContainText(ownScoreFixture.title);
  await detail.getByText("版本、范围与引用记录", { exact: true }).click();
  const archive = detail.getByRole("button", { name: "停用已发布版本", exact: true });
  await expect(archive).toBeEnabled();
  await archive.click();
  await expect(page.locator("[data-admin-confirm='knowledge-archive']")).toBeVisible();
  await page.locator("[data-admin-confirm-ok]").click();
  await expect(detail.locator(".kbw-identity")).toContainText("已停用");
  const templates = await responseJson<Array<{ slot: string; knowledge_id: string }>>(
    await page.request.get("/api/knowledge/question-templates"), "读取归档后的真实模板槽位失败",
  );
  expect(templates.filter((item) => item.slot === "score"), "真实后端的 score 槽位必须全部缺失，而非仅隐藏按钮").toEqual([]);
}

async function expandEmployeeKnowledgeList(page: Page): Promise<void> {
  await expect(page.locator("[data-knowledge]").first()).toBeVisible();
  const more = page.locator("[data-kb-load-more]");
  while (await more.count()) await more.click();
}

async function responseJson<T>(response: APIResponse, message: string): Promise<T> {
  expect(response.ok(), `${message}：${response.status()} ${await response.text()}`).toBeTruthy();
  return response.json() as Promise<T>;
}

/**
 * Uses the v2 template provisioned by native-auth infrastructure. Its reviewer
 * is a distinct normal-login company member; this consumer never creates a
 * requester-assigned workflow or substitutes a persona for an authenticated
 * reviewer context.
 */
async function nativePublicationTemplate(request: APIRequestContext): Promise<{ id: string; version: number }> {
  const templates = await responseJson<Array<{
    id: string; publishedVersion?: number | null;
    definition?: { name?: string; subjectType?: string; nodes?: Array<{ type?: string; assignee?: { kind?: string; userIds?: string[] } }> };
  }>>(
    await request.get("/api/admin/approval-types/v2/templates", { headers: { "X-Review-Company": nativeKnowledgeAuth.company } }),
    "读取已发布的独立评审知识流程失败",
  );
  const template = templates.find((item) => item.definition?.name === nativeKnowledgeAuth.template.name);
  const reviewer = template?.definition?.nodes?.find((node) => node.type === "review");
  expect(template, "原生认证夹具应提供已发布的知识条目 v2 流程").toBeTruthy();
  expect(template?.publishedVersion, "流程必须使用已发布当前版本").toEqual(expect.any(Number));
  expect(template?.definition?.subjectType).toBe("knowledge_publication");
  expect(reviewer?.assignee).toEqual({ kind: "named", userIds: [nativeKnowledgeReviewer.id] });
  return { id: template!.id, version: Number(template!.publishedVersion) };
}

/**
 * The requester submits with its current published template version. It is
 * explicitly denied self-review; a separate normal-login reviewer performs a
 * fresh L3 prepare + command with the review instance's current version. The
 * requester then reads the independently published result rather than calling
 * a direct-publish endpoint.
 */
async function approveViaAdmin(request: APIRequestContext, browser: Browser, id: string): Promise<void> {
  const headers = { "X-Review-Company": nativeKnowledgeAuth.company };
  const template = await nativePublicationTemplate(request);
  const command = { templateId: template.id, templateVersion: template.version, values: {}, releaseNote: "E2E 验证独立提交、审批与发布链路" };
  const prepared = await responseJson<{ confirmationId: string }>(
    await request.post(`/api/admin/knowledge/entries/${id}/publication-v2/prepare`, { headers, data: command }),
    "准备知识条目提交确认失败",
  );
  const submitted = await responseJson<{ instanceId: string; status: string }>(
    await request.post(`/api/admin/knowledge/entries/${id}/publication-v2/submit`, { headers, data: { command, confirmationId: prepared.confirmationId, idempotencyKey: randomUUID() } }),
    "确认提交知识条目审批失败",
  );
  expect(submitted.status).toBe("submitted");

  const requesterReview = await responseJson<{ id: string; version: number; status: string; allowedActions: string[] }>(
    await request.get(`/api/approvals/v2/instances/${submitted.instanceId}`, { headers }), "读取请求者审批实例失败",
  );
  expect(requesterReview.status).toBe("reviewing");
  expect(requesterReview.allowedActions).not.toContain("approve");
  const selfDecision = { action: "approve" as const, instanceId: requesterReview.id, expectedVersion: requesterReview.version, reason: "请求者不得自审" };
  const selfPrepared = await request.post("/api/approvals/v2/prepare", { headers, data: selfDecision });
  expect(selfPrepared.status(), `请求者自审必须被拒绝：${await selfPrepared.text()}`).toBe(403);

  const context = await reviewerContext(browser);
  try {
    const reviewer = context.request;
    const status = await responseJson<{ authenticated: boolean; account: { id: string; username: string } | null }>(
      await reviewer.get("/api/auth/status"), "读取独立评审人认证状态失败",
    );
    expect(status).toMatchObject({ authenticated: true, account: { id: nativeKnowledgeReviewer.id, username: nativeKnowledgeReviewer.username } });
    const review = await responseJson<{ id: string; version: number; status: string; allowedActions: string[] }>(
      await reviewer.get(`/api/approvals/v2/instances/${submitted.instanceId}`, { headers }), "读取独立评审实例失败",
    );
    expect(review.status).toBe("reviewing");
    expect(review.allowedActions).toContain("approve");
    const decision = { action: "approve" as const, instanceId: review.id, expectedVersion: review.version, reason: "独立评审人已核对条目内容、范围与预填负例。" };
    const decisionConfirmation = await responseJson<{ confirmationId: string }>(
      await reviewer.post("/api/approvals/v2/prepare", { headers, data: decision }), "准备独立审批确认失败",
    );
    const receipt = await responseJson<{ action: string; resourceId: string }>(
      await reviewer.post("/api/approvals/v2/commands", { headers, data: { command: decision, confirmationId: decisionConfirmation.confirmationId, idempotencyKey: randomUUID() } }),
      "确认独立审批失败",
    );
    expect(receipt).toMatchObject({ action: "approve", resourceId: submitted.instanceId });
    // The product's durable trigger assigns `kp_<md5>` from the approved
    // instance/version; retain the logical ID in the worker receipt while
    // dispatching the actual persisted execution_jobs primary key.
    const jobId = `knowledge-publish:${nativeKnowledgeAuth.company}:${submitted.instanceId}`;
    const executionJobId = `kp_${createHash("md5").update(`knowledge-publication:${nativeKnowledgeAuth.company}:${submitted.instanceId}:${review.version + 1}`).digest("hex")}`;
    expect(await processExecutionJobById(executionJobId, `wave7-knowledge-employee-publication:${jobId}`)).toMatchObject({
      execution_job_id: executionJobId,
      job_type: "knowledge.publication",
      handled: true,
      outcome: "processed",
    });
  } finally {
    await context.close();
  }

  await expect.poll(async () => {
    const state = await responseJson<{ publication: { status: string; reviewStatus: string } | null }>(
      await request.get(`/api/admin/knowledge/entries/${id}/publication-v2`, { headers }), "读取请求者侧独立发布状态失败",
    );
    return `${state.publication?.reviewStatus}:${state.publication?.status}`;
  }, { timeout: 15000, message: "独立审批后应由发布作业完成，不得把审批伪装为直接发布" }).toBe("approved:published");
}

test.beforeAll(async () => { await prepareNativeKnowledgeAdmin(); });

test.beforeEach(async ({ page, browser }) => {
  const request = page.request;
  await prepareEmployeeKnowledgeSeedOwners();
  await cleanupE2eRows(request);
  // Archive only this owned suite's score fixtures via real authorized product
  // commands. Publication applications, frozen snapshots and fingerprints are
  // not deleted or rewritten; no DB status/visibility mutation is performed.
  const templates = await responseJson<Array<{ slot: string; knowledge_id: string; title: string }>>(
    await request.get("/api/knowledge/question-templates"), "读取真实模板夹具失败",
  );
  for (const item of templates.filter((row) => row.slot === "score")) {
    expect(item.knowledge_id === "kb_q_pool_score" || item.title.startsWith("E2E 样例 · 公海评分提问模板 ·"), "不能归档其它套件或真实业务模板").toBeTruthy();
    await responseJson(await request.post(`/api/admin/knowledge/${item.knowledge_id}/archive`), "停用隔离score夹具失败");
  }
  const title = `${E2E_TITLE_PREFIX} · seed-equivalent · ${randomUUID()}`;
  OWN_TITLES.add(title);
  const fixture = await responseJson<{ id: string; status: string; created_by: string }>(
    await request.post("/api/admin/knowledge", { data: {
      title, body: SEED_BODY, source_body: SEED_BODY, kind: "question_template", base_id: "kbase_legacy",
      tags: "pool-question:score,kol-pool", brand: "*", lang: "en",
      structured: { question: SEED_BODY, answer: "说明评分口径、依据与置信度。" },
    } }), "创建本run合法seed-equivalent草稿失败",
  );
  expect(fixture).toMatchObject({ status: "draft", created_by: "sriphy" });
  ownScoreFixture = { id: fixture.id, title };
  await approveViaAdmin(request, browser, fixture.id);
  const published = await responseJson<Array<{ slot: string; knowledge_id: string; body: string }>>(
    await request.get("/api/knowledge/question-templates"), "读取独立发布后的seed-equivalent模板失败",
  );
  expect(published.filter((item) => item.slot === "score")).toEqual([expect.objectContaining({ knowledge_id: fixture.id, body: SEED_BODY })]);
  await stubPool(page);
});

test.afterEach(async ({ page }) => {
  const request = page.request;
  const rows = await responseJson<Array<{ id: string; title: string; status: string }>>(
    await request.get("/api/admin/knowledge"), "读取本run清理列表失败",
  );
  for (const row of rows.filter((item) => OWN_TITLES.has(item.title) && item.status === "published")) {
    await responseJson(await request.post(`/api/admin/knowledge/${row.id}/archive`), "停用本run已发布夹具失败（历史必须保留）");
  }
  await cleanupE2eRows(request);
});

test("归档槽位模板后，公海入口禁用并如实提示", async ({ page }) => {
  await archiveSeedScoreTemplate(page);
  const before = await employeeExecutionWriteSnapshot();
  const negativeWrites: string[] = [];
  page.on("request", (request) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) negativeWrites.push(new URL(request.url()).pathname);
  });

  await page.goto("/?tab=pool");
  await expect(page.locator('[data-home-pane="pool"]')).toBeVisible();
  const scoreEntry = page.locator("[data-pool-jev-assess]");
  await expect(scoreEntry).toBeDisabled();
  await expect(scoreEntry).toHaveAttribute("title", MISSING_COPY);
  // 归档只影响被归档的槽位：risk 仍可用（未选 KOL 时提示选择，而不是「未发布」）。
  const riskEntry = page.locator("[data-pool-analysis='risk']");
  await expect(riskEntry).toBeVisible();
  await expect(riskEntry).not.toHaveAttribute("title", MISSING_COPY);
  await page.goto("/kb");
  await page.locator("[data-kb-search]").fill(ownScoreFixture.title);
  await expect(page.locator(`[data-knowledge='${ownScoreFixture.id}']`)).toHaveCount(0);
  await expect(page.locator("[data-kbv-count]")).toHaveText("0 条知识");
  expect(negativeWrites, "缺失模板入口和搜索不得发起任何写请求").toEqual([]);
  expect(await employeeExecutionWriteSnapshot(), "缺失模板浏览不得创建会话、草稿、worker或实际队列任务").toEqual(before);
});

test("草稿未审批用户端不可见；发布后入口恢复并预填模板正文，点击不执行", async ({ page, browser }) => {
  const request = page.request;
  const jevPosts: string[] = [];
  page.on("request", (item) => {
    if (item.method() === "POST" && new URL(item.url()).pathname === "/api/home/pool/jev-assess") {
      jevPosts.push(new URL(item.url()).pathname);
    }
  });

  await archiveSeedScoreTemplate(page);
  const draft = await createDraftViaAdmin(page, request);

  // 草稿还没审批：用户端该入口照旧禁用。
  await page.goto("/?tab=pool");
  const scoreEntry = page.locator("[data-pool-jev-assess]");
  await expect(scoreEntry).toBeDisabled();
  await expect(scoreEntry).toHaveAttribute("title", MISSING_COPY);

  await approveViaAdmin(request, browser, draft.id);

  await page.goto("/?tab=pool");
  await page.locator("[data-pool-kol='uid_outdoor'] [data-pool-select]").check();
  await expect(scoreEntry).toBeEnabled();
  const beforePrefill = await employeeExecutionWriteSnapshot();
  await scoreEntry.click();

  const input = page.locator("[data-home] [data-composer-input]");
  await expect(input).toHaveValue(E2E_BODY);
  // Names belong to independently frozen object context, not interpolated body.
  const confirm = page.locator('[data-pool-score-confirm]');
  await expect(confirm).toBeVisible();
  await expect(confirm).toHaveAttribute('data-pool-score-targets', '1');
  await expect(confirm).toContainText('户外充电君');
  expect(jevPosts, "点击只预填草稿，不得直接调用评分接口").toEqual([]);
  expect(await employeeExecutionWriteSnapshot(), "点击只预填，不得创建会话、草稿、worker或实际队列任务").toEqual(beforePrefill);
});

test("员工知识库能看到这条已发布的问题模板", async ({ page, browser }) => {
  const request = page.request;
  const draft = await createDraftViaAdmin(page, request);
  await approveViaAdmin(request, browser, draft.id);

  await page.goto("/kb");
  const kb = page.locator("[data-kb-page='mine']");
  await expandEmployeeKnowledgeList(page);
  const row = kb.locator(`[data-knowledge='${draft.id}']`);
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute("data-kind", "question_template");
  await expect(row).toContainText("问题模板");
  await expect(row).toContainText(draft.title);
});
