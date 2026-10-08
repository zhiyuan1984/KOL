import { expect, test, type Page } from "@playwright/test";
import { stubHomePool } from "./kol-surface-stub";

// 功能域：公海 Agent 范围、分析会话、评分确认与回执。全部远端动作使用夹具。
const rows = Array.from({ length: 10 }, (_, i) => ({
  id: `pool_agent_${i}`, kol_uid: `pool_agent_${i}`, company_id: "company:amperetime",
  handle: `公海红人${i}`, platform: "youtube", homepage_url: `https://youtube.com/@pool-agent-${i}`,
  pool_status: "open", followers: "120000", avg_plays: "30000", direction: "vanlife",
}));
const templates = ["potential", "risk", "completeness", "score"].map((slot) => ({
  slot, knowledge_id: `pool_agent_template_${slot}`, published_version: 1, title: slot,
  body: `已发布的${slot}分析问题，请说明公开依据。`, placeholders: [], starter: slot,
}));
const select = (page: Page, i: number) => page.locator(`[data-pool-select='pool_agent_${i}']`);
const input = (page: Page) => page.locator("[data-home] [data-composer-input]");

test.beforeEach(async ({ page }) => {
  await stubHomePool(page, rows);
  await page.route("**/api/knowledge/question-templates", (route) => route.fulfill({ json: templates }));
});

async function analysisStub(page: Page, failFirst = false) {
  const enqueued: Record<string, unknown>[] = [];
  const messages: Record<string, unknown>[] = [];
  let posted = false;
  await page.route("**/api/home/kol-analyze/enqueue", async (route) => {
    enqueued.push(route.request().postDataJSON());
    await route.fulfill({ status: 201, json: { work_item_id: "pool-agent-task", creates_session: false, queued_copy: "已入队" } });
  });
  await page.route("**/api/tasks/pool-agent-task/run", (route) => route.fulfill({ status: 202, json: {
    task: { id: "pool-agent-task", title: "公海分析", task_type: "kol_analyze" },
    work_item_id: "pool-agent-task", run_id: "pool-agent-run", session_id: "pool-agent-session",
    pending: { text: "分析选中的红人", task_type: "kol_analyze", run_id: "pool-agent-run" },
  } }));
  await page.route("**/api/sessions/pool-agent-session/messages", async (route) => {
    messages.push(route.request().postDataJSON());
    if (failFirst && messages.length === 1) return route.fulfill({ status: 503, json: { detail: "分析连接暂时中断" } });
    posted = true;
    await route.fulfill({ json: { accepted: true, agent_status: "listening", messages: [] } });
  });
  await page.route(/\/api\/sessions\/pool-agent-session(?:\?.*)?$/, (route) => route.fulfill({ json: {
    agent_status: "listening", messages: posted ? [{ id: "pool-agent-answer", session_id: "pool-agent-session", role: "assistant", kind: "text",
      payload: { text: "根据公开资料，需要比较内容匹配与播放稳定性。" }, created_at: "2026-10-08T10:00:00Z" }] : [],
  } }));
  await page.route("**/api/sessions/pool-agent-session/events", (route) => route.fulfill({ contentType: "text/event-stream", body: "" }));
  return { enqueued, messages };
}

test("pool scope stays compact and selection preserves an authored draft", async ({ page }) => {
  const posts: string[] = [];
  page.on("request", (request) => { if (request.method() === "POST") posts.push(new URL(request.url()).pathname); });
  await page.goto("/?tab=pool");
  await expect(page.locator("[data-home-title='pool']")).toHaveText("公海分析");
  await expect(page.locator("[data-home-title='pool']")).toHaveCSS("font-size", "13px");
  await expect(page.locator("[data-pool-selection-scope]")).toHaveText("未选择对象");
  await expect(page.locator("[data-pool-jev-assess]")).toBeDisabled();
  await input(page).fill("比较内容适配度，保留我的问题");
  for (const i of [0, 1, 2, 3]) await select(page, i).check();
  const scope = page.locator("[data-pool-selection-scope]");
  await expect(scope).toContainText("已选 4 位红人");
  await expect(scope).toContainText("+1");
  await expect(scope.getByRole("button")).toHaveText("查看全部 4 位");
  await scope.getByRole("button").click();
  await expect(page.locator("[data-pool-selected-list] li")).toHaveCount(4);
  await select(page, 1).uncheck();
  await expect(input(page)).toHaveValue("比较内容适配度，保留我的问题");
  expect(posts).toEqual([]);
});

