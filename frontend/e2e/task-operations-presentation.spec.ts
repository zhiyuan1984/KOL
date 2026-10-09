import { expect, test, type Page } from "@playwright/test";

// Isolated rendering fixtures: no production data, tools, creation or cancellation.
async function fixture(page: Page, options: { error?: boolean; zero?: boolean; theme?: string } = {}) {
  const writes: string[] = [], errors: string[] = [], queries: string[] = [];
  const tasks = options.zero ? [] : Array.from({ length: 30 }, (_, index) => ({
    id: `task-${index}`, title: `任务 ${String(index + 1).padStart(2, "0")} · 采集并复核达人资料${index === 0 ? "超长标题".repeat(15) : ""}`,
    status: index < 10 ? "pending" : index < 20 ? "waiting_external" : index < 29 ? "running" : "failed",
    updated_at: "2026-10-09T06:00:00.000Z", created_at: "2026-10-09T02:00:00.000Z", task_type: "creator_discovery",
    due_at: index < 2 ? "2026-01-01T00:00:00Z" : null, source: "manual", cancelable: true, session_id: `session-${index}`,
    wait_reason: index >= 10 && index < 20 ? "等待外部采集完成，可在原会话查看进度" : null,
  }));
  const dashboard = {
    report_version: "task-operations-dashboard.v1", period: "realtime", timezone: "Asia/Shanghai", as_of: "2026-10-09T06:02:00Z", scope: "personal", source: "legacy_agent_task_projection",
    metrics: { total: tasks.length, in_progress: options.zero ? 0 : 19, waiting: options.zero ? 0 : 10, failed: options.zero ? 0 : 1, overdue: options.zero ? 0 : 2, cancelled: 0, completion_rate: 0, overdue_rate: 0, median_processing_hours: null },
    status_distribution: { queued: options.zero ? 0 : 10, running: options.zero ? 0 : 9, waiting: options.zero ? 0 : 10, completed: 0, failed: options.zero ? 0 : 1, cancelled: 0 }, comparison: null, trends: {},
    task_types: options.zero ? [] : [{ task_type: "creator_discovery", title: "采集线索", total: 30, in_progress: 19, completed: 0, failed: 1, trend: [0, 0, 0, 2, 5, 10, 30] }],
  };
  const business = { task: { task_id: "business-1", title: "报价审核业务任务", status: "open", updated_at: "2026-10-09T05:00:00Z", goal: "复核报价" }, counts: { total: 2, open: 1, blocked: 0, waiting_review: 0 }, current_blocking_work_order: null, next_work_order: null };
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (request.method() !== "GET") writes.push(`${request.method()} ${path}`);
    let json: unknown = [];
    if (path === "/api/auth/status") json = { authenticated: true, account: { id: "employee", name: "员工", available_modes: ["employee"] } };
    else if (path === "/api/me") json = { id: "employee", name: "员工", available_modes: ["employee"] };
    else if (path === "/api/preferences") json = { theme: options.theme || "light" };
    else if (path === "/api/tasks/operations-dashboard") {
      queries.push(url.search);
      if (options.error) return route.fulfill({ status: 503, json: { error: "service unavailable" } });
      json = { ...dashboard, period: url.searchParams.get("period") || "realtime" };
    } else if (path === "/api/tasks") {
      const status = url.searchParams.get("status"), q = url.searchParams.get("q"), overdue = url.searchParams.get("overdue");
      const items = tasks.filter(task => (!status || (status === "queued" ? task.status === "pending" : status === "waiting" ? task.status === "waiting_external" : task.status === status)) && (!q || task.title.includes(q)) && (!overdue || task.due_at));
      json = { items, page: { total: items.length, limit: 100, next_cursor: null } };
    } else if (path === "/api/task-work-orders/dashboard") json = {
      report_version: "task-work-order-dashboard.v2.1", period: "realtime", as_of: dashboard.as_of, timezone: "Asia/Shanghai", scope: "personal_authorized", source: "postgresql_task_work_orders", request_id: "test-only",
      summary: { tasks: { total: options.zero ? 0 : 1, open: options.zero ? 0 : 1, blocked: 0, waiting_review: 0, completed: 0 }, work_orders: { total: options.zero ? 0 : 2, open: options.zero ? 0 : 1, blocked: 0, waiting_review: 0, completed: 0, automatic_created: 0, automatic_assigned: 0 } },
      tasks: { items: options.zero ? [] : [business], page: { total: options.zero ? 0 : 1, limit: 100, next_cursor: null } }, metrics: {}, trends: {}, by_template: [], comparison: null,
    };
    if (path.endsWith("/events")) return route.fulfill({ contentType: "text/event-stream", body: "" });
    return route.fulfill({ json });
  });
  return { writes, errors, queries };
}

