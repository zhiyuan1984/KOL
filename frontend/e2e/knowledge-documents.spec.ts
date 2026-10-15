import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type APIResponse, type Browser, type Page } from "@playwright/test";
import { processExecutionJobById } from "../../backend/src/execution-jobs/dispatcher";
import { postgresQuery } from "../../backend/src/postgres/pool";
import { knowledgeReviewDefinition } from "../../shared/review";
import { prepareNativeKnowledgeAdmin } from "./fixtures/native-knowledge-admin";
import { nativeKnowledgeAuth, reviewerContext } from "./fixtures/native-knowledge-auth";

/**
 * 非结构化资料流水线（P1，stub 引擎专用）：
 * 上传 → 规整 → 索引 → 待审 → 发布（L3 回执）→ 库详情试算（答案 + 页级引用）。
 * data-e2e 跨运行保留：base 幂等创建；用例末尾归档本次发布的资料。
 * 真实模式（装机 PageIndex 侧车）的质量验收走设计 §12.3 试点清单，不在本规格内。
 */
test.skip(process.env.E2E_MODE === "real", "This suite targets the deterministic stub knowledge engine.");

// This suite intentionally opts in to the native principal fixture. A display
// persona does not confer an administrator grant; taxonomy and publication
// requests below must be authorized by the current `users` row.
test.beforeAll(async () => {
  await prepareNativeKnowledgeAdmin();
});

// 每次运行独立：旧中断运行可遗留分类，不能把正常 409 冲突吞成 `family.id` 的 undefined。
const BASE_CODE = `e2e_docs_${Date.now()}`;

async function jsonOk<T>(response: APIResponse): Promise<T> {
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json() as Promise<T>;
}

async function ensureBase(request: APIRequestContext): Promise<string> {
  const bases = await request.get("/api/admin/knowledge/bases")
    .then((response) => response.json() as Promise<{ bases: { id: string; code: string }[] }>);
  const hit = bases.bases.find((base) => base.code === BASE_CODE);
  if (hit) return hit.id;
  const domains = await request.get("/api/admin/knowledge/domains")
    .then((response) => response.json() as Promise<{ domains: { id: string; code: string }[] }>);
  let family = domains.domains.find((row) => row.code === `${BASE_CODE}_fam`);
  if (!family) {
    family = (await jsonOk<{ domain: { id: string; code: string } }>(await request.post("/api/admin/knowledge/domains", {
      data: { code: `${BASE_CODE}_fam`, name: "E2E 资料族", level: "family" },
    }))).domain;
  }
  let domain = domains.domains.find((row) => row.code === `${BASE_CODE}_dom`);
  if (!domain) {
    domain = (await jsonOk<{ domain: { id: string; code: string } }>(await request.post("/api/admin/knowledge/domains", {
      data: { code: `${BASE_CODE}_dom`, name: "E2E 资料域", level: "domain", parent_id: family.id },
    }))).domain;
  }
  const base = (await jsonOk<{ base: { id: string } }>(await request.post("/api/admin/knowledge/bases", {
    data: { code: BASE_CODE, name: "E2E 资料库", domain_id: domain.id, kind: "unstructured" },
  }))).base;
  return String(base.id);
}

/** 清掉失败运行遗留的未发布资料（published / archived / 加工中的不动）。 */
async function cleanupStaleDocs(request: APIRequestContext, baseId: string): Promise<void> {
  const body = await request.get(`/api/admin/knowledge/documents?base=${baseId}`)
    .then((response) => response.json() as Promise<{ documents: { id: string; title: string; status: string }[] }>);
  for (const doc of body.documents) {
    if (!/^e2e/i.test(doc.title)) continue;
    if (["published", "archived", "normalizing", "indexing"].includes(doc.status)) continue;
    await request.delete(`/api/admin/knowledge/documents/${doc.id}`).catch(() => undefined);
  }
}

async function waitDocumentStatus(
  request: APIRequestContext,
  baseId: string,
  title: string,
  status: string,
): Promise<Record<string, unknown>> {
  let found: Record<string, unknown> | null = null;
  await expect.poll(async () => {
    const body = await request.get(`/api/admin/knowledge/documents?base=${baseId}`)
      .then((response) => response.json() as Promise<{ documents: Record<string, unknown>[] }>);
    const hit = body.documents.find((doc) => String(doc.title) === title);
    found = hit || null;
    return hit ? String(hit.status) : "missing";
  }, { timeout: 15000, message: "资料应推进到目标状态（真实进度，不伪造）" }).toBe(status);
  return found as unknown as Record<string, unknown>;
}

