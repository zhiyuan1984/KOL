import { test, expect, type Page } from "@playwright/test";

/**
 * Entering 新工作任务 reads memory only. The thinking run starts from
 * 启动今日任务 / 启动待办任务 and nowhere else: not on page entry, not on a tab
 * switch, not on coming back from another page.
 */
// No /api/demo/reset here: this spec stubs every endpoint it reads, and the
// reset restarts the library/mail sync, which races when files run in parallel.
test.beforeEach(async ({ request }) => {
  await request.post("/api/me/persona", { data: { persona: "sriphy" } });
});

/**
 * /api/skills and /api/skills/market are unrelated to plan caching; stubbing
 * them keeps this spec independent of the bundled skill catalog.
 */
async function stubSlowChromeRequests(page: Page) {
  await page.route("**/api/skills**", (route) => route.fulfill({ json: {} }));
}

/** Every plan POST is recorded; the brief GET answers with a settled plan. */
async function stubPlanEndpoints(page: Page, planPosts: string[], lead = "缓存内的今日结论") {
  await stubSlowChromeRequests(page);
  await page.route("**/api/tasks**", (route) => route.fulfill({ json: { view: "open", tasks: [] } }));
  await page.route("**/api/home/today-tasks**", (route) => route.fulfill({ json: { items: [] } }));
  await page.route("**/api/home/todo-tasks**", (route) => route.fulfill({ json: { items: [] } }));
  await page.route("**/api/home/todo-brief**", (route) =>
    route.fulfill({ json: { planning: false, brief: null, events: [], creates_session: false, calls_model: false } }));
  await page.route("**/api/home/today-brief**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "POST" && url.pathname.endsWith("/plan")) {
      planPosts.push(url.pathname);
      await route.fulfill({ json: { planning: true, attached: false, work_item_id: "tsk_plan" } });
      return;
    }
    await route.fulfill({
      json: {
        planning: false,
        brief: { lead },
        events: [{ type: "run.completed", title: "今日规划已完成" }],
        creates_session: false,
        calls_model: false,
      },
    });
  });
}

/** The cache is written from a post-paint effect, so wait for the write, not the POST. */
async function waitForPlanCache(page: Page) {
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem("lingong:today-plan-cache") !== null), { timeout: 30000 })
    .toBe(true);
}

test("entering 新工作任务 posts no plan; 启动今日任务 posts exactly one", async ({ page }) => {
  const planPosts: string[] = [];
  await stubPlanEndpoints(page, planPosts);

  await page.goto("/");
  await expect(page.locator('[data-home-pane="today"]')).toBeVisible();
  const start = page.locator('[data-home-entry="plan-today"]');
  await expect(start).toHaveText("启动今日任务");
  // Give the old behaviour time to fire; entry must stay memory-only.
  await page.waitForTimeout(3000);
  expect(planPosts).toEqual([]);

  await start.click();
  await expect.poll(() => planPosts.length, { timeout: 30000 }).toBe(1);
  await waitForPlanCache(page);

  // Leave Home completely, then come back through the sidebar link.
  await page.goto("/cron");
  await expect(page.locator('[data-home-pane="today"]')).toHaveCount(0);
  await page.locator('[data-nav="new-task"]').click();
  await expect(page.locator('[data-home-pane="today"]')).toBeVisible();
  await expect(page.locator("[data-today-plan-events]")).toBeVisible();

  // Give the old behaviour time to re-POST; the cache must prevent it.
  await page.waitForTimeout(6000);
  expect(planPosts.length).toBe(1);
});

test("a stale cache re-reads memory and still posts no plan", async ({ page }) => {
  const planPosts: string[] = [];
  await stubPlanEndpoints(page, planPosts, "过期前结论");

  await page.goto("/");
  await expect(page.locator('[data-home-pane="today"]')).toBeVisible();
  await expect(page.locator('[data-home-entry="plan-today"]')).toHaveText("启动今日任务");

  // Age the cached memory, then re-enter Home. Aging can only cost a memory read;
  // it must not turn into a planning run of its own.
  await page.evaluate(() => {
    for (const key of ["lingong:today-plan-cache", "lingong:todo-plan-cache"]) {
      const raw = sessionStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      parsed.timestamp = Date.now() - 6 * 60 * 1000;
      sessionStorage.setItem(key, JSON.stringify(parsed));
    }
  });
  await page.goto("/cron");
  await page.locator('[data-nav="new-task"]').click();
  await expect(page.locator('[data-home-pane="today"]')).toBeVisible();
  await page.waitForTimeout(3000);
  expect(planPosts).toEqual([]);
});