test("summary is unique, analysis is collapsed, standard viewport shows twelve rows", async ({ page }, info) => {
  const state = await fixture(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/tasks");
  const root = page.locator("[data-task-center]");
  await expect(root.locator(".task-center-unified-table tbody > tr")).toHaveCount(20);
  await expect(root.locator(".task-report-kpis")).toHaveCount(0);
  await expect(root.locator(".task-operations-breakdown")).not.toHaveAttribute("open");
  await expect(root.locator(".task-operation-status-running")).toHaveText("9执行中");
  await expect(root.locator(".task-operation-status-waiting")).toHaveText("10等待处理");
  await expect(root.locator(".task-operations-as-of")).toContainText("14:02");
  const metrics = await root.evaluate(el => {
    const wrap = el.querySelector(".task-center-table-wrap")!.getBoundingClientRect();
    const rows = Array.from(el.querySelectorAll(".task-center-unified-table tbody > tr")).map(row => row.getBoundingClientRect());
    return { full: rows.filter(rect => rect.top >= wrap.top && rect.bottom <= wrap.bottom && rect.bottom <= innerHeight).length,
      geometry: Object.fromEntries([".task-operations-report", ".task-center-filters", ".task-status-filter-row", ".task-center-pagination", ".task-operations-breakdown"].map(selector => [selector, el.querySelector(selector)!.getBoundingClientRect().height])), wrap: { top: wrap.top, height: wrap.height, bottom: wrap.bottom }, rowHeight: rows[0].height, overflow: document.documentElement.scrollWidth > innerWidth + 1,
      titleFont: getComputedStyle(el.querySelector("h2")!).fontSize };
  });
  console.log("DENSITY", JSON.stringify(metrics));
  await page.screenshot({ path: info.outputPath("tasks-desktop.png") });
  expect(metrics.rowHeight).toBe(44);
  expect(metrics.full).toBeGreaterThanOrEqual(12);
  expect(metrics.overflow).toBe(false);
  expect(metrics.titleFont).toBe("13px");
  await page.screenshot({ path: info.outputPath("tasks-desktop.png") });
  await root.locator(".task-operations-breakdown summary").click();
  await expect(root.locator(".task-operations-table")).toContainText("处理中（含等待）");
  expect(state.errors).toEqual([]); expect(state.writes).toEqual([]);
});

test("lifecycle and overdue remain independent and survive refresh", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/tasks");
  await page.locator(".task-operation-status-waiting").click();
  await expect(page).toHaveURL(/source=agent/); await expect(page).toHaveURL(/status=waiting/);
  await expect(page.locator(".task-center-unified-table tbody > tr")).toHaveCount(10);
  await page.reload();
  await expect(page.locator(".task-operation-status-waiting")).toHaveAttribute("aria-pressed", "true");
  await page.locator(".task-attention-filter").click();
  await expect(page).toHaveURL(/status=waiting/); await expect(page).toHaveURL(/attention=overdue/);
  await expect(page.locator(".task-active-conditions")).toContainText("异常：逾期");
  await page.getByRole("button", { name: "清空筛选", exact: true }).click();
  await expect(page).not.toHaveURL(/attention=|status=|source=/);
  await expect(page.locator(".task-center-unified-table tbody > tr")).toHaveCount(20);
  expect(state.errors).toEqual([]); expect(state.writes).toEqual([]);
});

test("manual range is sent identically to Agent summary and list; business has explicit separate scope", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/tasks?from=2026-10-01&to=2026-10-09&source=agent");
  await expect(page.locator(".task-operations-title")).toContainText("2026-10-01 至 2026-10-09");
  await expect(page.locator(".task-work-order-summary")).toContainText("工单仍按周期口径");
  expect(state.queries.some(query => query.includes("from=2026-10-01") && query.includes("to=2026-10-09"))).toBe(true);
  await page.getByRole("button", { name: "清空筛选", exact: true }).click();
  expect(state.errors).toEqual([]); expect(state.writes).toEqual([]);
});

for (const mode of ["zero", "error"] as const) {
  test(`${mode} data never invents a successful read`, async ({ page }) => {
    const state = await fixture(page, { zero: mode === "zero", error: mode === "error" });
    await page.goto("/tasks");
    if (mode === "error") {
      await expect(page.locator(".task-operations-report")).toContainText("运营报表暂时无法读取");
      await expect(page.locator(".task-operations-summary-total")).toHaveCount(0);
    } else {
      await expect(page.locator(".task-operations-summary-total strong")).toHaveText("0");
      await expect(page.locator(".task-status-track-segment")).toHaveCount(0);
      await expect(page.locator(".task-center-empty")).toBeVisible();
    }
    expect(state.errors).toEqual([]); expect(state.writes).toEqual([]);
  });
}

