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
  const actions = page.locator('[data-discovery-event="confirm"]');
  await actions.getByRole("button", { name: "确认开始采集" }).click();
  await expect(actions).toContainText("已确认，等待执行");
  await expect(actions).toContainText("确认已收到，正在等待后台执行。无需重复确认。");
  await expect(page.locator("[data-scope-task-rail]")).toContainText("尚未取得候选资料");
  await expect(page.locator("[data-scope-task-rail]")).not.toContainText("确认采集范围后");
  await expect(page.locator("[data-scope-task-rail]")).not.toContainText(stale.summary);
  await expect(actions.getByRole("button", { name: "确认开始采集" })).toHaveCount(0);
  stage = "rejected";
  await page.reload();
  await expect(actions).toContainText("未执行");
  await expect(actions).toContainText("此前采集仍占用采集服务，本次启动未执行。");
  await expect(page.locator("[data-scope-task-rail]")).toContainText("尚未取得候选资料");
  await expect(page.locator("[data-scope-task-rail]")).not.toContainText(stale.summary);
  await expect(actions.getByRole("button", { name: "核对后重试" })).toBeVisible();
  expect(confirmations).toBe(1);
  await page.unrouteAll({ behavior: "wait" });
});

test("queued crawl shows position and supports dequeue", async ({ page, request }) => {
  const response = await request.post("/api/home/discovery/workspace", { data: {
    request_id: `queue-dequeue-${Date.now()}`, text: "发现露营候选", brief: {
      platforms: ["youtube"], region: "na", directions: [], keywords: ["camping"],
      min_followers: 10000, max_followers: 2000000, min_avg_plays_10: 5000, expect_count: 30,
    },
  } });
  expect(response.ok(), await response.text()).toBeTruthy();
  const saved = await response.json();
  let dequeued = false;
  const queuedSummary = "已加入采集排队，前面还有 2 个任务，轮到时自动开始。无需重复确认。";
  await page.route("**/api/queries/runtime.actions?*", route => route.fulfill({ json: { actions: [{
    id: "queue-action", run_id: "queue-worker", skill_id: "crawler_collect", operation: "start_crawl",
    arguments: { keywords: "camping" }, state: "succeeded", risk: "L3", confirmation_version: "snapshot",
    execution: null, can_retry: false, error_code: null, blocked_reason: null, receipt: null,
    crawl: dequeued
      ? { id: "queue-action", remote_task_id: null, state: "cancelled", status_json: null, error_code: "queue_cancelled_by_user" }
      : { id: "queue-action", remote_task_id: null, state: "queued", status_json: null, error_code: null, queue_position: 3 },
    progress: { label: "已确认，等待执行", summary: dequeued ? "本次动作已取消；已取得的回执和候选仍保留。" : queuedSummary,
      state: dequeued ? "cancelled" : "queued", replace_result: true,
      result: { type: "task_result", title: "已确认，等待执行", summary: queuedSummary, sections: [], metrics: [], recommended_actions: [] } },
  }] } }));
  let dequeueCalls = 0;
  await page.route("**/api/actions/runtime.crawl.dequeue", async route => {
    dequeueCalls += 1;
    dequeued = true;
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto(`/s/${saved.session_id}`);
  const actions = page.locator('[data-discovery-event="confirm"]');
  await expect(actions).toContainText("前面还有 2 个任务");
  await expect(actions.getByRole("button", { name: "取消排队" })).toBeVisible();
  await actions.getByRole("button", { name: "取消排队" }).click();
  await expect(actions).toContainText("已取消");
  await expect(actions.getByRole("button", { name: "取消排队" })).toHaveCount(0);
  expect(dequeueCalls).toBe(1);
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
  let messages: Record<string, unknown>[] = [];
  await page.route(`**/api/home/discovery/workspace/${saved.task_id}/pending`, route => route.fulfill({ json: { pending: null } }));
  await page.route(`**/api/sessions/${saved.session_id}`, route => route.fulfill({ json: { messages, agent_status: "listening" } }));
  await page.route(`**/api/sessions/${saved.session_id}/messages`, async route => {
    if (route.request().method() !== "POST") return route.continue();
    submitted = route.request().postDataJSON();
    messages = [
      { id: "analysis-request", kind: "me", payload: { text: submitted!.text } },
      { id: "analysis-report", kind: "task_result_card", payload: { title: "候选分析", summary: "本任务候选分析的完整证据", sections: [], metrics: [], recommended_actions: [] } },
    ];
    await route.fulfill({ json: { messages, agent_status: "listening" } });
  });
  await page.goto(`/s/${saved.session_id}`);
  const results = page.locator("[data-discovery-results]");
  await results.getByText("资料与筛选依据", { exact: true }).click();
  await expect(results).toContainText("本次采样 10 条，样本均播 123；未证明覆盖最近10条。");
  await expect(results.locator(".pool-row-metrics")).toContainText(/近10条均播\s*无法核验/);
  await expect(results.locator(".pool-row-metrics")).toContainText(/粉丝\s*4/);
  await expect(results).toContainText("粉丝缺少可核验来源");
  await expect(results).not.toContainText("粉丝不符合当前条件");
  await expect(results.getByRole("link", { name: "主页 ↗", exact: true })).toHaveAttribute("href", "https://www.youtube.com/channel/fixture");
  await page.screenshot({ path: testInfo.outputPath("discovery-candidates.png"), fullPage: true });
  await results.getByRole("button", { name: "让线索智能体分析候选" }).click();
  await expect.poll(() => submitted).toMatchObject({ intent: "crawler_collect", work_item_id: saved.task_id, text: expect.stringContaining("scoped-crawl") });
  await expect(page.locator("[data-discovery-analysis]")).toContainText("本任务候选分析的完整证据");
  await expect(page.locator(".scope-workspace-center-scroll")).not.toContainText("本任务候选分析的完整证据");
  await page.reload();
  await expect(page.locator("[data-discovery-analysis]")).toContainText("本任务候选分析的完整证据");
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
  const posted: Record<string, unknown>[] = [];
  await page.route(`**/api/sessions/${saved.session_id}/messages`, route => {
    posted.push(route.request().postDataJSON());
    return route.fulfill({ json: { messages: [], agent_status: "listening" } });
  });
  await page.goto(`/s/${saved.session_id}`);
  await expect(page).toHaveURL(`/?tab=discovery&resume=${saved.task_id}`);
  await expect(page.locator('[data-discovery-event="conditions"]')).toContainText("北美");
  await expect.poll(() => posted).toHaveLength(1);
  expect(posted[0]).toMatchObject({ work_item_id: saved.task_id, run_id: saved.pending.run_id });
  await expect(page.locator("[data-workspace-session]")).toHaveAttribute("data-workspace-session", saved.session_id);
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
  await page.locator("[data-home] [data-ai-prompt-submit]").click();
  const savedResponse = await workspaceSaved;
  expect(savedResponse.ok(), await savedResponse.text()).toBeTruthy();
  const savedWorkspace = await savedResponse.json();
  const readsWorkspaceTask = (response: import("@playwright/test").Response) => response.request().method() === "GET"
    && [`/api/tasks/${savedWorkspace.task_id}`, `/api/tasks/by-session/${savedWorkspace.session_id}`].includes(new URL(response.url()).pathname);
  // 新流程：提交后留在 AI发现 面核对实际参数、再确认采集，不跳转；任务会话由常驻入口打开。
  await expect(page).toHaveURL(/tab=discovery/);
  await expect(page.locator('[data-discovery-event="params"]')).toBeVisible();
  const restoredUrl = `/?tab=discovery&session_id=${encodeURIComponent(savedWorkspace.session_id)}`;
  // Both saved entry URLs must restore the same workspace without creating a task.
  const initialTask = page.waitForResponse(readsWorkspaceTask);
  await page.goto(`/s/${savedWorkspace.session_id}`);
  expect((await initialTask).ok()).toBeTruthy();
  await expect(page).toHaveURL(`/?tab=discovery&resume=${savedWorkspace.task_id}`);
  await expect(page.locator('[data-discovery-event="conditions"]')).toContainText("北美");
  await expect(page.locator("[data-workspace-session]")).toHaveAttribute("data-workspace-session", savedWorkspace.session_id);
  await expect(page.locator("[data-expert-identity='expert:crawler']")).toHaveCount(0);
  const restoredTask = page.waitForResponse(readsWorkspaceTask);
  await page.reload();
  expect((await restoredTask).ok()).toBeTruthy();
  await expect(page.locator('[data-discovery-event="conditions"]')).toContainText("北美");
  await expect(page.locator("[data-discovery-resume]")).toBeVisible();
  await expect(page.locator('[data-home] [data-composer-input]')).toHaveValue(/北美/);
  const continuedTask = page.waitForResponse(readsWorkspaceTask);
  const continueButton = page.getByRole("button", { name: "继续原发现任务" });
  if (surface.name.startsWith("short-keyboard")) { await continueButton.focus(); await page.keyboard.press("Enter"); }
  else if (surface.touch) await continueButton.tap();
  else await continueButton.click();
  expect((await continuedTask).ok()).toBeTruthy();
  await expect(page).toHaveURL(restoredUrl);
  await expect(page.locator('[data-discovery-event="conditions"]')).toContainText("北美");
  await expect(page.locator("[data-workspace-session]")).toHaveAttribute("data-workspace-session", savedWorkspace.session_id);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (surface.width < 1200) await expect(page.getByRole("button", { name: "展开红人线索", exact: true })).toBeVisible();
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
  await expect(page.locator('[data-discovery-event="skill"]').first()).toBeVisible();
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
  await actions.getByText("查看执行回执与范围", { exact: true }).click();
  await expect(actions.getByText("查看操作记录", { exact: true })).toBeVisible();
  expect(confirmations).toBe(1);
  await page.reload();
  await expect(page.locator("[data-runtime-actions]")).toContainText("采集请求已提交");
  await page.getByText("查看执行回执与范围", { exact: true }).click();
  await page.getByText("查看操作记录", { exact: true }).click();
  const record = page.getByText("查看操作记录", { exact: true }).locator("..");
  await expect(record).toContainText("采集公开红人资料");
  await expect(record).toContainText("采集请求已提交");
  await expect(record.locator("pre")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "确认开始采集" })).toHaveCount(0);
  expect(confirmations).toBe(1);
});


