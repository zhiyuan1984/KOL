import { test, expect, type Page } from "@playwright/test";

const LIVE_SIDE_EFFECT = /\/(send|confirm-stage|start-crawl|crawl-job|actions\/start-crawl)(?:\?|$)/;

async function openMode(page: Page, mode: "today" | "todo" | "discovery" | "lifecycle") {
  await page.locator(`[data-home-mode="${mode}"]`).click();
  await expect(page.locator(`[data-home-pane="${mode}"]`)).toBeVisible();
}

test.beforeEach(async ({ request }) => {
  await request.post("/api/demo/reset", { data: { workbench: true } });
  await request.post("/api/me/persona", { data: { persona: "sriphy" } });
});

test("home four-panel tab order and pane visibility", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("[data-home-mode]")).toHaveCount(4);
  expect(await page.locator("[data-home-mode]").evaluateAll((els) => (
    els.map((el) => el.getAttribute("data-home-mode"))
  ))).toEqual(["today", "todo", "discovery", "lifecycle"]);
  await expect(page.locator('[data-home-mode="today"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-home-mode="today"]')).toContainText("今日任务");
  await expect(page.locator('[data-home-mode="todo"]')).toContainText("我的待办");
  await expect(page.locator('[data-home-mode="discovery"]')).toContainText("AI发现");
  await expect(page.locator('[data-home-mode="lifecycle"]')).toContainText("我跟进的红人");

  await expect(page.locator("[data-home] h1")).toHaveText("今天有什么工作要处理？");
  await expect(page.locator('[data-home-pane="today"]')).toBeVisible();
  await expect(page.locator("[data-today-suggestions]")).toBeVisible();
  await expect(page.locator("[data-recommended-task]").first()).toContainText("今天推荐");
  await expect(page.locator('[data-home-pane="today"]')).not.toContainText("AI发现");
  await expect(page.locator("[data-suggest-cta='prefill']").first()).toBeVisible();
  await expect(page.locator("[data-suggest-cta='todo']").first()).toBeVisible();
  await expect(page.locator('[data-home-pane="todo"]')).toHaveCount(0);
  await expect(page.locator('[data-home-pane="discovery"]')).toHaveCount(0);
  await expect(page.locator('[data-home-pane="lifecycle"]')).toHaveCount(0);

  await openMode(page, "todo");
  await expect(page.locator("[data-home] h1")).toHaveCount(0);
  await expect(page.locator('[data-home-pane="todo"]')).toBeVisible();
  await expect(page.locator("[data-todo-filters]")).toBeVisible();
  await expect(page.locator("[data-todo-md]")).toBeVisible();
  await expect(page.locator("[data-today-suggestions]")).toHaveCount(0);
  await expect(page.locator("[data-discovery-panel]")).toHaveCount(0);

  await openMode(page, "discovery");
  await expect(page.locator("[data-home] h1")).toHaveCount(0);
  await expect(page.locator("[data-discovery-panel]")).toBeVisible();
  await expect(page.locator("[data-discovery-panel]")).toContainText("红人线索");
  await expect(page.locator("[data-discovery-panel]")).not.toContainText("加入待办");
  await expect(page.locator("[data-discovery-live]")).toHaveAttribute("data-discovery-live", "false");
  await expect(page.locator("[data-discovery-empty='idle']")).toBeVisible();

  await openMode(page, "lifecycle");
  await expect(page.locator("[data-home] h1")).toHaveCount(0);
  await expect(page.locator('[data-home-pane="lifecycle"]')).toBeVisible();
  await expect(page.locator("[data-followed-kol-column]")).toBeVisible();
  await expect(page.locator("[data-followed-origin]")).toHaveAttribute("data-followed-origin", "collaboration");
  await expect(page.locator("[data-discovery-candidate]")).toHaveCount(0);
});

