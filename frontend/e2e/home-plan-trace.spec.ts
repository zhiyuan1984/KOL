import { test, expect, type Page } from "@playwright/test";

/**
 * The 思考过程 stream must render the real harness trace, not a canned list:
 * Host phases, remote reads and the streaming reasoning summary each keep their
 * own row and their own state. Only the row that is still streaming may spin.
 */
test.beforeEach(async ({ request }) => {
  await request.post("/api/me/persona", { data: { persona: "sriphy" } });
});

const TRACE = [
  { id: "e1", sequence: 1, type: "run.progress", status: "running", title: "已读取当前任务记忆", created_at: "2026-09-20T06:51:00.000Z" },
  { id: "e2", sequence: 2, type: "run.progress", status: "running", title: "已打包来源增量", created_at: "2026-09-20T06:51:00.000Z" },
  { id: "e3", sequence: 3, type: "run.progress", status: "running", title: "已提交 Codex 规划", created_at: "2026-09-20T06:51:01.000Z" },
  { id: "e4", sequence: 4, type: "run.step", status: "done", item_key: "host:preparing", title: "准备任务", created_at: "2026-09-20T06:51:02.000Z" },
  { id: "e5", sequence: 5, type: "run.step", status: "done", item_key: "host:skill_ready", title: "加载任务规则", created_at: "2026-09-20T06:51:03.000Z" },
  {
    id: "e6",
    sequence: 6,
    type: "run.tool",
    status: "done",
    item_key: "op:creator_library_query",
    title: "读取达人库 · creator_library_query",
    summary: "creator_library_query",
    created_at: "2026-09-20T06:51:05.000Z",
  },
  {
    id: "e7",
    sequence: 7,
    type: "run.step",
    status: "running",
    item_key: "host:generating",
    title: "正在分析…",
    created_at: "2026-09-20T06:51:06.000Z",
  },
  {
    id: "e8",
    sequence: 8,
    type: "run.think",
    status: "running",
    item_key: "reasoning:rs_1",
    title: "Codex 推理",
    summary: "先核对逾期项，再确认今天的报价邮件优先级。",
    created_at: "2026-09-20T06:51:07.000Z",
  },
];

async function mockPlanningTrace(page: Page) {
  await page.route("**/api/tasks**", (route) => route.fulfill({ json: { view: "open", tasks: [] } }));
  await page.route("**/api/home/today-tasks**", (route) => route.fulfill({ json: { items: [] } }));
  await page.route("**/api/home/todo-brief**", (route) =>
    route.fulfill({ json: { planning: false, brief: null, events: [], creates_session: false } }));
  await page.route("**/api/home/today-brief**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "POST" && url.pathname.endsWith("/plan")) {
      await route.fulfill({ json: { planning: true, attached: false, work_item_id: "tsk_plan", creates_session: true } });
      return;
    }
    await route.fulfill({ json: { planning: true, brief: null, events: TRACE, creates_session: false, calls_model: false } });
  });
}

test("thinking stream renders the harness trace with per-row state, not a canned list", async ({ page }) => {
  await mockPlanningTrace(page);
  await page.goto("/");

  const stream = page.locator("[data-today-plan-phase]");
  await expect(stream).toBeVisible({ timeout: 20000 });
  await expect(stream).toHaveAttribute("data-today-plan-phase", "planning");

  // Host phases and the remote read are rows of their own.
  for (const label of ["准备任务", "加载任务规则", "读取达人库 · creator_library_query"]) {
    await expect(page.locator(`[data-today-plan-event="${label}"]`)).toBeVisible();
  }
  await expect(page.locator('[data-today-plan-event="读取达人库 · creator_library_query"]'))
    .toHaveAttribute("data-today-plan-state", "done");

  // The milestone rows are done the moment they are written, while the phase that
  // is actually in flight is the only one spinning. This is what used to be
  // hardcoded to "done".
  await expect(page.locator('[data-today-plan-event="已读取当前任务记忆"]'))
    .toHaveAttribute("data-today-plan-state", "done");
  await expect(page.locator('[data-today-plan-event="正在分析…"]'))
    .toHaveAttribute("data-today-plan-state", "running");
  await expect(page.locator(".today-plan-step-spinner")).toHaveCount(1);

  // The reasoning summary is the visible thinking box, and it is honest about
  // being reasoning (decision A) rather than the model's final answer.
  const think = page.locator("[data-today-plan-think]");
  await expect(think).toBeVisible();
  await expect(think).toContainText("Codex 推理");
  await expect(think).toContainText("先核对逾期项");

  // The button answers the click immediately.
  await expect(page.locator(".today-board-plan-btn")).toHaveAttribute("data-plan-state", "planning");
  await expect(page.locator(".today-board-plan-btn")).toBeDisabled();
});

