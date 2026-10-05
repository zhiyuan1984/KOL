import { expect, test } from "@playwright/test";

test("confirmation replaces stale discovery results and restores a busy rejection", async ({ page, request }) => {
  const response = await request.post("/api/home/discovery/workspace", { data: {
    request_id: `confirmation-progress-${Date.now()}`, text: "发现露营候选", brief: {
      platforms: ["youtube"], region: "na", directions: [], keywords: ["camping"],
      min_followers: 10000, max_followers: 2000000, min_avg_plays_10: 5000, expect_count: 30,
    },
  } });
  expect(response.ok(), await response.text()).toBeTruthy();
  const saved = await response.json();
  const stale = { type: "task_result", title: "等待确认", summary: "已生成平台确认卡，远端尚未执行。请核对后在平台确认。", sections: [], metrics: [], recommended_actions: [] };
  // Read the real persisted envelope once before installing the fixture.
  // A live route.fetch can finish after reload cancels its intercepted request.
  const taskResponse = await request.get(`/api/tasks/${saved.task_id}`);
  expect(taskResponse.ok(), await taskResponse.text()).toBeTruthy();
  const taskData = await taskResponse.json();
  Object.assign(taskData.task || taskData, { worker_id: "confirmation-worker", status: "waiting", context: stale.summary, task_result: stale });
  await page.route(new RegExp(`/api/tasks/(?:by-session/${saved.session_id}|${saved.task_id})$`), route => route.fulfill({ json: taskData }));
  const sessionResponse = await request.get(`/api/sessions/${saved.session_id}`);
  expect(sessionResponse.ok(), await sessionResponse.text()).toBeTruthy();
  const sessionData = await sessionResponse.json();
  sessionData.messages = [...(sessionData.messages || []), { id: "stale-result", session_id: saved.session_id,
    role: "assistant", kind: "task_result_card", payload: stale, created_at: new Date().toISOString() }];
  await page.route(`**/api/sessions/${saved.session_id}`, route => route.fulfill({ json: sessionData }));
  let stage = "pending";
  let confirmations = 0;
  await page.route("**/api/queries/runtime.actions?*", route => {
    const label = stage === "pending" ? "待确认" : stage === "queued" ? "已确认，等待执行" : "采集未启动 · 已有任务占用";
    const summary = stage === "queued" ? "确认已收到，正在等待后台执行。无需重复确认。" : "此前采集仍占用采集服务，本次启动未执行。";
    return route.fulfill({ json: { actions: [{ id: "confirmation-action", run_id: "confirmation-worker",
      skill_id: "crawler_collect", operation: "start_crawl", arguments: { keywords: "camping" },
      state: stage === "rejected" ? "rejected" : "pending", risk: "L3", confirmation_version: "snapshot",
      execution: stage === "pending" ? null : { id: "confirmation-job", status: stage === "queued" ? "queued" : "uncertain" },
      can_retry: stage === "rejected", error_code: stage === "rejected" ? "runtime_probe_crawl_busy" : null,
      progress: { label, summary, state: stage, replace_result: stage !== "pending", result: { ...stale, title: label, summary } },
    }] } });
  });
  await page.route("**/api/actions/runtime.confirm", async route => {
    confirmations += 1;
    stage = "queued";
    await route.fulfill({ status: 202, json: { job: { id: "confirmation-job" } } });
  });
  await page.goto(`/s/${saved.session_id}`);
  const actions = page.locator("[data-runtime-actions]");
  await actions.getByRole("button", { name: "确认开始采集" }).click();
  await expect(page.locator(".side-workbench")).toContainText("已确认，等待执行");
  await expect(page.locator(".side-workbench")).not.toContainText(stale.summary);
  await expect(actions.getByRole("button", { name: "确认开始采集" })).toHaveCount(0);
  stage = "rejected";
  await page.reload();
  await expect(page.locator(".side-workbench")).toContainText("采集未启动 · 已有任务占用");
  await expect(page.locator(".side-workbench")).not.toContainText(stale.summary);
  await expect(actions.getByRole("button", { name: "重新核对并重试" })).toBeVisible();
  expect(confirmations).toBe(1);
  await page.unrouteAll({ behavior: "wait" });
});

