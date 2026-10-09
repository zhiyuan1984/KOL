import { expect, test, type Page } from "@playwright/test";

test.setTimeout(60000);

// Rendering fixtures only: no database, planning, email or external tool execution.
async function fixture(page: Page, empty = false, theme = "light") {
  const writes: string[] = [];
  const errors: string[] = [];
  const day = (offset: number) => {
    const date = new Date(); date.setDate(date.getDate() + offset); return date.toISOString();
  };
  const tasks = empty ? [] : [
    { id: "overdue", title: "逾期跟进", status: "pending", source: "manual", due_at: day(-1) },
    { id: "due", title: "今天报价", status: "waiting", source: "manual", due_at: day(0) },
    { id: "failed", title: "异常重试", status: "failed", source: "manual", due_at: day(-2) },
  ];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== "GET") writes.push(`${request.method()} ${path}`);
    let json: unknown = [];
    if (path === "/api/auth/status") json = { authenticated: true, account: { id: "employee", name: "员工", available_modes: ["employee"] } };
    else if (path === "/api/me") json = { id: "employee", name: "员工", available_modes: ["employee"] };
    else if (path === "/api/preferences") json = { theme };
    else if (path === "/api/task-definitions") json = ["creator_daily_tasks", "todo_plan"].map(id => ({
      id, title: id === "todo_plan" ? "我的待办" : "今日 KOL 任务", granted: true,
      ui_template: { id, kind: "skill_template", skill_id: id, version: "1", title: id === "todo_plan" ? "我的待办" : "今日 KOL 任务",
        description: "整理当前授权范围内的任务，不执行正式业务动作。", inputs: [],
        steps: ["读取当前任务。", "整理下一步行动。"], constraints: ["不发送邮件、不修改合作阶段。"],
        output: { type: "tasks", title: "任务与下一步行动" }, source: "skill", read_only: true },
    }));
    else if (path === "/api/workbench/tasks") json = { items: tasks, page: { next_cursor: null } };
    else if (path === "/api/home/today-tasks" || path === "/api/home/todo-tasks") json = { items: [] };
    else if (path === "/api/workbench/plan") json = { planning: false, brief: null, events: [], creates_session: false, calls_model: false };
    else if (path === "/api/home/board") json = { kols: [], tabs: [], tasks, workbench: { today: tasks, todo: tasks } };
    else if (path === "/api/cron/jobs") json = { jobs: [] };
    else if (path === "/api/tickets") json = { items: [], page: { next_cursor: null } };
    else if (path === "/api/tasks") json = { tasks };
    if (path.endsWith("/events")) return route.fulfill({ contentType: "text/event-stream", body: "" });
    await route.fulfill({ json });
  });
  return { writes, errors };
}

for (const empty of [false, true]) {
  test(`both task pages remove duplicate header statistics and retain right-side filters (${empty ? "empty" : "populated"})`, async ({ page }) => {
    const state = await fixture(page, empty);
    for (const scope of ["today", "todo"] as const) {
      await page.goto(`/?tab=${scope}`);
      const root = page.locator(`[data-home-pane="${scope}"]`);
      await expect(root.locator("[data-list-total]")).toHaveAttribute("data-list-total", empty ? "0" : "3");
      await expect(root.locator("h1")).toHaveText(scope === "today" ? "今天有什么工作要处理？" : "我的待办");
      await expect(root.locator("[data-home-stats], [data-today-summary]")).toHaveCount(0);
      await expect(root.locator(".today-center-hero")).not.toContainText("逾期");
      await expect(root.locator(".today-center-hero")).not.toContainText("今天到期");
      const rail = root.locator("[data-scope-task-rail]");
      if (empty) {
        await expect(rail.locator('[data-attention-filter]')).toHaveCount(0);
      } else {
        await expect(rail.locator('[data-attention-filter="overdue"]')).toHaveText("逾期 2");
        await expect(rail.locator('[data-attention-filter="due_today"]')).toHaveText("今天到期 1");
        await expect(rail.locator('[data-attention-filter="exception"]')).toHaveText("异常 1");
      }
      await expect(rail.locator(`[data-home-entry="plan-${scope}"]`)).toBeVisible();
      await expect(root.locator("[data-skill-template-context]")).toBeVisible();
      if (!empty) {
        await rail.locator('[data-attention-filter="overdue"]').click();
        await expect(rail.locator("[data-today-todo]")).toHaveCount(2);
        await rail.locator(".task-board-clear-filter").click();
        await expect(rail.locator("[data-today-todo]")).toHaveCount(3);
        await rail.locator("input.task-board-search").fill("今天报价");
        await expect(rail.locator("[data-today-todo]")).toHaveCount(1);
      }
    }
    expect(state.writes).toEqual([]);
    expect(state.errors).toEqual([]);
  });
}

