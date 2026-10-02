import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * 非结构化资料流水线（P1，stub 引擎专用）：
 * 上传 → 规整 → 索引 → 待审 → 发布（L3 回执）→ 库详情试算（答案 + 页级引用）。
 * data-e2e 跨运行保留：base 幂等创建；用例末尾归档本次发布的资料。
 * 真实模式（装机 PageIndex 侧车）的质量验收走设计 §12.3 试点清单，不在本规格内。
 */
test.skip(process.env.E2E_MODE === "real", "This suite targets the deterministic stub knowledge engine.");

const BASE_CODE = "e2e_docs";

async function ensureBase(request: APIRequestContext): Promise<string> {
  const bases = await request.get("/api/admin/knowledge/bases")
    .then((response) => response.json() as Promise<{ bases: { id: string; code: string }[] }>);
  const hit = bases.bases.find((base) => base.code === BASE_CODE);
  if (hit) return hit.id;
  const domains = await request.get("/api/admin/knowledge/domains")
    .then((response) => response.json() as Promise<{ domains: { id: string; code: string }[] }>);
  let family = domains.domains.find((row) => row.code === `${BASE_CODE}_fam`);
  if (!family) {
    family = (await request.post("/api/admin/knowledge/domains", {
      data: { code: `${BASE_CODE}_fam`, name: "E2E 资料族", level: "family" },
    }).then((response) => response.json())).domain as { id: string; code: string };
  }
  let domain = domains.domains.find((row) => row.code === `${BASE_CODE}_dom`);
  if (!domain) {
    domain = (await request.post("/api/admin/knowledge/domains", {
      data: { code: `${BASE_CODE}_dom`, name: "E2E 资料域", level: "domain", parent_id: family.id },
    }).then((response) => response.json())).domain as { id: string; code: string };
  }
  const base = (await request.post("/api/admin/knowledge/bases", {
    data: { code: BASE_CODE, name: "E2E 资料库", domain_id: domain.id, kind: "unstructured" },
  }).then((response) => response.json())).base as { id: string };
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

async function openView(page: Page, path: string, view: string): Promise<void> {
  await page.goto(path);
  await expect(page.locator(`[data-admin-kb-view='${view}']`)).toBeVisible();
}

test("上传 PDF → 待审 → 发布（L3 回执）→ 库详情试算返回答案与页级引用", async ({ page, request }) => {
  await request.post("/api/me/persona", { data: { persona: "sriphy" } });
  const baseId = await ensureBase(request);
  await cleanupStaleDocs(request, baseId);
  const title = `e2e-doc-${Date.now()}`;
  const fileName = `${title}.pdf`;

  // 1) 入库：stub 引擎健康 → 上传入口真实可用
  await openView(page, "/admin/knowledge/ingest", "ingest");
  await expect(page.locator("[data-admin-kb-engine-health]")).toContainText("PageIndex");
  await page.locator("[data-admin-kb-doc-base]").selectOption(baseId);
  await page.locator("[data-admin-kb-doc-file]").setInputFiles({
    name: fileName,
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\nE2E stub fixture\n%%EOF\n", "utf8"),
  });
  await page.locator("[data-admin-kb-doc-upload-submit]").click();
  await expect(page.locator("[data-admin-receipt]")).toContainText("已上传");

  // 2) 真实进度推进到待审（以服务端状态为准）
  const doc = await waitDocumentStatus(request, baseId, title, "pending_review");
  const docId = String(doc.id);

  // 3) 待处置：发布（L3 确认 + 持久回执）
  await openView(page, "/admin/knowledge", "review");
  const row = page.locator(`[data-admin-kb-pending-doc='${docId}']`);
  await expect(row).toContainText(title);
  await row.locator(`[data-admin-kb-doc-publish='${docId}']`).click();
  await expect(page.locator("[data-admin-confirm='knowledge-document-publish']")).toBeVisible();
  await page.locator("[data-admin-confirm-ok]").click();
  await expect(page.locator("[data-admin-receipt]")).toContainText("已发布");

  // 4) 库详情：试算直接给答案 + 页级引用（未发布默认不参与，此处已发布）
  await openView(page, `/admin/knowledge/bases/${baseId}`, "base");
  await page.locator("[data-admin-kb-trial-question]").fill("这份资料讲了什么？");
  await page.locator("[data-admin-kb-trial-run]").click();
  const answer = page.locator("[data-admin-kb-trial-answer]");
  await expect(answer).toContainText("stub 试算答案");
  await expect(answer).toContainText("这份资料讲了什么？");
  await expect(page.locator(`[data-admin-kb-trial-citation='${docId}']`)).toContainText(title);

  // 5) 归档收尾：不再参与检索，留给下次运行干净环境
  const archived = await request.post(`/api/admin/knowledge/documents/${docId}/archive`);
  expect(archived.ok(), await archived.text()).toBeTruthy();
});
