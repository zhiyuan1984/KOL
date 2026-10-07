import { expect, test } from "@playwright/test";

/**
 * 中栏「思考过程」必须给真实产出（用户 2026-09-30 反馈「又造假」）：
 * - Host 里程碑是真实事件（写下时已收尾，status=done），界面不再替它猜状态；
 * - 模型写给员工的业务分析（brief.reasoning）随完成时刻一起展示，不藏在折叠里；
 * - 完成行是终态：标题/计时器必须收口，不能出现「正在整理 + ✓ 今日规划已完成」同框。
 */
test("settled plan shows the business analysis and a single completion time", async ({ page }) => {
  await page.route("**/api/workbench/tasks**", (route) => route.fulfill({ json: { items: [], page: { next_cursor: null } } }));
  await page.route("**/api/tasks**", (route) => route.fulfill({ json: { view: "open", tasks: [] } }));
  await page.route("**/api/home/today-tasks**", (route) => route.fulfill({ json: { items: [] } }));
  await page.route("**/api/workbench/plan", (route) => route.fulfill({
    json: {
      planning: false,
      brief: {
        lead: "今天先把采集恢复，再核对报价。",
        reasoning: [
          "先恢复失败采集，避免今天没有新线索。",
          "再把待确认报价一次性处理掉，减少来回。",
        ],
        stats: { unfinished: 2, candidates: 3 },
      },
      generated_at: "2026-09-20T06:52:00.000Z",
      events: [
        {
          id: "m1", sequence: 1, type: "run.progress", status: "done", item_key: "host:memory_read",
          title: "已读取当前任务记忆", summary: "未了结 2 项，已读入本轮上下文",
          created_at: "2026-09-20T06:51:00.000Z",
        },
        {
          id: "m2", sequence: 2, type: "run.progress", status: "done", item_key: "host:codex_submitted",
          title: "已提交 Codex 规划", summary: "Codex 正在做本轮业务分析",
          created_at: "2026-09-20T06:51:01.000Z",
        },
        {
          id: "s1", sequence: 3, type: "run.step", status: "done", item_key: "host:generating",
          title: "正在分析…", created_at: "2026-09-20T06:51:02.000Z",
        },
        {
          id: "c1", sequence: 4, type: "run.completed", status: "completed",
          title: "今日规划已完成", summary: "已更新今日展示",
          created_at: "2026-09-20T06:52:00.000Z",
        },
      ],
      creates_session: false,
      calls_model: false,
    },
  }));

  await page.goto("/");
  const stream = page.locator("[data-today-plan-phase]");
  await expect(stream).toBeVisible({ timeout: 20000 });

  // 完成行是终态：卡片收口成「整理完成」，计时器不再跳。
  await expect(stream).toContainText("整理完成");
  await expect(stream).toHaveAttribute("data-today-plan-open", "false");
  await expect(stream.locator("[data-today-plan-elapsed]")).toHaveCount(0);

  // 业务分析是真实产出且默认可读；整理时间集中显示在右栏摘要。
  const analysis = page.locator("[data-today-plan-analysis]");
  await expect(analysis).toBeVisible();
  await expect(analysis).toContainText("本次判断与依据");
  await expect(analysis).toContainText("先恢复失败采集");
  const finished = new Date("2026-09-20T06:52:00.000Z");
  const pad = (value: number) => String(value).padStart(2, "0");
  await expect(page.locator("[data-today-brief]")).toContainText("整理于");
  await expect(page.locator("[data-today-brief]")).toContainText(`${pad(finished.getHours())}:${pad(finished.getMinutes())}`);
});
