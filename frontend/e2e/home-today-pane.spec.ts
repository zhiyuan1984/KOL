import { test, expect } from "@playwright/test";
import { paneBodyText } from "./kol-surface-stub";

test.beforeEach(async ({ request }) => {
  await request.post("/api/demo/reset", { data: { workbench: true } });
  await request.post("/api/me/persona", { data: { persona: "sriphy" } });
});

function dayIso(offset: number) {
  const day = new Date();
  day.setDate(day.getDate() + offset);
  return day.toISOString();
}

async function mockTodayBrief(page: import("@playwright/test").Page, body: Record<string, unknown> = {}) {
  // 今日面板的行来自服务端展示记忆（GET /api/home/today-tasks）。不 stub 它会落到
  // 真实 demo 数据，被测的内存任务就永远不出现在列表里 —— 这里固定为空，让被测
  // memory 成为唯一来源（空 items 时前端回落到 memory 列表）。
  await page.route("**/api/home/today-tasks**", (route) => route.fulfill({ json: { items: [] } }));
  await page.route("**/api/home/todo-tasks**", (route) => route.fulfill({ json: { items: [] } }));
  await page.route("**/api/home/today-brief**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { planning: false, brief: null, events: [], creates_session: false, ...body } });
      return;
    }
    await route.fulfill({ json: { planning: true, work_item_id: "tsk_plan", session_id: "ses_plan", run_id: "run_plan" } });
  });
}

test("entering today lists memory without planning; 启动今日任务 starts the run", async ({ page }) => {
  const todos = [
    {
      id: "tsk_due",
      title: "写报价确认邮件",
      source: "manual",
      status: "waiting",
      due_at: dayIso(0),
      description: "金额待确认",
    },
  ];
  // 一次规划只在被 POST 之后才算「进行中」：进入页面的 memory 读取不会把 planning 置真，
  // 否则第二次读到的 planning 会让人以为已有计划在跑，于是附着而不是启动。
  let planning = false;
  const posts: string[] = [];
  // 同 mockTodayBrief：今日面板的行来自服务端展示记忆，不 stub 会落到真实 demo 数据。
  await page.route("**/api/home/today-tasks**", (route) => route.fulfill({ json: { items: [] } }));
  await page.route("**/api/home/todo-tasks**", (route) => route.fulfill({ json: { items: [] } }));
  await page.route("**/api/home/today-brief**", async (route) => {
    const method = route.request().method();
    const url = new URL(route.request().url());
    if (method === "POST" && url.pathname.endsWith("/plan")) {
      posts.push(url.pathname);
      planning = true;
      await route.fulfill({ json: { planning: true, attached: false, work_item_id: "tsk_plan", creates_session: true } });
      return;
    }
    await route.fulfill({
      json: { planning, brief: null, events: [], creates_session: false, calls_model: false },
    });
  });
  await page.route("**/api/tasks**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { view: "open", tasks: todos } });
      return;
    }
    await route.continue();
  });

  await page.goto("/");
  await expect(page.locator('[data-home-pane="today"]')).toBeVisible();
  await expect(page.locator("[data-scope-workspace] [data-scope-ai-workspace]")).toBeVisible();
  await expect(page.locator("[data-scope-workspace] [data-scope-task-rail]")).toBeVisible();
  await expect(page.locator("[data-today-list]")).toBeVisible();
  await expect(page.locator('[data-today-todo="tsk_due"]')).toBeVisible();

  const taskRail = page.locator("[data-scope-task-rail]");
  const taskRailToggle = taskRail.locator(".scope-task-rail-toggle");
  await taskRailToggle.click();
  await expect(taskRail).toHaveClass(/is-collapsed/);
  await expect(taskRailToggle).toHaveAttribute("aria-expanded", "false");
  await expect(taskRailToggle).toContainText("今日任务");
  await taskRailToggle.click();
  await expect(taskRail).not.toHaveClass(/is-collapsed/);
  await expect(page.locator('[data-today-todo="tsk_due"]')).toBeVisible();
  // 进入今日只读记忆：没有 POST，计划按钮停在可点的「启动今日任务」。
  const startPlan = page.locator('[data-home-entry="plan-today"]');
  await expect(startPlan).toHaveText("启动今日任务");
  await expect(startPlan).toBeEnabled();
  await expect(page.locator('[data-home-pane="today"]')).not.toHaveText(/^正在为你规划今天$/);
  await page.waitForTimeout(1500);
  expect(posts).toEqual([]);

  // 手动启动才发 plan POST，规划过程随后才出现，任务列表始终不被替换。
  await startPlan.click();
  await expect.poll(() => posts.length, { timeout: 30000 }).toBe(1);
  await expect(page.locator("[data-today-plan-phase]")).toBeVisible();
  await expect(page.locator("[data-today-plan-phase]")).toHaveText(/Lucas 正在读取今天的任务|Lucas 正在规划今天的任务|Lucas 已完成规划/);
  await expect(page.locator('[data-today-todo="tsk_due"]')).toBeVisible();
});