test("restored discovery retains the separate R3 stop confirmation and receipt", async ({ page, request }) => {
  const response = await request.post("/api/home/discovery/workspace", { data: {
    request_id: `restored-stop-${Date.now()}`, text: "隔离停止确认验收", brief: {
      platforms: ["youtube"], region: "na", directions: [], keywords: ["camping"],
      min_followers: 100, max_followers: 20000, min_avg_plays_10: 100, expect_count: 10,
    },
  } });
  expect(response.ok()).toBeTruthy();
  const saved = await response.json();
  await page.route(`**/api/home/discovery/workspace/${saved.task_id}/pending`, route => route.fulfill({ json: { pending: null } }));
  let stopState = "pending";
  await page.route("**/api/queries/runtime.actions?*", route => route.fulfill({ json: { actions: [
    { id: "saved-start", operation: "start_crawl", skill_id: "crawler_collect", state: "succeeded", risk: "L3",
      arguments: { keywords: "camping" }, crawl: { id: "saved-start", state: "running", remote_task_id: "saved-remote" } },
    { id: "saved-stop", operation: "stop_crawl", skill_id: "crawler_collect", state: stopState, risk: "L3",
      arguments: { task_id: "saved-remote" }, confirmation_version: "stop-snapshot",
      receipt: stopState === "succeeded" ? { task_id: "saved-remote" } : null },
  ] } }));
  let confirmations = 0;
  await page.route("**/api/actions/runtime.confirm", route => {
    expect(route.request().postDataJSON()).toEqual({ action_id: "saved-stop", confirmation_version: "stop-snapshot" });
    confirmations += 1; stopState = "succeeded";
    return route.fulfill({ status: 202, json: { job: { id: "stop-fixture" } } });
  });
  await page.goto(`/s/${saved.session_id}`);
  const stop = page.locator('[data-runtime-action="saved-stop"]');
  await expect(stop).toContainText("需要确认（R3）");
  await expect(stop).toContainText("saved-remote");
  expect(confirmations).toBe(0);
  await stop.getByRole("button", { name: "确认执行以上内容" }).click();
  await expect(stop).toContainText("停止请求已提交");
  await page.reload();
  await expect(stop).toContainText("停止请求已提交");
  expect(confirmations).toBe(1);
});
