import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
function screenshotPath(name: string) {
  const dir = process.env.TASK_DETAIL_SCREENSHOT_DIR || test.info().outputDir;
  mkdirSync(dir, { recursive: true });
  return path.join(dir, name);
}

// Transport fixtures exercise the real React UI; no backend persistence or production writes.
const task = { task_id: "detail-fixture", title: "跟进：MAX BUSHCRAFT（YouTube）", goal: "完成对 MAX BUSHCRAFT（youtube: UC9oYA9Hy2dZwqlhL_CMd_kA）的跟进，直到转化或放弃", status: "open", priority: "normal", due_at: null, data_version: 1, workspace_allowed: true, created_at: "2026-10-09T02:09:00Z", updated_at: "2026-10-09T02:09:00Z" };
const zero = { total: 0, open: 0, blocked: 0, waiting_review: 0, completed: 0, automatic_created: 0, automatic_assigned: 0 };
const event = { id: "event-fixture", event_type: "lead.created", summary: "线索建档：MAX BUSHCRAFT（YouTube）", evidence_ref: "kol:kol:lead.created:lead_efc7eeb0b99c", occurred_at: "2026-10-09T02:09:00Z", verified_at: "2026-10-09T02:09:00Z", verified_by: "fixture-person" };
const agentTask = { id: "agent-fixture", title: "MAX 资料分析", status: "completed", description: "核对资料", updated_at: "2026-10-09T02:08:00Z", created_at: "2026-10-09T02:08:00Z", runs: [] };

type Options = { blocked?: boolean; revoke?: boolean; relatedRevoked?: boolean; error?: boolean; theme?: string; many?: boolean };
async function fixture(page: Page, options: Options = {}) {
  let writes = 0, rootRevoked = false;
  const order = { work_order_id: "order-fixture", title: "核对内容版本", status: "waiting_approval", template_code: "fixture-template", template_title: "内容确认", template_version: 1, stage_code: "DRAFT", objective: "核对内容和证据", priority: "normal", due_at: null, automation_level: "A3", primary_assignee: null, latest_decision: null, creation_mode: "manual", assignment_origin: "unassigned", routing_policy_code: null };
  const counts = options.blocked ? { ...zero, total: 1, open: 1, blocked: 1 } : zero;
  const detail = { task, counts, work_orders: options.blocked ? [order] : [], verified_events: [event], current_blocking_work_order: options.blocked ? order : null, source: "postgresql_task_work_orders", as_of: "2026-10-09T06:00:00Z" };
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (route.request().method() !== "GET") {
      writes++;
      if (path.endsWith("/verified-events")) return route.fulfill({ json: { event: { id: "registered-fixture", replayed: false }, decision: { id: "decision-fixture", outcome: "skip", status: "recorded", confidence: null }, execution_job: { id: "job-fixture", status: "queued", job_type: "fixture" }, execution_mode: "async", request_id: "fixture-request" } });
      return route.fulfill({ status: 400, json: { error: "No side effect allowed in presentation fixture" } });
    }
    if (path === "/api/health") return route.fulfill({ json: { runtime_mode: "postgres-only" } });
    if (path === "/api/me") return route.fulfill({ json: { id: "ui-fixture-person", name: "UI 测试", available_modes: ["employee"], roles: ["employee"] } });
    if (path.includes("preferences")) return route.fulfill({ json: { theme: options.theme || "light" } });
    if (path === "/api/tasks/operations-dashboard") return route.fulfill({ json: { period: "today", metrics: { total: 1, in_progress: 0, waiting: 0, overdue: 0, failed: 0 }, status_distribution: { queued: 0, running: 0, waiting: 0, completed: 1, failed: 0, cancelled: 0 }, task_types: [], as_of: "2026-10-09T06:00:00Z" } });
    if (path === "/api/tasks") {
      const items = options.many ? Array.from({ length: 75 }, (_, i) => ({ ...agentTask, id: `agent-${i}`, title: `MAX 分析 ${i}` })) : [agentTask];
      return route.fulfill({ json: url.searchParams.has("limit") ? { items, page: { total: items.length, next_cursor: null } } : items });
    }
    if (path === "/api/tasks/agent-fixture") return route.fulfill({ json: agentTask });
    if (path === "/api/tasks/agent-fixture/events") return route.fulfill({ json: { events: [] } });
    if (path === "/api/task-work-orders/dashboard") return route.fulfill({ json: { summary: { tasks: { total: 1, open: 1, blocked: 0 }, work_orders: counts }, by_template: [], tasks: { items: [{ task, counts, current_blocking_work_order: detail.current_blocking_work_order, next_work_order: null }], page: { total: 1, next_cursor: null } } } });
    if (path === "/api/task-work-orders/detail-fixture") {
      if (options.revoke && rootRevoked) return route.fulfill({ status: 403, json: { error: "not_authorized" } });
      return route.fulfill({ json: detail });
    }
    if (path.endsWith("/suggestions")) return route.fulfill({ json: { suggestions: [], calls_model: false } });
    if (path.endsWith("/collaboration-context")) {
      if (options.revoke) rootRevoked = true;
      if (options.revoke || options.relatedRevoked) return route.fulfill({ status: 403, json: { error: "not_authorized" } });
      if (options.error) return route.fulfill({ status: 500, json: { error: "temporary_failure" } });
      return route.fulfill({ json: { task_id: task.task_id, risk: "L1", calls_model: false, cursor: 0, has_more: false, version: "v1", gates: options.blocked ? [{ work_order_id: "order-fixture", configured: true, allowed: false, blockers: ["artifact_version_conflict"], review: { id: "review-fixture", company_id: "company-fixture", status: "reviewing", version: 2, round: 1 }, prerequisites: [] }] : [], events: [] } });
    }
    if (path === "/api/sessions") return route.fulfill({ json: [] });
    return route.fulfill({ json: { count: 0, unread: 0, jobs: [], alerts: {}, version: "fixture" } });
  });
  return { writes: () => writes };
}
async function openFromRow(page: Page) {
  await page.goto("/tasks?period=today&status=all");
  await page.getByRole("row").filter({ hasText: task.title }).getByRole("button", { name: "详情", exact: true }).click();
  await expect(page.getByRole("dialog").filter({ hasText: task.title })).toBeVisible();
}

