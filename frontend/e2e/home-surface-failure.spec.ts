import { test, expect, type Page } from "@playwright/test";

const GATEWAY_HTML = {
  status: 502,
  contentType: "text/html",
  body: "<html><head><title>502 Bad Gateway</title></head><body>bad gateway</body></html>",
};

async function openFollow(page: Page) {
  await page.locator('[data-home-mode="lifecycle"]').click();
  await expect(page.locator('[data-home-pane="lifecycle"]')).toBeVisible();
}

test.beforeEach(async ({ request }) => {
  await request.post("/api/demo/reset", { data: { workbench: true } });
  await request.post("/api/me/persona", { data: { persona: "sriphy" } });
});

test("跟进面读失败只在它自己的位置上说一次，并带重试与交给 Agent", async ({ page }) => {
  const sessionPosts: string[] = [];
  page.on("request", (item) => {
    if (item.method() === "POST" && new URL(item.url()).pathname.startsWith("/api/sessions")) {
      sessionPosts.push(new URL(item.url()).pathname);
    }
  });

  let followingHits = 0;
  let down = true;
  // 重试路径也要自成一体：不打真后端，board 用桩返回，断网/DB 锁不会污染断言。
  // 重试会带 ?refresh=1，所以模式必须匹配 query。
  await page.route("**/api/home/board*", (route) => (
    down ? route.fulfill(GATEWAY_HTML) : route.fulfill({ json: { kols: [], follow_scope: null, workbench: {} } })
  ));
  await page.route("**/api/home/following", (route) => {
    followingHits += 1;
    if (down) return route.fulfill(GATEWAY_HTML);
    return route.fulfill({
      json: { entry: "memory", kind: "memory", creates_session: false, index: "我的跟进", kols: [] },
    });
  });

  await page.goto("/");
  await openFollow(page);

  const empty = page.locator("[data-follow-empty='down']");
  await expect(empty).toBeVisible();
  // 只渲染一份：不再有跨模式的全局错误卡
  await expect(page.locator("[data-home-query-error]")).toHaveCount(0);
  // 正文是可读文案，底层 HTTP 原文只在 title 里留给排查
  await expect(page.locator("[data-follow-down-reason]")).toContainText("上游服务暂时不可用");
  await expect(page.locator("[data-follow-down-reason]")).not.toContainText("502");
  await expect(page.locator("[data-follow-down-reason]")).toHaveAttribute("title", /请求失败 \(502\)/);

  // 交给 Agent：把这一面的失败事实写进 Composer，不发请求、不建会话
  await page.locator("[data-follow-handoff-agent]").click();
  await expect(page.locator("[data-home] [data-composer-input]")).toHaveValue(/让 Agent 分析\/安排：跟进列表读取失败/);
  expect(sessionPosts).toEqual([]);

  // 重试真的重发这一面的读取，成功后失败态消失
  const before = followingHits;
  down = false;
  await page.locator("[data-follow-retry]").click();
  await expect.poll(() => followingHits).toBeGreaterThan(before);
  await expect(page.locator("[data-follow-empty='down']")).toHaveCount(0);

  // 切回默认模式，失败态不跟着跑
  await page.locator('[data-home-mode="today"]').click();
  await expect(page.locator("[data-home-query-error]")).toHaveCount(0);
  expect(sessionPosts).toEqual([]);
});

test("公海面读失败同样只在自己的位置上说一次", async ({ page }) => {
  await page.route("**/api/home/board*", (route) => route.fulfill(GATEWAY_HTML));
  await page.route("**/api/home/pool*", (route) => route.fulfill(GATEWAY_HTML));

  await page.goto("/?tab=pool");
  const empty = page.locator("[data-pool-empty='down']");
  await expect(empty).toBeVisible();
  await expect(page.locator("[data-home-query-error]")).toHaveCount(0);
  await expect(page.locator("[data-pool-down-reason]")).toContainText("上游服务暂时不可用");
  await expect(page.locator("[data-pool-retry]")).toBeVisible();
  await expect(page.locator("[data-pool-handoff-agent]")).toBeVisible();
});
