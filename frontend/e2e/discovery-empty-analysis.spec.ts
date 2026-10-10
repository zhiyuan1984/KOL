import { test, expect, type Page } from "@playwright/test";

const id = "empty-analysis";
const brief = { platforms: ["youtube"], region: "global_en", directions: [], keywords: ["camping"],
  min_followers: 10000, max_followers: null, min_avg_plays_10: 5000, expect_count: 30 };
const analysisText = "请基于本任务已保存的发现条件与采集 remote-empty 的候选快照，整理可复核简报。";

async function fixture(page: Page, options: { status?: string; action?: "pending" | "empty" | "reading"; analysis?: boolean; readError?: boolean } = {}) {
  const writes: string[] = [];
  let status = options.status || "listening";
  await page.addInitScript(() => localStorage.setItem("ui:home-discovery-rail-collapsed", "false"));
  await page.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== "GET") writes.push(path);
    let json: unknown = [];
    if (path === "/api/health") json = { ok: true };
    else if (path === "/api/auth/status") json = { authenticated: true, account: { id: "employee", name: "员工", available_modes: ["employee"] } };
    else if (path === "/api/me") json = { id: "employee", name: "员工", available_modes: ["employee"] };
    else if (path === "/api/preferences") json = { theme: "light" };
    else if (path.includes("/api/tasks/by-session/") || path === `/api/tasks/${id}`) json = { task: {
      id, session_id: id, title: "发现任务", status: "completed", skill_id: "crawler_collect",
      input: { discovery_workspace: { kind: "discovery", version: 1, agent_id: "lead", profile: "lead", brief,
        template: { id: "crawler_collect", skill_id: "crawler_collect", version: "1", inputs: [], steps: [], constraints: [], output: { title: "候选" } } } },
    } };
    else if (path === `/api/sessions/${id}`) {
      if (options.readError) return route.fulfill({ status: 503, json: { error: "session_unavailable" } });
      json = { agent_status: status, messages: [{ id: "request", kind: "me", payload: { text: options.analysis ? analysisText : "请核对本次发现条件" } },
        ...(options.analysis && status === "listening" ? [{ id: "report", kind: "text", payload: { text: "本次快照为零候选，没有符合条件的证据。" } }] : [])] };
    } else if (path === "/api/queries/runtime.actions") json = { actions: options.action ? [{
      id: "action-empty", operation: "start_crawl", skill_id: "crawler_collect", state: options.action === "pending" ? "pending" : "succeeded",
      arguments: { platforms: ["youtube"], keywords: "camping", crawler_type: "search" }, confirmation_version: "v1",
      created_at: "2026-10-10T09:00:00Z", crawl: options.action === "pending" ? null : { id: "action-empty", state: "succeeded",
        result_state: options.action === "reading" ? "running" : "ready", remote_task_id: "remote-empty",
        ...(options.action === "empty" ? { result_json: { task_id: "remote-empty", complete: true, candidates: [] } } : {}) },
    }] : [] };
    else if (path.endsWith("/events")) {
      if (path.startsWith("/api/tasks/")) json = [{ type: "run.completed" }];
      else return route.fulfill({ contentType: "text/event-stream", body: "" });
    }
    await route.fulfill({ json });
  });
  return { writes, complete: () => { status = "listening"; } };
}

for (const entry of [`/s/${id}`, `/?tab=discovery&session_id=${id}`]) {
  test(`initial discovery thinking is not candidate analysis: ${entry}`, async ({ page }) => {
    const f = await fixture(page, { status: "running" });
    await page.goto(entry);
    await expect(page.locator("[data-workspace-session]")).toHaveAttribute("data-workspace-session", id);
    await expect(page.locator("[data-discovery-analysis]")).toHaveCount(0);
    await expect(page.locator('[data-discovery-empty="filtered"]')).toHaveCount(0);
    await expect(page).toHaveURL(entry);
    expect(f.writes).toEqual([]);
  });
}

test("an unconfirmed proposal is not a completed empty search", async ({ page }) => {
  const f = await fixture(page, { action: "pending" });
  await page.goto(`/s/${id}`);
  await expect(page.locator("[data-discovery-start-confirm]")).toBeVisible();
  await expect(page.locator('[data-discovery-empty="filtered"]')).toHaveCount(0);
  await expect(page.locator("[data-discovery-analysis]")).toHaveCount(0);
  expect(f.writes).toEqual([]);
});

test("candidate analysis and final empty conclusion are mutually exclusive and recover after reload", async ({ page }, info) => {
  const f = await fixture(page, { status: "running", action: "empty", analysis: true });
  await page.goto(`/s/${id}`);
  await expect(page.locator("[data-discovery-analysis]")).toContainText("正在分析本任务的候选快照");
  await expect(page.locator('[data-discovery-empty="filtered"]')).toHaveCount(0);
  f.complete();
  await expect(page.locator("[data-discovery-analysis]")).toContainText("本次快照为零候选");
  await expect(page.locator("[data-discovery-analysis]")).not.toContainText("正在分析");
  await expect(page.locator('[data-discovery-empty="filtered"]')).toContainText("本次采集未返回候选");
  await expect(page.locator('[data-discovery-empty="filtered"]')).not.toContainText("筛选无结果");
  await page.reload();
  await expect(page.locator('[data-discovery-empty="filtered"]')).toContainText("本次采集未返回候选");
  await page.screenshot({ path: info.outputPath("empty-result-after.png"), fullPage: true });
  expect(f.writes).toEqual([]);
});

