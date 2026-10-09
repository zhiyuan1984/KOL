import { expect, test, type Page } from "@playwright/test";

/**
 * Cron presentation fixtures exercise the real React route only. Every API request is
 * intercepted locally: they neither require a database nor certify scheduler/worker execution.
 */
type Json = Record<string, unknown>;
type Call = { method: string; path: string; body?: Json };
type FixtureOptions = {
  createFailsOnce?: boolean;
  initialJobFailures?: number;
  theme?: "light" | "dark";
  deferRun?: boolean;
};

const ALL_ACTIONS = { edit: false, pause: false, resume: false, publish: false, run_now: false };
const employee = { id: "employee-fixture", name: "页面 Fixture 员工", roles: ["employee"], available_modes: ["employee"] };
const now = "2026-10-09T01:00:00.000Z";

function actions(overrides: Partial<typeof ALL_ACTIONS> = {}) {
  return { ...ALL_ACTIONS, ...overrides };
}

function cronJob(input: Partial<Json> & Pick<Json, "id" | "job_key" | "title" | "status">): Json {
  const status = String(input.status);
  const system = Boolean(input.system);
  const handler_key = String(input.handler_key || "overdue-scan");
  const blockedHandler = ["ai-task", "ownership-release", "mail-memory-increment"].includes(handler_key);
  const execution_capability = input.execution_capability || {
    ready: !blockedHandler,
    reason: blockedHandler ? "该处理器的自动执行能力尚未就绪，需要人工接管。" : null,
    checked_at: now,
  };
  const ready = execution_capability.ready === true;
  const canRun = status === "published" && ready && !input.active_run_status;
  return {
    id: input.id,
    job_key: input.job_key,
    title: input.title,
    system,
    status,
    handler_key,
    cron_expr: input.cron_expr || "0 9 * * *",
    timezone: input.timezone || "Asia/Shanghai",
    next_run_at: status === "published" ? input.next_run_at || "2026-10-10T01:00:00.000Z" : null,
    last_terminal_status: input.last_terminal_status || null,
    last_result_label: input.last_result_label || null,
    active_run_status: input.active_run_status || null,
    allowed_actions: input.allowed_actions || actions(system ? { run_now: canRun } : { edit: true, pause: status === "published", resume: status === "paused", publish: status === "draft", run_now: canRun }),
    execution_capability,
    execute_identity: input.execute_identity || (system ? "system:scheduler" : "employee-fixture"),
    scope: input.scope || { label: system ? "系统登记范围（员工只读）" : "已授权个人工作范围" },
    handler: input.handler || { side_effect: handler_key === "discovery-search" ? "R2：提交采集需求" : "R1：创建任务草稿" },
    published_rev: input.published_rev || 3,
    condition: input.condition || {
      schedule: { kind: "recurring", repeat: "daily" },
      composer: { text: `${input.title} 的 fixture 内容`, scope: { expert_id: "expert:kol", skills: [], knowledge_bases: [], connectors: [] }, attachments: [], object_refs: [] },
    },
  };
}

