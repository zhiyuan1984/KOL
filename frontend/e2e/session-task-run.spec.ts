import { expect, test } from "@playwright/test";

/**
 * 会话任务页的运行状态诚实性（PROD-AGENT-09 / TECH-FE-03）：
 * 里程碑合成一条「任务进度」，停止的任务给出统一状态词与重新执行入口，
 * 右栏不再出现「本轮结果 · 结果」这类重复标题与占位废话。
 */
test("stopped task shows one progress block, a unified status and a retry entry", async ({ page }) => {
  const now = "2026-09-30T12:35:13.000Z";
  await page.route("**/api/sessions/task-stopped**", (route) => route.fulfill({
    json: {
      agent_status: "listening",
      messages: [
        { id: "me1", session_id: "task-stopped", role: "user", kind: "me", created_at: now, payload: { text: "今日 KOL 任务" } },
      ],
    },
  }));
  await page.route("**/api/tasks/by-session/task-stopped**", (route) => route.fulfill({
    json: {
      id: "tsk_stopped",
      session_id: "task-stopped",
      title: "今日 KOL 任务",
      status: "stopped",
      source: "manual",
      task_type: "creator_daily_tasks",
    },
  }));
  await page.route("**/api/tasks/tsk_stopped/events**", (route) => route.fulfill({
    json: [
      { id: "e1", type: "task.created", title: "今日 KOL 任务", status: "pending", summary: "任务已创建", created_at: now },
      { id: "e2", type: "run.started", title: "任务开始处理", status: "running", summary: "creator_daily_tasks", created_at: now },
      { id: "e3", type: "run.stopped", title: "已停止生成", status: "stopped", summary: "已保留已产生内容；可重新执行。", created_at: now },
    ],
  }));
  await page.route("**/api/tasks/tsk_stopped", (route) => route.fulfill({
    json: {
      id: "tsk_stopped",
      session_id: "task-stopped",
      title: "今日 KOL 任务",
      status: "stopped",
      source: "manual",
      task_type: "creator_daily_tasks",
    },
  }));
  const rerunPosts: string[] = [];
  page.on("request", request => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/sessions/task-stopped") rerunPosts.push(request.url());
  });
  await page.goto("/s/task-stopped");
  const trace = page.locator('[data-kind="process-trace"]');
  await expect(trace).toHaveCount(1);
  await expect(trace).toContainText("任务进度");
  await expect(trace).toContainText("任务已创建");
  await expect(trace).toContainText("已停止生成");
  // Stop is distinct from cancellation, with an explicit text and shape channel.
  const status = page.locator("[data-run-status='stopped']");
  await expect(status).toHaveCount(1);
  await expect(status.locator(".status-shape")).toBeVisible();
  await expect(status).toContainText("已停止");
  const rerun = page.locator("[data-rerun-task]");
  await expect(rerun).toBeVisible();
  await rerun.click();
  await expect(page.locator("[data-composer-input]")).toHaveValue("今日 KOL 任务");
  // Retry only restores an editable request; explicit send is still required.
  expect(rerunPosts).toEqual([]);
  const workbench = page.locator("[data-workbench]");
  await expect(workbench).not.toContainText("本轮结果 · 结果");
  await expect(workbench).not.toContainText("结果已生成");
  await expect(workbench).toContainText("系统不会自动重试");
});
