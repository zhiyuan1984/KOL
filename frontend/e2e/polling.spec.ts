import { test, expect, type Page, type Route } from "@playwright/test";
import { stubHomeBoardAndFollowing } from "./kol-surface-stub";

/**
 * 生产证据：单个浏览器最后 3000 条请求里 1960 条来自应用壳层（/api/tasks 1059、/api/sessions 989，
 * 499=1020 条客户端中止），后端单线程每个请求停顿 5–6s，/mail 首屏排在壳层轮询后面。
 *
 * 口径：Workbench 是 "/" 上唯一调用 GET /api/sessions 的地方，所以 /api/sessions 的次数与并发
 * 就是壳层轮询的次数与并发。首页首屏自己还读一次 GET /api/tasks（任务目录）与几次
 * ?view=open，所以 /api/tasks 只做计数，并发只看首轮之后（首轮那次是页面自己的目录读取）。
 */
const WINDOW_MS = 20_000;
const INTERVAL_MS = 15_000;
/** 人工延迟让并发在 route handler 里可见：真并发时两条请求的 handler 会同时驻留。 */
const ROUTE_LATENCY_MS = 150;

type PollLog = {
  sessionsAt: number[];
  tasksAt: number[];
  sessionsMaxOverlap: number;
  tasksMaxOverlap: number;
};

async function trackShellPolling(page: Page): Promise<PollLog> {
  const log: PollLog = { sessionsAt: [], tasksAt: [], sessionsMaxOverlap: 0, tasksMaxOverlap: 0 };
  const active = { sessions: 0, tasks: 0 };
  const hold = () => new Promise((resolve) => setTimeout(resolve, ROUTE_LATENCY_MS));

  await page.route("**/api/sessions**", async (route: Route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET" || url.pathname !== "/api/sessions") {
      await route.fallback();
      return;
    }
    active.sessions += 1;
    log.sessionsMaxOverlap = Math.max(log.sessionsMaxOverlap, active.sessions);
    log.sessionsAt.push(Date.now());
    await hold();
    await route.fulfill({ json: [] });
    active.sessions -= 1;
  });

  await page.route("**/api/tasks**", async (route: Route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== "GET" || url.pathname !== "/api/tasks" || url.search) {
      await route.fallback();
      return;
    }
    // 首轮是首页自己的目录读取（非壳层轮询），它与壳层挂载轮的并发不算壳层叠加；
    // 首轮之后还能并发，就只能是壳层自己叠出来的。
    const first = log.tasksAt.length === 0;
    log.tasksAt.push(Date.now());
    if (!first) {
      active.tasks += 1;
      log.tasksMaxOverlap = Math.max(log.tasksMaxOverlap, active.tasks);
    }
    await hold();
    await route.fulfill({ json: [] });
    if (!first) active.tasks -= 1;
  });

  return log;
}

test.beforeEach(async ({ page, request }) => {
  await request.post("/api/demo/reset", { data: { workbench: true } });
  await request.post("/api/me/persona", { data: { persona: "sriphy" } });
  // 板上无进行中的运行：首页自身的 4s 任务轮询不启动，/api/tasks 的并发只可能来自壳层。
  await stubHomeBoardAndFollowing(page, { kols: [], tabs: [{ code: "all", count: 0 }], tasks: [] });
});

test("壳层轮询 /api/sessions 串行且间隔 15s", async ({ page }) => {
  const log = await trackShellPolling(page);
  await page.goto("/");
  await expect(page.locator(".workbench")).toBeVisible();
  await expect.poll(() => log.sessionsAt.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(1);

  // 观察窗从挂载轮落地算起，保证窗内必然覆盖一个定时 tick。
  await page.waitForTimeout(WINDOW_MS);

  // 8s 间隔在 20s 窗内会发 3 次（挂载 + 8s + 16s）；15s 间隔只有 2 次。
  expect(log.sessionsAt.length).toBeLessThanOrEqual(2);
  // 同一时刻不得并发重复：上一次未返回时不再发下一次。
  expect(log.sessionsMaxOverlap).toBe(1);
  const gaps = log.sessionsAt.slice(1).map((at, index) => at - log.sessionsAt[index]);
  for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(INTERVAL_MS - 1000);
  // 两次读取合并成一次 Promise.all：每个 tick 都应伴随一次 /api/tasks 读取。
  const unpaired = log.sessionsAt.filter((at) => !log.tasksAt.some((taskAt) => Math.abs(taskAt - at) < 250));
  expect(unpaired).toEqual([]);
  expect(log.tasksMaxOverlap).toBe(1);
});

test("lingong:sessions-refresh 仍立即刷新，但被同一个闸门挡住不叠加", async ({ page }) => {
  const log = await trackShellPolling(page);
  await page.goto("/");
  await expect(page.locator(".workbench")).toBeVisible();
  await expect.poll(() => log.sessionsAt.length, { timeout: 10_000 }).toBe(1);
  await page.waitForTimeout(500);
  const before = log.sessionsAt.length;

  // 同一 tick 连发两次事件：第二次必须被闸门吃掉，最多只叠加出一条请求。
  await page.evaluate(() => {
    window.dispatchEvent(new Event("lingong:sessions-refresh"));
    window.dispatchEvent(new Event("lingong:sessions-refresh"));
  });
  await expect.poll(() => log.sessionsAt.length, { timeout: 10_000 }).toBe(before + 1);
  await page.waitForTimeout(500);

  expect(log.sessionsAt.length).toBe(before + 1);
  expect(log.sessionsMaxOverlap).toBe(1);
  expect(log.tasksMaxOverlap).toBe(1);
});
