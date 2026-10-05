import { test, expect, type Page } from "@playwright/test";
import { emptyReviewDefinition, type ReviewInstance } from "../../shared/review";
import type { InstanceView } from "../src/reviews/api";

async function workbench(page: Page) {
  const definition = emptyReviewDefinition();
  definition.name = "资料审批";
  definition.fields = [{ id: "note", label: "发布说明", type: "textarea", required: true }];
  const base: ReviewInstance = { id: "a", title: "同名申请", templateId: "flow", templateVersion: 4, version: 1, requester: "employee", definition, values: { note: "你好" }, currentNode: "review", status: "reviewing", round: 2, tasks: [{ id: "old", nodeId: "review", userId: "employee", round: 1, status: "superseded" }, { id: "current", nodeId: "review", userId: "employee", round: 2, status: "pending" }], createdAt: "2026-10-05T07:02:00Z", updatedAt: "2026-10-05T09:00:00Z" };
  let item: InstanceView = { ...base, allowedActions: ["approve", "reject", "transfer"], candidates: { transfer: ["reviewer"], countersign: [] }, events: [
    { id: "later", actor: "employee", action: "knowledge.published", version: 3, detail: {}, created_at: "2026-10-05T09:00:00Z" },
    { id: "earlier", actor: "employee", action: "approve", version: 2, detail: { reason: "核对无误" }, created_at: "2026-10-05T08:00:00Z" },
  ] };
  const requests: string[] = [], commands: unknown[] = [];
  let fail = false;
  await page.route("**/api/approvals/v2/**", async route => {
    const url = new URL(route.request().url());
    const path = url.pathname.split("/v2/")[1];
    if (path === "context") return route.fulfill({ json: { tenant: "test", actor: "employee", admin: false, people: [{ id: "employee", name: "黄启友", managerIds: [] }, { id: "reviewer", name: "负责人", managerIds: [] }] } });
    if (path === "companies") return route.fulfill({ json: [{ id: "test", name: "测试组织" }] });
    if (path === "templates") return route.fulfill({ json: [{ id: "flow", version: 4, publishedVersion: 4, definition }] });
    if (path === "notifications" || path === "drafts") return route.fulfill({ json: [] });
    if (path === "instance-page") { requests.push(url.search); return route.fulfill({ json: { items: [item, { ...item, id: "b", createdAt: "2026-10-05T07:03:00Z" }], nextCursor: null } }); }
    if (path === "instances/a" || path === "instances/b") return route.fulfill({ json: { ...item, id: path.endsWith("/b") ? "b" : "a" } });
    if (path === "prepare") return route.fulfill({ json: { confirmationId: "confirmed", summary: { name: "资料审批", version: 4, consequence: "记录决定" } } });
    if (path === "commands") {
      if (fail) return route.fulfill({ status: 503, json: { detail: "审批服务暂不可用" } });
      commands.push(route.request().postDataJSON());
      item = { ...item, status: "approved", allowedActions: [], tasks: item.tasks.map(t => t.status === "pending" ? { ...t, status: "approved" } : t) };
      return route.fulfill({ json: { id: "receipt", resourceId: "a" } });
    }
    return route.fulfill({ status: 404, json: { detail: "未配置测试接口" } });
  });
  return { requests, commands, setFail: () => { fail = true; }, setPublication: (publication: InstanceView["knowledgePublication"]) => { item = { ...item, status: "approved", allowedActions: [], knowledgePublication: publication }; } };
}

test("structured knowledge retains material version and manual publication state", async ({ page }) => {
  const f = await workbench(page);
  f.setPublication({ tenant: "test", instanceId: "a", documentId: "entry", title: "同名申请", filename: "结构化资料", fingerprint: "material-fingerprint", releaseNote: "核对后发布", status: "waiting", reviewStatus: "approved", version: 2, releaseMode: "manual", content: { body: "当前审批正文", structured: { 品牌: "LT" }, title: "结构化资料", kind: "spec" }, createdAt: "now", updatedAt: "now" });
  await page.goto("/approvals");
  await page.getByRole("button", { name: "同名申请", exact: true }).first().click();
  const detail = page.getByRole("region", { name: "申请详情" });
  await expect(detail.getByText("当前审批正文", { exact: true })).toBeVisible();
  await expect(detail.getByText("资料版本 v2", { exact: false })).toBeVisible();
  await expect(detail.getByText("流程版本 v4", { exact: false })).toBeVisible();
  await expect(detail.getByText("业务结果：等待管理员发布", { exact: true })).toBeVisible();
  await expect(detail.getByRole("link", { name: "查看 PDF 原件" })).toHaveCount(0);
});