/** Current workspace keeps legacy deep links but renders the lifecycle rail, not retired subpages. */
async function openStage(page: Page, path: string, stage: string): Promise<void> {
  await page.goto(path);
  await expect(page.locator("[data-knowledge-right]")).toHaveAttribute("data-kb-active-stage", stage);
}

type PublicationTemplate = {
  id: string;
  version: number;
  publishedVersion?: number | null;
  definition?: {
    name?: string;
    subjectType?: string;
    nodes?: Array<{ type?: string; assignee?: { kind?: string; userIds?: string[] } }>;
  };
};

function isPublishedIndependentTemplate(template: PublicationTemplate): boolean {
  const reviewer = template.definition?.nodes?.find((node) => node.type === "review");
  return Boolean(
    template.publishedVersion
      && template.definition?.name === nativeKnowledgeAuth.template.name
      && template.definition.subjectType === "knowledge_publication"
      && reviewer?.assignee?.kind === "named"
      && reviewer.assignee.userIds?.length === 1
      && reviewer.assignee.userIds[0] === nativeKnowledgeAuth.template.reviewerId,
  );
}

/** Creates the same published, independent-reviewer template that native setup validates. */
async function ensurePublishedKnowledgeTemplate(request: APIRequestContext): Promise<PublicationTemplate> {
  const current = await jsonOk<PublicationTemplate[]>(
    await request.get("/api/admin/approval-types/v2/templates"),
  );
  const existing = current.find(isPublishedIndependentTemplate);
  if (existing) return existing;

  const definition = knowledgeReviewDefinition();
  const review = definition.nodes.find((node) => node.type === "review");
  if (!review) throw new Error("知识发布模板必须包含人工审批节点");
  definition.name = nativeKnowledgeAuth.template.name;
  review.assignee = { kind: "named", userIds: [nativeKnowledgeAuth.template.reviewerId] };
  const created = await jsonOk<{ id: string; version: number }>(await request.post("/api/admin/approval-types/v2/templates", {
    data: { definition, creationKey: nativeKnowledgeAuth.template.creationKey },
  }));
  const command = { action: "publish", templateId: created.id, expectedVersion: created.version };
  const prepared = await jsonOk<{ confirmationId: string }>(await request.post("/api/approvals/v2/prepare", { data: command }));
  await jsonOk(await request.post("/api/approvals/v2/commands", {
    data: { command, confirmationId: prepared.confirmationId, idempotencyKey: randomUUID() },
  }));
  return { id: created.id, version: created.version, publishedVersion: created.version, definition };
}

type ScopeSnapshot = { state: string; job?: { id?: string } | null };

/** The browser server intentionally has no hidden worker; dispatch the durable queued job once in this isolated test. */
async function processQueuedScope(request: APIRequestContext, documentId: string): Promise<void> {
  const pending = await jsonOk<ScopeSnapshot>(await request.get(`/api/admin/knowledge/documents/${documentId}/scope`));
  expect(pending.state).toBe("empty");
  const jobId = String(pending.job?.id || "");
  expect(jobId, "范围作业必须由服务端持久化入队").not.toBe("");
  expect(await processExecutionJobById(jobId, "wave6-knowledge-admin-scope")).toMatchObject({
    execution_job_id: jobId,
    job_type: "knowledge.scope",
    handled: true,
    outcome: "processed",
  });
  await expect.poll(async () => {
    const latest = await jsonOk<ScopeSnapshot>(await request.get(`/api/admin/knowledge/documents/${documentId}/scope`));
    return latest.state;
  }, { timeout: 15000, message: "范围作业必须从真实页级证据生成 candidate" }).toBe("candidate");
}

type ReviewDetail = { id: string; requester: string; version: number; allowedActions?: string[] };

