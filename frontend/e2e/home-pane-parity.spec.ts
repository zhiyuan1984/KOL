import { test, expect, type Page } from "@playwright/test";

/**
 * 「我的待办」与「今日任务」必须是同一个工作台：DOM 骨架相同，请求只有 scope 路径不同。
 * 这是需求的可执行证据（CONST-10），不靠截图对比。（2026-09-23）
 */

test.beforeEach(async ({ request }) => {
  await request.post("/api/demo/reset", { data: { workbench: true } });
  await request.post("/api/me/persona", { data: { persona: "sriphy" } });
});

/** 工作台骨架：两页签必须逐项都在，且数量相同。 */
const SKELETON = [
  "[data-scope-workspace] [data-scope-ai-workspace]",
  "[data-scope-workspace] [data-scope-task-rail]",
  "[data-scope-workspace] .scope-task-rail-toggle",
  "[data-scope-workspace] [data-home-quick-tasks]",
  "[data-scope-workspace] [data-home-entry^='plan-']",
  "[data-scope-workspace] [data-list-total]",
  "[data-scope-workspace] [data-board-filter]",
  "[data-scope-workspace] .task-board-search",
  "[data-scope-workspace] [data-home-stats]",
  "[data-scope-workspace] .home-composer-dock",
] as const;

async function skeletonCounts(page: Page): Promise<number[]> {
  const counts: number[] = [];
  for (const selector of SKELETON) counts.push(await page.locator(selector).count());
  return counts;
}

async function filledPrimaryCount(page: Page, root: string): Promise<number> {
  const rgb = await page.evaluate(() => {
    const token = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim();
    const probe = document.createElement("span");
    probe.style.color = token;
    document.body.appendChild(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  return page.locator(root).locator("button").evaluateAll((els, target) => (
    els.filter((el) => {
      const style = getComputedStyle(el);
      if (style.backgroundColor !== target) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden";
    }).length
  ), rgb);
}

/** 固定视口工作台的几何：stage 不滚，中列与右栏各自滚，提问框贴视口底。 */
async function workspaceGeometry(page: Page, pane: string) {
  return page.evaluate((paneName) => {
    const root = document.querySelector(`[data-home-pane="${paneName}"]`) as HTMLElement;
    const overflowOf = (el: Element | null) => (el ? getComputedStyle(el as HTMLElement).overflowY : null);
    const dock = root.querySelector(".home-composer-dock") as HTMLElement | null;
    return {
      stage: overflowOf(document.querySelector(".home-stage")),
      center: overflowOf(root.querySelector("[data-scope-ai-workspace] .scope-workspace-center-scroll")),
      rail: overflowOf(root.querySelector("[data-scope-task-rail]")),
      dockBottom: dock ? Math.round(dock.getBoundingClientRect().bottom) : null,
      pageScrolls: document.documentElement.scrollHeight > window.innerHeight + 1,
    };
  }, pane);
}

test("today and todo render the same workspace skeleton", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('[data-home-pane="today"]')).toBeVisible();
  await expect(page.locator("[data-today-list]")).toBeVisible();
  const today = await skeletonCounts(page);
  await expect(page.locator('[data-home-pane="today"] [data-home-entry="plan-today"]')).toHaveText("启动今日任务");

  await page.locator('[data-home-mode="todo"]').click();
  await expect(page.locator('[data-home-pane="todo"]')).toBeVisible();
  await expect(page.locator("[data-todo-list]")).toBeVisible();
  const todo = await skeletonCounts(page);
  await expect(page.locator('[data-home-pane="todo"] [data-home-entry="plan-todo"]')).toHaveText("启动待办任务");

  expect(todo).toEqual(today);
  for (const [index, count] of today.entries()) {
    expect(count, `骨架项 ${SKELETON[index]} 必须存在`).toBeGreaterThan(0);
  }

  // 只有 scope 数据不同：标题文案各归各的，工作台位置一致。
  await expect(page.locator("[data-home] h1")).toHaveText("我的待办");
  await page.locator('[data-home-mode="today"]').click();
  await expect(page.locator("[data-home] h1")).toHaveText("今天有什么工作要处理？");
});

test("each pane only calls its own scope endpoints", async ({ page }) => {
  const scoped: string[] = [];
  page.on("request", (item) => {
    const path = new URL(item.url()).pathname;
    if (/^\/api\/home\/(today|todo)-(brief|tasks)$/.test(path)) scoped.push(path);
  });

  await page.goto("/");
  await expect(page.locator("[data-today-list]")).toBeVisible();
  await page.locator('[data-home-mode="todo"]').click();
  await expect(page.locator("[data-todo-list]")).toBeVisible();
  await expect.poll(() => scoped.filter((path) => path.includes("todo")).length).toBeGreaterThan(0);

  const todayPaths = [...new Set(scoped.filter((path) => path.includes("today")))].sort();
  const todoPaths = [...new Set(scoped.filter((path) => path.includes("todo")))].sort();
  expect(todayPaths).toEqual(["/api/home/today-brief", "/api/home/today-tasks"]);
  expect(todoPaths).toEqual(["/api/home/todo-brief", "/api/home/todo-tasks"]);
  // Same number of requests on both sides: the two panes differ by path only.
  expect(scoped.filter((path) => path.includes("today")).length)
    .toBe(scoped.filter((path) => path.includes("todo")).length);
});

test("each pane keeps at most one filled primary CTA", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("[data-today-list]")).toBeVisible();
  expect(await filledPrimaryCount(page, '[data-home-pane="today"]')).toBeLessThanOrEqual(1);

  await page.locator('[data-home-mode="todo"]').click();
  await expect(page.locator("[data-todo-list]")).toBeVisible();
  expect(await filledPrimaryCount(page, '[data-home-pane="todo"]')).toBeLessThanOrEqual(1);
});