test("home discovery persists plan and requires confirm before crawl or follow", async ({ page, request }) => {
  const livePosts: string[] = [];
  const discoveryPosts: string[] = [];
  const createdBodies: Array<Record<string, unknown>> = [];
  page.on("request", (item) => {
    if (item.method() !== "POST") return;
    const path = new URL(item.url()).pathname;
    if (LIVE_SIDE_EFFECT.test(path)) livePosts.push(path);
    if (path.startsWith("/api/discovery/")) discoveryPosts.push(path);
    if (path === "/api/discovery/requests") {
      createdBodies.push(item.postDataJSON() as Record<string, unknown>);
    }
  });

  await page.goto("/");
  await openMode(page, "discovery");
  await expect(page.locator("[data-discovery-panel]")).not.toContainText(/MCP|Codex|MediaCrawler|Harness|Job|stub/);
  await expect(page.locator('[data-discovery-filter="platform"]')).not.toContainText("全部平台");
  await expect(page.locator('[data-discovery-filter="platform"] [data-discovery-chip="tiktok"]')).toHaveCount(0);
  await expect(page.locator('[data-discovery-filter="platform"] [data-discovery-chip="youtube"]')).toHaveCount(1);
  await expect(page.locator('[data-discovery-filter="platform"] [data-discovery-chip="instagram"]')).toHaveCount(1);
  await expect(page.locator('[data-discovery-filter="platform"] [data-discovery-chip="facebook"]')).toHaveCount(1);
  await expect(page.locator('[data-discovery-filter="platform"] [data-discovery-chip="youtube"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-discovery-filter="region"] [data-discovery-chip="all"]')).toHaveText("不限地区");
  await expect(page.locator('[data-discovery-filter="region"] [data-discovery-chip="us"]')).toHaveText("美国");
  await expect(page.locator('[data-discovery-filter="region"] [data-discovery-chip="ca"]')).toHaveText("加拿大");
  await expect(page.locator('[data-discovery-filter="region"] [data-discovery-chip="eu"]')).toHaveText("欧洲");
  await expect(page.locator('[data-discovery-filter="region"] [data-discovery-chip="au"]')).toHaveText("澳洲");
  await page.locator("[data-discovery-query]").fill("找北美户外电源评测达人");
  await page.locator('[data-discovery-filter="platform"] [data-discovery-chip="youtube"]').click();
  await page.locator('[data-discovery-filter="region"] [data-discovery-chip="us"]').click();
  await page.locator("[data-discovery-add-direction]").click();
  await page.locator('[data-discovery-preset="户外电源"]').click();
  await expect(page.locator('[data-discovery-direction="户外电源"]')).toBeVisible();
  await expect(page.locator("[data-discovery-direction-popover]")).toHaveCount(0);
  await page.locator("[data-discovery-plan]").click();
  await expect(page.locator("[data-discovery-plan-card]")).toBeVisible();
  await expect(page.locator("[data-discovery-plan-card]")).toHaveAttribute("data-discovery-request-status", "open");
  await expect(page.locator("[data-discovery-confirm-plan]")).toBeVisible();
  await expect(page.locator("[data-discovery-follow-confirm]")).toHaveCount(0);
  await expect(page.locator("[data-discovery-plan-summary]")).toContainText("不会自动发信或改阶段");
  await expect(page.locator("[data-discovery-no-live]")).toBeVisible();
  await expect(page.locator("[data-discovery-panel]")).not.toContainText(/MCP|Codex|MediaCrawler|Harness/);
  expect(discoveryPosts.filter((path) => path.endsWith("/runs"))).toEqual([]);
  expect(livePosts).toEqual([]);

  const requestId = await page.locator("[data-discovery-request]").getAttribute("data-discovery-request");
  expect(requestId).toBeTruthy();
  const persisted = await request.get(`/api/discovery/requests/${requestId}`);
  expect(persisted.ok()).toBeTruthy();
  const body = await persisted.json() as {
    status?: string;
    status_label?: string;
    latest_run?: unknown;
    keywords?: string[];
    platforms?: string[];
    filters?: { region?: string; directions?: string[]; niche?: unknown };
  };
  expect(body.status).toBe("open");
  expect(body.status_label).toBe("待确认");
  expect(body.latest_run).toBeNull();
  expect(body.platforms).toEqual(["youtube"]);
  expect(createdBodies[0]?.platforms).toEqual(["youtube"]);
  expect(createdBodies[0]?.filters).toEqual({ region: "us", directions: ["户外电源"] });
  expect(createdBodies[0]?.filters).not.toHaveProperty("niche");
  expect(body.filters).toEqual({ region: "us", directions: ["户外电源"] });
  expect(body.filters).not.toHaveProperty("niche");
  expect(JSON.stringify(body)).not.toMatch(/MCP|Codex|MediaCrawler|Harness|crawl_job/i);

  const results = await request.get(`/api/discovery/requests/${requestId}/results`);
  expect(results.ok()).toBeTruthy();
  const resultBody = await results.json() as { pending_confirm?: boolean; candidates?: unknown[]; run?: unknown };
  expect(resultBody.pending_confirm).toBe(true);
  expect(resultBody.run).toBeNull();
  expect(resultBody.candidates || []).toEqual([]);

  await page.locator("[data-discovery-confirm-plan]").click();
  await expect(page.locator("[data-discovery-loading], [data-discovery-error]")).toBeVisible();
  expect(discoveryPosts.some((path) => path.includes("/runs"))).toBeTruthy();
  expect(discoveryPosts.some((path) => path.includes("/follow"))).toBeFalsy();
  expect(livePosts).toEqual([]);
  await expect(page.locator("[data-discovery-panel]")).not.toContainText(/MCP|Codex|MediaCrawler|Harness/);

  await openMode(page, "lifecycle");
  await expect(page.locator("[data-followed-kol-list]")).toBeVisible();
  await expect(page.locator("[data-discovery-candidate]")).toHaveCount(0);
  await expect(page.locator("[data-followed-origin]")).toHaveAttribute("data-followed-origin", "collaboration");
  expect(livePosts).toEqual([]);
});