test("compact zero-order detail shows a readable event and returns to the original list/focus", async ({ page }) => {
  const control = await fixture(page);
  await openFromRow(page);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("线索已建档", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "工单建议" })).toHaveCount(0);
  await expect(dialog.getByRole("heading", { name: "标准执行工单" })).toHaveCount(0);
  await expect(dialog.getByText(/登记后才会触发|Jev|PostgreSQL/)).toHaveCount(0);
  await expect(dialog.locator(".ant-btn-primary")).toHaveCount(0);
  await expect(dialog.getByText(event.evidence_ref)).not.toBeVisible();
  await dialog.getByRole("button", { name: "查看证据与追溯", exact: true }).click();
  await expect(dialog.getByText(event.evidence_ref)).toBeVisible();
  const titleFont = await dialog.locator(".task-detail-ant-heading strong").evaluate(el => getComputedStyle(el).fontSize);
  expect(titleFont).toBe("13px");
  await page.screenshot({ path: screenshotPath("detail-desktop.png"), fullPage: true, animations: "disabled" });
  await dialog.getByRole("button", { name: "返回任务明细" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/tasks\?period=today&status=all$/);
  await expect(page.getByRole("row").filter({ hasText: task.title }).getByRole("button", { name: "详情", exact: true })).toBeFocused();
  expect(control.writes()).toBe(0);
});