function buildJobs(): Json[] {
  const system = [
    cronJob({ id: "sys-daily", job_key: "sys-daily", title: "系统每日任务快照", status: "published", system: true, handler_key: "daily-task-snapshot", last_terminal_status: "succeeded", last_result_label: "已完成", allowed_actions: actions({ run_now: true }) }),
    cronJob({ id: "sys-overdue", job_key: "sys-overdue", title: "系统逾期扫描", status: "paused", system: true, handler_key: "overdue-scan", last_terminal_status: "failed", last_result_label: "失败", allowed_actions: actions() }),
    cronJob({ id: "sys-discovery", job_key: "sys-discovery", title: "系统发现采集", status: "published", system: true, handler_key: "discovery-search", last_terminal_status: "succeeded", last_result_label: "已入队", allowed_actions: actions({ run_now: true }) }),
    cronJob({ id: "sys-release", job_key: "sys-release", title: "系统归属释放", status: "disabled", system: true, handler_key: "ownership-release", last_terminal_status: "needs_takeover", last_result_label: "待接管", allowed_actions: actions() }),
    cronJob({ id: "sys-draft", job_key: "sys-draft", title: "系统风险汇总", status: "draft", system: true, handler_key: "ai-task", last_result_label: "未启用", allowed_actions: actions() }),
  ];
  const personalStatuses = [
    "published", "published", "published", "published", "published", "published", "published", "published", "published",
    "paused", "paused", "paused", "paused", "paused", "paused",
    "draft", "draft", "draft", "draft", "draft",
    "disabled", "disabled", "disabled", "disabled", "disabled",
  ];
  const personal = personalStatuses.map((status, index) => {
    const n = index + 1;
    return cronJob({
      id: `personal-${n}`,
      job_key: `personal-${n}`,
      title: `个人计划 ${String(n).padStart(2, "0")}`,
      status,
      last_terminal_status: index === 0 ? "succeeded" : null,
      last_result_label: index === 0 ? "已完成" : null,
    });
  });
  personal[1] = cronJob({ id: "personal-failed", job_key: "personal-failed", title: "个人失败日报", status: "published", last_terminal_status: "failed", last_result_label: "失败" });
  personal[9] = cronJob({ id: "personal-takeover", job_key: "personal-takeover", title: "个人待接管巡检", status: "paused", last_terminal_status: "needs_takeover", last_result_label: "待接管" });
  personal[10] = cronJob({ id: "personal-running", job_key: "personal-running", title: "个人运行中报表", status: "paused", active_run_status: "running", last_result_label: "执行中" });
  personal[15] = cronJob({
    id: "personal-ai-blocked", job_key: "personal-ai-blocked", title: "AI 能力未就绪计划", status: "draft", handler_key: "ai-task",
    execution_capability: { ready: false, reason: "AI 自动执行能力尚未就绪，需要人工接管。", checked_at: now },
    allowed_actions: actions({ edit: true, publish: true }),
    last_result_label: "能力未就绪",
  });
  return [...system, ...personal];
}

function failedSystemRun(): Json {
  return {
    id: "run-sys-overdue-failed", job_id: "sys-overdue", status: "failed", trigger: "scheduled", scheduled_for: "2026-10-09T00:00:00.000Z",
    started_at: "2026-10-09T00:00:01.000Z", finished_at: "2026-10-09T00:00:03.000Z", error_code: "source_temporarily_unavailable",
    error_summary: "系统排程执行失败：上游数据源暂时不可用。", receipt: { handler_key: "overdue-scan", items: [] }, session_id: null,
  };
}

function runningPersonalRun(): Json {
  return {
    id: "run-personal-running", job_id: "personal-running", status: "running", trigger: "manual", scheduled_for: "2026-10-09T01:00:00.000Z",
    started_at: "2026-10-09T01:00:01.000Z", finished_at: null, receipt: { handler_key: "ai-task", title: "仍在排队" }, session_id: null,
  };
}

type FixtureControl = {
  calls: Call[];
  createBodies: Json[];
  patchBodies: Array<{ id: string; body: Json }>;
  writes: () => number;
  releaseRun: () => void;
  failNextJobList: () => void;
  allowJobLists: () => void;
};

