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
  min_followers: 10000, max_followers: null, min_avg_plays_10: 5000, expect_count: 30 };
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

async function intercept(page: Page, taskDelay = 0, settled = false, themeOrCandidate: string | boolean = "light", failedFollow = false) {
  const theme = typeof themeOrCandidate === "string" ? themeOrCandidate : "light";
  const candidateMode = themeOrCandidate === true;
  const errors: string[] = [];
  let ignored = false;
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
    } else if (path.includes('/api/home/discovery/runtime/')) {
      const verb = path.split('/').at(-1);
      if (verb === 'follow' && failedFollow) return route.fulfill({ status: 409, json: { code: 'follow_conflict', message: '该红人已被其他员工跟进。' } });
      if (verb === 'ignore') ignored = true;
      if (verb === 'restore') ignored = false;
      json = { ok: true };
    } else if (path === "/api/queries/runtime.actions") json = { actions: [{
      id: "presentation-action", skill_id: "crawler_collect", operation: "start_crawl", risk: "L3", state: settled ? "succeeded" : "pending",
      created_at: "2026-10-05T01:03:00Z",
      crawl: candidateMode ? { id: 'presentation-action', state: 'succeeded', result_state: 'ready', result_json: {
        task_id: 'remote-task', complete: true, captured_at: '2026-10-05T01:05:00Z', candidates: [{
          id: 'channel-stable', name: 'Camping creator', platform: 'youtube', source_url: 'https://youtube.com/channel/channel-stable',
          followers: 3000000, avg_views_10: null, region: null, snapshot_version: 'candidate-version', ignored,
          followers_evidence: { state: 'source_recorded' },
        }],
      } } : null,
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

test("submitted discovery stays in its workspace while task loading is delayed", async ({ page }) => {
  const errors = await intercept(page, 1600);
  await page.goto("/?tab=discovery");
  await expect(page.locator("[data-discovery-search-card]")).toBeVisible();
  await page.locator("[data-home] [data-ai-prompt-submit]").click();
  await expect(page).toHaveURL(/tab=discovery/);
  await expect(page.locator("[data-workspace-session]")).toHaveAttribute("data-workspace-session", task.session_id);
  await expect(page.locator("[data-discovery-start-confirm]")).toBeVisible();
  await expect(page.locator("[data-complete-task]")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("focused stream links remain reachable during live content growth", async ({ page }) => {
  await intercept(page);
  let releaseAnalysis!: () => void;
  let analysisStarted!: () => void;
  const held = new Promise<void>(resolve => { releaseAnalysis = resolve; });
  const started = new Promise<void>(resolve => { analysisStarted = resolve; });
  const pending = { text: "分析本次发现条件", intent: "crawler_collect", work_item_id: task.id, run_id: "focus-run" };
  await page.route("**/api/home/discovery/workspace", route => route.fulfill({ json: {
    task_id: task.id, session_id: task.session_id, pending,
  } }));
  await page.route(`**/api/sessions/${task.session_id}/messages`, async route => {
    analysisStarted();
    await held;
    await route.fulfill({ status: 202, json: { accepted: true, messages: [], agent_status: "listening" } });
  });
  try {
    await page.goto("/?tab=discovery");
    await page.locator("[data-home] [data-ai-prompt-submit]").click();
    await started;
    await expect(page.locator("[data-discovery-start-confirm]")).toBeInViewport();
    const stream = page.locator(".scope-workspace-center-scroll");
    const link = page.locator("[data-discovery-open-session]").first();
    await expect(link).toHaveAttribute("href", `/?tab=discovery&session_id=${task.session_id}`);
    await stream.evaluate(el => {
      for (let i = 0; i < 40; i++) { const row = document.createElement("p"); row.textContent = `布局回归内容 ${i}`; el.append(row); }
      el.scrollTop = el.scrollHeight;
    });
    await expect.poll(() => stream.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThanOrEqual(1);
    await link.focus();
    await expect(link).toBeFocused();
    await expect(link).toBeInViewport();
    const top = await link.evaluate(el => el.getBoundingClientRect().top);
    await stream.evaluate(el => { const row = document.createElement("p"); row.textContent = "新增布局内容".repeat(100); el.append(row); });
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(Math.abs(await link.evaluate(el => el.getBoundingClientRect().top) - top)).toBeLessThanOrEqual(1);
    await expect(link).toBeInViewport();
  } finally {
    releaseAnalysis();
    await page.unrouteAll({ behavior: "wait" });
  }
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
  await expect(jump).toHaveAccessibleName("回到最新");
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
  const stage = page.locator(".scope-workspace-center-scroll");
  await stage.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await stage.evaluate(el => { el.scrollTop = 0; });
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
    await expect(page.locator("[data-workspace-session]")).toHaveAttribute("data-workspace-session", task.session_id);
    const params = page.locator('[data-discovery-event="params"]');
    await expect(params).toContainText("关键词搜索");
    await expect(params).toContainText("YouTube");
    const card = page.locator('[data-discovery-event="confirm"]');
    const pane = page.locator(".scope-workspace-center-scroll");
    await expect(card.getByRole("button", { name: "确认开始采集", exact: true })).toBeInViewport();
    await expect(page.locator('[data-ai-prompt-submit]')).toBeInViewport();
    await pane.evaluate(el => { el.scrollTop = 0; });
    await pane.locator(".scope-workspace-center-scroll-content").evaluate(el => {
      const content = document.createElement("p"); content.textContent = "新增过程内容".repeat(100); el.append(content);
    });
    // 看历史时新内容不打断阅读：位置不动；不在底部时右下角是「滚到底部」。
    await expect.poll(() => pane.evaluate(el => el.scrollTop)).toBe(0);
    const jump = page.locator('[data-scope-scroll-jump]');
    await expect(jump).toHaveAccessibleName("回到最新");
    await jump.click();
    await expect.poll(() => pane.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThanOrEqual(1);
    const sizes = await params.locator('dt, dd, h3').evaluateAll(els => [...new Set(els.map(el => getComputedStyle(el).fontSize))]);
    expect(sizes).toEqual(["13px"]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    expect(errors).toEqual([]);
    await page.screenshot({ path: info.outputPath("discovery-presentation.png") });
  });
}

test("submitted collection keeps its receipt without claiming completion before remote facts", async ({ page }) => {
  await intercept(page, 0, true);
  await page.goto(`/s/${task.session_id}`);
  await expect(page.locator('[data-discovery-start-confirm]')).toHaveCount(0);
  await expect(page.locator('[data-discovery-event="confirm"]')).toContainText('已取得回执');
  await expect(page.locator('[data-discovery-run-status-label]')).toContainText('启动中');
  await expect(page.locator('[data-discovery-event="params"]')).toContainText('YouTube');
});

test('follow opens my creators directly, and import opens public pool after confirmation', async ({ page }) => {
  await intercept(page, 0, true, true);
  const requests: string[] = [];
  page.on('request', request => { if (request.method() === 'POST') requests.push(new URL(request.url()).pathname); });
  await page.goto(`/s/${task.session_id}`);
  const card = page.locator('[data-discovery-candidate=channel-stable]');
  await expect(card).toContainText('粉丝符合当前条件');
  await card.getByRole('button', { name: '跟进', exact: true }).click();
  await expect(page).toHaveURL(/tab=lifecycle$/);
  expect(requests.some(path => path.endsWith('/channel-stable/follow'))).toBeTruthy();
  expect(requests.some(path => path.includes('/claim') || path.endsWith('/ingest'))).toBeFalsy();
  await page.goto(`/s/${task.session_id}`);
  await card.getByRole('button', { name: '加入公海', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '确认入库公海' }).click();
  await expect(page).toHaveURL(/tab=pool$/);
  expect(requests.some(path => path.endsWith('/channel-stable/ingest'))).toBeTruthy();
});

test('bulk runtime import waits for confirmation and submits the current candidate snapshot', async ({ page }) => {
  await intercept(page, 0, true, true);
  const imports: unknown[] = [];
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/channel-stable/ingest')) imports.push(request.postDataJSON());
  });
  await page.goto(`/s/${task.session_id}`);
  await page.getByRole('checkbox', { name: '选择 Camping creator', exact: true }).check();
  await page.locator('[data-discovery-ingest]').click();
  await expect(page.getByRole('dialog')).toContainText('将把 1 条线索');
  expect(imports).toEqual([]);
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  expect(imports).toEqual([]);
  await page.locator('[data-discovery-ingest]').click();
  await page.getByRole('dialog').getByRole('button', { name: '确认入库公海', exact: true }).evaluate(el => { (el as HTMLButtonElement).click(); (el as HTMLButtonElement).click(); });
  await expect.poll(() => imports.length).toBe(1);
  expect(imports[0]).toEqual({ snapshot_version: 'candidate-version', confirmed: true });
  await expect(page.locator('[data-discovery-toast]')).toContainText('已取得 1 位候选的入库回执');
});

test('ignore survives reload, can be restored, and failed follow stays in the task', async ({ page }) => {
  await intercept(page, 0, true, true, true);
  await page.goto(`/s/${task.session_id}`);
  const card = page.locator('[data-discovery-candidate=channel-stable]');
  await card.getByRole('button', { name: '忽略', exact: true }).click();
  await expect(card).toHaveCount(0);
  await page.reload();
  await page.locator('[data-discovery-results]').getByRole('button', { name: '已忽略', exact: true }).click();
  await card.getByRole('button', { name: '恢复考虑', exact: true }).click();
  await page.locator('[data-discovery-results]').getByRole('button', { name: '返回候选', exact: true }).click();
  await card.getByRole('button', { name: '跟进', exact: true }).click();
  await expect(card.getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL(`/s/${task.session_id}`);
  await expect(page.locator("[data-workspace-session]")).toHaveAttribute("data-workspace-session", task.session_id);
});

test('discovery recovery and sidebar navigation remain usable on a task', async ({ page }) => {
  await intercept(page, 0, true);
  await page.goto(`/s/${task.session_id}`);
  await expect(page.locator('[data-workspace-session]')).toHaveAttribute('data-workspace-session', task.session_id);
  for (const [key, path] of [['running', '/tasks'], ['mail', '/mail'], ['cron', '/cron'], ['knowledge', '/kb']]) {
    await page.goto(`/s/${task.session_id}`);
    await expect(page.locator('[data-workspace-session]')).toHaveAttribute('data-workspace-session', task.session_id);
    await page.locator(`.sidebar [data-nav=${key}]`).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
  }
});

test('unlimited upper followers remains optional and candidate cards fit the right pane', async ({ page }) => {
  await intercept(page, 0, true, true);
  await page.goto('/?tab=discovery');
  const upper = page.locator('[data-discovery-max-followers]');
  await expect(page.getByRole('group', { name: '粉丝数范围', exact: true }).first()).toBeVisible();
  await expect(upper).toBeVisible();
  await expect(upper).toHaveValue('');
  await upper.fill('5000000');
  await expect(upper).toHaveValue('5,000,000');
  await upper.fill('');
  await expect(upper).toHaveValue('');
  await page.goto(`/s/${task.session_id}`);
  const bounds = await page.locator('[data-discovery-event=confirm]').evaluate(el => {
    const pane = document.querySelector('.scope-workspace-center-scroll-content')!.getBoundingClientRect();
    const card = el.getBoundingClientRect();
    return { card: card.width, pane: pane.width };
  });
  expect(Math.abs(bounds.card - bounds.pane)).toBeLessThanOrEqual(1);
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const card = page.locator('[data-discovery-candidate=channel-stable]');
    await expect(card).toBeVisible();
    const sizes = await card.evaluate(el => ({ visible: el.clientWidth, contents: el.scrollWidth }));
    expect(sizes.contents).toBeLessThanOrEqual(sizes.visible + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  }
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
    const actions = page.locator('[data-discovery-event="confirm"]');
    await expect(actions).toBeVisible();
    await expect(actions).toContainText("R3 · 确认开始采集");
    await expect(actions.getByRole("button", { name: "确认开始采集", exact: true })).toBeEnabled();
    for (const button of await actions.getByRole("button").all()) await expect(button).toHaveAccessibleName(/\S/);
    const measurements = await textContrast(page, ".scope-workspace-center");
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
      await page.route(/\/api\/tasks\/(?:by-session\/presentation-session|presentation-task)(?:\?.*)?$/, route => route.fulfill({ json: {
        task: { ...task, skill_id: "kol_analyze", input: {} },
      } }));
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.route(`**/api/sessions/${task.session_id}/events`, route => route.continue({ url: `http://127.0.0.1:${address.port}/events` }));
      await page.goto(`/s/${task.session_id}`);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      const pane = page.locator("[data-session-stream-pane]");
      await expect(pane).toBeVisible();
      await expect.poll(() => pane.evaluate(el => el.scrollTop)).toBe(0);
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
      // 流式更新同一条消息：上翻时不抢滚动，控件只给「滚到底部」，不报条数（DESIGN §10.2）。
      const jump = page.locator("[data-session-scroll-jump]");
      await expect(jump).toHaveAccessibleName("回到最新");
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
