import { test, expect, type Page } from "@playwright/test";

const skill = { id: "creator_library_query", title: "达人库查询", label: "达人库查询",
  description: "查询授权范围内的达人", granted: true, employee_visible: true,
  required_inputs: [], aliases: [], input_schema: [] };
const recovery = "当前入口没有可用的对应技能，请选择有使用资格的智能体或补充问题归属。";

async function fixture(page: Page) {
  const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
  const account = { id: "query-test-user", name: "查询测试员工", roles: [], available_modes: ["employee"] };
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown = [];
    if (route.request().method() === "POST") posts.push({ path, body: route.request().postDataJSON() || {} });
    if (path === "/api/auth/status") json = { authenticated: true, account };
    else if (path === "/api/me") json = account;
    else if (path === "/api/me/preferences") json = {};
    else if (path === "/api/task-definitions" || path === "/api/skills") json = [skill];
    else if (path === "/api/home/board") json = { kols: [], tabs: [], tasks: [], workbench: { today: [], todo: [] }, follow_scope: { required: false, bound: false } };
    else if (path === "/api/workbench/tasks" || path === "/api/tickets") json = { items: [], page: { next_cursor: null } };
    else if (path === "/api/workbench/plan") json = { planning: false, brief: null, events: [], creates_session: false };
    else if (path === "/api/home/today-tasks" || path === "/api/home/todo-tasks") json = { items: [] };
    else if (path === "/api/tasks") json = { tasks: [] };
    else if (path === "/api/tasks/from-text") json = { task: null, tasks: [], needs_clarification: true,
      requested_task_type: "creator_library_query", clarification_kind: "direction", clarification: recovery,
      resolution: { task_type: null, alternatives: [], missing_fields: [], next_action: recovery } };
    await route.fulfill({ json });
  });
  return posts;
}

async function selectQuery(page: Page) {
  await page.locator("[data-home] [data-attach]").click();
  const menu = page.getByRole("menu", { name: "添加内容" });
  await menu.locator("[data-composer-menu-search]").fill("达人库查询");
  await menu.locator('[data-skill-option="creator_library_query"]').click();
  await expect(page.locator('[data-skill-chip="creator_library_query"]')).toBeVisible();
}

test("empty query retains explicit skill and shows the actual blocker without a daily-planning prompt", async ({ page }) => {
  const posts = await fixture(page);
  await page.goto("/");
  await expect(page.locator("[data-scope-ai-empty]")).toContainText("启动今日任务");
  await selectQuery(page);
  await expect(page.locator("[data-home-title]")).toHaveText("达人库查询");
  await expect(page.locator("[data-scope-ai-empty]")).toHaveCount(0);
  await expect(page.locator("[data-task-intake-result]")).toContainText("尚无任务结果");
  await expect(page.getByText("今日工作计划", { exact: true })).toHaveCount(0);
  await expect(page.getByText("生成今日安排", { exact: true })).toHaveCount(0);
  await page.locator("[data-home] [data-ai-prompt-submit]").click();
  const feedback = page.locator("[data-creation-feedback]");
  await expect(feedback).toContainText("达人库查询暂未开始");
  await expect(feedback).toContainText(recovery);
  await expect(feedback).not.toContainText("需要确认任务方向");
  const intake = posts.filter(post => post.path === "/api/tasks/from-text");
  expect(intake).toHaveLength(1);
  expect(intake[0].body).toMatchObject({ task_type: "creator_library_query", intent: "creator_library_query" });
  expect(posts.some(post => post.path.includes("plan-runs") || /\/run$/.test(post.path))).toBe(false);
  await expect(page.locator("[data-scope-ai-empty]")).toHaveCount(0);
  await page.screenshot({ path: "test-results/query-context/query-blocked.png" });
  await page.locator('[data-home-mode="today"]').click();
  await expect(page.locator("[data-creation-feedback]")).toHaveCount(0);
  await expect(page.locator("[data-task-intake-result]")).toHaveCount(0);
  await expect(page.getByText("今日工作计划", { exact: true })).toBeVisible();
  await expect(page.locator("[data-scope-ai-empty]")).toContainText("启动今日任务");
});

test("unselected ambiguous text still asks for direction and hides the planning empty state", async ({ page }) => {
  await fixture(page);
  await page.route("**/api/tasks/from-text", route => route.fulfill({ json: {
    task: null, tasks: [], needs_clarification: true, clarification_kind: "direction",
    clarification: "请补充你要完成的工作", resolution: { task_type: null, missing_fields: [], alternatives: [] },
  } }));
  await page.goto("/");
  await page.locator("[data-home] [data-composer-input]").fill("帮我处理一下");
  await page.locator("[data-home] [data-ai-prompt-submit]").click();
  await expect(page.locator("[data-creation-feedback]")).toContainText("需要确认任务方向");
  await expect(page.locator("[data-scope-ai-empty]")).toHaveCount(0);
});

for (const viewport of [{ width: 375, height: 667 }, { width: 768, height: 600 }, { width: 1280, height: 720 }, { width: 1920, height: 1080 }]) {
  test(`query selection stays visible at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await fixture(page);
    await page.goto("/");
    await selectQuery(page);
    await expect(page.locator("[data-home-title]")).toHaveText("达人库查询");
    await expect(page.locator("[data-scope-ai-empty]")).toHaveCount(0);
    await expect(page.locator("[data-task-intake-result]")).toBeVisible();
    await expect(page.getByText("今日工作计划", { exact: true })).toHaveCount(0);
    await expect(page.locator("[data-home] [data-ai-prompt-submit]")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/query-context/query-${viewport.width}.png` });
  });
}
