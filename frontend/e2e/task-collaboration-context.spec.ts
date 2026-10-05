import { expect, test, type Page } from "@playwright/test";

/** UI transport fixtures only; native persistence/permissions have separate tests. */
async function fixture(page: Page) {
  const counts = { total: 1, open: 1, blocked: 1, waiting_review: 0, completed: 0, automatic_created: 0, automatic_assigned: 0 };
  const task = { task_id: "fixture-task", title: "依赖核验测试任务", goal: "核验当前动作依赖", status: "open", priority: "normal", due_at: null, data_version: 1 };
  const order = { work_order_id: "fixture-next", template_code: "fixture_next", template_version: 1, template_title: "测试模板", status: "waiting_approval",
    title: "核验测试稿", objective: "核对版本", automation_level: "A3", primary_assignee: null, latest_decision: null };
  await page.route("**/api/task-work-orders/dashboard**", route => route.fulfill({ json: { summary: { tasks: { total: 1, open: 1, blocked: 1 }, work_orders: counts }, by_template: [],
    tasks: { items: [{ task, counts, current_blocking_work_order: order, next_work_order: order }], page: { total: 1, next_cursor: null } } } }));
  await page.route(/\/api\/task-work-orders\/fixture-task$/, route => route.fulfill({ json: { task, counts, current_blocking_work_order: order, work_orders: [order], verified_events: [] } }));
  const review = { id: "fixture-review", company_id: "fixture-company", status: "approved", version: 2, round: 1 };
  let revoked = false, reads = 0;
  await page.route("**/api/task-work-orders/fixture-task/collaboration-context**", route => {
    reads++;
    return revoked ? route.fulfill({ status: 404, json: { detail: { code: "task_not_found_or_not_authorized" } } }) : route.fulfill({ json: {
      task_id: task.task_id, risk: "L1", calls_model: false, version: "fixture-version", cursor: 4, has_more: false,
      gates: [{ work_order_id: order.work_order_id, configured: true, allowed: false, blockers: ["artifact_version_conflict"], prerequisites: [], review }],
      events: [{ sequence: 4, source_type: "review", source_id: review.id, company_id: review.company_id, source_version: 2,
        before_state: { status: "reviewing" }, after_state: { status: "approved" }, occurred_at: "2026-10-05T06:00:00Z" }],
    } });
  });
  await page.goto("/tasks");
  await page.getByRole("region", { name: "业务任务及其标准工单" }).getByRole("button", { name: "详情", exact: true }).click();
  return { revoke: () => { revoked = true; }, reads: () => reads };
}

test("shows precise dependency reason and links the scoped approval without executing", async ({ page }) => {
  let writes = 0;
  page.on("request", request => { if (request.method() !== "GET" && request.url().includes("/api/")) writes++; });
  await fixture(page);
  const context = page.getByRole("region", { name: "审批与工单依赖" });
  await expect(context).toContainText("产物已变化，请复核新版本并重新审批");
  await expect(context.getByRole("link", { name: "审批详情" })).toHaveAttribute("href", "/reviews/fixture-review?reviewCompany=fixture-company");
  await expect(context).toContainText("版本 2");
  await context.getByText("关联变化记录", { exact: true }).click();
  await expect(context).toContainText("审批中 → 已通过");
  expect(writes).toBe(0);
});

test("deduplicates cursor replay and clears the entire task cache when access is revoked", async ({ page }) => {
  await page.clock.install();
  const control = await fixture(page);
  const context = page.getByRole("region", { name: "审批与工单依赖" });
  await expect(context).toContainText("版本 2");
  await page.clock.fastForward(15_100);
  await expect.poll(control.reads).toBeGreaterThan(1);
  await context.getByText("关联变化记录", { exact: true }).click();
  await expect(context.getByText("审批变化", { exact: true })).toHaveCount(1);
  control.revoke();
  await page.clock.fastForward(15_100);
  await expect(page.getByRole("dialog", { name: "AI 标准工单任务详情" })).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText("已清除缓存内容");
  await expect(page.getByRole("link", { name: "审批详情" })).toHaveCount(0);
});