test("both panes share one scroll architecture and keep the ask box a footer", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const measure = async (scope: "today" | "todo") => {
    await page.goto(scope === "todo" ? "/?tab=todo" : "/");
    await expect(page.locator(`[data-home-pane="${scope}"] [data-scope-task-rail]`)).toBeVisible({ timeout: 30000 });
    return workspaceGeometry(page, scope);
  };

  const today = await measure("today");
  const todo = await measure("todo");
  expect(todo).toEqual(today);
  // 固定视口工作台：stage 不滚，中列与右栏各自滚；整页不滚，提问框留在视口内。
  expect(today.stage).toBe("hidden");
  expect(today.center).toBe("auto");
  expect(today.rail).toBe("auto");
  expect(today.pageScrolls).toBe(false);
  expect(today.dockBottom).toBe(900);
});

test("AI发现 runs on the same shell and keeps the ask box a footer", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // 没有任何 run：中栏是条件卡，右栏是空结果容器（不再有第二套单列布局）。
  await page.route("**/api/home/discovery/runs**", (route) => route.fulfill({ json: { runs: [] } }));
  await page.goto("/?tab=discovery");
  await expect(page.locator('[data-home-pane="discovery"] [data-scope-ai-workspace]')).toBeVisible({ timeout: 30000 });
  await expect(page.locator("[data-discovery-search-card]")).toBeVisible();

  const geometry = await workspaceGeometry(page, "discovery");
  expect(geometry.stage).toBe("hidden");
  expect(geometry.center).toBe("auto");
  expect(geometry.rail).toBe("auto");
  expect(geometry.pageScrolls).toBe(false);
  expect(geometry.dockBottom).toBe(900);

  // 骨架项与今日/待办同一套：可折叠右栏、快捷任务、提问框都在，结果容器落在右栏。
  await expect(page.locator('[data-home-pane="discovery"] .scope-task-rail-toggle')).toBeVisible();
  await expect(page.locator('[data-home-pane="discovery"] [data-home-quick-tasks]')).toBeVisible();
  await expect(page.locator('[data-home-pane="discovery"] [data-scope-task-rail] [data-discovery-panel]')).toHaveCount(1);
  await expect(page.locator('[data-home-pane="discovery"] [data-scope-ai-workspace] [data-discovery-panel]')).toHaveCount(0);
  expect(await filledPrimaryCount(page, '[data-home-pane="discovery"]')).toBeLessThanOrEqual(1);
});

test("all five modes run on the same interaction and result shell", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const mode of ["today", "todo", "discovery", "pool", "lifecycle"] as const) {
    await page.goto(mode === "today" ? "/" : `/?tab=${mode}`);
    await expectWorkspaceChrome(page, mode);
    const geometry = await workspaceGeometry(page, mode);
    expect(geometry.stage).toBe("hidden");
    expect(geometry.center).toBe("auto");
    expect(geometry.rail).toBe("auto");
    expect(geometry.pageScrolls).toBe(false);
    expect(geometry.dockBottom).toBe(900);
  }
  // 对象面的结果内容必须落在右栏之内，而不是第二套页面。
  await page.goto("/?tab=pool");
  await expect(page.locator('[data-home-pane="pool"] [data-object-interaction]')).toBeVisible();
  await expect(page.locator('[data-home-pane="pool"] [data-scope-task-rail] [data-pool-overview]')).toHaveCount(1);
  await page.goto("/?tab=lifecycle");
  await expect(page.locator('[data-home-pane="lifecycle"] [data-object-interaction]')).toBeVisible();
  await expect(page.locator('[data-home-pane="lifecycle"] [data-scope-task-rail] [data-lifecycle-overview]')).toHaveCount(1);
});