test("deep-link close removes only detail parameter; refresh does not reopen", async ({ page }) => {
  await fixture(page);
  await page.goto("/tasks?period=today&businessTask=detail-fixture&status=all");
  await page.getByRole("dialog").getByRole("button", { name: "返回任务明细" }).click();
  await expect(page).toHaveURL(/\/tasks\?period=today&status=all$/);
  await page.reload();
  await expect(page.getByRole("region", { name: "任务明细" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("browser back and ESC close the business detail without resetting search", async ({ page }) => {
  await fixture(page);
  await page.goto("/tasks?period=today&status=all");
  const search = page.getByRole("textbox", { name: "搜索任务名称、内容、技能或模板" });
  await search.fill("MAX");
  await page.getByRole("row").filter({ hasText: task.title }).getByRole("button", { name: "详情", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(search).toHaveValue("MAX");
  await page.getByRole("row").filter({ hasText: task.title }).getByRole("button", { name: "详情", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(search).toHaveValue("MAX");
});

test("Agent detail returns to the list with search and period intact; direct route has a safe fallback", async ({ page }) => {
  await fixture(page);
  await page.goto("/tasks?period=today&status=all");
  await page.getByRole("textbox", { name: "搜索任务名称、内容、技能或模板" }).fill("MAX");
  await page.getByRole("row").filter({ hasText: agentTask.title }).getByRole("button", { name: "详情", exact: true }).click();
  await expect(page).toHaveURL(/\/tasks\/agent-fixture$/);
  await page.getByRole("link", { name: /返回任务明细/ }).click();
  await expect(page).toHaveURL(/\/tasks\?period=today&status=all$/);
  await expect(page.getByRole("textbox", { name: "搜索任务名称、内容、技能或模板" })).toHaveValue("MAX");
});

test("dirty draft requires discard confirmation; write requires explicit review and yields actual receipt", async ({ page }) => {
  const control = await fixture(page);
  await openFromRow(page);
  const drawer = page.getByRole("dialog").first();
  await drawer.getByRole("button", { name: "登记事件", exact: true }).click();
  await drawer.getByRole("textbox", { name: /已核验事实摘要/ }).fill("测试中已核验的事实");
  await drawer.getByRole("textbox", { name: /证据引用/ }).fill("fixture:evidence");
  await drawer.getByRole("button", { name: "返回任务明细" }).click();
  const discard = page.getByRole("dialog").filter({ hasText: "放弃未提交的内容？" });
  await expect(discard).toBeVisible();
  await discard.getByRole("button", { name: "继续编辑" }).click();
  await expect(drawer.getByRole("textbox", { name: /已核验事实摘要/ })).toHaveValue("测试中已核验的事实");
  await drawer.getByRole("button", { name: "提交已核验事件" }).click();
  expect(control.writes()).toBe(0);
  const confirmation = page.getByRole("dialog").filter({ hasText: "确认登记已核验事件" });
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText("fixture:evidence");
  await confirmation.getByRole("button", { name: "确认写入并进入异步处理" }).click();
  await expect(drawer).toContainText("已登记核验事件");
  await expect(drawer).toContainText("queued");
  expect(control.writes()).toBe(1);
});

test("blocked work order and scoped approval remain visible; errors are not a zero state", async ({ page }) => {
  await fixture(page, { blocked: true });
  await openFromRow(page);
  await expect(page.getByRole("dialog")).toContainText("产物已变化，请复核新版本并重新审批");
  await expect(page.getByRole("dialog").getByRole("link", { name: "审批详情" })).toHaveAttribute("href", "/reviews/review-fixture?reviewCompany=company-fixture");
});

test("revoked permission clears all detail data", async ({ page }) => {
  await fixture(page, { revoke: true });
  await page.goto("/tasks?businessTask=detail-fixture");
  await expect(page.getByRole("alert")).toContainText("已清除缓存内容");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

for (const width of [375, 768]) test(`detail at ${width}px has single-column fields and no overflowing drawer`, async ({ page }) => {
  await page.setViewportSize({ width, height: 700 });
  await fixture(page);
  await page.goto("/tasks?businessTask=detail-fixture");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("线索已建档", { exact: true })).toBeVisible();
  const bounds = await dialog.evaluate(el => ({ width: el.getBoundingClientRect().width, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
  expect(bounds.width).toBeLessThanOrEqual(width);
  expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth + 1);
  await expect(dialog.getByRole("button", { name: "返回任务明细" })).toBeVisible();
  await page.screenshot({ path: screenshotPath(`detail-${width}.png`), fullPage: true, animations: "disabled" });
});


test("loaded cursor range, expansion and scroll are restored from independent Agent detail", async ({ page }) => {
  await fixture(page, { many: true });
  await page.route("**/api/tasks?**", route => {
    const url = new URL(route.request().url());
    const second = url.searchParams.has("cursor");
    return route.fulfill({ json: { items: second ? [agentTask] : Array.from({ length: 60 }, (_, i) => ({ ...agentTask, id: `many-${i}`, title: `MAX 分析 ${i}`, updated_at: "2026-10-09T02:10:00Z" })), page: { total: 61, next_cursor: second ? null : "fixture-page-2" } } });
  });
  await page.goto("/tasks?period=today&status=all");
  await page.getByRole("button", { name: "加载更多 Agent 任务", exact: true }).click();
  const targetRow = page.getByRole("row").filter({ hasText: agentTask.title });
  await targetRow.getByRole("button", { name: /展开.*明细/ }).click();
  await targetRow.scrollIntoViewIfNeeded();
  const previousScroll = await page.locator(".tasks-page").evaluate(el => el.scrollTop);
  expect(previousScroll).toBeGreaterThan(0);
  await targetRow.getByRole("button", { name: "详情", exact: true }).click();
  await page.getByRole("link", { name: /返回任务明细/ }).click();
  await expect(page.getByRole("region", { name: "任务明细" })).toContainText("已载入 61 / 61 个 Agent 任务");
  await expect(page.getByRole("button", { name: /收起MAX 资料分析明细/ })).toBeVisible();
  await expect.poll(() => page.locator(".tasks-page").evaluate(el => el.scrollTop)).toBeGreaterThan(previousScroll - 5);
});

for (const size of [{ width: 1280, height: 600 }, { width: 1024, height: 600 }]) test(`fixed submit footer remains reachable at ${size.width}×${size.height}`, async ({ page }) => {
  await page.setViewportSize(size);
  await fixture(page);
  await page.goto("/tasks?businessTask=detail-fixture");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "登记事件", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "提交已核验事件" })).toBeVisible();
  await dialog.getByRole("button", { name: "高级核验字段" }).click();
  await dialog.getByRole("textbox", { name: "已完成阶段（每行一个）" }).scrollIntoViewIfNeeded();
  const footer = await dialog.getByRole("button", { name: "提交已核验事件" }).boundingBox();
  expect(footer!.y + footer!.height).toBeLessThanOrEqual(size.height);
  await expect(dialog.getByRole("button", { name: "返回任务明细" })).toBeVisible();
});

test("dark theme and reduced motion preserve legibility and focus trapping", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  await fixture(page, { theme: "dark" });
  await page.goto("/tasks?businessTask=detail-fixture");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("线索已建档", { exact: true })).toBeVisible();
  const typography = await dialog.locator(".task-detail-ant-heading strong").evaluate(el => ({ size: getComputedStyle(el).fontSize, weight: getComputedStyle(el).fontWeight, color: getComputedStyle(el).color }));
  expect(typography.size).toBe("13px"); expect(typography.weight).toBe("600");
  for (let i = 0; i < 16; i++) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
  }
  await page.screenshot({ path: screenshotPath("detail-dark.png"), animations: "disabled" });
});

test("200 percent zoom keeps return and footer inside the viewport", async ({ page }) => {
  await fixture(page);
  await page.goto("/tasks?businessTask=detail-fixture");
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "返回任务明细" })).toBeVisible();
  await dialog.getByRole("button", { name: "登记事件", exact: true }).click();
  const box = await dialog.getByRole("button", { name: "提交已核验事件" }).boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(900);
});

test("read failures remain visible with a retry instead of disappearing as an empty module", async ({ page }) => {
  await fixture(page, { error: true });
  await page.goto("/tasks?businessTask=detail-fixture");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "重新读取" })).toBeVisible();
});