test("home discovery chips keep query on reset and persist when editing plan", async ({ page }) => {
  await page.goto("/");
  await openMode(page, "discovery");
  const query = page.locator("[data-discovery-query]");
  await query.fill("找 Instagram 美国家庭旅行达人");
  await expect(page.locator('[data-discovery-filter="platform"] [data-discovery-chip="instagram"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-discovery-filter="region"] [data-discovery-chip="us"]')).toHaveAttribute("aria-pressed", "true");
  await page.locator("[data-discovery-add-direction]").click();
  await page.locator("[data-discovery-direction-input]").fill("家庭旅行");
  await page.locator("[data-discovery-direction-input]").press("Enter");
  await expect(page.locator('[data-discovery-direction="家庭旅行"]')).toBeVisible();
  await expect(page.getByLabel("删除方向：家庭旅行")).toBeVisible();
  await page.locator("[data-discovery-reset]").click();
  await expect(query).toHaveValue("找 Instagram 美国家庭旅行达人");
  await expect(page.locator('[data-discovery-filter="platform"] [data-discovery-chip="youtube"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-discovery-filter="region"] [data-discovery-chip="all"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-discovery-direction]")).toHaveCount(0);

  await page.locator('[data-discovery-filter="platform"] [data-discovery-chip="facebook"]').click();
  await page.locator('[data-discovery-filter="region"] [data-discovery-chip="ca"]').click();
  await page.locator("[data-discovery-add-direction]").click();
  await page.locator('[data-discovery-preset="户外露营"]').click();
  await expect(page.locator("[data-discovery-direction-popover]")).toHaveCount(0);
  await page.locator("[data-discovery-plan]").click();
  await expect(page.locator("[data-discovery-plan-card]")).toBeVisible();
  await page.locator("[data-discovery-cancel-plan]").click();
  await expect(query).toHaveValue("找 Instagram 美国家庭旅行达人");
  await expect(page.locator('[data-discovery-filter="platform"] [data-discovery-chip="facebook"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-discovery-filter="region"] [data-discovery-chip="ca"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-discovery-direction="户外露营"]')).toBeVisible();
});

test("today suggestion convert to todo dedupes", async ({ page }) => {
  await page.goto("/");
  await openMode(page, "todo");
  await expect(page.locator("[data-todo-card]").first()).toBeVisible({ timeout: 15000 });
  await openMode(page, "today");
  const firstSuggest = page.locator("[data-recommended-task]").first();
  const title = (await firstSuggest.locator("strong").innerText()).trim();
  const convert = page.locator("[data-suggestion-to-todo]").first();
  await expect(convert).toHaveText("加入待办");
  await convert.click();
  await expect(page.locator('[data-home-pane="todo"]')).toBeVisible();
  await expect(page.locator("[data-todo-card]").filter({ hasText: title })).toHaveCount(1);
  const afterFirst = await page.locator("[data-todo-card]").count();
  await openMode(page, "today");
  await expect(page.locator("[data-suggestion-to-todo]").first()).toHaveText("已在待办");
  await expect(page.locator("[data-suggestion-to-todo]").first()).toBeDisabled();
  await openMode(page, "todo");
  await expect(page.locator("[data-todo-card]").filter({ hasText: title })).toHaveCount(1);
  await expect(page.locator("[data-todo-card]")).toHaveCount(afterFirst);
});