test("quick intents only fill a published editable question", async ({ page }) => {
  const flow = await analysisStub(page);
  await page.goto("/?tab=pool");
  await select(page, 0).check();
  for (const kind of ["potential", "risk", "completeness"]) {
    await page.locator(`[data-pool-analysis='${kind}']`).click();
    await expect(input(page)).toHaveValue(new RegExp(`已发布的${kind}分析问题`));
    await expect(input(page)).toBeFocused();
  }
  expect(flow.enqueued).toEqual([]);
  expect(flow.messages).toEqual([]);
});

test("missing published templates stay disabled without a made-up question", async ({ page }) => {
  await page.route("**/api/knowledge/question-templates", (route) => route.fulfill({ json: [] }));
  await page.goto("/?tab=pool");
  await select(page, 0).check();
  const button = page.locator("[data-pool-analysis='potential']");
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute("title", /未在管理端知识库发布/);
  await expect(input(page)).toHaveValue("");
});

test("session events replace a streaming message in place", async ({ page }) => {
  await analysisStub(page);
  const frame = { id: "pool-stream-message", session_id: "pool-agent-session", role: "assistant", kind: "text",
    payload: { text: "第一段公开依据", streaming: true }, created_at: "2026-10-08T10:00:00Z" };
  await page.route("**/api/sessions/pool-agent-session/events", (route) => route.fulfill({ contentType: "text/event-stream", body:
    `event: snapshot\ndata: ${JSON.stringify({ messages: [frame], agent_status: "running" })}\n\n`
    + `event: upsert\ndata: ${JSON.stringify({ message: { ...frame, payload: { text: "连续输出的完整公开依据", streaming: false } } })}\n\n`
    + 'event: status\ndata: {"agent_status":"listening"}\n\n',
  }));
  await page.goto("/?tab=pool");
  await select(page, 0).check();
  await input(page).fill("比较公开依据");
  await page.locator("[data-home] [data-send]").click();
  await expect(page.locator("[data-pool-agent-feed]")).toContainText("连续输出的完整公开依据");
  await expect(page.getByText("连续输出的完整公开依据", { exact: true })).toHaveCount(1);
  await expect(page.locator("[data-pool-agent-turn='analysis']")).toHaveCount(1);
});

test("free questions run inside pool and keep the submitted scope after reselection", async ({ page }) => {
  const flow = await analysisStub(page);
  await page.goto("/?tab=pool");
  await select(page, 0).check();
  await select(page, 1).check();
  await input(page).fill("比较这两位谁更适合领取");
  await page.locator("[data-home] [data-send]").click();
  await expect(page.locator("[data-pool-agent-feed]")).toContainText("根据公开资料");
  await expect(page).toHaveURL(/\?tab=pool$/);
  expect(flow.enqueued[0].kol_uids).toEqual(["pool_agent_0", "pool_agent_1"]);
  await select(page, 1).uncheck();
  await select(page, 2).check();
  await expect(page.locator("[data-pool-selection-scope]")).toContainText("公海红人2");
  const history = page.locator("[data-pool-history-scope]");
  await expect(history).toContainText("公海红人1");
  await expect(history).not.toContainText("公海红人2");
});

test("failed dispatch retries the original task and run", async ({ page }) => {
  const flow = await analysisStub(page, true);
  await page.goto("/?tab=pool");
  await select(page, 0).check();
  await input(page).fill("检查公开资料风险");
  await page.locator("[data-home] [data-send]").click();
  await expect(page.locator("[data-pool-agent-feed]")).toContainText("分析连接暂时中断");
  await page.locator("[data-pool-agent-feed]").getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.locator("[data-pool-agent-feed]")).toContainText("根据公开资料");
  expect(flow.enqueued).toHaveLength(1);
  expect(flow.messages).toHaveLength(2);
  expect(flow.messages[1].run_id).toBe(flow.messages[0].run_id);
});