for (const theme of ["light", "dark"]) {
  test(`today and todo share stable content widths before and after scrolling in ${theme}`, async ({ page }, info) => {
    const state = await fixture(page, false, theme);
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1920, height: 900 }, { width: 1280, height: 520 }, { width: 768, height: 900 }, { width: 375, height: 844 }]) {
      await page.setViewportSize(viewport);
      const samples: unknown[] = [];
      for (const scope of ["today", "todo"] as const) {
        await page.goto(`/?tab=${scope}`);
        const root = page.locator(`[data-home-pane="${scope}"]`);
        await expect(root.locator("[data-skill-template-context]")).toBeVisible();
        const measure = () => root.evaluate(el => {
          const rect = (selector: string) => el.querySelector(selector)!.getBoundingClientRect();
          const body = rect(".scope-workspace-center-scroll-content");
          const card = rect("[data-skill-template-context]");
          const composer = rect(".composer");
          const header = rect(".today-center-hero");
          return { bodyWidth: body.width, cardWidth: card.width, composerWidth: composer.width,
            left: body.left, composerLeft: composer.left, headerLeft: header.left,
            overflow: document.documentElement.scrollWidth > innerWidth + 1 };
        });
        const before = await measure();
        expect(before.overflow).toBe(false);
        expect(Math.abs(before.bodyWidth - before.composerWidth)).toBeLessThanOrEqual(1);
        expect(before.cardWidth).toBe(before.bodyWidth);
        expect(before.left).toBe(before.composerLeft);
        expect(before.left).toBe(before.headerLeft);
        // Passive extra content triggers the real scroll control, not a fake button.
        await root.locator(".scope-workspace-center-scroll-content").evaluate(el => {
          const tail = document.createElement("div"); tail.style.height = "1600px"; tail.setAttribute("aria-hidden", "true"); el.append(tail);
          const scroll = el.closest(".scope-workspace-center-scroll")!; scroll.dispatchEvent(new Event("scroll"));
        });
        const jump = root.locator("[data-scope-scroll-jump]");
        await expect(jump).toBeVisible();
        const after = await measure();
        expect(after).toEqual(before);
        await jump.focus();
        await page.keyboard.press("Enter");
        await expect.poll(() => root.locator(".scope-workspace-center-scroll").evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThanOrEqual(1);
        samples.push(before);
        if (viewport.width === 1440) await page.screenshot({ path: info.outputPath(`${scope}-${theme}.png`) });
      }
      expect(samples[0]).toEqual(samples[1]);
    }
    expect(state.writes).toEqual([]);
    expect(state.errors).toEqual([]);
  });
}