async function fixture(page: Page, options: FixtureOptions = {}): Promise<FixtureControl> {
  let jobs = buildJobs();
  const runsByJob = new Map<string, Json[]>([
    ["sys-overdue", [failedSystemRun()]],
    ["personal-running", [runningPersonalRun()]],
  ]);
  const calls: Call[] = [];
  const createBodies: Json[] = [];
  const patchBodies: Array<{ id: string; body: Json }> = [];
  let writes = 0;
  let remainingJobFailures = options.initialJobFailures || 0;
  let failNextJobList = false;
  let createFailsOnce = Boolean(options.createFailsOnce);
  let releaseDeferredRun: (() => void) | undefined;

  const lookup = (id: string) => jobs.find((job) => String(job.id) === id || String(job.job_key) === id);
  const replace = (next: Json) => { jobs = jobs.map((job) => job.id === next.id ? next : job); };

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    let body: Json | undefined;
    try { body = request.postDataJSON() as Json; } catch { /* only JSON Cron writes are inspected */ }
    calls.push({ method, path, body });

    if (path === "/api/health") return route.fulfill({ json: { runtime_mode: "postgres-only" } });
    if (path === "/api/me") return route.fulfill({ json: employee });
    if (path.includes("preferences")) return route.fulfill({ json: { theme: options.theme || "light" } });

    if (path === "/api/cron/jobs" && method === "GET") {
      if (remainingJobFailures > 0) {
        remainingJobFailures--;
        return route.fulfill({ status: 503, json: { error: "fixture_list_unavailable" } });
      }
      if (failNextJobList) {
        failNextJobList = false;
        return route.fulfill({ status: 503, json: { error: "fixture_refresh_unavailable" } });
      }
      return route.fulfill({ json: { jobs, alerts: { failed: 2, needs_takeover: 2 } } });
    }
    if (path === "/api/cron/jobs" && method === "POST") {
      writes++;
      createBodies.push(body || {});
      if (createFailsOnce) {
        createFailsOnce = false;
        return route.fulfill({ status: 503, json: { error: "fixture_create_unavailable" } });
      }
      const created = cronJob({
        ...(body || {}), id: "personal-new", job_key: "personal-new", status: "draft", system: false,
        allowed_actions: actions({ edit: true, publish: true }), execution_capability: { ready: false, reason: "AI 自动执行能力尚未就绪，需要人工接管。", checked_at: now },
      });
      jobs = [...jobs, created];
      // api.createCronJob returns a naked CronJob, rather than { job }.
      return route.fulfill({ json: created });
    }

    const jobMatch = /^\/api\/cron\/jobs\/([^/]+)$/.exec(path);
    if (jobMatch && method === "GET") {
      const job = lookup(decodeURIComponent(jobMatch[1]));
      return job
        ? route.fulfill({ json: { job, runs: runsByJob.get(String(job.id)) || [] } })
        : route.fulfill({ status: 404, json: { error: "missing_fixture_job" } });
    }
    if (jobMatch && method === "PATCH") {
      writes++;
      const id = decodeURIComponent(jobMatch[1]);
      const before = lookup(id);
      if (!before) return route.fulfill({ status: 404, json: { error: "missing_fixture_job" } });
      patchBodies.push({ id, body: body || {} });
      const next: Json = { ...before, ...(body || {}) };
      if (body?.status === "published") {
        const blocked = (before.execution_capability as Json | undefined)?.ready === false;
        next.allowed_actions = actions({ edit: !Boolean(before.system), pause: !Boolean(before.system), run_now: !Boolean(before.system) ? !blocked : true });
      }
      replace(next);
      return route.fulfill({ json: { job: next } });
    }

    const runMatch = /^\/api\/cron\/jobs\/([^/]+)\/run$/.exec(path);
    if (runMatch && method === "POST") {
      writes++;
      const id = decodeURIComponent(runMatch[1]);
      const before = lookup(id);
      if (!before) return route.fulfill({ status: 404, json: { error: "missing_fixture_job" } });
      if (options.deferRun && id === "sys-discovery") {
        await new Promise<void>((resolve) => { releaseDeferredRun = resolve; });
      }
      const run = {
        id: "run-sys-discovery-queued", job_id: String(before.id), status: "succeeded", trigger: "manual", scheduled_for: "2026-10-09T01:05:00.000Z",
        started_at: "2026-10-09T01:05:01.000Z", finished_at: "2026-10-09T01:05:02.000Z", session_id: null,
        receipt: { handler_key: "discovery-search", crawl_job_id: "crawl-fixture-17", queue_position: 2, note: "候选由采集流水线回填。" },
      };
      const next = { ...before, active_run_status: null, last_terminal_status: "succeeded", last_result_label: "已入队" };
      replace(next);
      runsByJob.set(String(before.id), [run]);
      return route.fulfill({ json: { run_id: run.id, run, job: next } });
    }

    const runsMatch = /^\/api\/cron\/runs\/([^/]+)$/.exec(path);
    if (runsMatch && method === "GET") {
      const runId = decodeURIComponent(runsMatch[1]);
      if (runId === "run-personal-running") return route.fulfill({ status: 503, json: { error: "fixture_run_refresh_unavailable" } });
      for (const [jobId, rows] of runsByJob) {
        const run = rows.find((row) => row.id === runId);
        if (run) return route.fulfill({ json: { run, job: lookup(jobId) } });
      }
      return route.fulfill({ status: 404, json: { error: "missing_fixture_run" } });
    }

    // Shell and ComposerDock are real components on this route. Feed each read a legal empty
    // collection/object shape rather than letting Vite proxy to any live service.
    if (method === "GET" && ["/api/sessions", "/api/tasks", "/api/experts", "/api/skills", "/api/skills/market", "/api/knowledge", "/api/knowledge/market", "/api/knowledge/composer", "/api/files/recent"].includes(path)) return route.fulfill({ json: [] });
    if (method === "GET" && path === "/api/version") return route.fulfill({ json: { version: "fixture" } });
    if (method === "GET" && path.includes("approval")) return route.fulfill({ json: { count: 0 } });
    if (method === "GET" && path.includes("mail")) return route.fulfill({ json: { unread: 0, count: 0, messages: [] } });
    if (method === "GET") return route.fulfill({ json: { count: 0, unread: 0, items: [], jobs: [], alerts: {}, version: "fixture" } });
    return route.fulfill({ status: 400, json: { error: "No side effect allowed in Cron presentation fixture" } });
  });

  return {
    calls,
    createBodies,
    patchBodies,
    writes: () => writes,
    releaseRun: () => releaseDeferredRun?.(),
    failNextJobList: () => { failNextJobList = true; },
    allowJobLists: () => { remainingJobFailures = 0; },
  };
}