test("sidebar 新工作任务 lands on today list without tab hop or recommend/queued copy", async ({ page }) => {
  await mockTodayBrief(page);
  await page.goto("/?tab=lifecycle");
  await expect(page.locator('[data-home-pane="lifecycle"]')).toBeVisible();
  await page.locator('[data-nav="new-task"]').click();
  await expect(page).toHaveURL(/\/(?:\?|$)/);
  await expect(page).not.toHaveURL(/[?&]tab=/);
  await expect(page.locator('[data-home-pane="today"]')).toBeVisible();
  await expect(page.locator("[data-today-list]")).toBeVisible();
  await expect(page.locator('[data-home-pane="today"]')).not.toContainText("已入队");
  await expect(page.locator('[data-home-pane="today"]')).not.toContainText("今天推荐");
  // tab 行与提问框是工作台 chrome（会带「我的待办」字样），内容断言只看页签正文。
  await expect.poll(() => paneBodyText(page, "today")).not.toContain("加入待办");
  await expect.poll(() => paneBodyText(page, "today")).not.toContain("正式待办");
  await expect.poll(() => paneBodyText(page, "today")).not.toContain("待办");
  await expect(page.locator("[data-recommended-tasks], [data-today-suggestions], [data-insight-list]")).toHaveCount(0);
  await expect(page.locator("[data-today-brief], [data-today-primary]")).toHaveCount(0);
});

test("today pane shows today-scheduled work items including unpromoted source=ai", async ({ page }) => {
  const todos = [
    {
      id: "tsk_high",
      title: "样品异常跟进",
      source: "manual",
      status: "failed",
      due_at: dayIso(-3),
      risk: "样品丢失争议",
      risk_level: "high",
      display_label: "处理",
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
      display_status: "waiting_approval",
      display_status_label: "审批中",
      display_verb: "approve",
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
      id: "tsk_ai_open",
      title: "画像补全",
      source: "ai",
      status: "pending",
    },
    {
      id: "tsk_ai_failed",
      title: "记状态争议",
      source: "ai",
      status: "failed",
      history_summary: "样品丢失争议",
    },
    {
      id: "tsk_ai_overdue",
      title: "失联跟进",
      source: "ai",
      status: "pending",
      due_at: dayIso(-2),
      next_action: "再写一封跟进",
    },
  ];
  const writes: string[] = [];
  await mockTodayBrief(page);
  await page.route("**/api/home/board", (route) => route.fulfill({
    json: { kols: [], tabs: [], tasks: todos, workbench: { today: todos.filter((row) => !["tsk_queued", "tsk_open", "tsk_ai_open"].includes(row.id)), todo: todos, recommendations: [{ id: "rec-1", title: "诱饵", reason: "不要出现", source: "ai" }] } },
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
  // 今日行集合：高优先 ∪ 今天起始/到期 ∪ 逾期 ∪ 进行中 ∪ 审批 ∪ 高风险 —— 共 7 行。
  // 任务板默认只渲染前 5 行（COLLAPSED_ROWS），所以先断言集合大小，再展开看具体行。
  await expect(page.locator("[data-today-list]")).toHaveAttribute("data-list-total", "7");
  await page.locator(".task-board-expand").click();
  await expect(page.locator("[data-today-todo]")).toHaveCount(7);
  // 状态文案是展示状态（后端 display_status_label 优先，缺省按日期/状态推导）：
  // 失败 / 延期 / 临期 / 进行中 —— 不再是旧分桶词（高风险/已逾期/今天到期）。
  await expect(page.locator('[data-today-todo="tsk_high"]')).toContainText("失败");
  await expect(page.locator('[data-today-todo="tsk_high"] [data-risk-level]')).toHaveText("风险高");
  await expect(page.locator('[data-today-todo="tsk_ai_failed"]')).toContainText("失败");
  await expect(page.locator('[data-today-todo="tsk_overdue"]')).toContainText("延期");
  await expect(page.locator('[data-today-todo="tsk_ai_overdue"]')).toContainText("延期");
  await expect(page.locator('[data-today-todo="tsk_due"]')).toContainText("临期");
  await expect(page.locator('[data-today-todo="tsk_run"]')).toContainText("进行中");
  await expect(page.locator('[data-today-todo="tsk_approval"]')).toContainText("审批中");
  await expect(page.locator('[data-today-todo="tsk_queued"], [data-today-todo="tsk_open"], [data-today-todo="tsk_ai_open"]')).toHaveCount(0);
  await expect(page.locator('[data-today-todo="tsk_high"] [data-today-todo-act]')).toHaveText("处理");
  await expect(page.locator('[data-today-todo="tsk_approval"] [data-today-todo-act]')).toHaveText("去审批");
  await expect(page.locator('[data-home-pane="today"]')).not.toContainText("已入队");
  await expect(page.locator('[data-home-pane="today"]')).not.toContainText("今天推荐");
  await expect.poll(() => paneBodyText(page, "today")).not.toContain("加入待办");
  await expect.poll(() => paneBodyText(page, "today")).not.toContain("正式待办");
  await expect.poll(() => paneBodyText(page, "today")).not.toContain("待办");
  await expect(page.locator('[data-home-pane="today"]')).not.toContainText("现在做这一件");
  await expect(page.locator("[data-recommended-task], [data-insight-card]")).toHaveCount(0);

  await page.locator('[data-today-todo="tsk_high"] [data-today-todo-act]').click();
  await expect.poll(() => writes).toEqual(["/api/tasks/tsk_high/acknowledge"]);
  await expect(page).toHaveURL(/\/s\/ses_high/);

  await page.goto("/");
  await expect(page.locator("[data-today-list]")).toBeVisible();
  await page.locator(".task-board-expand").click();
  await page.locator('[data-today-todo="tsk_approval"] [data-today-todo-act]').click();
  await expect.poll(() => writes).toEqual(["/api/tasks/tsk_high/acknowledge", "/api/tasks/tsk_approval/acknowledge"]);
  await expect(page).toHaveURL(/\/approvals\/apr_quote/);
});
