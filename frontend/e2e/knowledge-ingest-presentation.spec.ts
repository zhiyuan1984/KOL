import { expect, test, type Page } from "@playwright/test";

async function fixture(page: Page, v2 = false) {
  const account = { id: "admin", name: "管理员", available_modes: ["admin", "employee"] };
  const common = { base_id: "base", base_name: "产品规格", filename: "产品规格.pdf", title: "产品规格", size_bytes: 603136, updated_at: "2026-10-05T09:03:00Z" };
  let documents = [{ ...common, id: "published", status: "published" }, { ...common, id: "pending", status: "pending_review" }];
  let detailFails = false;
  let ready = false;
  const writes: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown = [];
    if (path === "/api/health") json = { ok: true };
    else if (path === "/api/auth/status") json = { authenticated: true, account };
    else if (path === "/api/me") json = account;
    else if (path === "/api/preferences") json = { theme: "light" };
    else if (path.endsWith("/index-health")) json = { ok: true, mode: "real", pageindex: "unknown" };
    else if (path === "/api/admin/knowledge/bases") json = { bases: [{ id: "base", name: "产品规格", kind: "unstructured" }] };
    else if (path === "/api/admin/knowledge/documents") {
      if (route.request().method() === "POST") {
        writes.push("upload");
        const doc = { ...common, id: "uploaded", status: "uploaded" };
        documents = [...documents, doc];
        await new Promise(resolve => setTimeout(resolve, 500));
        json = { document: doc };
      } else json = { documents };
    } else if (path.endsWith("/publication-v2")) {
      json = { ...(v2 ? {} : { legacy: { updatedAt: common.updated_at } }), tenant: "test", templates: [], publication: v2 ? { tenant: "test", instanceId: "v2-approval", documentId: "pending", title: common.title, filename: common.filename, fingerprint: "real-version-fingerprint", releaseNote: "核对后申请", status: "waiting", reviewStatus: "reviewing", createdAt: common.updated_at, updatedAt: common.updated_at } : null, intake: { allowed: true, reason: "" } };
    } else if (path.endsWith("/publication")) {
      const published = path.includes("/published/");
      json = { tenant: "test", base_id: "base", version: 1, label: published ? "已发布" : ready ? "待提交审批" : "审批中", review_status: published ? "legacy" : ready ? "not_submitted" : "reviewing", publication_status: published ? "published" : "unpublished", allowed_actions: published ? ["create_revision"] : ready ? ["submit"] : ["view_review"], instance_id: published || ready ? null : "approval", binding: null, error: null, attempts: 0, blocking_reason: "" };
    } else if (path.endsWith("/review-prepare")) {
      json = { confirmationId: "confirmation", command: { action: "submit", values: {} }, material: { title: "产品规格", base_name: "产品规格", pages: 4, version: 1 }, summary: { consequence: "审批通过后将自动发布此版本" } };
    } else if (/\/documents\/[^/]+$/.test(path)) {
      if (detailFails) return route.fulfill({ status: 503, json: { detail: "详情暂不可用" } });
      json = { document: documents.find(doc => path.endsWith(doc.id)), base: { name: "产品规格" }, jobs: [{ id: "job", kind: "normalize", status: "done", attempt: 1, progress_total: 4, progress_done: 4 }], text_preview: { text: "加工结果正文" } };
    } else if (path.endsWith("/archive")) writes.push("archive");
    else if (path === "/api/approvals/v2/context") json = { tenant: "test", actor: "admin", admin: false, people: [] };
    await route.fulfill({ json });
  });
  await page.goto("/admin/knowledge/ingest?reviewCompany=test");
  await expect(page.locator("[data-admin-kb-documents-table]")).toBeVisible({ timeout: 20000 });
  return { writes, errors, ready: () => { ready = true; }, failDetails: () => { detailFails = true; }, recoverDetails: () => { detailFails = false; } };
}