test.describe("task stream with a coarse pointer", () => {
  test.use({ hasTouch: true });
  test("jump remains reachable without shrinking cards", async ({ page }) => {
    const state = await fixture(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const viewport of [{ width: 1440, height: 520 }, { width: 375, height: 844 }]) {
      await page.setViewportSize(viewport);
      const widths: number[] = [];
      for (const scope of ["today", "todo"]) {
        await page.goto(`/?tab=${scope}`);
        const root = page.locator(`[data-home-pane="${scope}"]`);
        const card = root.locator("[data-skill-template-context]");
        await expect(card).toBeVisible();
        const before = await card.evaluate(el => el.getBoundingClientRect().width);
        await root.locator(".scope-workspace-center-scroll-content").evaluate(el => {
          const tail = document.createElement("div"); tail.style.height = "1600px"; tail.setAttribute("aria-hidden", "true"); el.append(tail);
          el.closest(".scope-workspace-center-scroll")!.dispatchEvent(new Event("scroll"));
        });
        const jump = root.locator("[data-scope-scroll-jump]");
        await expect(jump).toBeInViewport();
        const size = await jump.evaluate(el => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height }));
        expect(size.width).toBeGreaterThanOrEqual(44);
        expect(size.height).toBeGreaterThanOrEqual(44);
        expect(await card.evaluate(el => el.getBoundingClientRect().width)).toBe(before);
        await jump.tap();
        await expect.poll(() => root.locator(".scope-workspace-center-scroll").evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThanOrEqual(1);
        widths.push(before);
      }
      expect(widths[0]).toBe(widths[1]);
    }
    expect(state.writes).toEqual([]);
    expect(state.errors).toEqual([]);
  });
});

// 2026-10-09 approved density: measure final DOM boxes, not declared CSS tokens.
for (const theme of ["light", "dark"]) {
  test(`approved compact task rows, search spacing and composer controls in ${theme}`, async ({ page }, info) => {
    const state = await fixture(page, false, theme);
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }, { width: 1024, height: 768 }, { width: 390, height: 844 }, { width: 1280, height: 630 }]) {
      await page.setViewportSize(viewport);
      for (const scope of ["today", "todo"]) {
        await page.goto(`/?tab=${scope}`);
        const root = page.locator(`[data-home-pane="${scope}"]`);
        const row = root.locator('[data-today-todo]').first();
        await expect(row).toBeVisible();
        const height = await row.evaluate(el => el.getBoundingClientRect().height);
        expect(height).toBe(32);
        await expect(row).toHaveCSS("font-size", "13px");
        const search = root.locator('.task-board-search.ant-input-affix-wrapper');
        expect(await search.evaluate(el => el.getBoundingClientRect().height)).toBe(32);
        expect(await search.evaluate(el => {
          const icon = el.querySelector('.ant-input-prefix')!.getBoundingClientRect();
          const input = el.querySelector('input')!.getBoundingClientRect();
          return input.left - icon.right;
        })).toBeGreaterThanOrEqual(8);
        const plus = root.locator('.composer-plus');
        const send = root.locator('.send-arrow');
        const sizes = await Promise.all([plus, send].map(locator => locator.evaluate(el => {
          const rect = el.getBoundingClientRect(); return { width: rect.width, height: rect.height };
        })));
        expect(sizes[0]).toEqual(sizes[1]);
        expect(sizes[0].width).toBe(sizes[0].height);
        expect(await plus.evaluate(el => {
          const radius = getComputedStyle(el).borderTopLeftRadius;
          return radius.endsWith('%') ? parseFloat(radius) >= 50 : parseFloat(radius) >= el.getBoundingClientRect().width / 2;
        })).toBe(true);
        const clear = root.locator('[data-composer-clear-draft]');
        await expect(clear).toBeVisible();
        const input = root.locator('[data-composer-input]');
        await input.fill('待清理的下一条草稿');
        await clear.click();
        await expect(input).toHaveValue('');
        await expect(input).toBeFocused();
        await expect(clear).toBeDisabled();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        await page.screenshot({ path: info.outputPath(`${scope}-${theme}-${viewport.width}x${viewport.height}-density.png`) });
      }
    }
    expect(state.writes).toEqual([]);
    expect(state.errors).toEqual([]);
  });
}
