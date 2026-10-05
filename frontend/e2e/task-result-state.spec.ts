import { test, expect } from "@playwright/test";

for (const [agent, ready, label] of [
  ["listening", true, "结果已生成"],
  ["listening", false, "结果待验收"],
  ["waiting_approval", true, "待你确认"],
] as const) {
  test(`task result state ${label} agrees across middle and right columns`, async ({ page }) => {
    const sid = "result-state-session";
    await page.addInitScript(() => sessionStorage.setItem("task:result-state-session", "result-state-task"));
    await page.route("**/api/tasks/result-state-task", route => route.fulfill({ json: {
      id: "result-state-task", title: "产品咨询", task_type: "product_consult", status: "waiting",
      execution: { run_id: "run", status: "completed", result_ready: ready },
    } }));
    await page.route("**/api/tasks/result-state-task/events", route => route.fulfill({ json: [] }));
    await page.route(`**/api/sessions/${sid}`, route => route.fulfill({ json: {
      agent_status: agent, messages: [
        { id: "op", session_id: sid, role: "assistant", kind: "operation_trace", created_at: new Date().toISOString(), payload: {
          active: false, title: "正在调用系统能力", items: [
            { id: "err", name: "runtime/list", label: "runtime/list", status: "failed" },
            { id: "lost", name: "unknown_call", status: "running" },
          ],
        } },
        { id: "result", session_id: sid, role: "assistant", kind: "task_result_card", created_at: new Date().toISOString(), payload: {
          title: "产品咨询", summary: "产品规格资料仍为草稿，尚未提交审批。", sections: [
            { title: "查询结果", body: "未检索到可引用的产品资料。请联系资料负责人提交审批，发布后重新查询。" },
          ],
        } },
      ],
    } }));
    await page.goto(`/s/${sid}`);
    await expect(page.locator("[data-run-status]")).toContainText(label);
    await expect(page.locator("[data-workbench] .side-status")).toContainText(label);
    await expect(page.locator("[data-run-status]")).not.toContainText("正在处理");
    const trace = page.locator('[data-kind="operation-trace"]');
    await expect(trace).toContainText("系统能力调用记录");
    await expect(trace).toContainText("失败");
    await expect(trace).toContainText("已中断");
    await expect(trace).not.toContainText("正在处理这项工作");
    await expect(page.locator("[data-task-analysis-summary]")).not.toContainText("正在处理");
    await expect(page.locator("[data-task-analysis-summary]")).toContainText(label);
    await expect(page.locator("[data-workbench]")).toContainText("产品规格资料仍为草稿");
  });
}
