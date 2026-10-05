import { test, expect, type Page } from "@playwright/test";
import { createServer, type ServerResponse } from "node:http";

const brief = { platforms: ["youtube"], region: "global_en", directions: [], keywords: ["camping", "portable power station"],
  min_followers: 10000, max_followers: 2000000, min_avg_plays_10: 5000, expect_count: 30 };
const template = { id: "crawler_collect", skill_id: "crawler_collect", version: "1", title: "采集线索",
  inputs: [], steps: [], constraints: [], output: { title: "候选" } };
const task = { id: "presentation-task", session_id: "presentation-session", title: "AI发现 · youtube · camping",
  status: "waiting", skill_id: "crawler_collect", input: { discovery_workspace: {
    kind: "discovery", version: 1, agent_id: "lead", profile: "lead", brief, template, submitted_text: "发现露营线索",
  } } };

async function intercept(page: Page, taskDelay = 0, settled = false) {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown = [];
    if (path === "/api/health") json = { ok: true };
    else if (path === "/api/auth/status") json = { authenticated: true, account: { id: "employee", name: "员工", available_modes: ["employee"] } };
    else if (path === "/api/me") json = { id: "employee", name: "员工", available_modes: ["employee"] };
    else if (path === "/api/preferences") json = { theme: "light" };
    else if (path === "/api/cron/jobs") json = { jobs: [] };
    else if (path === "/api/home/discovery/workspace") json = { task_id: task.id, session_id: task.session_id };
    else if (path.includes("/api/tasks/by-session/") || path === `/api/tasks/${task.id}`) {
      if (taskDelay) await new Promise(resolve => setTimeout(resolve, taskDelay));
      json = { task };
    } else if (path === "/api/queries/runtime.actions") json = { actions: [{
      id: "presentation-action", skill_id: "crawler_collect", operation: "start_crawl", risk: "L3", state: settled ? "succeeded" : "pending",
      receipt: settled ? { task_id: "remote-task", accepted: true } : null,
      confirmation_version: "v1", arguments: { platforms: ["youtube"], keywords: "camping,portable power station",
        crawler_type: "search", enable_comments: false, enable_sub_comments: false },
    }] };
    else if (path === `/api/sessions/${task.session_id}`) json = { agent_status: "listening", messages: [
      { id: "steps", kind: "process_trace", payload: { title: "快照核对", items: [
        { id: "snapshot", label: "快照完整性已确认", status: "done", observed_at: "2026-10-05T01:02:03Z" },
        { id: "legacy", label: "历史核对步骤", status: "done" },
      ] } },
      { id: "review", kind: "text", payload: { text: "### 审宪与权限结论\n\n符合本轮授权：主责为线索发现；仅提出 L3 受控采集确认。\n\n### 下一步\n\n请核对确认卡。" } },
      { id: "conflict", kind: "text", payload: { text: "### 审宪与权限结论\n\n权限冲突：无法访问该对象，请核对当前范围。" } },
      ...Array.from({ length: 20 }, (_, i) => ({
      id: `message-${i}`, session_id: task.session_id, kind: "text", payload: { text: `第 ${i + 1} 段分析\n\n### 候选证据\n\n核对发现条件与采集范围。`.repeat(3) },
    })),
    ] };
    else if (path.endsWith("/events")) return route.fulfill({ status: 200, contentType: "text/event-stream", body: "" });
    await route.fulfill({ json });
  });
  return errors;
}

