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

test("home discovery mock happy path never goes LIVE and stays out of followed KOL", async ({ page }) => {
  const livePosts: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "POST") return;
    const path = new URL(request.url()).pathname;
    if (LIVE_SIDE_EFFECT.test(path)) livePosts.push(path);
  });

  await page.goto("/");
  await openMode(page, "discovery");
  await expect(page.locator("[data-discovery-panel]")).not.toContainText(/MCP|Codex|MediaCrawler|Harness/);
  await expect(page.locator('[data-discovery-filter="platform"] option[value="tiktok"]')).toHaveCount(0);
  await expect(page.locator('[data-discovery-filter="platform"] option[value="youtube"]')).toHaveCount(1);
  await expect(page.locator('[data-discovery-filter="platform"] option[value="facebook"]')).toHaveCount(1);
  await page.locator("[data-discovery-query]").fill("找北美户外电源评测达人");
  await page.locator('[data-discovery-filter="platform"]').selectOption("youtube");
  await page.locator('[data-discovery-filter="region"]').selectOption("na");
  await page.locator("[data-discovery-plan]").click();
  await expect(page.locator("[data-discovery-plan-card]")).toBeVisible();
  await expect(page.locator("[data-discovery-plan-summary]")).toContainText("不会自动发信或改阶段");
  await expect(page.locator("[data-discovery-no-live]")).toBeVisible();
  await expect(page.locator("[data-discovery-panel]")).not.toContainText(/MCP|Codex|MediaCrawler|Harness/);

  await page.locator("[data-discovery-confirm-plan]").click();
  await expect(page.locator("[data-discovery-loading]")).toBeVisible();
  await expect(page.locator("[data-discovery-candidates]")).toBeVisible({ timeout: 8000 });
  await expect(page.locator("[data-discovery-candidate]").first()).toBeVisible();
  const handles = await page.locator("[data-discovery-candidate]").evaluateAll((els) => (
    els.map((el) => el.getAttribute("data-discovery-candidate") || "")
  ));
  expect(handles.length).toBeGreaterThan(0);
  expect(handles).toContain("trailpower_reviews");
  expect(handles).not.toContain("户外电源达人");
  expect(handles).not.toContain("营地灯测评娘");

  const first = page.locator("[data-discovery-candidate]").first();
  const handle = (await first.getAttribute("data-discovery-candidate")) || "";
  const favorite = first.locator("[data-discovery-favorite]");
  await favorite.scrollIntoViewIfNeeded();
  await favorite.click();
  await expect(first.locator("[data-discovery-favorite]")).toHaveAttribute("aria-pressed", "true");
  await first.locator("[data-discovery-follow]").click();
  await expect(page.locator("[data-discovery-follow-confirm]")).toBeVisible();
  await page.locator("[data-discovery-follow-yes]").click();
  await expect(first.locator("[data-discovery-followed]")).toContainText("跟进意向");
  expect(livePosts).toEqual([]);

  await openMode(page, "lifecycle");
  await expect(page.locator("[data-followed-kol-list]")).toBeVisible();
  await expect(page.locator("[data-discovery-candidate]")).toHaveCount(0);
  await expect(page.locator("[data-followed-kol-list]")).not.toContainText("trailpower_reviews");
  await expect(page.locator("[data-followed-kol-list]")).not.toContainText("camp_lantern_lab");
  await expect(page.locator(`[data-followed-kol="${handle}"]`)).toHaveCount(0);
  await expect(page.locator('[data-followed-kol="trailpower_reviews"]')).toHaveCount(0);
  await expect(page.locator("[data-followed-origin]")).toHaveAttribute("data-followed-origin", "collaboration");
  expect(livePosts).toEqual([]);
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
