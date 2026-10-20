import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

async function fixture(page: Page, debug = false, running = false) {
  const writes: string[] = [], errors: string[] = [];
  let generated = !running;
  let revision = 1;
  page.on("pageerror", error => errors.push(error.message));
  // An optional locally installed test font makes Chinese screenshots readable
  // in minimal CI images. No production font or dependency is changed.
  const fontRoot = process.env.TASK_TEST_FONT_ROOT;
  if (fontRoot) {
    await page.route("**/test-font/**", route => {
      const file = new URL(route.request().url()).pathname.split("/test-font/")[1];
      return route.fulfill({ contentType: file.endsWith(".css") ? "text/css" : "font/woff2", body: readFileSync(path.join(fontRoot, file)) });
    });
    await page.addInitScript(() => document.addEventListener("DOMContentLoaded", () => {
      for (const weight of [400, 600]) { const link = document.createElement("link"); link.rel = "stylesheet"; link.href = `/test-font/${weight}.css`; document.head.append(link); }
      const style = document.createElement("style"); style.textContent = ':root { --sans: "Noto Sans SC", sans-serif; }'; document.head.append(style);
    }));
  }
  await page.addInitScript(({ debug }) => {
    localStorage.setItem("ui:right-collapsed", "false");
    localStorage.setItem("ui:debug-view", String(debug));
  }, { debug });
  const stamp = "2026-10-18T14:02:30Z";
  const messages = () => [
    { id: "me", kind: "me", created_at: stamp, payload: { text: "查询 Daniel Catapang 的达人档案和平台表现，整理合作建议。" } },
    { id: "identity", kind: "agent_identity", created_at: stamp, payload: { agent_name: "线索智能体" } },
    { id: "trace", kind: "process_trace", created_at: stamp, payload: { run_id: "run-1", items: [
      { id: "host:preparing", kind: "host", label: "正在核对任务条件", status: "done" },
      { id: "summary", kind: "reasoning", label: "先核实达人唯一身份，再读取档案与平台资料；缺失字段单独说明。", status: generated ? "done" : "running", observed_at: stamp },
    ] } },
    { id: "ops", kind: "operation_trace", created_at: stamp, payload: { items: [
      { id: "call-1", label: "读取达人档案与平台资料，核对负责人及来源阶段，并明确区分事实、建议和未返回的信息，所有续行从左开始。", status: "done", observed_at: "2026-10-18T14:02:34Z" },
    ] } },
    ...(generated ? [{ id: `result-${revision}`, kind: "task_result_card", created_at: "2026-10-18T14:02:43Z", payload: {
      title: `达人画像 ${revision}`, summary: "资料已整理；缺项已披露。",
      sections: [{ title: "档案与合作归属", body: "第一段：来源阶段仅代表当前记录，不推断全部合作。\n\n第二段：档案负责人已返回，平台表现资料仍需核验。" },
        { title: "数据缺口", items: ["粉丝数、近10条均播和受众地区尚未收录。"] }],
      recommended_actions: ["核验平台资料", "起草合作邮件"],
    } }] : []),
  ];
  await page.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() !== "GET") writes.push(`${request.method()} ${path}`);
    const account = { id: "employee", name: "员工", available_modes: debug ? ["employee", "admin"] : ["employee"], roles: debug ? ["admin"] : ["employee"] };
    let json: unknown = [];
    if (path === "/api/auth/status") json = { authenticated: true, account };
    else if (path === "/api/me") json = account;
    else if (path === "/api/preferences") json = { theme: "light" };
    else if (path.includes("/task-work-orders/sessions/")) json = { workspace: null };
    else if (path.includes("/tasks/by-session/") || path === "/api/tasks/task-1") json = {
      id: "task-1", title: "达人画像", task_type: "creator_profile", skill_id: "creator_profile",
      status: running ? "running" : "completed", execution: { run_id: "run-1", status: running ? "running" : "completed", result_ready: generated },
      input: {},
    };
    else if (path.endsWith("/pending")) json = { pending: null };
    else if (path === "/api/queries/runtime.actions") json = { actions: [] };
    else if (path === "/api/sessions/test-terminal") json = { agent_status: running ? "running" : "listening", messages: messages() };
    else if (path.includes("/events")) {
      if (path.includes("/sessions/")) return route.fulfill({ contentType: "text/event-stream", body: "" });
      json = [];
    }
    await route.fulfill({ json });
  });
  return { writes, errors, generate: () => { generated = true; }, revise: () => { revision++; } };
}