test.describe("touch hit targets", () => {
  test.use({ hasTouch: true, viewport: { width: 860, height: 700 } });
  test("drawer action hit targets are 44px without inflating the painted button", async ({ page }) => {
    await fixture(page);
    await page.goto("/tasks?businessTask=detail-fixture");
    const dialog = page.getByRole("dialog");
    const target = dialog.getByRole("button", { name: "返回任务明细" });
    await expect(target).toBeVisible();
    const sizes = await target.evaluate(el => ({ hit: el.getBoundingClientRect().height, visible: parseFloat(getComputedStyle(el, "::before").height) }));
    expect(sizes.hit).toBeGreaterThanOrEqual(44);
    expect(sizes.visible).toBe(24);
    await page.screenshot({ path: screenshotPath("detail-touch.png"), animations: "disabled" });
  });
});


test("suggestion adoption still requires explicit confirmation and displays its formal receipt", async ({ page }) => {
  await fixture(page);
  let adopted = false, posts = 0;
  const suggestion = { decision_id: "suggestion-fixture", task_id: task.task_id, outcome: "create", template_title: "确认测试模板", template_code: "fixture-template", template_version: 1, source_event: { id: "source-fixture", summary: "核验后的事实", source_version: "v1", evidence_ref: "fixture:evidence" }, candidates: [], version: "basis-v1", risk: "L3", assignment_target: null };
  await page.route("**/detail-fixture/suggestions", route => route.fulfill({ json: { suggestions: [{ ...suggestion, actions: adopted ? [] : ["create"], blockers: adopted ? ["source_event_already_adopted"] : [], execution_receipt: adopted ? { id: "adoption-receipt", status: "created", work_order_id: "order-fixture" } : null }], calls_model: false } }));
  await page.route("**/decisions/suggestion-fixture/adopt", route => {
    posts++;
    expect(route.request().postDataJSON()).toMatchObject({ confirmed: true, basis_version: "basis-v1", action: "create" });
    adopted = true;
    return route.fulfill({ json: { attempt: { id: "adoption-receipt", status: "created" }, work_order: { id: "order-fixture" }, replayed: false } });
  });
  await page.goto("/tasks?businessTask=detail-fixture");
  const region = page.getByRole("region", { name: "工单建议", exact: true });
  await region.getByRole("button", { name: "采纳建单建议" }).click();
  expect(posts).toBe(0);
  await expect(region.getByRole("group", { name: "确认采纳建议" })).toContainText("尚不分派人员");
  await region.getByRole("button", { name: "确认采纳", exact: true }).click();
  await expect(region).toContainText("执行回执：adoption-receipt");
  expect(posts).toBe(1);
});