test("the ask box is a footer and the workspace has exactly one scroll container", async ({ page }) => {
  await mockPlanningTrace(page);
  // A tall task list is what used to create a second, nested scroller.
  await page.route("**/api/tasks**", (route) => route.fulfill({
    json: {
      view: "open",
      tasks: Array.from({ length: 30 }, (_, i) => ({
        id: `tsk_${i}`,
        title: `任务 ${i}`,
        source: "manual",
        status: "pending",
        due_at: new Date().toISOString(),
      })),
    },
  }));

  for (const viewport of [{ width: 1440, height: 900 }, { width: 1264, height: 600 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.locator("[data-today-plan-phase]")).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(1500);

    const probe = await page.evaluate(() => {
      const scrollable = (el: Element): boolean => {
        const node = el as HTMLElement;
        const cs = getComputedStyle(node);
        if (!/(auto|scroll|overlay)/.test(cs.overflowY)) return false;
        return node.scrollHeight > node.clientHeight + 1;
      };
      const pane = document.querySelector(".home-pane");
      const found: string[] = [];
      if (pane) {
        for (const el of Array.from(pane.querySelectorAll("*"))) {
          if (el.matches("textarea, input, select")) continue;
          if (scrollable(el)) found.push(`${el.tagName.toLowerCase()}.${el.className}`);
        }
      }
      const dock = document.querySelector(".home-composer-dock") as HTMLElement | null;
      const stage = document.querySelector(".home-stage") as HTMLElement | null;
      return {
        found,
        docScrolls: document.documentElement.scrollHeight > window.innerHeight + 1,
        dockTop: dock ? Math.round(dock.getBoundingClientRect().top) : null,
        dockBottom: dock ? Math.round(dock.getBoundingClientRect().bottom) : null,
        stageBottom: stage ? Math.round(stage.getBoundingClientRect().bottom) : null,
        innerHeight: window.innerHeight,
      };
    });

    expect(probe.docScrolls, `${viewport.width}x${viewport.height} 不该有整页滚动`).toBe(false);
    // Exactly one scroll container, and it is the workspace stage.
    expect(probe.found.length, `${viewport.width}x${viewport.height} 滚动容器：${probe.found.join(" | ")}`).toBe(1);
    expect(probe.found[0]).toContain("home-stage");
    // The composer is a footer beside the scroll area, not a layer over it, and it
    // is fully on screen (it used to hang below the fold).
    expect(probe.dockTop!, "输入框不能压在滚动区上").toBeGreaterThanOrEqual(probe.stageBottom!);
    expect(probe.dockBottom!, "输入框必须完整在视口内").toBeLessThanOrEqual(probe.innerHeight + 1);
  }
});

test("a failed run shows the failed step and its reason instead of a green check", async ({ page }) => {
  await page.route("**/api/tasks**", (route) => route.fulfill({ json: { view: "open", tasks: [] } }));
  await page.route("**/api/home/today-tasks**", (route) => route.fulfill({ json: { items: [] } }));
  await page.route("**/api/home/todo-brief**", (route) =>
    route.fulfill({ json: { planning: false, brief: null, events: [], creates_session: false } }));
  await page.route("**/api/home/today-brief**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "POST" && url.pathname.endsWith("/plan")) {
      await route.fulfill({ json: { planning: true, attached: false, work_item_id: "tsk_plan", creates_session: true } });
      return;
    }
    await route.fulfill({
      json: {
        planning: false,
        brief: null,
        events: [
          ...TRACE.slice(0, 5),
          { id: "f1", sequence: 6, type: "run.step", status: "failed", item_key: "host:validating", title: "校验输出", created_at: "2026-09-20T06:51:20.000Z" },
          { id: "f2", sequence: 7, type: "run.failed", status: "failed", title: "今日规划未通过校验", summary: "Codex did not produce display_tasks", created_at: "2026-09-20T06:51:21.000Z" },
        ],
        creates_session: false,
        calls_model: false,
      },
    });
  });
  await page.goto("/");

  // Settled runs collapse to one line; the failure is still in the header, and
  // the step list is one click away. Wait for the collapse so the click below
  // can only mean "open".
  await expect(page.locator("[data-today-plan-phase]")).toHaveAttribute("data-today-plan-phase", "failed");
  await expect(page.locator("[data-today-plan-phase]")).toContainText("规划失败");
  await expect(page.locator("[data-today-plan-phase]")).toHaveAttribute("data-today-plan-open", "false");
  await page.locator(".today-plan-toggle").click();
  await expect(page.locator("[data-today-plan-phase]")).toHaveAttribute("data-today-plan-open", "true");
  await expect(page.locator('[data-today-plan-event="校验输出"]')).toHaveAttribute("data-today-plan-state", "failed");
  await expect(page.locator('[data-today-plan-event="今日规划未通过校验"]')).toHaveAttribute("data-today-plan-state", "failed");
  await expect(page.locator("[data-today-plan-phase]")).toContainText("Codex did not produce display_tasks");
  await expect(page.locator(".today-plan-spinner")).toHaveCount(0);
});

