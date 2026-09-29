import { test, expect, type Page } from "@playwright/test";

/**
 * 快捷指令预设是一次性的。
 *
 * 「今日任务」/「我的待办」只预填并锁定"这一次"规划：一旦用户在提问框里显式选了技能、
 * 或把正文改成自己的需求，这次提交就绝不能再启动 Codex 规划；反过来，离开 AI发现 后
 * 再点今日任务，也不能把提交偷偷变成一次采集。
 */

test.beforeEach(async ({ request }) => {
  await request.post("/api/demo/reset", { data: { workbench: true } });
  await request.post("/api/me/persona", { data: { persona: "sriphy" } });
});

function collectPosts(page: Page) {
  const fromText: Record<string, unknown>[] = [];
  const paths: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "POST") return;
    const path = new URL(request.url()).pathname;
    paths.push(path);
    if (path.endsWith("/from-text")) {
      try {
        fromText.push(request.postDataJSON() as Record<string, unknown>);
      } catch {
        /* ignore */
      }
    }
  });
  return { fromText, paths };
}

async function stubHome(page: Page) {
  const planPosts: string[] = [];
  await page.route("**/api/home/today-tasks**", (route) => route.fulfill({ json: { items: [] } }));
  await page.route("**/api/home/todo-tasks**", (route) => route.fulfill({ json: { items: [] } }));
  await page.route("**/api/home/today-brief**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "POST" && url.pathname.endsWith("/plan")) {
      planPosts.push(url.pathname);
      await route.fulfill({ json: { planning: true, attached: false, work_item_id: "tsk_today_plan" } });
      return;
    }
    await route.fulfill({ json: { planning: planPosts.length > 0, brief: null, events: [], creates_session: false, calls_model: false } });
  });
  await page.route("**/api/home/todo-brief**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "POST" && url.pathname.endsWith("/plan")) {
      planPosts.push(url.pathname);
      await route.fulfill({ json: { planning: true, attached: false, work_item_id: "tsk_todo_plan", task_type: "todo_plan" } });
      return;
    }
    await route.fulfill({ json: { planning: false, brief: null, events: [], creates_session: false, calls_model: false } });
  });
  await page.route("**/api/tasks/from-text", (route) => route.fulfill({
    json: {
      task: null,
      tasks: [],
      resolved_tasks: [],
      needs_clarification: true,
      clarification_kind: "missing_fields",
      clarification: "还缺必要字段",
      resolution: { missing_fields: ["topic"] },
    },
  }));
  await page.route("**/api/tasks**", (route) => (
    route.request().method() === "GET"
      ? route.fulfill({ json: { view: "open", tasks: [] } })
      : route.continue()
  ));
  return planPosts;
}

async function pickSkillFromPlus(page: Page, skillId: string, query: string) {
  await page.locator("[data-home] [data-attach]").click();
  const menu = page.getByRole("menu", { name: "添加内容" });
  await expect(menu).toBeVisible();
  await menu.locator("[data-composer-menu-search]").fill(query);
  const option = menu.locator(`[data-skill-option="${skillId}"]`);
  await expect(option).toBeVisible();
  await option.click();
}

test("今日任务预设下用 + 选技能后提交：走技能，不再启动规划", async ({ page }) => {
  const planPosts = await stubHome(page);
  const { fromText } = collectPosts(page);

  await page.goto("/?tab=today");
  await expect(page.locator('[data-home-pane="today"]')).toBeVisible();
  await expect(page.locator("[data-home] [data-composer-input]")).toHaveValue(/今日任务/);

  await pickSkillFromPlus(page, "reply_analysis", "回复分析");
  await expect(page.locator('[data-skill-chip="reply_analysis"]')).toContainText("回复分析");
  // 旧预设正文不能留下来当技能提示词。
  await expect(page.locator("[data-home] [data-composer-input]")).not.toHaveValue(/^今日任务$/);

  await page.locator("[data-home] [data-ai-prompt-submit]").click();
  await expect.poll(() => fromText.length).toBe(1);
  expect(fromText[0].task_type).toBe("reply_analysis");
  expect(fromText[0].intent).toBe("reply_analysis");
  expect(planPosts).toEqual([]);
});

test("今日任务预设下改成自己的需求再提交：不启动规划", async ({ page }) => {
  const planPosts = await stubHome(page);
  const { fromText } = collectPosts(page);

  await page.goto("/?tab=today");
  await expect(page.locator('[data-home-pane="today"]')).toBeVisible();
  await page.locator("[data-home] [data-composer-input]").fill("帮我整理这周跟小美妆日记的合作进度");

  await page.locator("[data-home] [data-ai-prompt-submit]").click();
  await expect.poll(() => fromText.length).toBe(1);
  expect(planPosts).toEqual([]);
});

test("先进 AI发现再点今日任务后提交：启动规划，不发起采集", async ({ page }) => {
  const planPosts = await stubHome(page);
  const { paths } = collectPosts(page);

  await page.goto("/?tab=discovery");
  await expect(page.locator('[data-home-pane="discovery"]')).toBeVisible();
  await page.locator('[data-home-mode="today"]').click();
  await expect(page.locator('[data-home-pane="today"]')).toBeVisible();
  await expect(page.locator("[data-home] [data-composer-input]")).toHaveValue(/今日任务/);

  await page.locator("[data-home] [data-ai-prompt-submit]").click();
  await expect.poll(() => planPosts.length).toBe(1);
  expect(planPosts[0]).toBe("/api/home/today-brief/plan");
  expect(paths).not.toContain("/api/home/discovery/run");
});

test("今日选过技能再切到我的待办提交：待办计划仍然启动，不被旧技能劫持", async ({ page }) => {
  const planPosts = await stubHome(page);
  const { fromText } = collectPosts(page);

  await page.goto("/?tab=today");
  await expect(page.locator('[data-home-pane="today"]')).toBeVisible();
  await pickSkillFromPlus(page, "reply_analysis", "回复分析");
  await expect(page.locator('[data-skill-chip="reply_analysis"]')).toContainText("回复分析");

  await page.locator('[data-home-mode="todo"]').click();
  await expect(page.locator('[data-home-pane="todo"]')).toBeVisible();
  await expect(page.locator("[data-home] [data-composer-input]")).toHaveValue(/整理我的待办任务/);

  await page.locator("[data-home] [data-ai-prompt-submit]").click();
  await expect.poll(() => planPosts.length).toBe(1);
  expect(planPosts[0]).toBe("/api/home/todo-brief/plan");
  expect(fromText).toEqual([]);
});