async function independentlyApprove(
  browser: Browser,
  requester: APIRequestContext,
  reviewHref: string,
): Promise<string> {
  const reviewUrl = new URL(reviewHref, process.env.E2E_BASE || "http://127.0.0.1:8949");
  const instanceId = reviewUrl.pathname.split("/").filter(Boolean).at(-1) || "";
  expect(instanceId, "提交回执必须链接到真实审批实例").not.toBe("");
  const reviewer = await reviewerContext(browser);
  try {
    const reviewerPage = await reviewer.newPage();
    await reviewerPage.goto(reviewUrl.toString());
    const apiUrl = (path: string) => new URL(path, reviewUrl.origin).toString();
    const headers = { "X-Review-Company": nativeKnowledgeAuth.company };
    const identity = await jsonOk<{ authenticated: boolean; account: { id: string }; permissions: { admin?: boolean } }>(
      await reviewerPage.request.get(apiUrl("/api/auth/status")),
    );
    expect(identity).toMatchObject({ authenticated: true, account: { id: nativeKnowledgeAuth.template.reviewerId }, permissions: { admin: false } });
    const detail = await jsonOk<ReviewDetail>(
      await reviewerPage.request.get(apiUrl(`/api/approvals/v2/instances/${instanceId}`), { headers }),
    );
    expect(detail.requester).toBe("sriphy");
    expect(detail.allowedActions).toContain("approve");
    const decision = { action: "approve", instanceId, expectedVersion: detail.version, reason: "已核对原文与冻结版本" };
    const requesterDenied = await requester.post("/api/approvals/v2/prepare", { headers, data: decision });
    expect(requesterDenied.status(), "申请人不得审核自己的知识发布").toBe(403);
    const reviewerInvalid = await reviewerPage.request.post(apiUrl("/api/approvals/v2/prepare"), {
      headers,
      data: { ...decision, reason: "x".repeat(2001) },
    });
    expect(reviewerInvalid.status(), "独立评审人的超长决定理由必须被拒绝").toBe(422);
    const prepared = await jsonOk<{ confirmationId: string }>(
      await reviewerPage.request.post(apiUrl("/api/approvals/v2/prepare"), { headers, data: decision }),
    );
    const approved = await reviewerPage.request.post(apiUrl("/api/approvals/v2/commands"), {
      headers,
      data: { command: decision, confirmationId: prepared.confirmationId, idempotencyKey: randomUUID() },
    });
    expect(approved.ok(), await approved.text()).toBeTruthy();
    return instanceId;
  } finally {
    await reviewer.close();
  }
}

