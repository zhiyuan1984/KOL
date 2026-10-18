import { test, expect } from "@playwright/test";

/**
 * The session page has one header and one result rail; switching views must not
 * duplicate the return link, the task title, or the result pointer.
 */
test("task session keeps one header and exposes result/status views", async ({ page }) => {
  const now = new Date().toISOString();
  await page.addInitScript(() => sessionStorage.setItem("task:rail-tabs-session", "task-rail-tabs"));
  await page.route("**/api/tasks/task-rail-tabs", route => route.fulfill({ json: {
    id: "task-rail-tabs",
    title: "达人库查询",
    description: "按关键词、合作阶段和风险标签分页查询红人库",
    source: "manual",
    status: "waiting",
    execution: { run_id: "run", status: "completed", result_ready: true },
  } }));
  await page.route("**/api/tasks/task-rail-tabs/events", route => route.fulfill({ json: [] }));
  await page.route("**/api/sessions/rail-tabs-session", route => route.fulfill({ json: {
    agent_status: "listening",
    messages: [
      { id: "me", kind: "me", created_at: now, payload: { text: "查询达人库" } },
      { id: "process", kind: "process_trace", created_at: now, payload: {
        title: "Preparing skill execution",
        items: [{ id: "step-1", label: "读取授权范围内的达人档案", status: "done" }],
      } },
      { id: "result-1", kind: "task_result_card", created_at: new Date(Date.now() - 2000).toISOString(), payload: {
        title: "达人库查询结果",
        summary: "第 1 页，共 20 条。",
        sections: [{ title: "本页达人", body: "| 名称 | 平台 |\n|---|---|\n| Small Plot | YouTube |" }],
      } },
      { id: "result-2", kind: "task_result_card", created_at: now, payload: {
        title: "达人库查询结果",
        summary: "匹配 236 位，本页 20 位。",
        sections: [{ title: "本页达人", body: "| 名称 | 平台 |\n|---|---|\n| Small Plot | YouTube |" }],
      } },
    ],
  } }));

  await page.goto("/s/rail-tabs-session");
  await expect(page.locator("[data-workbench]")).toBeVisible({ timeout: 15000 });

  // One header: one return link, one title, completion in the header.
  await expect(page.locator("[data-session-back-link]")).toHaveCount(1);
  await expect(page.locator("[data-complete-task]")).toHaveCount(0);
  await expect(page.locator("[data-session-terminal-status]")).toHaveText("已完成");
  await expect(page.locator("[data-session-stream-pane] h1")).toHaveCount(0);
  await expect(page.locator("[data-task-context]")).not.toHaveAttribute("open", "");
  await page.locator("[data-task-context] > summary").click();
  await expect(page.locator("[data-task-source]")).toHaveText("今天的工作");
  await expect(page.locator("[data-task-context] [data-session-back-link]")).toHaveCount(0);
  await expect(page.locator("[data-task-detail]")).toContainText("按关键词、合作阶段和风险标签分页查询红人库");

  // Result is the default view; the duplicate result stays in history.
  await expect(page.locator("[data-rail-tab='result']")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("[data-rail-tab='status']")).toBeVisible();
  await expect(page.locator("[data-rail-tab='debug']")).toHaveCount(0);
  await expect(page.locator("[data-round-results]")).toBeVisible();
  await expect(page.locator("[data-round-results] [data-result-message='result-2']")).toContainText("匹配 236 位");
  await expect(page.locator("[data-kind='task-result-pointer']")).toHaveCount(1);
  await expect(page.locator("[data-kind='result-pointer-history']")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "查看成果" })).toHaveCount(0);
  await page.locator("[data-rail-tab='status']").click();
  await expect(page.locator("[data-rail-result-history]")).toContainText("历史与阶段输出");
  await page.locator("[data-rail-result-history] summary").click();
  await page.locator("[data-rail-result-history] button").first().click();
  await expect(page.locator("[data-round-results] [data-result-message='result-1']")).toContainText("第 1 页");

  // Status view keeps the process readable and does not repeat engine jargon.
  await page.locator("[data-rail-tab='status']").click();
  await expect(page.locator("[data-rail-panel='status']")).toBeVisible();
  await expect(page.locator("[data-rail-panel='status']")).toContainText("读取授权范围内的达人档案");
  await expect(page.locator("[data-rail-panel='status']")).not.toContainText("Preparing skill execution");
  await expect(page.locator("[data-round-results]")).toBeHidden();

  await page.locator("[data-rail-tab='result']").click();
  await expect(page.locator("[data-round-results]")).toBeVisible();
});
