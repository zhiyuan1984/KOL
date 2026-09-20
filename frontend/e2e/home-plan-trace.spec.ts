import { test, expect } from "@playwright/test";

/**
 * The 思考过程 card must render the real harness trace, not a canned list:
 * Host phases, remote reads and the streaming reasoning summary each keep their
 * own row and their own state. A milestone row is complete the moment it is
 * written; only the row that is still streaming may spin.
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
    type: "run.think",
    status: "running",
    item_key: "reasoning:rs_1",
    title: "Codex 推理",
    summary: "先核对逾期项，再确认今天的报价邮件优先级。",
    created_at: "2026-09-20T06:51:07.000Z",
  },
];

async function mockPlanningTrace(page: import("@playwright/test").Page) {
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

test("thinking card renders the harness trace with per-row state, not a canned list", async ({ page }) => {
  await mockPlanningTrace(page);
  await page.goto("/");

  const card = page.locator("[data-today-plan-phase]");
  await expect(card).toBeVisible({ timeout: 20000 });
  await expect(card).toHaveAttribute("data-today-plan-phase", "planning");

  // Host phases and the remote read are rows of their own.
  for (const label of ["准备任务", "加载任务规则", "读取达人库 · creator_library_query"]) {
    await expect(page.locator(`[data-today-plan-event="${label}"]`)).toBeVisible();
  }
  await expect(page.locator('[data-today-plan-event="读取达人库 · creator_library_query"]'))
    .toHaveAttribute("data-today-plan-state", "done");

  // The milestone rows are done the moment they are written; only the streaming
  // reasoning row is running. This is what used to be hardcoded to "done".
  await expect(page.locator('[data-today-plan-event="已读取当前任务记忆"]'))
    .toHaveAttribute("data-today-plan-state", "done");
  await expect(page.locator('[data-today-plan-event="Codex 推理"]'))
    .toHaveAttribute("data-today-plan-state", "running");
  await expect(page.locator(".today-plan-step-spinner")).toHaveCount(1);

  // The reasoning summary is the visible thinking box, not a 4-line stub.
  const think = page.locator("[data-today-plan-think]");
  await expect(think).toBeVisible();
  await expect(think).toContainText("先核对逾期项");

  // While planning, the ask box is docked at the bottom instead of covering the card.
  await expect(page.locator("[data-composer-rhythm]")).toHaveAttribute("data-composer-rhythm", "dock");
  const cardBox = await card.boundingBox();
  const dockBox = await page.locator(".home-composer-dock").boundingBox();
  expect(cardBox).not.toBeNull();
  expect(dockBox).not.toBeNull();
  expect(dockBox!.y).toBeGreaterThan(cardBox!.y);
  // The card is not squeezed into a sliver by the hero composer.
  expect(cardBox!.height).toBeGreaterThan(120);
});

test("a failed run shows the failed step instead of a green check", async ({ page }) => {
  await mockPlanningTrace(page);
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

  await expect(page.locator('[data-today-plan-event="校验输出"]')).toHaveAttribute("data-today-plan-state", "failed");
  await expect(page.locator('[data-today-plan-event="今日规划未通过校验"]')).toHaveAttribute("data-today-plan-state", "failed");
  await expect(page.locator(".today-plan-step-spinner")).toHaveCount(0);
});