test("a settled run collapses to one line and expands on demand", async ({ page }) => {
  await page.route("**/api/tasks**", (route) => route.fulfill({ json: { view: "open", tasks: [] } }));
  await page.route("**/api/home/today-tasks**", (route) => route.fulfill({ json: { items: [] } }));
  await page.route("**/api/home/todo-brief**", (route) =>
    route.fulfill({ json: { planning: false, brief: null, events: [], creates_session: false } }));
  await page.route("**/api/home/today-brief**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "POST" && url.pathname.endsWith("/plan")) {
      await route.fulfill({ json: { planning: true, attached: true, work_item_id: "tsk_plan" } });
      return;
    }
    await route.fulfill({
      json: {
        planning: false,
        brief: {
          lead: "今天先恢复采集，再核查风险。",
          stats: { unfinished: 2, failed_runs: 1, discovery_anomalies: 1, candidates: 7 },
        },
        events: [
          ...TRACE.slice(0, 6),
          { id: "c1", sequence: 8, type: "run.completed", status: "completed", title: "今日规划已完成", created_at: "2026-09-20T06:52:00.000Z" },
        ],
        creates_session: false,
        calls_model: false,
      },
    });
  });
  await page.goto("/");

  const stream = page.locator("[data-today-plan-phase]");
  await expect(stream).toHaveAttribute("data-today-plan-open", "false");
  // Collapsed: one line, no step list.
  await expect(page.locator("[data-today-plan-steps]")).toHaveCount(0);
  await expect(stream).toContainText("Codex 已完成规划");
  await expect(stream).toContainText("分析");
  const collapsedHeight = (await stream.boundingBox())!.height;
  expect(collapsedHeight).toBeLessThan(80);

  // The summary is light text, and never a business action button.
  const summary = page.locator("[data-today-brief]");
  await expect(summary).toContainText("今天先恢复采集");
  await expect(summary).toContainText("2 项任务");
  await expect(page.locator("[data-today-primary]")).toHaveCount(0);

  await page.locator(".today-plan-toggle").click();
  await expect(stream).toHaveAttribute("data-today-plan-open", "true");
  await expect(page.locator("[data-today-plan-steps]")).toBeVisible();
  await expect(page.locator(".today-plan-toggle")).toContainText("收起过程");
});

