import { test, expect } from "@playwright/test";

/**
 * 任务状态单点表达（DESIGN §8.6）：状态只在右栏出现一次，中栏不再有「分析摘要」。
 * 「结果已出、等你标记完成」与需要人确认的高风险「待确认」必须分开表述。
 */
for (const [agent, ready, label, tone, glyph] of [
  ["listening", true, "结果已生成 · 待你标记完成", "done", "✓"],
  ["listening", false, "执行已结束 · 待你核对结果", "neutral", "○"],
  ["waiting_approval", true, "待确认 · 需要你确认后才会执行", "confirm", "⚠"],
] as const) {
  test(`task result state ${label} is stated once, in the right column`, async ({ page }) => {
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
    const workbench = page.locator("[data-workbench]");
    await expect(workbench.locator("[data-run-status]")).toContainText(label);
    await expect(workbench.locator("[data-run-status]")).toHaveAttribute("data-run-tone", tone);
    // 状态与形状一起表达，不靠颜色单通道（DESIGN §1 不变量 4）。
    await expect(workbench.locator("[data-run-status] .status-shape")).toHaveText(glyph);
    await expect(workbench.locator(".side-status")).toContainText(label);
    await expect(workbench.locator("[data-run-status]")).not.toContainText("正在处理");
    // 中栏不再另说一套状态，也没有「分析摘要」这一块。
    await expect(page.locator(".session-center [data-run-status]")).toHaveCount(0);
    await expect(page.locator("[data-task-analysis-summary]")).toHaveCount(0);
    await expect(page.locator("[data-run-status]")).toHaveCount(1);
    // 中栏三段式：页头与输入框固定在滚动区之外，只有消息流在滚（DESIGN §10.1）。
    await expect(page.locator(".session-center > header.task-detail-header")).toHaveCount(1);
    await expect(page.locator("[data-session-stream-pane] .task-detail-header")).toHaveCount(0);
    await expect(page.locator("[data-session-stream-pane] .session-composer")).toHaveCount(0);
    const trace = page.locator('[data-kind="operation-trace"]');
    await expect(trace).toContainText("系统能力调用记录");
    await expect(trace).toContainText("失败");
    await expect(trace).toContainText("已中断");
    await expect(trace).not.toContainText("正在处理这项工作");
    await expect(workbench).toContainText("产品规格资料仍为草稿");
  });
}