test("uses saved candidates for analysis and distinguishes sampled views from latest ten", async ({ page, request }, testInfo) => {
  const response = await request.post("/api/home/discovery/workspace", { data: {
    request_id: `candidate-context-${Date.now()}`, text: "发现北美露营候选", brief: {
      platforms: ["youtube"], region: "na", directions: [], keywords: ["camping"],
      min_followers: 100, max_followers: 20000, min_avg_plays_10: 100, expect_count: 10,
    },
  } });
  expect(response.ok()).toBeTruthy();
  const saved = await response.json();
  await page.route("**/api/queries/runtime.actions?*", route => route.fulfill({ json: { actions: [{
    id: "candidate-action", skill_id: "crawler_collect", operation: "start_crawl", arguments: { keywords: "camping" },
    state: "succeeded", risk: "L3", confirmation_version: "reviewed", blocked_reason: null, receipt: { task_id: "scoped-crawl" },
    crawl: { id: "candidate-action", remote_task_id: "scoped-crawl", state: "succeeded", result_state: "ready", result_json: {
      task_id: "scoped-crawl", captured_at: "2026-10-04T10:00:00Z", complete: true, candidates: [
        { id: "candidate-1", name: "测试候选", platform: "youtube", source_url: "https://www.youtube.com/channel/fixture",
          followers: 4, avg_views_10: null, region: null, sampled_views_count: 10, sampled_views_avg: 123 },
      ],
    } },
  }] } }));
  let submitted: Record<string, unknown> | null = null;
  await page.route(`**/api/sessions/${saved.session_id}/messages`, async route => {
    if (route.request().method() !== "POST") return route.continue();
    submitted = route.request().postDataJSON();
    await route.fulfill({ json: { messages: [], agent_status: "listening" } });
  });
  await page.goto(`/s/${saved.session_id}`);
  const results = page.locator("[data-discovery-results]");
  await expect(results).toContainText("采集样本 10 条");
  await expect(results).toContainText("近10条均播：数据不足，无法核验");
  await expect(results).toContainText("粉丝：4 · 缺少可核验来源，暂不判定门槛");
  await expect(results).not.toContainText("不符合当前门槛");
  await expect(results.getByRole("link", { name: "查看原始主页" })).toHaveAttribute("href", "https://www.youtube.com/channel/fixture");
  await page.screenshot({ path: testInfo.outputPath("discovery-candidates.png"), fullPage: true });
  await results.getByRole("button", { name: "让线索智能体分析候选" }).click();
  await expect.poll(() => submitted).toMatchObject({ intent: "crawler_collect", text: expect.stringContaining("scoped-crawl") });
});

test("recovers a saved discovery after the browser loses its initial pending message", async ({ page, request }) => {
  const response = await request.post("/api/home/discovery/workspace", { data: {
    request_id: `lost-pending-${Date.now()}`, text: "发现北美露营候选", brief: {
      platforms: ["youtube"], region: "na", directions: [], keywords: ["camping"],
      min_followers: 100, max_followers: 20000, min_avg_plays_10: 100, expect_count: 10,
    },
  } });
  expect(response.ok()).toBeTruthy();
  const saved = await response.json();
  await page.goto(`/s/${saved.session_id}`);
  await expect(page.locator("[data-discovery-condition-snapshot]")).toContainText("北美");
  const post = page.waitForRequest(r => r.method() === "POST" && r.url().includes(`/sessions/${saved.session_id}/messages`));
  await page.getByRole("button", { name: "继续分析发现需求" }).click();
  expect((await post).postDataJSON()).toMatchObject({ work_item_id: saved.task_id, run_id: saved.pending.run_id });
  await expect(page.getByRole("button", { name: "继续分析发现需求" })).toHaveCount(0);
});