const listRows = (page: Page) => page.locator("[data-cron-job]");
const jobRow = (page: Page, jobKey: string) => page.locator(`[data-cron-job="${jobKey}"]`);
const listCalls = (control: FixtureControl) => control.calls.filter((call) => call.method === "GET" && call.path === "/api/cron/jobs");
const detailCalls = (control: FixtureControl) => control.calls.filter((call) => /\/api\/cron\/jobs\/[^/]+$/.test(call.path));

async function openJob(page: Page, jobKey: string) {
  await jobRow(page, jobKey).getByRole("button", { name: /个人|系统|AI/ }).click();
  return page.getByRole("dialog").filter({ has: page.locator(`[data-cron-detail="${jobKey}"]`) });
}

async function saveScreenshot(page: Page, name: string) {
  await page.screenshot({ path: test.info().outputPath(name), fullPage: true, animations: "disabled" });
}

test("列表只读取摘要且无 N+1；六列、32px 工具栏与 data-grid 密度可测", async ({ page }) => {
  const control = await fixture(page);
  await page.goto("/cron");
  await expect(listRows(page).first()).toBeVisible();

  expect(detailCalls(control)).toEqual([]);
  expect(control.calls.filter((call) => call.path.includes("/api/cron/runs/"))).toEqual([]);
  // Workbench badge and the page can each read the same summary endpoint, but never per-row details.
  expect(listCalls(control).length).toBeLessThanOrEqual(2);

  const headers = await page.locator(".ant-table-thead th").allTextContents();
  expect(headers.map((text) => text.trim())).toEqual(["任务", "频率", "计划状态", "下次运行", "最近结果", "操作"]);
  const measured = await page.locator(".ant-table").evaluate((table) => {
    const row = table.querySelector<HTMLElement>(".ant-table-tbody > tr");
    const head = table.querySelector<HTMLElement>(".ant-table-thead > tr");
    const search = document.querySelector<HTMLElement>(".cron-workspace-tools .ant-input-affix-wrapper");
    const create = document.querySelector<HTMLElement>("[data-cron-focus='new']");
    return {
      row: row?.getBoundingClientRect().height,
      head: head?.getBoundingClientRect().height,
      font: getComputedStyle(table).fontSize,
      search: search?.getBoundingClientRect().height,
      create: create?.getBoundingClientRect().height,
    };
  });
  expect(measured).toEqual({ row: 44, head: 36, font: "13px", search: 32, create: 32 });
  await expect(page.locator(".cron-workspace .ant-btn-primary")).toHaveCount(1);
  await saveScreenshot(page, "cron-list-desktop.png");
});

