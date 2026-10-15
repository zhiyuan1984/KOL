import { expect, test, type Page } from "@playwright/test";

/** 当前紧凑资料表 → 原生资料工作区的迁移回归。
 * 旧表行曾重复渲染引擎状态、正文与审批；现行表只保留资料身份/原件/更多操作，
 * 加工正文、确认与真实审批在 “加工与审批” 的同一资产工作区完成。 */
async function fixture(page: Page, pptx = false) {
  const account = { id: "admin", name: "管理员", available_modes: ["admin", "employee"] };
  const common = { base_id: "base", base_name: "产品规格", filename: pptx ? "战略规划.pptx" : "产品规格.pdf", title: "产品规格", media_type: pptx ? "pptx" : "pdf", size_bytes: 603136, updated_at: "2026-10-05T09:03:00Z", created_at: "2026-10-05T08:00:00Z", ...(pptx ? { artifacts: { normalize: { mode: "pptx-convert" } } } : {}) };
  let documents: any[] = [{ ...common, id: "published", status: "published" }, { ...common, id: "pending", status: "pending_review" }];
  let detailFails = false;
  const writes: string[] = [], errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    let json: any = [];
    if (path === "/api/health") json = { ok: true };
    else if (path === "/api/auth/status") json = { authenticated: true, account };
    else if (path === "/api/me") json = account;
    else if (path === "/api/preferences") json = { theme: "light" };
    else if (path === "/api/cron/jobs") json = { jobs: [] };
    else if (path === "/api/admin/knowledge/workspace-v1") json = { tenant: "test", bases: [{ id: "base", name: "产品规格", kind: "unstructured", status: "active" }], domains: [], rows: documents.map(doc => ({ ...doc, asset_type: "document", kind: "document" })), total: documents.length, page: 1, page_size: 20, page_count: 1, facets: { view: { all: documents.length, values: { pending_review: 1, published: 1 } }, kind: { all: documents.length, values: { document: documents.length } }, brand: { all: documents.length, values: {}, unbranded: documents.length }, stage: { all: documents.length, values: {}, empty: documents.length }, family: { all: documents.length, values: {} }, domain: { all: documents.length, values: {} }, base: { all: documents.length, values: { base: documents.length } } }, stats: { status: { draft: 0, pending_review: 1, published: 1, archived: 0 }, pending_review: { count: 1, max_wait_days: 1 }, pending_documents: { count: 1, max_wait_days: 1 }, expiring: { count: 0, nearest: null } } };
    else if (path.endsWith("/index-health")) json = { ok: true, mode: "stub", pageindex: "available" };
    else if (path === "/api/admin/knowledge/bases") json = { bases: [{ id: "base", name: "产品规格", kind: "unstructured", status: "active" }] };
    else if (path === "/api/admin/knowledge/domains") json = { domains: [] };
    else if (path === "/api/admin/knowledge/raw") json = [];
    else if (path === "/api/admin/knowledge/jobs") json = [];
    else if (path === "/api/admin/knowledge/documents") {
      if (method === "POST") { writes.push("upload"); const uploaded = { ...common, id: "uploaded", filename: "产品规格.pdf", status: "uploaded" }; documents = [...documents, uploaded]; json = { document: uploaded }; }
      else json = { documents };
    } else if (/\/api\/admin\/knowledge\/documents\/[^/]+$/.test(path)) {
      if (detailFails) return route.fulfill({ status: 503, json: { detail: "详情暂不可用" } });
      const id = path.split("/").at(-1)!;
      json = { document: documents.find(doc => doc.id === id), base: { name: "产品规格" }, jobs: [{ id: "job", kind: "normalize", status: "done", attempt: 1, progress_total: 4, progress_done: 4 }], text_preview: { text: "加工结果正文" }, actions: { edit: false, start: false, retry: false, cancel: false, revision: true } };
    } else if (path.endsWith("/archive")) { writes.push("archive"); json = { document: { id: "published" } }; }
    else if (path.endsWith("/publication-v2")) json = { legacy: { updatedAt: common.updated_at }, tenant: "test", templates: [], publication: null, intake: { allowed: true, reason: "" } };
    else if (path.endsWith("/scope")) json = { revision: 1, state: "checked", frozen: false, explanation: "产品规格", scope: { summary: "产品规格", topics: [], entities: [], question_types: [], limitations: [], unverified_notes: [], coverage: { status: "complete", unreadable_pages: [] }, evidence: [] }, job: null, actions: { edit: true, generate: true, check: false } };
    await route.fulfill({ json });
  });
  await page.goto("/admin/knowledge/ingest?reviewCompany=test");
  await expect(page.locator("[data-admin-kb-documents-table]")).toBeVisible();
  return { writes, errors, failDetails: () => { detailFails = true; }, recoverDetails: () => { detailFails = false; } };
}