for (const surface of [
  { name: "pointer", width: 1440, height: 900, touch: false },
  { name: "short-keyboard", width: 1024, height: 589, touch: false },
  { name: "touch", width: 820, height: 700, touch: true },
  ...[1280, 1440, 1680].flatMap(width => [900, 785, 700].map(height => ({
    name: `pointer-${width}-${height}`, width, height, touch: false,
  }))).filter(surface => surface.name !== "pointer-1440-900"),
  ...[1260, 1024].flatMap(width => [630, 589].map(height => ({
    name: `short-keyboard-${width}-${height}`, width, height, touch: false,
  }))).filter(surface => surface.name !== "short-keyboard-1024-589"),
  { name: "touch-phone", width: 390, height: 700, touch: true },
]) test.describe(surface.name, () => {
test.use({ viewport: { width: surface.width, height: surface.height }, hasTouch: surface.touch });
test("home discovery submits to the lead agent without calling the retired crawler entry", async ({ page }, testInfo) => {
  // The reported deployment uses HTTP on an IP address: randomUUID may be absent.
  await page.addInitScript(() => { Object.defineProperty(crypto, "randomUUID", { value: undefined }); });
  const oldPosts: string[] = [];
  page.on("request", request => {
    if (request.method() === "POST" && /\/api\/home\/discovery\/run$|\/start-crawl$/.test(new URL(request.url()).pathname)) oldPosts.push(request.url());
  });
  await page.goto("/?tab=discovery");
  await expect(page.locator("[data-discovery-search-card]")).toBeVisible();
  await page.locator('[data-skill-param="region"] [data-discovery-chip="na"]').click();
  const workspaceSaved = page.waitForResponse(response => response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/home/discovery/workspace");
  const initialTask = page.waitForResponse(response => response.request().method() === "GET"
    && /^\/api\/tasks\/(?:by-session\/)?(?:wi|ses)_discovery_/.test(new URL(response.url()).pathname));
  await page.locator("[data-home] [data-ai-prompt-submit]").click();
  const savedResponse = await workspaceSaved;
  expect(savedResponse.ok(), await savedResponse.text()).toBeTruthy();
  const savedWorkspace = await savedResponse.json();
  const readsWorkspaceTask = (response: import("@playwright/test").Response) => response.request().method() === "GET"
    && [`/api/tasks/${savedWorkspace.task_id}`, `/api/tasks/by-session/${savedWorkspace.session_id}`].includes(new URL(response.url()).pathname);
  const initialTaskResponse = await initialTask;
  expect(readsWorkspaceTask(initialTaskResponse)).toBe(true);
  expect(initialTaskResponse.ok()).toBeTruthy();
  await expect(page).toHaveURL(/\/s\/[^/]+$/);
  const sessionUrl = page.url();
  await expect(page.locator('[data-agent-profile="lead"]')).toContainText("线索智能体");
  await expect(page.locator("[data-discovery-condition-snapshot]")).toContainText("北美");
  await expect(page.locator("[data-expert-identity='expert:crawler']")).toHaveCount(0);
  const restoredTask = page.waitForResponse(readsWorkspaceTask);
  await page.reload();
  expect((await restoredTask).ok()).toBeTruthy();
  await expect(page.locator("[data-discovery-condition-snapshot]")).toContainText("北美");
  const back = page.getByRole("link", { name: /返回\s*AI发现/ });
  await expect(back).toHaveCount(1);
  if (surface.name.startsWith("short-keyboard")) { await back.focus(); await page.keyboard.press("Enter"); }
  else if (surface.touch) await back.tap();
  else await back.click();
  await expect(page).toHaveURL(/tab=discovery&resume=/);
  await expect(page.locator("[data-discovery-resume]")).toBeVisible();
  await expect(page.locator('[data-home] [data-composer-input]')).toHaveValue(/北美/);
  const continuedTask = page.waitForResponse(readsWorkspaceTask);
  await page.getByRole("button", { name: "继续原发现任务" }).click();
  expect((await continuedTask).ok()).toBeTruthy();
  await expect(page).toHaveURL(sessionUrl);
  await expect(page.locator("[data-discovery-condition-snapshot]")).toContainText("北美");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (surface.width < 1200) await expect(page.getByRole("button", { name: "展开结果", exact: true })).toBeVisible();
  if (surface.touch) {
    const top = await page.locator(".mobile-top").boundingBox();
    expect(top!.height).toBeLessThan(surface.height / 5);
  }
  await page.screenshot({ path: testInfo.outputPath(`discovery-${surface.name}.png`), fullPage: true });
  if (surface.touch) await page.getByRole("button", { name: "打开导航", exact: true }).tap();
  await page.getByRole("link", { name: "技能", exact: true }).click();
  await expect(page).toHaveURL(/\/skills$/);
  expect(oldPosts).toEqual([]);
});
});

test("a previous failed discovery does not hide the new conditions or template", async ({ page }) => {
  await page.route("**/api/home/discovery/runs", route => route.fulfill({ json: { runs: [
    { id: "old_failure", status: "crawl_failed", work_item_id: "old_task", error: "采集失败" },
  ] } }));
  await page.goto("/?tab=discovery");
  await expect(page.locator("[data-discovery-search-card]")).toBeVisible();
  await expect(page.locator('[data-home] [data-composer-input]')).toHaveValue(/【发现任务】/);
  await expect(page.locator('[data-skill-template-context]').first()).toBeVisible();
});

test("shows exact pending scope, confirms once, and restores the receipt after reload", async ({ page, request }) => {
  const created = await request.post("/api/sessions", { data: { title: "Runtime confirmation UI" } });
  expect(created.ok()).toBeTruthy();
  const session = await created.json();
  const id = String(session.id || session.session_id || session.session?.id);
  let confirmations = 0;
  let state = "pending";
  await page.route("**/api/queries/runtime.actions?*", (route) => route.fulfill({ json: { actions: [{
    id: "action_ui_test", skill_id: "crawler_collect", operation: "start_crawl", arguments: { platforms: ["youtube"], keywords: "camping" },
    state, risk: "L3", confirmation_version: "reviewed-snapshot", blocked_reason: null,
    receipt: state === "succeeded" ? { task_id: "task_ui_test" } : null,
  }] } }));
  await page.route("**/api/actions/runtime.confirm", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ action_id: "action_ui_test", confirmation_version: "reviewed-snapshot" });
    confirmations += 1;
    state = "succeeded";
    await route.fulfill({ status: 202, json: { job: { id: "job_ui_test" } } });
  });
  await page.goto(`/s/${id}`);
  const actions = page.locator("[data-runtime-actions]");
  await expect(actions).toContainText("请确认本次采集范围");
  await expect(actions).toContainText("camping");
  expect(confirmations).toBe(0);
  await actions.getByRole("button", { name: "确认开始采集" }).click();
  await expect(actions).toContainText("采集请求已提交");
  await expect(actions.getByText("查看操作记录", { exact: true })).toBeVisible();
  expect(confirmations).toBe(1);
  await page.reload();
  await expect(page.locator("[data-runtime-actions]")).toContainText("采集请求已提交");
  await page.getByText("查看操作记录", { exact: true }).click();
  const record = page.getByText("查看操作记录", { exact: true }).locator("..");
  await expect(record).toContainText("采集公开红人资料");
  await expect(record).toContainText("采集请求已提交");
  await expect(record.locator("pre")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "确认开始采集" })).toHaveCount(0);
  expect(confirmations).toBe(1);
});