test("搜索只在 Enter/clear 提交，清除不丢失状态且不重新读取服务器", async ({ page }) => {
  const control = await fixture(page);
  await page.goto("/cron?status=paused");
  await expect(listRows(page)).toHaveCount(7);
  const before = listCalls(control).length;
  const search = page.getByRole("searchbox", { name: "搜索任务" });
  await expect(search).toHaveAttribute("aria-label", "搜索任务");
  await search.fill("个人");
  await expect(listRows(page)).toHaveCount(7); // editing input is not an implicit filter
  await search.press("Enter");
  await expect(page).toHaveURL(/\/cron\?status=paused&q=%E4%B8%AA%E4%BA%BA$/);
  await expect(listRows(page)).toHaveCount(6);
  expect(listCalls(control)).toHaveLength(before);
  await page.locator(".ant-input-affix-wrapper:has(#cron-search) .ant-input-clear-icon").click();
  await expect(page).toHaveURL(/\/cron\?status=paused$/);
  await expect(listRows(page)).toHaveCount(7);
  expect(listCalls(control)).toHaveLength(before);
});

test("状态计数在分页之前精确计算", async ({ page }) => {
  await fixture(page);
  await page.goto("/cron");
  await expect(listRows(page).first()).toBeVisible();
  const tabCounts = await page.locator(".ant-tabs-tab").evaluateAll((tabs) => tabs.map((tab) => ({
    label: tab.querySelector(".cron-view-count")?.previousSibling?.textContent?.trim(),
    count: tab.querySelector(".cron-view-count")?.textContent?.trim(),
  })));
  expect(tabCounts).toEqual([
    { label: "全部", count: "30" }, { label: "已启用", count: "11" }, { label: "已暂停", count: "7" }, { label: "草稿", count: "6" }, { label: "未启用", count: "6" },
  ]);
  await page.locator(".ant-pagination-item-2").click();
  await expect(page).toHaveURL(/page=2/);
  await expect(listRows(page)).toHaveCount(10);
  await expect(page.locator(".ant-tabs-tab").filter({ hasText: "全部30" })).toBeVisible();
});

test("系统员工无修改权但可按既有能力立即运行；AI 阻断不伪造成功且回执只读", async ({ page }) => {
  const control = await fixture(page);
  await page.goto("/cron?status=published");
  const runnableSystem = jobRow(page, "sys-daily");
  await expect(runnableSystem).toBeVisible();
  await expect(runnableSystem.locator("[data-cron-pause]")).toHaveCount(0);
  await expect(runnableSystem.getByRole("button", { name: "立即运行" })).toBeEnabled();
  await page.goto("/cron/sys-overdue");
  const drawer = page.getByRole("dialog").filter({ has: page.locator("[data-cron-detail='sys-overdue']") });
  await expect(drawer).toContainText("此系统任务由管理员管理，员工不能修改计划");
  await expect(drawer).toContainText("系统排程执行失败：上游数据源暂时不可用");
  await expect(drawer.getByRole("button", { name: "立即运行" })).toHaveCount(0);
  await expect(drawer.getByRole("link", { name: /打开执行会话|查看执行/ })).toHaveCount(0);
  await page.goto("/cron/personal-ai-blocked");
  const blockedDrawer = page.getByRole("dialog");
  await expect(blockedDrawer).toContainText("执行能力未就绪");
  await expect(blockedDrawer.getByRole("button", { name: "立即运行" })).toHaveCount(0);
  expect(control.writes()).toBe(0);
});