test("small height, narrow screen and dark mode preserve layout and access to actions", async ({ page }, info) => {
  const state = await fixture(page, { theme: "dark" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const viewport of [{ width: 1280, height: 700 }, { width: 1024, height: 589 }, { width: 768, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport); await page.goto("/tasks");
    await expect(page.locator(".task-center-unified-table")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const root = page.locator("[data-task-center]");
    expect(await root.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`tasks-${viewport.width}-${viewport.height}-dark.png`) });
    if (viewport.width === 390) {
      await page.locator(".task-center-more").filter({ has: page.locator("svg") }).first().click();
      await expect(page.locator(".task-row-more-popup")).toContainText("取消");
      await page.keyboard.press("Escape");
    }
  }
  expect(state.errors).toEqual([]); expect(state.writes).toEqual([]);
});


test("a list failure is never shown as an empty result when summary succeeds", async ({ page }) => {
  await fixture(page);
  await page.route("**/api/tasks?**", route => route.fulfill({ status: 503, json: { error: "list unavailable" } }));
  await page.goto("/tasks?source=agent");
  await expect(page.locator(".task-operations-summary-total strong")).toHaveText("30");
  await expect(page.locator(".task-center-unified-section")).toContainText("任务明细暂时无法读取");
  await expect(page.locator(".task-center-empty")).toHaveCount(0);
});

test("all-source Agent conditions are sent to the server, not applied to only the first page", async ({ page }) => {
  const requests: string[] = [];
  await fixture(page);
  page.on("request", request => { if (new URL(request.url()).pathname === "/api/tasks") requests.push(request.url()); });
  await page.goto("/tasks?status=running&attention=overdue");
  await expect(page.locator(".task-center-empty")).toBeVisible();
  expect(requests.some(url => new URL(url).searchParams.get("status") === "running" && new URL(url).searchParams.get("overdue") === "true")).toBe(true);
});

test("page changes remain synchronized on browser backward and forward navigation", async ({ page }) => {
  await fixture(page);
  await page.goto("/tasks?source=agent");
  await page.locator(".ant-pagination-item-2").click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.locator(".ant-pagination-item-active")).toHaveText("2");
  await page.goBack();
  await expect(page.locator(".ant-pagination-item-active")).toHaveText("1");
  await page.goForward();
  await expect(page.locator(".ant-pagination-item-active")).toHaveText("2");
});

test("partially loaded business results retain a load-more entry even with no current matches", async ({ page }) => {
  await fixture(page);
  await page.route("**/api/task-work-orders/dashboard?**", route => {
    const tail = new URL(route.request().url()).searchParams.has("cursor");
    const counts = { total: 1, open: 1, blocked: 0, waiting_review: 0 };
    const make = (id: string, status: string) => ({ task: { task_id: id, title: id === "tail" ? "后续执行中的业务任务" : "待启动的业务任务", status, updated_at: "2026-10-09T06:00:00Z" }, counts, current_blocking_work_order: null, next_work_order: null });
    return route.fulfill({ json: { period: "realtime", timezone: "Asia/Shanghai", summary: { tasks: { total: 2, open: 2 }, work_orders: counts }, tasks: { items: tail ? [make("tail", "running")] : [make("head", "open")], page: { total: 2, next_cursor: tail ? null : "business-tail" } } } });
  });
  await page.goto("/tasks?source=business&status=running");
  await expect(page.locator(".task-center-empty")).toContainText("仍有更多任务可读取");
  await page.getByRole("button", { name: "加载更多结果", exact: true }).click();
  await expect(page.locator(".task-center-unified-table")).toContainText("后续执行中的业务任务");
});

test.describe("touch task operations", () => {
  test.use({ hasTouch: true });
  test("row detail, fold and more remain reachable with registered 44px hit boxes", async ({ page }) => {
    await fixture(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/tasks");
    const first = page.locator(".task-center-unified-table tbody > tr").first();
    for (const selector of [".task-center-detail-slot button", ".task-center-more", ".task-center-fold"]) {
      const size = await first.locator(selector).evaluate(el => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height }));
      expect(size.width).toBeGreaterThanOrEqual(44); expect(size.height).toBeGreaterThanOrEqual(44);
    }
    await first.locator(".task-center-more").tap();
    await expect(page.locator(".task-row-more-popup")).toContainText("取消");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
});
