import { test, expect } from "@playwright/test";

/**
 * Entering 新工作任务 must reuse the last plan instead of re-running Codex.
 * Home keeps its planning memory in sessionStorage, so coming back to "/" from
 * another page (or a reload) must not fire another /today-brief/plan POST.
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
async function stubSlowChromeRequests(page: import("@playwright/test").Page) {
  await page.route("**/api/skills**", (route) => route.fulfill({ json: {} }));
}

test("re-entering 新工作任务 reuses the cached today plan", async ({ page }) => {
  const planPosts: string[] = [];
  await stubSlowChromeRequests(page);
  await page.route("**/api/tasks**", (route) =>
    route.fulfill({ json: { view: "open", tasks: [] } }),
  );
  await page.route("**/api/home/today-tasks**", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
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
        brief: { lead: "缓存内的今日结论" },
        events: [{ type: "run.completed", title: "今日规划已完成" }],
        creates_session: false,
        calls_model: false,
      },
    });
  });

  await page.goto("/");
  await expect.poll(() => planPosts.length, { timeout: 30000 }).toBe(1);
  await expect(page.locator("[data-today-plan-phase]")).toHaveText(/已按本轮规划刷新|收起/);

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

test("a stale cache expires and plans again", async ({ page }) => {
  const planPosts: string[] = [];
  await stubSlowChromeRequests(page);
  await page.route("**/api/tasks**", (route) =>
    route.fulfill({ json: { view: "open", tasks: [] } }),
  );
  await page.route("**/api/home/today-tasks**", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
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
        brief: { lead: "过期前结论" },
        events: [{ type: "run.completed", title: "今日规划已完成" }],
        creates_session: false,
        calls_model: false,
      },
    });
  });

  await page.goto("/");
  await expect.poll(() => planPosts.length, { timeout: 30000 }).toBe(1);
  // Age the cached plan past the 5 minute TTL, then re-enter Home. The cache is
  // written from a post-paint effect, so waiting for the POST is not enough —
  // aging before the write lands would leave a fresh cache and never re-plan.
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem("lingong:today-plan-cache") !== null), { timeout: 30000 })
    .toBe(true);
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
  await expect.poll(() => planPosts.length, { timeout: 30000 }).toBe(2);
});