test("最近失败／待接管辅助筛选与当前状态相交，而非替换状态", async ({ page }) => {
  await fixture(page);
  await page.goto("/cron?status=paused");
  await page.getByText("最近失败／待接管", { exact: true }).click();
  await expect(page).toHaveURL(/status=paused.*attention=1|attention=1.*status=paused/);
  await expect(listRows(page)).toHaveCount(2);
  await expect(jobRow(page, "sys-overdue")).toBeVisible();
  await expect(jobRow(page, "personal-takeover")).toBeVisible();
  await expect(jobRow(page, "personal-failed")).toHaveCount(0);
  await expect(page.locator(".ant-tabs-tab").filter({ hasText: "已暂停2" })).toBeVisible();
});

test("抽屉关闭、浏览器返回、ESC 与深链刷新均恢复 q/status/page 和行焦点", async ({ page }) => {
  await fixture(page);
  const listUrl = "/cron?q=%E4%B8%AA%E4%BA%BA&status=all&page=2";
  await page.goto(listUrl);
  const target = jobRow(page, "personal-25");
  await expect(target).toBeVisible();
  const task = target.getByRole("button", { name: "个人计划 25" });
  await task.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`${listUrl.replace(/[?]/g, "\\?")}$`));
  await expect(task).toBeFocused();

  await task.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`${listUrl.replace(/[?]/g, "\\?")}$`));
  await expect(task).toBeFocused();

  await page.goto("/cron/personal-25?q=%E4%B8%AA%E4%BA%BA&status=all&page=2");
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  await drawer.getByRole("button", { name: "返回定时任务列表" }).click();
  await expect(page).toHaveURL(new RegExp(`${listUrl.replace(/[?]/g, "\\?")}$`));
  await page.reload();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("searchbox", { name: "搜索任务" })).toHaveValue("个人");
});

test("新建草稿以 Asia/Shanghai 只提交一次并转 UTC；失败保留内容后可重试", async ({ page }) => {
  const control = await fixture(page, { createFailsOnce: true });
  await page.goto("/cron?status=draft&q=%E4%B8%AA%E4%BA%BA&page=2");
  await page.getByRole("button", { name: "新建定时任务" }).click();
  await expect(page).toHaveURL(/\/cron\/new\?status=draft&q=%E4%B8%AA%E4%BA%BA&page=2$/);
  await page.getByLabel("任务名称").fill("北京时间新建草稿");
  await page.getByLabel("执行方式").selectOption("recurring");
  await page.locator(".cron-editor-schedule select").first().selectOption("daily");
  await page.getByRole("textbox", { name: "时间" }).fill("09:30");
  await page.getByText("高级时间设置", { exact: true }).click();
  await page.getByLabel("生效开始").fill("2026-10-10T09:30");
  await page.getByLabel("生效结束").fill("2026-10-11T09:30");
  await page.getByLabel("调度时区").fill("Asia/Shanghai");
  await page.locator("[data-composer-input]").fill("仅保存草稿，不代表业务完成。");
  const save = page.getByRole("button", { name: "保存为草稿", exact: true });
  await save.click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("任务名称")).toHaveValue("北京时间新建草稿");
  await expect(page.locator("[data-composer-input]")).toHaveValue("仅保存草稿，不代表业务完成。");
  expect(control.createBodies).toHaveLength(1);
  await save.click();
  await expect(page).toHaveURL(/\/cron\/personal-new\?status=draft&q=%E4%B8%AA%E4%BA%BA&page=2$/);
  expect(control.createBodies).toHaveLength(2);
  const body = control.createBodies[1];
  expect(body).toMatchObject({ title: "北京时间新建草稿", cron_expr: "30 9 * * *", timezone: "Asia/Shanghai", handler_key: "ai-task", status: "draft" });
  expect((body.condition as Json).schedule).toMatchObject({
    kind: "recurring", repeat: "daily", start_at: "2026-10-10T01:30:00.000Z", end_at: "2026-10-11T01:30:00.000Z",
  });
});