test("the previous version folds to one row and the row keeps no duplicate priority", async ({ page }) => {
  await page.route("**/api/tasks**", (route) => route.fulfill({
    json: {
      view: "open",
      tasks: [{
        id: "tsk_1",
        title: "恢复美妆护肤类 YouTube 达人采集",
        source: "manual",
        status: "failed",
        due_at: new Date().toISOString(),
        priority: "high",
        layout_why: "采集失败，本轮集中出现多项同类异常。",
        display_verb: "retry",
      }],
    },
  }));
  await page.route("**/api/home/today-tasks**", (route) => route.fulfill({ json: { items: [] } }));
  await page.route("**/api/home/todo-brief**", (route) =>
    route.fulfill({ json: { planning: false, brief: null, events: [], creates_session: false } }));
  await page.route("**/api/home/today-brief**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "POST" && url.pathname.endsWith("/plan")) {
      await route.fulfill({ json: { planning: true, attached: true, work_item_id: "tsk_plan" } });
      return;
    }
    await route.fulfill({
      json: {
        planning: false,
        brief: { lead: "本轮先恢复采集。", stats: { unfinished: 1, failed_runs: 1, discovery_anomalies: 0, candidates: 12 } },
        events: [
          ...TRACE.slice(0, 6),
          { id: "c1", sequence: 9, type: "run.completed", status: "completed", title: "今日规划已完成", created_at: "2026-09-20T06:52:00.000Z" },
        ],
        previous_brief: { lead: "上一版先把报价邮件发出去。", stats: { unfinished: 2 } },
        previous_events: [
          { id: "p1", sequence: 1, type: "run.step", status: "done", item_key: "host:preparing", title: "上一版准备任务", created_at: "2026-09-20T06:40:00.000Z" },
          { id: "p2", sequence: 2, type: "run.completed", status: "completed", title: "上一版已完成", created_at: "2026-09-20T06:41:00.000Z" },
        ],
        creates_session: false,
        calls_model: false,
      },
    });
  });
  await page.goto("/");

  // 上一版默认折叠成一行（36-40px 量级），不与当前版本争视线。
  const previous = page.locator("[data-today-plan-previous]");
  await expect(previous).toBeVisible();
  await expect(previous).toContainText("上一版计划");
  await expect(previous).toContainText("2 项任务");
  await expect(page.locator(".today-plan-previous-body")).toHaveCount(0);
  const collapsed = (await previous.boundingBox())!.height;
  expect(collapsed).toBeLessThan(48);
  await previous.locator("button").click();
  await expect(page.locator(".today-plan-previous-body")).toContainText("上一版先把报价邮件发出去");

  // 任务行不再重复：优先级只出现一次，来源列已删，勾选列已删。
  const row = page.locator('[data-today-todo="tsk_1"]');
  await expect(row.locator("[data-priority-label]")).toHaveCount(0);
  await expect(row.locator("[data-board-status]")).toHaveCount(1);
  await expect(row.locator(".today-board-source-note")).toHaveCount(0);
  await expect(page.locator(".today-board-table thead")).not.toContainText("来源");
  await expect(page.locator(".today-board-check, .today-board-cell-check")).toHaveCount(0);
  // 今日 pane 不再出现「待办」字样（这是本条断言真正的意图）。
  await expect(page.locator('[data-home-pane="today"]')).not.toContainText("待办");
});