test("submitted discovery keeps its own layout while task loading is delayed", async ({ page }) => {
  const errors = await intercept(page, 1600);
  await page.goto("/?tab=discovery");
  await expect(page.locator("[data-discovery-search-card]")).toBeVisible();
  const seen: string[] = [];
  await page.exposeFunction("recordChrome", (text: string) => seen.push(text));
  await page.evaluate(() => {
    new MutationObserver(() => {
      const text = document.querySelector("[data-session-back-link]")?.textContent;
      if (text) void (window as unknown as { recordChrome(text: string): Promise<void> }).recordChrome(text);
    }).observe(document.body, { childList: true, subtree: true });
  });
  await page.locator("[data-home] [data-ai-prompt-submit]").click();
  await expect(page).toHaveURL(/\/s\/presentation-session$/);
  await expect(page.locator("[data-discovery-workspace]")).toBeVisible();
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.every(text => text.includes("返回AI发现"))).toBeTruthy();
  await expect(page.locator("[data-complete-task], [data-skill-template-context]")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Home uses one directional jump control without covering the composer", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 589 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors = await intercept(page);
  await page.goto("/?tab=discovery");
  const pane = page.locator(".scope-workspace-center-scroll");
  await expect(pane).toBeVisible();
  await pane.locator(".scope-workspace-center-scroll-content").evaluate(el => {
    for (let i = 0; i < 40; i++) {
      const p = document.createElement("p");
      p.textContent = `历史过程 ${i}`;
      el.append(p);
    }
  });
  const jump = page.locator("[data-scope-scroll-jump]");
  await expect(jump).toHaveCount(1);
  await expect(jump).toHaveAccessibleName("滚到底部");
  await jump.click();
  await expect.poll(() => pane.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThanOrEqual(1);
  await expect(jump).toHaveAccessibleName("滚到顶部");
  await jump.click();
  await expect.poll(() => pane.evaluate(el => el.scrollTop)).toBe(0);
  await expect(page.locator("[data-home] [data-ai-prompt-submit]")).toBeInViewport();
  expect(errors).toEqual([]);
});

test("short discovery reveals focused input after context growth and respects manual reading", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 589 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors = await intercept(page);
  await page.goto("/?tab=discovery");
  await page.getByRole("button", { name: "编辑完整请求" }).click();
  await page.locator("[data-home] [data-composer-input]").fill("保留尺寸变化时的草稿");
  const submit = page.locator("[data-home] [data-ai-prompt-submit]");
  await submit.focus();
  const grow = () => page.locator(".scope-workspace-center-scroll-content").evaluate(el => {
    for (let i = 0; i < 40; i++) {
      const p = document.createElement("p");
      p.textContent = `异步上下文 ${i}`;
      el.append(p);
    }
  });
  await grow();
  await expect.poll(() => submit.evaluate(el => {
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= innerHeight && el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
  })).toBe(true);
  await expect(submit).toBeFocused();
  const stage = page.locator(".home-stage");
  await expect.poll(() => stage.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  await stage.hover();
  await page.mouse.wheel(0, -10000);
  await expect.poll(() => stage.evaluate(el => el.scrollTop)).toBe(0);
  await grow();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect.poll(() => stage.evaluate(el => el.scrollTop)).toBe(0);
  await expect(page.locator("[data-home] [data-composer-input]")).toHaveValue("保留尺寸变化时的草稿");
  expect(errors).toEqual([]);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 589 }, { width: 390, height: 700 }]) {
  test(`confirmation and scrolling remain reachable at ${viewport.width}×${viewport.height}`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors = await intercept(page);
    await page.goto(`/s/${task.session_id}`);
    await expect(page.locator("[data-discovery-workspace]")).toBeVisible();
    const card = page.locator(".runtime-action-card");
    await expect(card).toContainText("关键词搜索");
    await expect(card).toContainText("YouTube");
    await expect(card.locator("pre").first()).not.toBeVisible();
    const pane = page.locator("[data-session-stream-pane]");
    await pane.evaluate(el => { el.scrollTop = el.scrollHeight; });
    const jump = page.locator("[data-session-scroll-jump]");
    await expect(jump).toHaveAccessibleName("滚到顶部");
    await expect(card.getByRole("button", { name: "确认执行以上内容" })).toBeInViewport();
    await jump.click();
    await expect.poll(() => pane.evaluate(el => el.scrollTop)).toBe(0);
    await expect(page.locator(".agent-internal-review")).toHaveCount(1);
    await expect(page.getByText("符合本轮授权：主责为线索发现；仅提出 L3 受控采集确认。")).not.toBeVisible();
    await expect(page.getByText("权限冲突：无法访问该对象，请核对当前范围。")).toBeVisible();
    await pane.locator(".conversation-content").evaluate(el => {
      const content = document.createElement("p");
      content.textContent = "新增过程内容".repeat(100);
      el.append(content);
    });
    await expect.poll(() => pane.evaluate(el => el.scrollTop)).toBe(0);
    await expect(jump).toHaveAccessibleName("滚到底部");
    await page.mouse.move(viewport.width / 2, viewport.height / 3);
    await page.mouse.wheel(0, 500);
    await jump.click();
    await expect.poll(() => pane.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThanOrEqual(1);
    const sizes = await page.locator(".session-center h3, .runtime-action-summary dt, .runtime-action-summary dd, .session-center button").evaluateAll(els =>
      [...new Set(els.map(el => getComputedStyle(el).fontSize))]);
    expect(sizes).toEqual(["13px"]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    expect(errors).toEqual([]);
    await page.screenshot({ path: info.outputPath("discovery-presentation.png") });
  });
}

test("submitted collection is compact and steps show only recorded times", async ({ page }) => {
  await intercept(page, 0, true);
  await page.goto(`/s/${task.session_id}`);
  const card = page.locator('.runtime-action-card');
  await expect(card).toContainText('采集请求已提交');
  await expect(card).toContainText('需确认执行（L3）');
  await expect(card).not.toContainText('已取得回执');
  await expect(card.locator('.runtime-action-summary')).not.toBeVisible();
  await expect(card.getByText('查看回执')).toBeVisible();
  const trace = page.locator('[data-kind=process-trace]');
  await expect(trace.locator('time')).toHaveAttribute('datetime', '2026-10-05T01:02:03Z');
  await expect(trace).toContainText('时间未记录');
  await card.locator('.runtime-action-scope > summary').click();
  await expect(card.locator('.runtime-action-summary')).toBeVisible();
});
for (const theme of ["light", "dark"]) {
  test(`HTTP SSE preserves history reading and follows the bottom in ${theme}`, async ({ page }) => {
    const clients = new Set<ServerResponse>();
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", "access-control-allow-origin": "*" });
      response.flushHeaders();
      clients.add(response);
      response.on("close", () => clients.delete(response));
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing isolated stream address");
    try {
      const errors = await intercept(page, 0, true);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.route(`**/api/sessions/${task.session_id}/events`, route => route.continue({ url: `http://127.0.0.1:${address.port}/events` }));
      await page.goto(`/s/${task.session_id}`);
      await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
      const pane = page.locator("[data-session-stream-pane]");
      await expect(pane).toBeVisible();
      await expect.poll(() => clients.size).toBe(1);
      await pane.evaluate(el => { el.scrollTop = el.scrollHeight; });
      const emit = (revision: number) => {
        const message = { id: "sse-scroll-message", session_id: task.session_id, kind: "text", payload: {
          text: Array.from({ length: 12 + revision * 4 }, (_, i) => `流式段落 ${i}：受控事件验收。`).join("\n\n") + `\n\nSSE版本${revision}`,
        } };
        for (const response of clients) response.write(`event: upsert\ndata: ${JSON.stringify({ message })}\n\n`);
      };
      emit(1);
      await expect(pane).toContainText("SSE版本1");
      await expect.poll(() => pane.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThanOrEqual(1);
      await pane.hover();
      await page.mouse.wheel(0, -10000);
      await expect.poll(() => pane.evaluate(el => el.scrollTop)).toBe(0);
      emit(2);
      await expect(pane).toContainText("SSE版本2");
      await expect(pane).not.toContainText("SSE版本1");
      await expect.poll(() => pane.evaluate(el => el.scrollTop)).toBe(0);
      const jump = page.locator("[data-session-scroll-jump]");
      await expect(jump).toHaveAccessibleName("滚到底部");
      await jump.click();
      await expect.poll(() => pane.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThanOrEqual(1);
      emit(3);
      await expect(pane).toContainText("SSE版本3");
      await expect.poll(() => pane.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThanOrEqual(1);
      expect(errors).toEqual([]);
    } finally {
      for (const response of clients) response.end();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
}