test("发布必须经过核对确认，且 AI 阻断文案与 run_now 权限不会被升级", async ({ page }) => {
  const control = await fixture(page);
  await page.goto("/cron/personal-ai-blocked");
  const drawer = page.getByRole("dialog", { name: "AI 能力未就绪计划" });
  await expect(drawer).toContainText("执行能力未就绪");
  await drawer.getByRole("button", { name: "发布并启用", exact: true }).click();
  const confirm = page.getByRole("dialog").filter({ hasText: "核对并启用此任务？" });
  await expect(confirm).toContainText("启用计划不会解除阻断");
  await confirm.getByRole("button", { name: "发布并启用", exact: true }).click();
  await expect(drawer).toContainText("已启用");
  await expect(drawer).toContainText("执行能力未就绪");
  await expect(drawer.getByRole("button", { name: "立即运行" })).toHaveCount(0);
  expect(control.patchBodies).toContainEqual({ id: "personal-ai-blocked", body: { status: "published" } });
});

test("立即运行只锁定当前行，原位显示已入队而不冒充业务完成", async ({ page }) => {
  const control = await fixture(page, { deferRun: true });
  await page.goto("/cron?status=published");
  const row = jobRow(page, "sys-discovery");
  const otherRun = jobRow(page, "sys-daily").getByRole("button", { name: "立即运行" });
  await expect(row).toBeVisible();
  const originalRow = await row.elementHandle();
  await row.getByRole("button", { name: "立即运行" }).click();
  await expect(row.getByRole("button", { name: "立即运行" })).toBeDisabled();
  await expect(otherRun).toBeEnabled();
  control.releaseRun();
  await expect(row).toContainText("已入队");
  expect(await originalRow?.evaluate((node) => node.isConnected)).toBe(true);
  await expect(row.getByText("已完成", { exact: true })).toHaveCount(0);
  expect(control.writes()).toBe(1);
});

test("列表刷新失败会保留旧状态并给出明确恢复入口", async ({ page }) => {
  const control = await fixture(page);
  await page.goto("/cron");
  await expect(jobRow(page, "personal-1")).toBeVisible();
  control.failNextJobList();
  await page.getByRole("button", { name: "刷新定时任务列表" }).click();
  await expect(page.getByRole("status")).toContainText("读取失败，当前列表可能是旧状态");
  await expect(jobRow(page, "personal-1")).toBeVisible();
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.getByRole("status")).toHaveCount(0);
});

test("初始读取错误不伪造 0 计数，提供重新读取后才显示数据", async ({ page }) => {
  const control = await fixture(page, { initialJobFailures: 999 });
  await page.goto("/cron");
  await expect(page.locator("[data-cron-state='error']")).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("请求失败 (503)");
  await expect(page.locator(".cron-view-count")).toHaveCount(0);
  await expect(listRows(page)).toHaveCount(0);
  control.allowJobLists();
  await page.getByRole("button", { name: "重新读取", exact: true }).click();
  await expect(listRows(page).first()).toBeVisible();
  await expect(page.locator(".cron-view-count")).toHaveCount(5);
});