test("紧凑工作表关联同名原文、加工结果和真实审批；空模块通过 Tab 查看", async ({ page }, testInfo) => {
  const f = await fixture(page);
  await expect(page.locator("[data-admin-kb-engine-health]")).toHaveText("PageIndex · 可用");
  await page.screenshot({ path: testInfo.outputPath("ingest-desktop.png"), fullPage: true });
  const pending = page.locator("[data-admin-kb-doc='pending']");
  await expect(pending).toContainText("审批中");
  await expect(pending).not.toContainText("待提交审批");
  await expect(pending).toContainText("同名资料");
  await pending.getByRole("button", { name: "查看审批进度" }).click();
  const detail = page.locator("[data-admin-kb-doc-detail-panel='pending']");
  await expect(detail).toContainText("加工结果正文");
  await expect(detail.getByRole("link", { name: /查看本次审批/ })).toHaveAttribute("href", /reviews\/approval/);
  expect(await detail.evaluate(el => el.closest("tr")?.previousElementSibling?.getAttribute("data-admin-kb-doc"))).toBe("pending");
  await page.getByRole("button", { name: "原文库 0" }).click();
  await expect(page.locator("[data-admin-knowledge-ingest]")).toContainText("暂无原文");
  await expect(page.locator("[data-admin-kb-documents]")).toHaveCount(0);
  await page.getByRole("button", { name: "提取作业 0" }).click();
  await expect(page.locator("[data-admin-kb-jobs]")).toContainText("还没有提取作业");
  expect(f.writes).toEqual([]);
  expect(f.errors).toEqual([]);
});

test("归档进入更多菜单且确认说明退出检索，取消不写入", async ({ page }) => {
  const f = await fixture(page);
  const row = page.locator("[data-admin-kb-doc='published']");
  await expect(row.locator("[data-admin-kb-doc-archive]")).not.toBeVisible();
  await row.getByText("更多", { exact: true }).click();
  await row.locator("[data-admin-kb-doc-archive]").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("不再参与检索");
  await dialog.locator("[data-admin-confirm-cancel]").click();
  expect(f.writes).toEqual([]);
});

test("上传立即展示可追踪传输记录，并保留同名提示", async ({ page }) => {
  const f = await fixture(page);
  await page.locator("[data-admin-kb-doc-base]").selectOption("base");
  await page.locator("[data-admin-kb-doc-file]").setInputFiles({ name: "产品规格.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 fixture") });
  await expect(page.locator("[data-admin-kb-doc-upload]")).toContainText("已有同名文件");
  await page.locator("[data-admin-kb-doc-upload-submit]").click();
  await expect(page.locator("[data-admin-kb-upload-progress]")).toBeVisible();
  await expect(page.locator("[data-admin-kb-doc='uploaded']")).toContainText("排队中");
  await expect(page.locator("[data-admin-receipt]")).toContainText("审批通过后自动发布");
  expect(f.writes).toEqual(["upload"]);
  expect(f.errors).toEqual([]);
});

test("详情失败可恢复，窄屏无页面横向溢出", async ({ page }) => {
  const f = await fixture(page);
  f.failDetails();
  await page.locator("[data-admin-kb-doc-detail='pending']").click();
  const detail = page.locator("[data-admin-kb-doc-detail-panel]");
  await expect(detail).toContainText("详情暂不可用");
  f.recoverDetails();
  await detail.getByRole("button", { name: "重试读取详情" }).click();
  await expect(detail).toContainText("加工结果正文");
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 700 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  expect(f.errors).toEqual([]);
});


test("待审资料在原位检查结果并确认审批，取消不提交", async ({ page }) => {
  const f = await fixture(page);
  f.ready();
  await page.reload();
  const row = page.locator("[data-admin-kb-doc='pending']");
  await row.getByRole("button", { name: "提交审批", exact: true }).click();
  const detail = page.locator("[data-admin-kb-doc-detail-panel='pending']");
  await expect(detail).toContainText("加工结果正文");
  await detail.getByLabel("发布说明").fill("核对原文和加工结果后申请发布");
  await detail.getByRole("button", { name: "提交审批", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "确认提交知识发布审批" });
  await expect(dialog).toContainText("审批通过后将自动发布");
  await dialog.locator("[data-admin-confirm-cancel]").click();
  await expect(detail.getByLabel("发布说明")).toHaveValue("核对原文和加工结果后申请发布");
  expect(f.writes).toEqual([]);
  expect(f.errors).toEqual([]);
});


test("新版发布审批保持原位并使用 publication-v2 的审批状态与真实入口", async ({ page }) => {
  const f = await fixture(page, true);
  const row = page.locator("[data-admin-kb-doc='pending']");
  await expect(row).toContainText("审批中");
  await row.getByRole("button", { name: "查看审批进度" }).click();
  const detail = page.locator("[data-admin-kb-doc-detail-panel='pending']");
  await expect(detail.getByRole("link", { name: /查看审批记录与处理入口/ })).toHaveAttribute("href", /reviews\/v2-approval/);
  await expect(detail).toContainText("real-version");
  expect(f.writes).toEqual([]);
  expect(f.errors).toEqual([]);
});