test("PPTX 资料详情保留原件与逐页 PDF 预览，不触发发布", async ({ page }) => {
  const f = await fixture(page, true);
  await page.locator("[data-admin-kb-doc-detail='pending']").click();
  await expect(page.locator("[data-admin-kb-doc-open='pending']")).toHaveAttribute("href", /\/documents\/pending\/file\?company=test/);
  await expect(page.locator("[data-admin-kb-doc-preview='pending']")).toHaveText("预览逐页 PDF");
  expect(f.writes).toEqual([]); expect(f.errors).toEqual([]);
});

test("紧凑资料表保留同名独立性和原生工作区入口；空模块通过 Tab 查看", async ({ page }) => {
  const f = await fixture(page);
  await page.locator("[data-admin-kb-doc-detail='pending']").click();
  const detail = page.locator("[data-admin-kb-doc-detail-panel='pending']");
  await expect(detail).toContainText("同名资料 · 1");
  await expect(detail).toContainText("独立记录，未确认版本关系");
  await expect(detail.getByRole("link", { name: "加工与审批", exact: true })).toHaveAttribute("href", /assetId=pending/);
  await page.getByRole("button", { name: "原文库 0" }).click();
  await expect(page.locator("[data-admin-knowledge-ingest]")).toContainText("暂无原文");
  await page.getByRole("button", { name: "提取作业 0" }).click();
  await expect(page.locator("[data-admin-kb-jobs]")).toContainText("还没有提取作业");
  expect(f.writes).toEqual([]); expect(f.errors).toEqual([]);
});

test("归档在更多操作中说明退出检索；取消不写入", async ({ page }) => {
  const f = await fixture(page);
  await page.locator("[data-admin-kb-doc-details-link='published']").click();
  const detail = page.locator("[data-admin-kb-doc-detail-panel='published']");
  await detail.locator("summary").filter({ hasText: "更多操作" }).click();
  await detail.locator("[data-admin-kb-doc-archive='published']").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("不再参与检索");
  await dialog.locator("[data-admin-confirm-cancel]").click();
  expect(f.writes).toEqual([]); expect(f.errors).toEqual([]);
});

test("上传经知识创作工作区显示待上传文件并要求合法非结构化库", async ({ page }) => {
  const f = await fixture(page);
  await page.getByRole("tab", { name: "知识创作", exact: true }).click();
  await page.getByRole("button", { name: "上传文件", exact: true }).click();
  await page.locator("[data-kbv-upload-pick]").setInputFiles({ name: "产品规格.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 fixture") });
  await expect(page.locator("[data-kbv-upload-queue]")).toContainText("产品规格.pdf");
  await expect(page.locator("[data-kbv-upload-submit]")).toBeDisabled();
  await page.locator("[data-kbv-upload-scope] [data-kb-scope-base='base']").click();
  await expect(page.locator("[data-kbv-upload-submit]")).toBeEnabled();
  expect(f.writes).toEqual([]); expect(f.errors).toEqual([]);
});

test("资料详情失败可恢复，紧凑工作区窄屏不横向溢出", async ({ page }) => {
  const f = await fixture(page); f.failDetails();
  await page.locator("[data-admin-kb-doc-detail='pending']").click();
  const detail = page.locator("[data-admin-kb-doc-detail-panel='pending']");
  await expect(detail.getByRole("alert")).toContainText("详情暂不可用");
  f.recoverDetails(); await detail.getByRole("button", { name: "重试读取详情" }).click();
  await expect(detail.locator(".ant-descriptions")).toBeVisible();
  for (const width of [1440, 1024, 390]) { await page.setViewportSize({ width, height: 700 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); }
  expect(f.errors).toEqual([]);
});

test("待审资料在紧凑表原位提供加工与审批深链，确认流不在表行绕过", async ({ page }) => {
  const f = await fixture(page);
  await page.locator("[data-admin-kb-doc-detail='pending']").click();
  const link = page.locator("[data-admin-kb-doc-detail-panel='pending']").getByRole("link", { name: "加工与审批", exact: true });
  await expect(link).toHaveAttribute("href", /stage=published.*assetId=pending/);
  expect(f.writes).toEqual([]); expect(f.errors).toEqual([]);
});

test("新版审批资料仍以稳定资产 ID 进入当前工作区，不在表格伪造审批状态", async ({ page }) => {
  const f = await fixture(page);
  const row = page.locator("[data-admin-kb-doc='pending']");
  await expect(row).not.toContainText("审批中");
  await row.locator("[data-admin-kb-doc-details-link='pending']").click();
  await expect(page.locator("[data-admin-kb-doc-workspace='pending']")).toHaveAttribute("href", /assetId=pending/);
  expect(f.writes).toEqual([]); expect(f.errors).toEqual([]);
});