test("1440/1024/768/390、短高度、深色减动效与触控均无横向溢出", async ({ page, browser }) => {
  await fixture(page, { theme: "dark" });
  await page.goto("/cron");
  for (const size of [
    { width: 1440, height: 900 }, { width: 1024, height: 680 }, { width: 768, height: 560 }, { width: 390, height: 480 },
  ]) {
    await page.setViewportSize(size);
    await expect(listRows(page).first()).toBeVisible();
    const bounds = await page.locator("[data-cron-page]").evaluate((node) => ({ width: node.getBoundingClientRect().width, scrollWidth: node.scrollWidth, viewport: window.innerWidth }));
    expect(bounds.width).toBeLessThanOrEqual(size.width + 1);
    expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.viewport + 1);
    if (size.width <= 390) await expect(page.locator(".cron-mobile-list > li[data-cron-job]").first()).toBeVisible();
  }
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  const motion = await page.locator("[data-cron-page]").evaluate((node) => getComputedStyle(node.querySelector(".ant-tabs-tab")!).transitionDuration);
  expect(motion).toBe("0s");
  await saveScreenshot(page, "cron-mobile-dark-reduced.png");

  const touch = await browser.newContext({ viewport: { width: 390, height: 600 }, hasTouch: true, colorScheme: "dark", reducedMotion: "reduce" });
  try {
    const touchPage = await touch.newPage();
    await fixture(touchPage, { theme: "dark" });
    await touchPage.goto("/cron");
    const hit = await touchPage.getByRole("button", { name: "新建定时任务" }).evaluate((node) => node.getBoundingClientRect().height);
    expect(hit).toBeGreaterThanOrEqual(44);
    const bounds = await touchPage.locator("[data-cron-page]").evaluate((node) => ({ scrollWidth: node.scrollWidth, viewport: window.innerWidth }));
    expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.viewport + 1);
    await touchPage.screenshot({ path: test.info().outputPath("cron-touch.png"), fullPage: true, animations: "disabled" });
  } finally {
    await touch.close();
  }
});

test("未保存的草稿在浏览器返回时须确认，继续编辑保留内容且短高度保存区可见", async ({ page }) => {
  const control = await fixture(page);
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.goto("/cron?q=%E4%B8%AA%E4%BA%BA");
  await page.getByRole("button", { name: "新建定时任务" }).click();
  await expect(page.getByRole("dialog", { name: "新建定时任务" })).toBeVisible();
  await page.getByLabel("任务名称").fill("未保存的北京时间草稿");
  await page.locator("[data-composer-input]").fill("保留我的任务内容。");
  await expect(page.getByRole("button", { name: "保存为草稿", exact: true })).toBeInViewport();
  await page.goBack();
  let confirm = page.getByRole("dialog").filter({ hasText: "放弃未保存的内容？" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "继续编辑", exact: true }).click();
  await expect(page).toHaveURL(/\/cron\/new\?q=/);
  await expect(page.getByLabel("任务名称")).toHaveValue("未保存的北京时间草稿");
  await expect(page.locator("[data-composer-input]")).toHaveValue("保留我的任务内容。");
  await page.getByRole("button", { name: "返回定时任务列表" }).click();
  confirm = page.getByRole("dialog").filter({ hasText: "放弃未保存的内容？" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "放弃并返回", exact: true }).click();
  await expect(page).toHaveURL(/\/cron\?q=/);
  expect(control.writes()).toBe(0);
});

test("切换为单次仅提交对应字段，非中国浏览器仍按北京时间转换", async ({ page }) => {
  const control = await fixture(page);
  await page.goto("/cron/new");
  await page.getByLabel("任务名称").fill("单次北京时间任务");
  await page.getByLabel("执行方式").selectOption("interval");
  await page.getByLabel("每隔多少分钟").fill("45");
  await page.getByLabel("执行方式").selectOption("once");
  await page.getByLabel("执行时间").fill("2031-01-02T09:30");
  await page.locator("[data-composer-input]").fill("仅在指定时间执行一次。");
  await page.getByRole("button", { name: "保存为草稿", exact: true }).click();
  await expect(page).toHaveURL(/\/cron\/personal-new$/);
  const body = control.createBodies[0];
  expect(body.timezone).toBe("Asia/Shanghai");
  expect((body.condition as Json).schedule).toEqual({ kind: "once", once_at: "2031-01-02T01:30:00.000Z" });
  expect(control.createBodies).toHaveLength(1);
});
