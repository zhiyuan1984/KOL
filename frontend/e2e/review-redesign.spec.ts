import { expect, test, type Page } from "@playwright/test";
import { emptyReviewDefinition } from "../../shared/review";
import { reviewShellFixture } from "./review-shell-fixture";

async function fixture(page: Page) {
  await reviewShellFixture(page);
  const definition = { ...emptyReviewDefinition(), name: "费用申请", description: "填写费用依据后提交", fields: [{ id: "cost", label: "费用金额", type: "money" as const, required: true, currencies: ["CNY"], numeric: { precision: 12, scale: 2 } }] };
  const template = { id: "expense", version: 1, publishedVersion: 1, hasUnpublishedChanges: false, enabled: true, definition, updatedAt: "2026-10-17T00:00:00Z" };
  const instance = { id: "instance", templateId: "expense", templateVersion: 1, version: 1, definition, values: { cost: { amount: "1280.50", currency: "CNY" } }, title: "十月采购费用", requester: "employee", currentNode: "review", status: "reviewing", tasks: [{ nodeId: "review", userId: "reviewer", status: "pending", dueAt: "2026-01-01T00:00:00Z" }], allowedActions: [], events: [{ id: "event", actor: "employee", action: "submit", version: 1, detail: {}, created_at: "2026-10-17T00:00:00Z" }], createdAt: "2026-10-17T00:00:00Z", updatedAt: "2026-10-17T00:00:00Z" };
  const calls: string[] = [];
  await page.route("**/api/approvals/v2/**", async route => {
    const url = new URL(route.request().url()), p = url.pathname.split("/v2/")[1];
    calls.push(p + url.search);
    let json: unknown = [];
    if (p === "context") json = { tenant: "test", actor: "employee", admin: true, people: [{ id: "employee", name: "测试员工", managerIds: ["reviewer"] }, { id: "reviewer", name: "财务负责人", managerIds: [] }] };
    else if (p === "companies") json = [{ id: "test", name: "测试公司" }];
    else if (p === "templates") json = [template];
    else if (p === "instance-page") json = { items: url.searchParams.get("filter") === "cc" ? [] : [instance], nextCursor: null };
    else if (p === "instances/instance") json = instance;
    else if (p === "preview") json = { summary: { name: "十月采购费用", version: 1, consequence: "仅记录审批结果" }, trace: [{ nodeId: "review", type: "review", userIds: ["reviewer"] }] };
    await route.fulfill({ json });
  });
  await page.route("**/api/admin/approval-types/v2/templates", route => route.fulfill({ json: [template, { ...template, id: "budget", version: 2, publishedVersion: null, definition: { ...definition, name: "预算申请" } }] }));
  return calls;
}
test("employee inbox, scoped cc and detail sections show actual material and history", async ({ page }) => {
  const calls = await fixture(page); await page.goto("/approvals");
  const main = page.locator("main.review-page");
  await expect(main.getByText("1280.50 CNY", { exact: false })).toBeVisible();
  await expect(main.getByText(/已超时/)).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("employee-inbox.png") });
  await main.getByRole("button", { name: "十月采购费用", exact: true }).click();
  const detail = main.getByRole("region", { name: "申请详情" });
  await expect(detail.getByText("审批依据为提交时的材料快照", { exact: false })).toBeVisible();
  await detail.getByRole("button", { name: "审批进度", exact: true }).click();
  await expect(detail.getByRole("region", { name: "审批进度" }).getByText("财务负责人")).toBeVisible();
  await detail.getByRole("button", { name: "操作记录", exact: true }).click();
  await expect(detail.getByText("提交审批", { exact: false })).toBeVisible();
  await detail.getByRole("button", { name: "返回列表", exact: true }).click();
  await main.getByRole("button", { name: "抄送我的", exact: true }).click();
  await expect(main.getByText("流程到达抄送节点后，会出现在这里。")).toBeVisible();
  expect(calls.some(p => p.includes("filter=cc"))).toBe(true);
});
test("path preview does not submit and expires when employee changes material", async ({ page }) => {
  const calls = await fixture(page); await page.goto("/approvals");
  const main = page.locator("main.review-page");
  await main.getByRole("button", { name: "发起审批", exact: true }).click();
  await main.getByLabel("申请标题").fill("费用预览");
  await main.locator('[data-review-field="cost"] input').fill("1280.50");
  await main.getByLabel("费用金额币种").selectOption("CNY");
  await main.getByRole("button", { name: "核对申请与路径", exact: true }).click();
  await expect(main.getByLabel("申请核对", { exact: true }).getByText("财务负责人", { exact: true })).toBeVisible();
  await main.locator('[data-review-field="cost"] input').fill("42");
  await expect(main.getByLabel("申请核对", { exact: true }).getByText("财务负责人", { exact: true })).toHaveCount(0);
  expect(calls.some(p => p === "commands" || p === "prepare")).toBe(false);
});
test("admin filters template lifecycle and searches without editing or publishing", async ({ page }) => {
  const calls = await fixture(page); await page.goto("/admin/approval-types");
  const main = page.locator("main.review-page");
  await main.getByLabel("流程状态筛选").selectOption("unpublished");
  await expect(main.getByRole("button", { name: "预算申请", exact: true })).toBeVisible();
  await expect(main.getByRole("button", { name: "费用申请", exact: true })).toHaveCount(0);
  await main.getByLabel("搜索流程").fill("不存在");
  await expect(main.getByText("暂无匹配流程。可清空筛选或新建流程。")).toBeVisible();
  await main.getByLabel("搜索流程").fill("");
  await main.getByLabel("流程状态筛选").selectOption("all");
  await expect(main.getByRole("button", { name: "费用申请", exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("admin-catalog.png") });
  expect(calls.some(p => p === "commands" || p === "prepare")).toBe(false);
});
for (const viewport of [{ width: 390, height: 700 }, { width: 1024, height: 589 }]) test(`approval layout fits ${viewport.width}x${viewport.height}`, async ({ page }) => {
  await fixture(page); await page.setViewportSize(viewport); await page.goto("/approvals");
  const main = page.locator("main.review-page");
  await expect(main.getByRole("button", { name: "十月采购费用", exact: true })).toBeVisible();
  await main.getByRole("button", { name: "十月采购费用", exact: true }).click();
  await expect(main.getByRole("button", { name: "返回列表", exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("employee-detail.png") });
  await page.goto("/admin/approval-types");
  await expect(main.getByRole("button", { name: "费用申请", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("admin-templates.png") });
});
