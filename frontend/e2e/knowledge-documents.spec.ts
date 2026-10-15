import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";
import { knowledgeReviewDefinition } from "../../shared/review";
import { prepareNativeKnowledgeAdmin } from "./fixtures/native-knowledge-admin";

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

/**
 * Create a genuine, published knowledge-publication template through the
 * current review APIs. The named reviewer is the same native test principal
 * established above; this never changes roles, spoofs an operator, or skips
 * the later L3 submission confirmation.
 */
async function ensurePublishedKnowledgeTemplate(request: APIRequestContext): Promise<void> {
  const current = await jsonOk<Array<{ id: string; version: number; publishedVersion?: number | null; definition?: { subjectType?: string } }>>(
    await request.get("/api/admin/approval-types/v2/templates"),
  );
  const existing = current.find((template) => template.definition?.subjectType === "knowledge_publication" && template.publishedVersion);
  if (existing) return;

  const definition = knowledgeReviewDefinition();
  const review = definition.nodes.find((node) => node.type === "review");
  if (!review) throw new Error("知识发布模板必须包含人工审批节点");
  review.assignee = { kind: "named", userIds: ["sriphy"] };
  const created = await jsonOk<{ id: string; version: number }>(await request.post("/api/admin/approval-types/v2/templates", {
    data: { definition, creationKey: randomUUID() },
  }));
  const command = { action: "publish", templateId: created.id, expectedVersion: created.version };
  const prepared = await jsonOk<{ confirmationId: string }>(await request.post("/api/approvals/v2/prepare", { data: command }));
  await jsonOk(await request.post("/api/approvals/v2/commands", {
    data: { command, confirmationId: prepared.confirmationId, idempotencyKey: randomUUID() },
  }));
}

test("上传 PDF → 待审 → 发布（L3 回执）→ 库详情试算返回答案与页级引用", async ({ page, request }) => {
  // Keep the legacy coverage sequence, but route every visual action through
  // the current creation stage, document rail and publication-v2 form.
  expect((await request.post("/api/me/persona", { data: { persona: "sriphy" } })).ok()).toBeTruthy();
  const baseId = await ensureBase(request);
  await ensurePublishedKnowledgeTemplate(request);
  await cleanupStaleDocs(request, baseId);
  const title = `e2e-doc-${Date.now()}`;
  const fileName = `${title}.pdf`;

  // 1) 入库：stage=create 的现行上传面板强制选择合法非结构化库。
  await openStage(page, "/admin/knowledge?stage=create", "create");
  await page.locator("[data-kbv-upload]").click();
  const upload = page.locator("[data-kbv-upload-dialog]");
  await expect(upload).toBeVisible();
  await upload.locator("[data-kbv-upload-pick]").setInputFiles({
    name: fileName,
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\nE2E stub fixture\n%%EOF\n", "utf8"),
  });
  await expect(upload.locator("[data-kbv-upload-queue]")).toContainText(fileName);
  await expect(upload.locator("[data-kbv-upload-submit]")).toBeDisabled();
  await upload.locator(`[data-kbv-upload-scope] [data-kb-scope-base='${baseId}']`).click();
  await expect(upload.locator("[data-kbv-upload-submit]")).toBeEnabled();
  await upload.locator("[data-kbv-upload-submit]").click();
  await expect(page.locator("[data-admin-receipt]")).toContainText("资料已上传");

  // 2) 真实进度推进到待审（以服务端状态为准）
  const doc = await waitDocumentStatus(request, baseId, title, "pending_review");
  const docId = String(doc.id);

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
  await expect(publication.getByLabel("审批流程")).toHaveValue(/.+/);
  const submit = publication.locator("[data-kbv-doc-action='submit']");
  await expect(submit).toBeEnabled();
  await submit.click();
  const confirmation = page.getByRole("dialog", { name: "确认提交知识发布审批" });
  await expect(confirmation).toContainText("知识发布审批");
  await confirmation.getByRole("button", { name: "确认提交审批", exact: true }).click();
  await expect(page.locator("[data-admin-receipt]")).toContainText("已提交审批");
  await expect(page.locator("[data-workspace-mode='detail']")).toContainText("审批中");

  // 5) 旧“库详情试算”迁到当前冻结审批资料版本：答案和原件页级引用仍须可追溯。
  const reviewUrl = await publication.getByRole("link", { name: /查看审批记录与处理入口/ }).getAttribute("href");
  expect(reviewUrl).toBeTruthy();
  await page.goto(reviewUrl!);
  const material = page.getByRole("region", { name: "审批资料版本" });
  await expect(material).toContainText(title);
  await material.getByText("本次资料版本试算", { exact: true }).click();
  await material.getByLabel("试算问题").fill("这份资料讲了什么？");
  await material.getByRole("button", { name: "试算", exact: true }).click();
  await expect(material).toContainText("这份资料讲了什么？");
  await expect(material.getByRole("link", { name: /原文第\d+页/ })).toHaveCount(1);

  // 6) 归档收尾：不再参与检索，留给下次运行干净环境。
  const archived = await request.post(`/api/admin/knowledge/documents/${docId}/archive`);
  expect(archived.ok(), await archived.text()).toBeTruthy();
});