test("unknown event-write result does not auto-retry and manual retry reuses the identical payload", async ({ page }) => {
  await fixture(page);
  const payloads: unknown[] = [];
  await page.route("**/detail-fixture/verified-events", route => {
    payloads.push(route.request().postDataJSON());
    return payloads.length === 1 ? route.fulfill({ status: 503, json: { error: "unconfirmed_result" } }) : route.fulfill({ json: { event: { id: "same-event", replayed: true }, decision: { outcome: "skip", status: "recorded", confidence: null }, execution_job: { id: "same-job", status: "queued" }, execution_mode: "async" } });
  });
  await page.goto("/tasks?businessTask=detail-fixture");
  const drawer = page.getByRole("dialog");
  await drawer.getByRole("button", { name: "登记事件", exact: true }).click();
  await drawer.getByRole("textbox", { name: /已核验事实摘要/ }).fill("已核验测试事实");
  await drawer.getByRole("textbox", { name: /证据引用/ }).fill("fixture:retry");
  await drawer.getByRole("button", { name: "提交已核验事件" }).click();
  const confirmation = page.getByRole("dialog").filter({ hasText: "确认登记已核验事件" });
  await confirmation.getByRole("button", { name: "确认写入并进入异步处理" }).click();
  await expect(confirmation).toContainText("系统未自动重试");
  expect(payloads).toHaveLength(1);
  await confirmation.getByRole("button", { name: "使用同一登记标识再次提交" }).click();
  await expect(page.getByRole("dialog").filter({ hasText: task.title }).first()).toContainText("已核对既有登记回执");
  expect(payloads).toHaveLength(2);
  expect(payloads[1]).toEqual(payloads[0]);
});


test("a restricted related module cannot close an independently authorized root task", async ({ page }) => {
  await fixture(page, { relatedRevoked: true });
  await page.goto("/tasks?businessTask=detail-fixture");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("审批与工单依赖当前不可访问");
  await expect(dialog.getByText("线索已建档", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "返回任务明细" })).toBeVisible();
  await dialog.getByRole("button", { name: "返回任务明细" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("direct independent task detail safely returns to the canonical task list", async ({ page }) => {
  await fixture(page);
  await page.goto("/tasks/agent-fixture");
  await expect(page.getByRole("link", { name: /返回任务明细/ })).toHaveAttribute("href", "/tasks");
});