test("remote completion without a result snapshot is still awaiting results", async ({ page }) => {
  const f = await fixture(page, { action: "reading" });
  await page.goto(`/s/${id}`);
  await expect(page.locator("[data-discovery-remote-receipt]")).toContainText("正在读取结果");
  await expect(page.locator('[data-discovery-empty="filtered"]')).toHaveCount(0);
  await expect(page.locator('[data-discovery-empty="waiting-results"]')).toBeVisible();
  expect(f.writes).toEqual([]);
});

test("session read failures never claim candidate analysis is running", async ({ page }) => {
  const f = await fixture(page, { readError: true });
  await page.goto(`/s/${id}`);
  await expect(page.getByRole("alert").first()).toBeVisible();
  await expect(page.locator("[data-discovery-analysis]")).toHaveCount(0);
  expect(f.writes).toEqual([]);
});

test("an old analysis request does not relabel a later unrelated turn", async ({ page }) => {
  const f = await fixture(page, { status: "running", action: "pending" });
  await page.route(`**/api/sessions/${id}?**`, route => route.fulfill({ json: { agent_status: "running", messages: [
    { id: "old-analysis", kind: "me", payload: { text: analysisText } },
    { id: "old-report", kind: "text", payload: { text: "上一次分析完成" } },
    { id: "new-question", kind: "me", payload: { text: "请核对新的采集条件" } },
  ] } }));
  await page.route(`**/api/sessions/${id}`, route => route.fulfill({ json: { agent_status: "running", messages: [
    { id: "old-analysis", kind: "me", payload: { text: analysisText } },
    { id: "old-report", kind: "text", payload: { text: "上一次分析完成" } },
    { id: "new-question", kind: "me", payload: { text: "请核对新的采集条件" } },
  ] } }));
  await page.goto(`/s/${id}`);
  await expect(page.locator("[data-discovery-start-confirm]")).toBeVisible();
  await expect(page.locator("[data-discovery-analysis]")).toHaveCount(0);
  expect(f.writes).toEqual([]);
});

test("a completed thinking turn without a crawl action is not a zero candidate result", async ({ page }) => {
  const f = await fixture(page);
  await page.goto(`/s/${id}`);
  await expect(page.locator("[data-workspace-session]")).toHaveAttribute("data-workspace-session", id);
  await expect(page.locator('[data-discovery-empty="filtered"]')).toHaveCount(0);
  await expect(page.locator("[data-discovery-analysis]")).toHaveCount(0);
  expect(f.writes).toEqual([]);
});

test("an incomplete empty snapshot is not a final zero candidate result", async ({ page }) => {
  const f = await fixture(page, { action: "empty" });
  await page.route("**/api/queries/runtime.actions?**", route => route.fulfill({ json: { actions: [{
    id: "action-empty", operation: "start_crawl", skill_id: "crawler_collect", state: "succeeded", arguments: {},
    crawl: { id: "action-empty", state: "partial", result_state: "partial", result_json: { task_id: "remote-empty", complete: false, candidates: [] } },
  }] } }));
  await page.goto(`/s/${id}`);
  await expect(page.locator("[data-discovery-remote-receipt]")).toContainText("采集部分完成");
  await expect(page.locator('[data-discovery-empty="filtered"]')).toHaveCount(0);
  expect(f.writes).toEqual([]);
});

test("a saved stale rejection exposes review-and-retry, never starts automatically", async ({ page }) => {
  const f = await fixture(page, { action: "pending" });
  await page.route("**/api/queries/runtime.actions?**", route => route.fulfill({ json: { actions: [{
    id: "action-stale", operation: "start_crawl", skill_id: "crawler_collect", state: "rejected",
    arguments: { platforms: ["youtube"], keywords: "camping", crawler_type: "search" },
    error_code: "runtime_action_snapshot_stale", confirmation_version: "v1", can_retry: true,
    execution: { id: "stale-job", status: "failed", error_code: "runtime_action_snapshot_stale" },
    progress: { state: "rejected", label: "采集未启动 · 确认已失效", summary: "本次采集未下发，请重新核对范围。" },
  }] } }));
  await page.goto(`/s/${id}`);
  await expect(page.locator('[data-discovery-event="confirm"]')).toHaveAttribute("data-discovery-event-state", "rejected");
  await expect(page.locator("[data-discovery-start-retry]")).toBeVisible();
  await expect(page.locator("[data-discovery-start-confirm]")).toHaveCount(0);
  await expect(page.locator("[data-discovery-execution-progress]")).toContainText("本次采集未下发");
  expect(f.writes).toEqual([]);
});

test("unknown dispatched outcome is not relabeled as starting or made retryable", async ({ page }) => {
  const f = await fixture(page, { action: "pending" });
  await page.route("**/api/queries/runtime.actions?**", route => route.fulfill({ json: { actions: [{
    id: "action-unknown", operation: "start_crawl", skill_id: "crawler_collect", state: "pending", arguments: {},
    can_retry: false, execution: { id: "unknown-job", status: "uncertain", error_code: "execution_handler_error" },
    progress: { state: "uncertain", label: "结果待核实", summary: "请核对已有任务，不要重新启动。" },
  }] } }));
  await page.goto(`/s/${id}`);
  await expect(page.locator('[data-discovery-event="confirm"]')).toHaveAttribute("data-discovery-event-state", "uncertain");
  await expect(page.locator("[data-discovery-start-confirm]")).toHaveCount(0);
  await expect(page.locator("[data-discovery-start-retry]")).toHaveCount(0);
  expect(f.writes).toEqual([]);
});