test("score confirmation is invalidated by scope changes and can be cancelled without IO", async ({ page }) => {
  const posts: string[] = [];
  page.on("request", (request) => { if (request.method() === "POST") posts.push(new URL(request.url()).pathname); });
  await page.goto("/?tab=pool");
  await select(page, 0).check();
  await input(page).fill("保留这份分析草稿");
  await page.locator("[data-pool-jev-assess]").click();
  const confirm = page.locator("[data-pool-score-confirm]");
  await expect(confirm).toContainText("R3");
  await expect(confirm).toContainText("已选 1 位");
  await expect(confirm).toContainText("写入 KOL 记忆");
  await expect(page.locator("[data-ai-prompt-submit]")).toBeDisabled();
  await select(page, 1).check();
  await expect(confirm).toHaveCount(0);
  await page.locator("[data-pool-jev-assess]").click();
  await expect(confirm).toHaveAttribute("data-pool-score-targets", "2");
  await page.locator("[data-pool-score-cancel]").click();
  await expect(input(page)).toHaveValue("保留这份分析草稿");
  expect(posts).toEqual([]);
});

test("score batches show real returned progress and refresh rows without changing history", async ({ page }) => {
  let batch: string[] = [];
  const batches: string[][] = [];
  const scored = new Set<string>();
  let release: (() => void) | undefined;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  const currentRows = () => rows.map((row) => scored.has(row.kol_uid) ? { ...row, potential_score: 88, potential_confidence: 0.9,
    assessment_state: "scored", assessed_at: "2026-10-08T10:00:00Z", assessment_model: "jev-1.13" } : row);
  await page.route(/\/api\/home\/pool(?:\?.*)?$/, (route) => route.fulfill({ json: { items: currentRows() } }));
  await page.route("**/api/home/pool/jev-assess", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      expect(body.criteria).toBeNull();
      batch = body.kol_uids;
      batches.push(batch);
      return route.fulfill({ status: 202, json: { accepted: true, started: true, status: "running" } });
    }
    if (batches.length === 1) await waiting;
    for (const id of batch) scored.add(id);
    await route.fulfill({ json: { status: "succeeded", ok: true, items: currentRows(), message: "评分已返回" } });
  });
  await page.goto("/?tab=pool");
  await page.locator("[data-pool-select-all]").check();
  await page.locator("[data-pool-jev-assess]").click();
  await page.locator("[data-pool-score-execute]").click();
  await expect(page.locator("[data-pool-score-status]")).toContainText("已返回 0/2 批次");
  release?.();
  await expect(page.locator("[data-pool-score-status]")).toContainText("已完成");
  expect(batches.map((ids) => ids.length)).toEqual([8, 2]);
  await expect(page.locator("[data-pool-score-result]")).toHaveCount(10);
  await expect(page.locator("[data-pool-kol='pool_agent_0'] [data-pool-score='potential']")).toContainText("评分 88");
  await page.locator("[data-pool-select-all]").uncheck();
  await expect(page.locator("[data-pool-history-scope] li")).toHaveCount(10);
  await expect(page.locator("[data-pool-selection-scope]")).toHaveText("未选择对象");
});

test("score failure preserves the confirmed scope for a separate retry confirmation", async ({ page }) => {
  const batches: string[][] = [];
  await page.route("**/api/home/pool/jev-assess", async (route) => {
    if (route.request().method() === "POST") {
      batches.push(route.request().postDataJSON().kol_uids);
      return route.fulfill({ status: 202, json: { accepted: true, started: true, status: "running" } });
    }
    await route.fulfill({ json: { status: "failed", ok: false, message: "评分服务暂时不可用" } });
  });
  await page.goto("/?tab=pool");
  await select(page, 0).check();
  await page.locator("[data-pool-jev-assess]").click();
  await page.locator("[data-pool-score-execute]").click();
  await expect(page.locator("[data-pool-agent-feed]")).toContainText("评分服务暂时不可用");
  await select(page, 0).uncheck();
  await select(page, 1).check();
  await page.locator("[data-pool-agent-feed]").getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.locator("[data-pool-score-confirm]")).toContainText("公海红人0");
  await expect(page.locator("[data-pool-score-confirm]")).not.toContainText("公海红人1");
  expect(batches).toEqual([["pool_agent_0"]]);
});