test("list and detail preserve search and identity, keep current actions visible and fold history", async ({ page }) => {
  const f = await workbench(page);
  await page.goto("/approvals");
  const main = page.locator("main.review-workbench");
  await expect(main.getByRole("heading", { name: "审批中心" })).toBeVisible();
  await expect(main.getByRole("textbox", { name: "申请标题" })).toHaveCount(0);
  await expect(main.locator("tbody tr")).toHaveCount(2);
  const search = main.getByRole("textbox", { name: "搜索标题或流程名称" });
  await search.fill("同名"); await search.press("Enter");
  await expect.poll(() => f.requests.some(r => r.includes("q=%E5%90%8C%E5%90%8D"))).toBe(true);
  await main.getByRole("button", { name: "同名申请", exact: true }).first().click();
  const detail = main.getByRole("region", { name: "申请详情" });
  await expect(main.locator("tbody tr")).toHaveCount(2);
  await expect(search).toHaveValue("同名");
  await expect(detail.getByText("流程版本 v4", { exact: false })).toBeVisible();
  await expect(detail.getByText("你好", { exact: true })).toBeVisible();
  await expect(detail.locator("li[data-current] details")).toHaveAttribute("open", "");
  await expect(detail.locator(".review-event-list")).not.toBeVisible();
  await expect(detail.getByLabel("转交对象")).toHaveCount(0);
  await main.screenshot({ path: test.info().outputPath("approval-workbench.png") });
  await detail.getByRole("button", { name: "更多操作" }).click();
  await expect(detail.getByLabel("转交对象")).toBeVisible();
  await detail.getByText("操作记录", { exact: true }).click();
  await expect(detail.locator(".review-event-list li").first()).toContainText("意见：核对无误");
  await expect(detail.locator(".review-event-list li").last()).toContainText("知识已发布");
  for (const viewport of [{ width: 1024, height: 589 }, { width: 390, height: 667 }]) {
    await page.setViewportSize(viewport);
    await expect(detail.getByRole("button", { name: "同意", exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await detail.getByRole("button", { name: "返回列表" }).click();
  await expect(search).toHaveValue("同名");
  await expect(main.locator("tbody tr")).toHaveCount(2);
});

test("a decision requires confirmation and refreshes both list and read-only detail", async ({ page }) => {
  const f = await workbench(page); await page.goto("/approvals");
  await page.getByRole("button", { name: "同名申请", exact: true }).first().click();
  const detail = page.getByRole("region", { name: "申请详情" });
  await detail.getByLabel("处理意见", { exact: false }).fill("核对无误");
  await detail.getByRole("button", { name: "同意", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible(); expect(f.commands).toHaveLength(0);
  await dialog.getByRole("button", { name: "同意", exact: true }).click();
  await expect(detail.getByText("当前没有可执行动作 · 只读")).toBeVisible();
  await expect(detail.getByRole("button", { name: "同意", exact: true })).toHaveCount(0);
  await expect(page.locator("tbody tr").first()).toContainText("审批已通过");
  expect(f.commands).toHaveLength(1);
});

test("failed decisions retain comments and do not report success", async ({ page }) => {
  const f = await workbench(page); f.setFail(); await page.goto("/approvals");
  await page.getByRole("button", { name: "同名申请", exact: true }).first().click();
  const detail = page.getByRole("region", { name: "申请详情" });
  await detail.getByLabel("处理意见", { exact: false }).fill("保留我的意见");
  await detail.getByRole("button", { name: "同意", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "同意", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("审批服务暂不可用");
  await page.getByRole("dialog").locator("[data-admin-confirm-cancel]").click();
  await expect(detail.getByLabel("处理意见", { exact: false })).toHaveValue("保留我的意见");
  expect(f.commands).toHaveLength(0);
});

test("long dynamic forms keep draft and submit controls in view", async ({ page }) => {
  await workbench(page);
  await page.goto("/approvals");
  await page.getByRole("button", { name: "发起审批", exact: true }).click();
  await page.getByLabel("申请标题").fill("未提交的材料");
  await page.getByLabel("发布说明", { exact: false }).fill("材料内容\n".repeat(100));
  await page.setViewportSize({ width: 1024, height: 589 });
  await expect(page.getByRole("button", { name: "提交审批", exact: true })).toBeInViewport();
  await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeInViewport();
});

test("legacy expense intake stays hidden and approval success leaves the external receipt unresolved", async ({ page }) => {
  await page.route("**/api/approvals?**", route => route.fulfill({ json: [{ id: "expense", kind: "expense", title: "费用", brand: "LT", amount_usd: 5000, status: "consumed", business_status_label: "已办结", chain: ["manager"], chain_detail: [{ name: "黄启友", role: "负责人" }], current_index: 1, can_decide: false, allowed_actions: [], version: 1, receipts: { decision: "approved", gateway: "accepted", gateway_label: "网关已接受", external: "pending_check", external_label: "待核对" } }] }));
  await page.route("**/api/wecom/cards", route => route.fulfill({ json: [] }));
  await page.goto("/approvals/legacy");
  await expect(page.locator("[data-approval-initiate]")).not.toBeVisible();
  await page.locator(".approval-summary").click();
  await expect(page.locator("[data-receipt=decision]")).toContainText("审批已通过");
  await expect(page.locator("[data-receipt=external]")).toContainText("待核对");
  await expect(page.locator("[data-approval-detail]")).toHaveCount(0);
  await page.getByRole("button", { name: "发起费用审批", exact: true }).click();
  await expect(page.locator("[data-approval-initiate]")).toBeVisible();
});