test("上传 PDF → 待审 → 发布（L3 回执）→ 库详情试算返回答案与页级引用", async ({ page, request, browser }) => {
  // Keep the legacy coverage sequence, but route every visual action through
  // the current creation stage, document rail and publication-v2 form.
  // Native auth has no persona-elevation endpoint. In that explicit config,
  // page.request shares the legitimate HttpOnly login established by global
  // setup; the legacy disabled-auth run retains its existing persona fixture.
  const api = process.env.E2E_AUTH_MODE === "enabled" ? page.request : request;
  if (process.env.E2E_AUTH_MODE === "enabled") {
    const status = await api.get("/api/auth/status");
    expect(status.ok(), await status.text()).toBeTruthy();
    expect(await status.json()).toMatchObject({ authenticated: true, account: { username: "sriphy" } });
  } else {
    expect((await api.post("/api/me/persona", { data: { persona: "sriphy" } })).ok()).toBeTruthy();
  }
  const baseId = await ensureBase(api);
  const template = await ensurePublishedKnowledgeTemplate(api);
  await cleanupStaleDocs(api, baseId);
  const title = `e2e-doc-${Date.now()}`;
  const fileName = `${title}.pdf`;

  // 1) 入库：stage=create 的现行上传面板强制选择合法非结构化库。
  await openStage(page, "/admin/knowledge?stage=create", "create");
  await page.locator("[data-kbv-upload]").click();
  const upload = page.locator("[data-kbv-upload-dialog]");
  // The current inline surface keeps fields in this region while its shared
  // action bar is rendered by WorkspaceActions outside the region. Keep the
  // original negative assertion against the same semantic submit control.
  const uploadSubmit = page.locator("[data-kbv-upload-submit]");
  await expect(upload).toBeVisible();
  await upload.locator("[data-kbv-upload-pick]").setInputFiles({
    name: fileName,
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\nE2E stub fixture\n%%EOF\n", "utf8"),
  });
  await expect(upload.locator("[data-kbv-upload-queue]")).toContainText(fileName);
  await expect(uploadSubmit).toBeDisabled();
  await upload.locator(`[data-kbv-upload-scope] [data-kb-scope-base='${baseId}']`).click();
  await expect(uploadSubmit).toBeEnabled();
  await uploadSubmit.click();
  await expect(page.locator("[data-admin-receipt]")).toContainText("资料已上传");

  // 2) 真实进度推进到待审（以服务端状态为准）
  const doc = await waitDocumentStatus(api, baseId, title, "pending_review");
  const docId = String(doc.id);
  await processQueuedScope(api, docId);

  // 3) 原位 processing/detail：先核对服务端生成的范围，才允许进入审批。
  await openStage(page, `/admin/knowledge?stage=published&mode=detail&assetType=document&assetId=${docId}`, "published");
  const scope = page.getByRole("region", { name: "文档知识范围" });
  await expect(scope).toBeVisible();
  const confirmScope = scope.getByRole("button", { name: "确认已核对原文范围", exact: true });
  await expect(confirmScope).toBeEnabled();
  await confirmScope.click();
  await expect(scope).toContainText("范围已核对");

  // 4) publication-v2：L3 确认产生审批回执；审批与实际发布保持为两个步骤。
  await page.getByRole("button", { name: "提交审批", exact: true }).click();
  await expect(page.locator("[data-workspace-mode='review']")).toBeVisible();
  const publication = page.getByRole("region", { name: "知识发布审批" });
  const templatePicker = publication.getByLabel("审批流程");
  // The current panel selects its sole published template, then collapses the
  // native picker. Assert that durable default instead of forcing its hidden
  // implementation control; the selected workflow/version remains explicit.
  await expect(templatePicker).toHaveValue(template.id);
  await publication.getByLabel("发布说明").fill("已核对上传原文、范围与适用对象后提交独立审批");
  const submit = page.locator("[data-kbv-doc-action='submit']");
  await expect(submit).toBeEnabled();
  await submit.click();
  const confirmation = page.getByRole("dialog", { name: "确认提交知识发布审批" });
  await expect(confirmation).toContainText("知识发布审批");
  await confirmation.getByRole("button", { name: "确认提交审批", exact: true }).click();
  await expect(page.locator("[data-admin-receipt]")).toContainText("已提交审批");
  await expect(page.locator("[data-workspace-mode='detail']")).toContainText("审批中");

  // 5) 旧“库详情试算”迁到当前冻结审批资料版本：答案和原件页级引用仍须可追溯。
  const reviewUrl = await page.getByRole("link", { name: /查看审批记录与处理入口/ }).getAttribute("href");
  expect(reviewUrl).toBeTruthy();
  await page.goto(reviewUrl!);
  const material = page.getByRole("region", { name: "审批材料" });
  await expect(material).toContainText(title);
  const frozenScope = material.getByRole("region", { name: "审批冻结的知识范围" });
  await expect(frozenScope).toBeVisible();
  await expect(frozenScope.getByRole("link", { name: /原件第\d+页/ })).toHaveCount(1);
  const reviewInstanceId = new URL(reviewUrl!, process.env.E2E_BASE || "http://127.0.0.1:8949")
    .pathname.split("/").filter(Boolean).at(-1) || "";
  expect(reviewInstanceId, "提交回执必须链接到真实审批实例").not.toBe("");
  const frozenTrial = await jsonOk<{
    answer: string;
    scope: string;
    citations: Array<{ page: number; source_url: string }>;
  }>(await api.post(`/api/approvals/v2/instances/${encodeURIComponent(reviewInstanceId)}/knowledge/trial`, {
    headers: { "X-Review-Company": nativeKnowledgeAuth.company },
    data: { query: "这份资料讲了什么？" },
  }));
  expect(frozenTrial.answer).toContain("这份资料讲了什么？");
  expect(frozenTrial.scope).toContain("本次审批版本试算");
  expect(frozenTrial.citations).toEqual([
    expect.objectContaining({ page: 1, source_url: expect.stringContaining("#page=1") }),
  ]);

  if (process.env.E2E_AUTH_MODE === "enabled") {
    const instanceId = await independentlyApprove(browser, api, reviewUrl!);
    const durableJobs = await postgresQuery<{ id: string }>(
      "SELECT id FROM execution_jobs WHERE job_type='knowledge.publication' AND tenant_ref=$1 AND payload_json::jsonb->>'instanceId'=$2",
      [nativeKnowledgeAuth.company, instanceId],
    );
    expect(durableJobs, "独立审批应入队唯一真实持久发布作业").toHaveLength(1);
    const durableJobId = durableJobs[0].id;
    expect(await processExecutionJobById(durableJobId, "wave6-knowledge-admin-publication")).toMatchObject({
      execution_job_id: durableJobId,
      job_type: "knowledge.publication",
      handled: true,
      outcome: "processed",
    });
    await expect.poll(async () => {
      const detail = await jsonOk<{ document: { status: string } }>(await api.get(`/api/admin/knowledge/documents/${docId}`));
      return detail.document.status;
    }, { timeout: 15000, message: "独立批准后的持久发布作业必须真实发布资料" }).toBe("published");
  }

  // 6) 归档收尾：不再参与检索，留给下次运行干净环境。
  const archived = await api.post(`/api/admin/knowledge/documents/${docId}/archive`);
  expect(archived.ok(), await archived.text()).toBeTruthy();
});