test("an expanded ten-person scope uses the feed and leaves the confirmation visible", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 630 });
  await page.goto("/?tab=pool");
  await page.locator("[data-pool-select-all]").check();
  await page.locator("[data-pool-selection-all]").click();
  await expect(page.locator("[data-pool-selected-list] li")).toHaveCount(10);
  await page.locator("[data-pool-jev-assess]").click();
  const decision = await page.locator("[data-pool-score-execute]").boundingBox();
  expect(decision!.y + decision!.height).toBeLessThanOrEqual(630);
  expect(await page.locator("[data-pool-selected-list]").evaluate((el) => Boolean(el.closest(".scope-workspace-center-scroll")))).toBe(true);
});

test("a pending score resumes by reading its receipt without a second scoring POST", async ({ page }) => {
  let posts = 0, reads = 0, ready = false;
  const scored = { ...rows[0], potential_score: 88, potential_confidence: 0.9,
    assessment_state: "scored", assessed_at: "2026-10-08T10:00:00Z" };
  await page.route("**/api/home/pool/jev-assess", async (route) => {
    if (route.request().method() === "POST") {
      posts += 1;
      return route.fulfill({ status: 202, json: { started: true, accepted: true, status: "running" } });
    }
    reads += 1;
    await route.fulfill({ json: ready ? { ok: true, status: "succeeded", items: [scored] } : { status: "running" } });
  });
  await page.goto("/?tab=pool");
  await select(page, 0).check();
  await page.clock.install();
  await page.locator("[data-pool-jev-assess]").click();
  await page.locator("[data-pool-score-execute]").click();
  await expect.poll(() => reads).toBe(1);
  for (let i = 1; i < 45; i++) {
    await page.clock.runFor(1000);
    await expect.poll(() => reads).toBe(i + 1);
  }
  await expect(page.locator("[data-pool-score-status]")).toContainText("仍在后台进行");
  ready = true;
  await page.locator("[data-pool-agent-feed]").getByRole("button", { name: "读取评分状态" }).click();
  await expect(page.locator("[data-pool-score-status]")).toContainText("已完成");
  expect(posts).toBe(1);
});

test("short viewport keeps scope and score decision visible with one solid primary", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 630 });
  await page.goto("/?tab=pool");
  await select(page, 0).check();
  await page.locator("[data-pool-jev-assess]").click();
  const geometry = await page.locator("[data-home-pane='pool']").evaluate((el) => {
    const box = (selector: string) => el.querySelector(selector)!.getBoundingClientRect();
    const header = box("[data-pool-interaction]"), decision = box("[data-pool-score-execute]"), composer = box("[data-composer-input]");
    const primary = getComputedStyle(el).getPropertyValue("--primary").trim();
    const probe = document.createElement("span"); probe.style.backgroundColor = primary; el.append(probe);
    const primaryRgb = getComputedStyle(probe).backgroundColor; probe.remove();
    return { headerTop: header.top, decisionBottom: decision.bottom, composerBottom: composer.bottom,
      overflow: document.documentElement.scrollWidth > innerWidth,
      primaryCount: [...el.querySelectorAll("button")].filter((b) => b.getBoundingClientRect().width > 0 && getComputedStyle(b).backgroundColor === primaryRgb).length };
  });
  expect(geometry.headerTop).toBeGreaterThanOrEqual(0);
  expect(geometry.decisionBottom).toBeLessThanOrEqual(630);
  expect(geometry.composerBottom).toBeLessThanOrEqual(630);
  expect(geometry.overflow).toBe(false);
  expect(geometry.primaryCount).toBe(1);
  await page.screenshot({ path: test.info().outputPath("pool-agent-confirm.png") });
});