test("automatic completion, real analysis/steps, exact rhythm and left-wrapped text", async ({ page }, info) => {
  const state = await fixture(page);
  await page.goto("/s/test-terminal");
  if (process.env.TASK_TEST_FONT_ROOT) { await page.waitForFunction(() => document.styleSheets.length > 2); await page.evaluate(() => document.fonts.ready); }
  await expect(page.locator("[data-session-terminal-status]")).toHaveText("已完成");
  await expect(page.locator("[data-complete-task]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "查看成果", exact: true })).toHaveCount(0);
  await expect(page.locator("[data-session-stream-pane]")).toContainText("分析摘要");
  await expect(page.locator("[data-session-stream-pane]")).toContainText("读取达人档案与平台资料");
  await expect(page.locator("[data-session-stream-pane]")).not.toContainText("未提供步骤说明");
  await expect(page.locator("[data-session-stream-pane]")).not.toContainText("正在核对任务条件");
  await expect(page.locator("[data-rail-tab=result]")).toHaveAttribute("aria-selected", "true");
  const geometry = await page.locator("[data-scope-workspace=session]").evaluate(el => {
    const user = el.querySelector<HTMLElement>('.message.is-user')!;
    const feed = el.querySelector<HTMLElement>('.conversation-content')!;
    const paragraph = el.querySelector<HTMLElement>('.rail-panel .md p')!;
    const section = el.querySelector<HTMLElement>('.result-section')!;
    const step = el.querySelector<HTMLElement>('.trace-list [data-kind="business_step"]')!;
    const span = step.querySelector('span')!;
    const range = document.createRange(); range.selectNodeContents(span);
    const rects = [...range.getClientRects()];
    return { paragraphGap: getComputedStyle(paragraph).marginBottom,
      sectionGap: getComputedStyle(section).marginTop, sectionPad: getComputedStyle(section).paddingTop,
      userFull: Math.abs(user.getBoundingClientRect().width - feed.getBoundingClientRect().width) < 1,
      wrapped: rects.length > 1, continuationX: rects[1]?.left, containerX: step.getBoundingClientRect().left,
      overflow: document.documentElement.scrollWidth > innerWidth };
  });
  expect(geometry).toMatchObject({ paragraphGap: "2px", sectionGap: "4px", sectionPad: "0px", userFull: true, wrapped: true, overflow: false });
  expect(Math.abs(geometry.continuationX - geometry.containerX)).toBeLessThan(1);
  await page.screenshot({ path: info.outputPath("result-terminal.png") });
  await page.locator('[data-rail-tab=status]').click();
  await expect(page.locator('[data-rail-panel=status]')).toContainText("本次处理记录");
  await expect(page.locator(".rail-status-quiet")).toHaveCSS("row-gap", "2px");
  await expect(page.locator(".rail-status-quiet")).toHaveCSS("padding-bottom", "0px");
  await expect(page.locator(".rail-status-panel .trace-list")).toHaveCSS("row-gap", "2px");
  await page.screenshot({ path: info.outputPath("status-terminal.png") });
  expect(state.errors).toEqual([]); expect(state.writes).toEqual([]);
  await expect(page).toHaveURL("/s/test-terminal");
});

test("first result appears automatically and later revisions do not steal an explicit status view", async ({ page }) => {
  const state = await fixture(page, false, true);
  await page.goto("/s/test-terminal");
  if (process.env.TASK_TEST_FONT_ROOT) { await page.waitForFunction(() => document.styleSheets.length > 2); await page.evaluate(() => document.fonts.ready); }
  await expect(page.locator('[data-rail-tab=status]')).toHaveAttribute("aria-selected", "true");
  state.generate();
  await expect(page.locator('[data-rail-tab=result]')).toHaveAttribute("aria-selected", "true", { timeout: 12000 });
  await page.locator('[data-rail-tab=status]').click();
  state.revise();
  await expect(page.locator('[data-new-result]')).toBeVisible({ timeout: 12000 });
  await expect(page.locator('[data-rail-tab=status]')).toHaveAttribute("aria-selected", "true");
  await page.locator('[data-new-result]').click();
  await expect(page.locator('[data-round-results]')).toContainText("达人画像 2");
});

test("authorized debug tab and compact narrow/short layouts keep the same task", async ({ page }, info) => {
  const state = await fixture(page, true);
  await page.goto("/s/test-terminal");
  if (process.env.TASK_TEST_FONT_ROOT) { await page.waitForFunction(() => document.styleSheets.length > 2); await page.evaluate(() => document.fonts.ready); }
  await expect(page.locator('[data-rail-tab=debug]')).toBeVisible();
  await page.locator('[data-rail-tab=debug]').click();
  await expect(page.locator('[data-rail-panel=debug]')).toContainText("运行");
  await expect(page.locator(".rail-debug-list")).toHaveCSS("row-gap", "4px");
  await page.screenshot({ path: info.outputPath("debug-terminal.png") });
  for (const viewport of [{ width: 1024, height: 589 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('[data-ai-prompt-submit]')).toBeInViewport();
    await expect(page).toHaveURL("/s/test-terminal");
  }
  expect(state.errors).toEqual([]); expect(state.writes).toEqual([]);
});