test("rail collapse is remembered per mode and never bleeds across modes", async ({ page }) => {
  await page.goto("/?tab=pool");
  await expect(page.locator('[data-home-pane="pool"] [data-scope-task-rail]')).toBeVisible({ timeout: 30000 });
  await page.locator('[data-home-pane="pool"] .scope-task-rail-toggle').click();
  await expect(page.locator('[data-home-pane="pool"] [data-scope-task-rail]')).toHaveClass(/is-collapsed/);
  await page.reload();
  await expect(page.locator('[data-home-pane="pool"] [data-scope-task-rail]')).toHaveClass(/is-collapsed/);
  await page.goto("/?tab=lifecycle");
  await expect(page.locator('[data-home-pane="lifecycle"] [data-scope-task-rail]')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('[data-home-pane="lifecycle"] [data-scope-task-rail]')).not.toHaveClass(/is-collapsed/);
  await page.goto("/?tab=pool");
  await expect(page.locator('[data-home-pane="pool"] [data-scope-task-rail]')).toBeVisible({ timeout: 30000 });
  await page.locator('[data-home-pane="pool"] .scope-task-rail-toggle').click();
  await expect(page.locator('[data-home-pane="pool"] [data-scope-task-rail]')).not.toHaveClass(/is-collapsed/);
});

test("workspace stacks at 1000px and keeps the dock on short viewports", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.goto("/?tab=pool");
  await expect(page.locator('[data-home-pane="pool"] [data-scope-task-rail]')).toBeVisible({ timeout: 30000 });
  const display = await page.locator('[data-home-pane="pool"].scope-workspace').evaluate((el) => getComputedStyle(el).display);
  expect(display).toBe("block");
  expect(await horizontalOverflow(page, "html")).toBeLessThanOrEqual(1);
  await expect(page.locator('[data-home-pane="pool"] .scope-task-rail-toggle')).toBeVisible();

  await page.setViewportSize({ width: 1440, height: 520 });
  await page.goto("/?tab=lifecycle");
  await expect(page.locator('[data-home-pane="lifecycle"] [data-scope-task-rail]')).toBeVisible({ timeout: 30000 });
  const geometry = await workspaceGeometry(page, "lifecycle");
  expect(geometry.pageScrolls).toBe(false);
  expect(geometry.dockBottom).toBe(520);
});

test("rail toggle is keyboard operable", async ({ page }) => {
  await page.goto("/?tab=pool");
  const toggle = page.locator('[data-home-pane="pool"] .scope-task-rail-toggle');
  await expect(toggle).toBeVisible({ timeout: 30000 });
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
});

test("return-to-bottom uses the compact latest icon control", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?tab=discovery");
  const scroll = page.locator('[data-home-pane="discovery"] .scope-workspace-center-scroll');
  await expect(scroll).toBeVisible({ timeout: 30000 });

  // The real button is conditional on an overflowed center stream. Add a
  // passive test-only tail instead of changing production task data.
  await scroll.evaluate((element) => {
    const tail = document.createElement("div");
    tail.dataset.testScrollTail = "true";
    tail.style.height = "1600px";
    tail.setAttribute("aria-hidden", "true");
    element.appendChild(tail);
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });

  const jump = page.locator("[data-scope-scroll-jump]");
  await expect(jump).toBeVisible();
  await expect(jump).toHaveAttribute("aria-label", "查看最新");
  await expect(jump).toHaveAttribute("data-tooltip", "查看最新");
  await expect(jump.locator("svg")).toHaveCount(1);
  expect(await jump.evaluate((element) => ({
    width: getComputedStyle(element).width,
    height: getComputedStyle(element).height,
    tooltip: getComputedStyle(element, "::after").content,
  }))).toEqual({ width: "48px", height: "48px", tooltip: '"查看最新"' });

  await jump.hover();
  await expect.poll(() => jump.evaluate((element) => getComputedStyle(element, "::after").opacity)).toBe("1");
  await jump.click();
  await expect.poll(() => scroll.evaluate((element) => (
    element.scrollHeight - element.scrollTop - element.clientHeight <= 24
  ))).toBe(true);
});

/** 横向溢出量：scrollWidth 超出 clientWidth 的像素数（1px 容差）。 */
async function horizontalOverflow(page: Page, selector: string): Promise<number> {
  return page.locator(selector).first().evaluate((el) => el.scrollWidth - el.clientWidth);
}

/** 五模式共用的 Chrome 断言：同壳、导航不在 Composer、右栏无横向溢出、CTA ≤ 1。 */
async function expectWorkspaceChrome(page: Page, mode: string) {
  const root = page.locator(`[data-home-pane="${mode}"]`);
  await expect(root.locator("[data-scope-ai-workspace]")).toBeVisible({ timeout: 30000 });
  await expect(root.locator("[data-scope-task-rail]")).toBeVisible();
  await expect(root.locator("[data-home-quick-tasks]")).toBeVisible();
  await expect(root.locator(".home-composer-dock")).toBeVisible();
  // 模式导航属于页面导航，不寄生在提问框里；「首次建联」不是第六模式。
  await expect(page.locator(`[data-home-pane="${mode}"] .home-composer-dock [data-home-quick-tasks]`)).toHaveCount(0);
  await expect(root.locator('[data-home-quick-task="first-outreach"]')).toHaveCount(0);
  expect(await horizontalOverflow(page, `[data-home-pane="${mode}"] [data-scope-task-rail]`)).toBeLessThanOrEqual(1);
  expect(await filledPrimaryCount(page, `[data-home-pane="${mode}"]`)).toBeLessThanOrEqual(1);
}
