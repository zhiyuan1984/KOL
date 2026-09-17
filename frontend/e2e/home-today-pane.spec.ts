import { test, expect } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  await request.post("/api/demo/reset", { data: { workbench: true } });
  await request.post("/api/me/persona", { data: { persona: "sriphy" } });
});

function dayIso(offset: number) {
  const day = new Date();
  day.setDate(day.getDate() + offset);
  return day.toISOString();
}

test("sidebar 新工作任务 lands on today list without tab hop or recommend/queued copy", async ({ page }) => {
  await page.goto("/?tab=lifecycle");
  await expect(page.locator('[data-home-pane="lifecycle"]')).toBeVisible();
  await page.locator('[data-nav="new-task"]').click();
  await expect(page).toHaveURL(/\/(?:\?|$)/);
  await expect(page).not.toHaveURL(/[?&]tab=/);
  await expect(page.locator('[data-home-pane="today"]')).toBeVisible();
  await expect(page.locator("[data-today-list]")).toBeVisible();
  await expect(page.locator('[data-home-pane="today"]')).not.toContainText("已入队");
  await expect(page.locator('[data-home-pane="today"]')).not.toContainText("今天推荐");
  await expect(page.locator("[data-recommended-tasks], [data-today-suggestions], [data-insight-list]")).toHaveCount(0);
  await expect(page.locator("[data-today-brief], [data-today-primary]")).toHaveCount(0);
});

test("today pane shows only risk/overdue/due/running/approval formal todos", async ({ page }) => {
  const todos = [
    {
      id: "tsk_high",
      title: "样品异常跟进",
      source: "manual",
      status: "failed",
      due_at: dayIso(-3),
      risk: "样品丢失争议",
      history_summary: "主流程已离开时间线",
      session_id: "ses_high",
    },
    {
      id: "tsk_overdue",
      title: "补寄样品",
      source: "manual",
      status: "pending",
      due_at: dayIso(-1),
      next_action: "核对物流",
    },
    {
      id: "tsk_due",
      title: "写报价确认邮件",
      source: "manual",
      status: "waiting",
      due_at: dayIso(0),
      description: "金额待确认",
    },
    {
      id: "tsk_run",
      title: "风险扫描",
      source: "manual",
      status: "in_progress",
      history_summary: "正在核对逾期合作",
    },
    {
      id: "tsk_approval",
      title: "审批报价",
      source: "manual",
      status: "waiting_approval",
      approval_id: "apr_quote",
      context: "等负责人确认",
    },
    {
      id: "tsk_queued",
      title: "已入队扫描",
      source: "manual",
      status: "queued",
    },
    {
      id: "tsk_open",
      title: "无截止日期事项",
      source: "manual",
      status: "pending",
    },
    {
      id: "tsk_ai",
      title: "今天推荐画像",
      source: "ai",
      status: "pending",
    },
  ];
  const writes: string[] = [];
  await page.route("**/api/home/board", (route) => route.fulfill({
    json: { kols: [], tabs: [], tasks: todos, workbench: { today: todos.filter((row) => !["tsk_queued", "tsk_open", "tsk_ai"].includes(row.id)), todo: todos, recommendations: [{ id: "rec-1", title: "今天推荐诱饵", reason: "不要出现", source: "ai" }] } },
  }));
  await page.route("**/api/tasks**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (method === "GET" && url.pathname === "/api/tasks") {
      await route.fulfill({ json: { view: "todo", tasks: todos } });
      return;
    }
    const ack = url.pathname.match(/^\/api\/tasks\/([^/]+)\/acknowledge$/);
    if (method === "POST" && ack) {
      writes.push(url.pathname);
      const id = decodeURIComponent(ack[1]);
      const row = todos.find((item) => item.id === id);
      await route.fulfill({
        json: { ...row, last_acted_at: new Date().toISOString(), acknowledged_at: new Date().toISOString(), creates_session: false, entry: "command" },
      });
      return;
    }
    const detail = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);
    if (method === "GET" && detail) {
      const id = decodeURIComponent(detail[1]);
      await route.fulfill({ json: todos.find((item) => item.id === id) || {} });
      return;
    }
    await route.continue();
  });

  await page.goto("/");
  await expect(page.locator('[data-home-pane="today"]')).toBeVisible();
  await expect(page.locator("[data-today-list]")).toBeVisible();
  await expect(page.locator("[data-today-todo]")).toHaveCount(5);
  await expect(page.locator('[data-today-todo="tsk_high"]')).toContainText("高风险");
  await expect(page.locator('[data-today-todo="tsk_overdue"]')).toContainText("已逾期");
  await expect(page.locator('[data-today-todo="tsk_due"]')).toContainText("今天到期");
  await expect(page.locator('[data-today-todo="tsk_run"]')).toContainText("进行中");
  await expect(page.locator('[data-today-todo="tsk_approval"]')).toContainText("审批中");
  await expect(page.locator('[data-today-todo="tsk_high"] [data-today-todo-act]')).toHaveText("处理");
  await expect(page.locator('[data-today-todo="tsk_approval"] [data-today-todo-act]')).toHaveText("去审批");
  await expect(page.locator('[data-home-pane="today"]')).not.toContainText("已入队");
  await expect(page.locator('[data-home-pane="today"]')).not.toContainText("今天推荐");
  await expect(page.locator('[data-home-pane="today"]')).not.toContainText("现在做这一件");
  await expect(page.locator("[data-recommended-task], [data-insight-card]")).toHaveCount(0);

  await page.locator('[data-today-todo="tsk_high"] [data-today-todo-act]').click();
  await expect.poll(() => writes).toEqual(["/api/tasks/tsk_high/acknowledge"]);
  await expect(page).toHaveURL(/\/s\/ses_high/);

  await page.goto("/");
  await page.locator('[data-today-todo="tsk_approval"] [data-today-todo-act]').click();
  await expect.poll(() => writes).toEqual(["/api/tasks/tsk_high/acknowledge", "/api/tasks/tsk_approval/acknowledge"]);
  await expect(page).toHaveURL(/\/approvals\/apr_quote/);
});
