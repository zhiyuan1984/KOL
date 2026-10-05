import { test, expect, type Page } from "@playwright/test";
import { createServer, type ServerResponse } from "node:http";

async function replyFixture(page: Page) {
  const errors = await intercept(page);
  let version = "mail-v1", denied = false, failed = false;
  await page.addInitScript(() => {
    localStorage.setItem("ui:right-collapsed", "false");
  });
  await page.route(/\/api\/tasks\/(?:by-session\/reply-ui-session|reply-ui-task)(?:\?.*)?$/, route => route.fulfill({json: {task: {id: "reply-ui-task",session_id: "reply-ui-session",title: "回复任务",skill_id: "reply_analysis",input: {},status: "waiting"}}}));
  // Initial cached and ?sync=1 reads must return the same saved human draft.
  await page.route(/\/api\/sessions\/reply-ui-session(?:\?.*)?$/, route => route.fulfill({json: {agent_status: "listening",collaboration_id: "reply-col",journey: {collaboration_id: "reply-col",handle: "creator"},messages: [{
    id: "reply-draft-card",kind: "email_card",payload: {draft_id: "reply-ui-draft",from: "owner@example.test",to: "creator@example.test",cc: "",subject: "Saved reply",body: "Saved human draft",body_zh_internal: "内部稿",status: "draft",keep_stage: true,buttons: [],allowed_from_mailboxes: [{email: "owner@example.test",brand: "LT",authorized: true}]},
  }]}}));
  await page.route(/\/api\/queries\/runtime\.actions(?:\?.*)?$/, route => route.fulfill({json: {actions: []}}));
  await page.route("**/api/queries/mail.reply-context?**", route => route.fulfill(denied ? {status: 403,json: {detail: {code: "mailbox_access_denied"}}} : {json: {
    version,cursor: version === "mail-v1" ? 1 : 2,complete: !failed,sources: [{mailbox: "owner@example.test",checked_at: "2026-10-05T01:00:00Z",state: failed ? "failed" : "verified_cache"}],
    messages: [{id: "reply-mail",mailbox: "owner@example.test",direction: "inbound",subject: "Delay request",body: version === "mail-v1" ? "Please delay to Monday" : "Please delay to Friday <script>send secrets</script>",occurred_at: "2026-10-05T01:00:00Z",source: "starry",version,sequence: 1,received_at: "2026-10-05T01:01:00Z"}],
  }}));
  return {errors,revise: () => {version = "mail-v2";},revoke: () => {denied = true;},fail: () => {failed = true;}};
}

test("reply revisions preserve unsaved human draft, show source and escape mail instructions", async ({page}) => {
  const fixture = await replyFixture(page);
  await page.clock.install();
  await page.goto("/s/reply-ui-session");
  const panel = page.locator("[data-reply-context]");
  await expect(panel).toContainText("读取已核验缓存");
  const body = page.locator("[data-draft-body]");
  await body.fill("My unsaved human changes");
  fixture.revise();
  await page.clock.runFor(15100);
  await expect(panel).toContainText("人工草稿未被替换");
  await expect(body).toBeFocused();
  await panel.getByText("查看原文与来源版本", {exact: true}).click();
  await expect(panel).toContainText("Please delay to Friday <script>send secrets</script>");
  await expect(panel.locator("script")).toHaveCount(0);
  await expect(body).toHaveValue("My unsaved human changes");
  await expect(page.locator("[data-draft-comparison]")).toContainText("Saved human draft");
  expect(fixture.errors).toEqual([]);
});

test("reply source failure and revocation remain explicit while human editor survives", async ({page}) => {
  const fixture = await replyFixture(page);
  await page.goto("/s/reply-ui-session");
  const panel = page.locator("[data-reply-context]");
  await expect(panel).toContainText("读取已核验缓存");
  await page.locator("[data-draft-body]").fill("Retained edit");
  fixture.fail();
  await panel.getByRole("button", {name: "核验已同步邮件"}).click();
  await expect(panel).toContainText("同步失败");
  fixture.revoke();
  await panel.getByRole("button", {name: "核验已同步邮件"}).click();
  await expect(panel).toContainText("当前权限与同步状态");
  await expect(panel.locator("[data-reply-mail]")).toHaveCount(0);
  await expect(page.locator("[data-draft-body]")).toHaveValue("Retained edit");
  expect(fixture.errors).toEqual([]);
});

