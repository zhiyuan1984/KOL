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

test("todo pane lists open memory items including unpromoted source=ai", async ({ page }) => {
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
      id: "tsk_ai_failed",
      title: "记状态争议",
      source: "ai",
      status: "failed",
      history_summary: "样品丢失争议",
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
      title: "队列扫描",
      source: "manual",
      status: "queued",
    },
    {
      id: "tsk_ai_open",
      title: "画像补全",
      source: "ai",
      status: "pending",
    },
    {
      id: "tsk_done",
      title: "已完成复盘",
      source: "manual",
      status: "completed",
    },
  ];
  const writes: string[] = [];
  const sessionPosts: string[] = [];
  page.on("request", (item) => {
    if (item.method() !== "POST") return;
    const path = new URL(item.url()).pathname;
    if (path === "/api/sessions" || /\/collaborations\/[^/]+\/session$/.test(path) || path.endsWith("/run") || path.endsWith("/from-text")) {
      sessionPosts.push(path);
    }
  });
  await page.route("**/api/home/board", (route) => route.fulfill({
    json: {
      kols: [],
      tabs: [],
      tasks: todos,
      workbench: { open: todos.filter((row) => row.status !== "completed"), today: [], todo: todos },
    },
  }));
  await page.route("**/api/tasks**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (method === "GET" && url.pathname === "/api/tasks") {
      await route.fulfill({ json: { view: "open", tasks: todos } });
      return;
    }
    const ack = url.pathname.match(/^\/api\/tasks\/([^/]+)\/acknowledge$/);
    if (method === "POST" && ack) {
      writes.push(url.pathname);
      const id = decodeURIComponent(ack[1]);
      const row = todos.find((item) => item.id === id);
      await route.fulfill({
        json: {
          ...row,
          last_acted_at: new Date().toISOString(),
          acknowledged_at: new Date().toISOString(),
          creates_session: false,
          entry: "command",
        },
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

  await page.goto("/?tab=todo");
  await expect(page).toHaveURL(/[?&]tab=todo/);
  await expect(page.locator('[data-home-pane="todo"]')).toBeVisible();
  await expect(page.locator("[data-todo-list]")).toBeVisible();
  // 今日相关行只包括失败/高风险和今天到期；进行中与等审批也留在待办面板。
  await expect(page.locator("[data-today-todo]")).toHaveCount(4);
  // 原 tsk_ai_failed「高风险」桶行现在归今日面板，待办面板不再渲染该行。
  await expect(page.locator('[data-today-todo="tsk_ai_failed"]')).toHaveCount(0);
  // 分桶容器与「后续」文案随分桶分组移除；状态 chip 用 taskDisplayStatus 派生标签。
  await expect(page.locator('[data-today-todo="tsk_run"]')).toBeVisible();
  await expect(page.locator('[data-today-todo="tsk_approval"]')).toBeVisible();
  await expect(page.locator('[data-today-todo="tsk_queued"]')).toBeVisible();
  await expect(page.locator('[data-today-todo="tsk_queued"] [data-board-status]')).toHaveText("未开始");
  await expect(page.locator('[data-today-todo="tsk_queued"] [data-today-todo-act]')).toHaveText("打开");
  await expect(page.locator('[data-today-todo="tsk_ai_open"]')).toBeVisible();
  await expect(page.locator('[data-today-todo="tsk_ai_open"] [data-board-status]')).toHaveText("未开始");
  await expect(page.locator('[data-today-todo="tsk_done"]')).toHaveCount(0);
  await expect(page.locator('[data-home-pane="todo"]')).not.toContainText("已入队");
  await expect(page.locator('[data-home-pane="todo"]')).not.toContainText("今天推荐");
  await expect(page.locator('[data-home-pane="todo"]')).not.toContainText("待处理");
  await expect(page.locator('[data-home-pane="todo"]')).not.toContainText("加入待办");
  await expect(page.locator('[data-home-pane="todo"]')).not.toContainText("确认后才会出现");
  await expect(page.locator("[data-recommended-task], [data-insight-card]")).toHaveCount(0);
  expect(sessionPosts).toEqual([]);

  // 待办筛选已改为共享任务板的优先级筛选（全部/重要且紧急/…），原 later/all 过滤按钮移除。
  await page.locator('[data-today-todo="tsk_queued"] [data-today-todo-act]').click();
  await expect.poll(() => writes).toEqual(["/api/tasks/tsk_queued/acknowledge"]);
  await expect(page).toHaveURL(/[?&]tab=todo/);
  expect(sessionPosts).toEqual([]);
});

test("todo entry locks todo_plan without planning; composer submit starts the run", async ({ page }) => {
  const todos = [{
    id: "tsk_open",
    title: "无截止日期事项",
    source: "manual",
    status: "pending",
  }];
  const planPosts: string[] = [];
  // A todo plan counts as running only after /todo-brief/plan was posted; reading
  // the brief on entry must not look like a run that is already in flight.
  let planning = false;
  await page.route("**/api/home/todo-tasks**", (route) => route.fulfill({ json: { items: [] } }));
  await page.route("**/api/home/todo-brief**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "POST" && url.pathname.endsWith("/plan")) {
      planPosts.push(url.pathname);
      planning = true;
      await route.fulfill({ json: { planning: true, attached: false, work_item_id: "tsk_todo_plan", task_type: "todo_plan" } });
      return;
    }
    await route.fulfill({ json: { planning, brief: null, events: [], creates_session: false, calls_model: false } });
  });
  await page.route("**/api/tasks**", (route) => route.fulfill({ json: { view: "open", tasks: todos } }));

  await page.goto("/?tab=todo");
  await expect(page.locator('[data-home-pane="todo"]')).toBeVisible();
  await expect(page.locator("[data-todo-list]")).toBeVisible();
  const startPlan = page.locator('[data-home-entry="plan-todo"]');
  await expect(startPlan).toHaveText("启动待办任务");
  await expect(startPlan).toBeEnabled();
  await expect(page.locator('[data-skill-chip="todo_plan"]')).toHaveCount(0);
  await expect(page.locator("[data-home] [data-composer-input]")).toHaveValue(/整理我的待办任务/);
  await page.waitForTimeout(1500);
  expect(planPosts).toEqual([]);

  await page.locator("[data-home] [data-ai-prompt-submit]").click();
  await expect.poll(() => planPosts.length, { timeout: 30000 }).toBe(1);
  await expect(page.locator("[data-todo-list]")).toBeVisible();
});

test("tab=todo is a memory route and does not POST sessions", async ({ page }) => {
  const sessionPosts: string[] = [];
  page.on("request", (item) => {
    if (item.method() !== "POST") return;
    const path = new URL(item.url()).pathname;
    if (path === "/api/sessions" || /\/collaborations\/[^/]+\/session$/.test(path) || path.endsWith("/run") || path.endsWith("/from-text")) {
      sessionPosts.push(path);
    }
  });
  await page.goto("/?tab=todo");
  await expect(page.locator('[data-home-pane="todo"]')).toBeVisible();
  await expect(page.locator(".task-board-filters")).toBeVisible();
  await expect(page.locator('[data-home-pane="todo"]')).not.toContainText("已入队");
  await expect(page.locator('[data-home-pane="todo"]')).not.toContainText("今天推荐");
  await expect(page.locator('[data-home-pane="todo"]')).not.toContainText("待处理");
  expect(sessionPosts).toEqual([]);
});