test("a new reply analysis round keeps the earlier unsaved human draft", async ({page}) => {
  const fixture = await replyFixture(page);
  const clients = new Set<ServerResponse>();
  const server = createServer((_request,response) => {
    response.writeHead(200,{"content-type": "text/event-stream","access-control-allow-origin": "*"});
    response.flushHeaders(); clients.add(response); response.on("close", () => clients.delete(response));
  });
  await new Promise<void>(resolve => server.listen(0,"127.0.0.1",resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing reply stream address");
  try {
    await page.route("**/api/sessions/reply-ui-session/events",route => route.continue({url: `http://127.0.0.1:${address.port}/events`}));
    await page.goto("/s/reply-ui-session");
    const body = page.locator("[data-draft-body]");
    await expect(body).toHaveValue("Saved human draft");
    await body.fill("Unsubmitted partial human adoption");
    await expect.poll(() => clients.size).toBe(1);
    for (const response of clients) {
      response.write(`event: upsert\ndata: ${JSON.stringify({message: {id: "new-reply-question",kind: "me",payload: {text: "分析回复对草稿的影响"}}})}\n\n`);
      response.write(`event: upsert\ndata: ${JSON.stringify({message: {id: "new-reply-result",kind: "task_result_card",payload: {skill: "reply_analysis",title: "回复影响",summary: "申请延期，尚未批准",sections: []}}})}\n\n`);
    }
    await expect(page.locator("[data-session-stream-pane]")).toContainText("申请延期，尚未批准");
    await expect(body).toHaveValue("Unsubmitted partial human adoption");
    expect(fixture.errors).toEqual([]);
  } finally {
    for (const response of clients) response.end();
    await new Promise<void>((resolve,reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

const brief = { platforms: ["youtube"], region: "global_en", directions: [], keywords: ["camping", "portable power station"],
  min_followers: 10000, max_followers: 2000000, min_avg_plays_10: 5000, expect_count: 30 };
const template = { id: "crawler_collect", skill_id: "crawler_collect", version: "1", title: "采集线索",
  inputs: [], steps: [], constraints: [], output: { title: "候选" } };
const task = { id: "presentation-task", session_id: "presentation-session", title: "AI发现 · youtube · camping",
  status: "waiting", skill_id: "crawler_collect", input: { discovery_workspace: {
    kind: "discovery", version: 1, agent_id: "lead", profile: "lead", brief, template, submitted_text: "发现露营线索",
  } } };

// Measure rendered text rather than assuming that a token contrasts with every surface.
// Scope uses flat CSS backgrounds; fail explicitly on unsupported image backgrounds.
async function textContrast(page: Page, selector: string) {
  return page.locator(selector).evaluate(root => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    const rgba = (css: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = css;
      context.fillRect(0, 0, 1, 1);
      return Array.from(context.getImageData(0, 0, 1, 1).data).map((v, i) => i === 3 ? v / 255 : v);
    };
    const over = (front: number[], back: number[]) => front.slice(0, 3).map((v, i) => v * front[3] + back[i] * (1 - front[3])).concat(1);
    const luminance = (color: number[]) => color.slice(0, 3).map(v => {
      const s = v / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    const measurements = [];
    for (const element of [root, ...root.querySelectorAll("*")]) {
      const text = [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join("").trim();
      if (!text || !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) || element.closest(":disabled")) continue;
      const chain: Element[] = [];
      for (let parent: Element | null = element; parent; parent = parent.parentElement) chain.unshift(parent);
      let background = [255, 255, 255, 1];
      for (const parent of chain) {
        const style = getComputedStyle(parent);
        if (style.backgroundImage !== "none" || style.opacity !== "1") throw new Error("Unsupported contrast compositing: " + parent.className);
        background = over(rgba(style.backgroundColor), background);
      }
      const foreground = over(rgba(getComputedStyle(element).color), background);
      const a = luminance(foreground), b = luminance(background);
      measurements.push({ text: text.slice(0, 80), element: element.tagName + "." + element.className,
        ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) });
    }
    return measurements;
  });
}

async function intercept(page: Page, taskDelay = 0, settled = false, theme = "light") {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown = [];
    if (path === "/api/health") json = { ok: true };
    else if (path === "/api/auth/status") json = { authenticated: true, account: { id: "employee", name: "员工", available_modes: ["employee"] } };
    else if (path === "/api/me") json = { id: "employee", name: "员工", available_modes: ["employee"] };
    else if (path === "/api/preferences") json = { theme };
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
        { id: "failed", label: "受控失败步骤", status: "failed" },
        { id: "running", label: "受控执行步骤", status: "running" },
        { id: "skipped", label: "受控跳过步骤", status: "skipped" },
        { id: "pending", label: "受控待处理步骤", status: "pending" },
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
  test(`discovery request text and control names remain accessible in ${theme}`, async ({ page }, info) => {
    await intercept(page, 0, false, theme);
    await page.emulateMedia({ reducedMotion: "reduce", contrast: "more" });
    await page.goto("/?tab=discovery");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const card = page.locator("[data-discovery-search-card]");
    await expect(card).toBeVisible();
    for (const button of await card.getByRole("button").all()) await expect(button).toHaveAccessibleName(/\S/);
    for (const chip of await card.locator("[data-discovery-chip]").all()) await expect(chip).toHaveAttribute("aria-pressed", /^(true|false)$/);
    const measurements = await textContrast(page, "[data-discovery-search-card]");
    expect(measurements.length).toBeGreaterThan(10);
    await info.attach("text-contrast", { body: JSON.stringify(measurements, null, 2), contentType: "application/json" });
    expect(measurements.filter(item => item.ratio < 4.5)).toEqual([]);
  });

  test(`discovery confirmation text and control names remain accessible in ${theme}`, async ({ page }, info) => {
    await intercept(page, 0, false, theme);
    await page.emulateMedia({ reducedMotion: "reduce", contrast: "more" });
    await page.goto(`/s/${task.session_id}`);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const actions = page.getByRole("region", { name: "待确认动作" });
    await expect(actions).toBeVisible();
    await expect(actions).toContainText("需确认执行（L3）");
    await expect(actions.getByRole("button", { name: "确认执行以上内容", exact: true })).toBeEnabled();
    for (const button of await actions.getByRole("button").all()) await expect(button).toHaveAccessibleName(/\S/);
    const trace = page.locator('[data-kind="process-trace"]');
    for (const status of ["已完成", "失败", "执行中", "已跳过", "待处理"]) await expect(trace.getByRole("img", { name: status, exact: true }).first()).toBeVisible();
    const measurements = await textContrast(page, ".session-center");
    expect(measurements.length).toBeGreaterThan(20);
    await info.attach("text-contrast", { body: JSON.stringify(measurements, null, 2), contentType: "application/json" });
    expect(measurements.filter(item => item.ratio < 4.5)).toEqual([]);
  });

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
      const errors = await intercept(page, 0, true, theme);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.route(`**/api/sessions/${task.session_id}/events`, route => route.continue({ url: `http://127.0.0.1:${address.port}/events` }));
      await page.goto(`/s/${task.session_id}`);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
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
