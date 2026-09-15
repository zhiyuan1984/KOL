import { test, expect, type Page } from "@playwright/test";

const LIVE_SIDE_EFFECT = /\/(send|confirm-stage|start-crawl|crawl-job|actions\/start-crawl)(?:\?|$)/;

async function openMode(page: Page, mode: "today" | "todo" | "discovery" | "lifecycle") {
  await page.locator(`[data-home-mode="${mode}"]`).click();
  await expect(page.locator(`[data-home-pane="${mode}"]`)).toBeVisible();
}

test.beforeEach(async ({ request }) => {
  await request.post("/api/demo/reset", { data: { workbench: true } });
  await request.post("/api/me/persona", { data: { persona: "sriphy" } });
});

test("home four-panel tab order and pane visibility", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("[data-home-mode]")).toHaveCount(4);
  expect(await page.locator("[data-home-mode]").evaluateAll((els) => (
    els.map((el) => el.getAttribute("data-home-mode"))
  ))).toEqual(["today", "todo", "discovery", "lifecycle"]);
  await expect(page.locator('[data-home-mode="today"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-home-mode="today"]')).toContainText("今日任务");
  await expect(page.locator('[data-home-mode="todo"]')).toContainText("我的待办");
  await expect(page.locator('[data-home-mode="discovery"]')).toContainText("AI发现");
  await expect(page.locator('[data-home-mode="lifecycle"]')).toContainText("我跟进的红人");

  await expect(page.locator("[data-home] h1")).toHaveText("今天有什么工作要处理？");
  await expect(page.locator('[data-home-pane="today"]')).toBeVisible();
  await expect(page.locator("[data-today-suggestions]")).toBeVisible();
  await expect(page.locator("[data-recommended-task]").first()).toContainText("今天推荐");
  await expect(page.locator('[data-home-pane="today"]')).not.toContainText("AI发现");
  await expect(page.locator("[data-suggest-cta='prefill']").first()).toBeVisible();
  await expect(page.locator("[data-suggest-cta='todo']").first()).toBeVisible();
  await expect(page.locator('[data-home-pane="todo"]')).toHaveCount(0);
  await expect(page.locator('[data-home-pane="discovery"]')).toHaveCount(0);
  await expect(page.locator('[data-home-pane="lifecycle"]')).toHaveCount(0);

  await openMode(page, "todo");
  await expect(page.locator("[data-home] h1")).toHaveCount(0);
  await expect(page.locator('[data-home-pane="todo"]')).toBeVisible();
  await expect(page.locator("[data-todo-filters]")).toBeVisible();
  await expect(page.locator("[data-todo-md]")).toBeVisible();
  await expect(page.locator("[data-today-suggestions]")).toHaveCount(0);
  await expect(page.locator("[data-discovery-panel]")).toHaveCount(0);

  await openMode(page, "discovery");
  await expect(page.locator("[data-home] h1")).toHaveCount(0);
  await expect(page.locator("[data-discovery-panel]")).toBeVisible();
  await expect(page.locator("[data-discovery-panel]")).toContainText("红人线索");
  await expect(page.locator("[data-discovery-panel]")).not.toContainText("加入待办");
  await expect(page.locator("[data-discovery-live]")).toHaveAttribute("data-discovery-live", "false");
  await expect(page.locator("[data-discovery-empty='idle']")).toBeVisible();

  await openMode(page, "lifecycle");
  await expect(page.locator("[data-home] h1")).toHaveCount(0);
  await expect(page.locator('[data-home-pane="lifecycle"]')).toBeVisible();
  await expect(page.locator("[data-followed-kol-column]")).toBeVisible();
  await expect(page.locator("[data-followed-origin]")).toHaveAttribute("data-followed-origin", "collaboration");
  await expect(page.locator("[data-discovery-candidate]")).toHaveCount(0);
  await expect(page.locator("[data-kol-tab]")).toHaveCount(0);
  await expect(page.locator("[data-followed-object-search]")).toBeVisible();
  await expect(page.locator('[data-kol-tab="needs_me"]')).toHaveCount(0);
  await expect(page.locator('[data-kol-tab="INITIAL_CONTACT"]')).toHaveCount(0);
  await expect(page.locator("[data-kol-stage-filter]")).toBeVisible();
  await expect(page.locator('[data-home-pane="lifecycle"]')).not.toContainText("需要我处理");
  await expect(page.locator('[data-home-pane="lifecycle"]')).not.toContainText("正式阶段共 15 个");
});

test("home discovery persists plan and requires confirm before crawl or follow", async ({ page, request }) => {
  const livePosts: string[] = [];
  const discoveryPosts: string[] = [];
  const createdBodies: Array<Record<string, unknown>> = [];
  page.on("request", (item) => {
    if (item.method() !== "POST") return;
    const path = new URL(item.url()).pathname;
    if (LIVE_SIDE_EFFECT.test(path)) livePosts.push(path);
    if (path.startsWith("/api/discovery/")) discoveryPosts.push(path);
    if (path === "/api/discovery/requests") {
      createdBodies.push(item.postDataJSON() as Record<string, unknown>);
    }
  });

  await page.goto("/");
  await openMode(page, "discovery");
  await expect(page.locator("[data-discovery-panel]")).not.toContainText(/MCP|Codex|MediaCrawler|Harness|Job|stub/);
  await expect(page.locator("[data-discovery-panel]")).not.toContainText("已识别并可调整");
  expect(await page.locator("[data-discovery-form]").evaluate((form) => (
    [...form.querySelectorAll("[data-discovery-filters], [data-discovery-query]")].map((node) => (
      node.hasAttribute("data-discovery-filters") ? "filters" : "query"
    ))
  ))).toEqual(["filters", "query"]);
  await expect(page.locator('[data-discovery-filter="platform"]')).not.toContainText("全部平台");
  await expect(page.locator('[data-discovery-filter="platform"] [data-discovery-chip="tiktok"]')).toHaveCount(0);
  await expect(page.locator('[data-discovery-filter="platform"] [data-discovery-chip="youtube"]')).toHaveCount(1);
  await expect(page.locator('[data-discovery-filter="platform"] [data-discovery-chip="instagram"]')).toHaveCount(1);
  await expect(page.locator('[data-discovery-filter="platform"] [data-discovery-chip="facebook"]')).toHaveCount(1);
  await expect(page.locator('[data-discovery-filter="platform"] [data-discovery-chip="youtube"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-discovery-filter="region"] [data-discovery-chip="all"]')).toHaveText("不限地区");
  await expect(page.locator('[data-discovery-filter="region"] [data-discovery-chip="us"]')).toHaveText("美国");
  await expect(page.locator('[data-discovery-filter="region"] [data-discovery-chip="ca"]')).toHaveText("加拿大");
  await expect(page.locator('[data-discovery-filter="region"] [data-discovery-chip="eu"]')).toHaveText("欧洲");
  await expect(page.locator('[data-discovery-filter="region"] [data-discovery-chip="au"]')).toHaveText("澳洲");
  await page.locator("[data-discovery-query]").fill("找北美户外电源评测达人");
  await page.locator('[data-discovery-filter="platform"] [data-discovery-chip="youtube"]').click();
  await page.locator('[data-discovery-filter="region"] [data-discovery-chip="us"]').click();
  await page.locator("[data-discovery-add-direction]").click();
  await page.locator('[data-discovery-preset="户外电源"]').click();
  await expect(page.locator('[data-discovery-direction="户外电源"]')).toBeVisible();
  await expect(page.locator("[data-discovery-direction-popover]")).toHaveCount(0);
  await page.locator("[data-discovery-plan]").click();
  await expect(page.locator("[data-discovery-plan-card]")).toBeVisible();
  await expect(page.locator("[data-discovery-plan-card]")).toHaveAttribute("data-discovery-request-status", "open");
  await expect(page.locator("[data-discovery-confirm-plan]")).toBeVisible();
  await expect(page.locator("[data-discovery-follow-confirm]")).toHaveCount(0);
  await expect(page.locator("[data-discovery-plan-summary]")).toContainText("不会自动发信或改阶段");
  await expect(page.locator("[data-discovery-no-live]")).toBeVisible();
  await expect(page.locator("[data-discovery-panel]")).not.toContainText(/MCP|Codex|MediaCrawler|Harness/);
  expect(discoveryPosts.filter((path) => path.endsWith("/runs"))).toEqual([]);
  expect(livePosts).toEqual([]);

  const requestId = await page.locator("[data-discovery-request]").getAttribute("data-discovery-request");
  expect(requestId).toBeTruthy();
  const persisted = await request.get(`/api/discovery/requests/${requestId}`);
  expect(persisted.ok()).toBeTruthy();
  const body = await persisted.json() as {
    status?: string;
    status_label?: string;
    latest_run?: unknown;
    keywords?: string[];
    platforms?: string[];
    filters?: { region?: string; directions?: string[]; niche?: unknown };
  };
  expect(body.status).toBe("open");
  expect(body.status_label).toBe("待确认");
  expect(body.latest_run).toBeNull();
  expect(body.platforms).toEqual(["youtube"]);
  expect(createdBodies[0]?.platforms).toEqual(["youtube"]);
  expect(createdBodies[0]?.filters).toEqual({ region: "us", directions: ["户外电源"] });
  expect(createdBodies[0]?.filters).not.toHaveProperty("niche");
  expect(body.filters).toEqual({ region: "us", directions: ["户外电源"] });
  expect(body.filters).not.toHaveProperty("niche");
  expect(JSON.stringify(body)).not.toMatch(/MCP|Codex|MediaCrawler|Harness|crawl_job/i);

  const results = await request.get(`/api/discovery/requests/${requestId}/results`);
  expect(results.ok()).toBeTruthy();
  const resultBody = await results.json() as { pending_confirm?: boolean; candidates?: unknown[]; run?: unknown };
  expect(resultBody.pending_confirm).toBe(true);
  expect(resultBody.run).toBeNull();
  expect(resultBody.candidates || []).toEqual([]);

  await page.locator("[data-discovery-confirm-plan]").click();
  await expect(page.locator("[data-discovery-loading], [data-discovery-error]")).toBeVisible();
  const afterRun = await request.get(`/api/discovery/requests/${requestId}/results`);
  expect(afterRun.ok()).toBeTruthy();
  const afterBody = await afterRun.json() as {
    search_keywords?: string[];
    run?: { search_keywords?: string[] } | null;
    keywords?: string[];
  };
  expect(afterBody.keywords).toEqual(["找北美户外电源评测达人"]);
  const used = afterBody.search_keywords?.length
    ? afterBody.search_keywords
    : afterBody.run?.search_keywords || [];
  expect(used).toEqual(expect.arrayContaining(["portable power station"]));
  expect(used.join(" ")).not.toMatch(/找北美|达人/);
  expect(discoveryPosts.some((path) => path.includes("/runs"))).toBeTruthy();
  expect(discoveryPosts.some((path) => path.includes("/follow"))).toBeFalsy();
  expect(livePosts).toEqual([]);
  await expect(page.locator("[data-discovery-panel]")).not.toContainText(/MCP|Codex|MediaCrawler|Harness/);

  await openMode(page, "lifecycle");
  await expect(page.locator("[data-followed-kol-list]")).toBeVisible();
  await expect(page.locator("[data-discovery-candidate]")).toHaveCount(0);
  await expect(page.locator("[data-followed-origin]")).toHaveAttribute("data-followed-origin", "collaboration");
  expect(livePosts).toEqual([]);
});

test("home discovery chips keep query on reset and persist when editing plan", async ({ page }) => {
  await page.goto("/");
  await openMode(page, "discovery");
  const query = page.locator("[data-discovery-query]");
  await query.fill("找 Instagram 美国家庭旅行达人");
  await expect(page.locator('[data-discovery-filter="platform"] [data-discovery-chip="instagram"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-discovery-filter="region"] [data-discovery-chip="us"]')).toHaveAttribute("aria-pressed", "true");
  await page.locator("[data-discovery-add-direction]").click();
  await page.locator("[data-discovery-direction-input]").fill("家庭旅行");
  await page.locator("[data-discovery-direction-input]").press("Enter");
  await expect(page.locator('[data-discovery-direction="家庭旅行"]')).toBeVisible();
  await expect(page.getByLabel("删除方向：家庭旅行")).toBeVisible();
  await page.locator("[data-discovery-reset]").click();
  await expect(query).toHaveValue("找 Instagram 美国家庭旅行达人");
  await expect(page.locator('[data-discovery-filter="platform"] [data-discovery-chip="youtube"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-discovery-filter="region"] [data-discovery-chip="all"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-discovery-direction]")).toHaveCount(0);

  await page.locator('[data-discovery-filter="platform"] [data-discovery-chip="facebook"]').click();
  await page.locator('[data-discovery-filter="region"] [data-discovery-chip="ca"]').click();
  await page.locator("[data-discovery-add-direction]").click();
  await page.locator('[data-discovery-preset="户外露营"]').click();
  await expect(page.locator("[data-discovery-direction-popover]")).toHaveCount(0);
  await page.locator("[data-discovery-plan]").click();
  await expect(page.locator("[data-discovery-plan-card]")).toBeVisible();
  await page.locator("[data-discovery-cancel-plan]").click();
  await expect(query).toHaveValue("找 Instagram 美国家庭旅行达人");
  await expect(page.locator('[data-discovery-filter="platform"] [data-discovery-chip="facebook"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-discovery-filter="region"] [data-discovery-chip="ca"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-discovery-direction="户外露营"]')).toBeVisible();
});

test("home discovery maps streamable connection failures to employee copy", async ({ page }) => {
  await page.route("**/api/discovery/requests", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({
        detail: "Streamable HTTP error: Error POSTing to endpoint (HTTP 404)",
      }),
    });
  });

  await page.goto("/");
  await openMode(page, "discovery");
  await page.locator("[data-discovery-query]").fill("找北美户外电源评测达人");
  await page.locator("[data-discovery-plan]").click();

  const error = page.locator("[data-discovery-error]");
  await expect(error).toBeVisible();
  await expect(error).toHaveAttribute("data-discovery-error-kind", "connection");
  await expect(error.locator("[data-discovery-error-title]")).toHaveText("采集服务连接失败");
  await expect(error.locator("[data-discovery-error-message]")).toHaveText("暂时连不上采集服务。请确认服务可用后再检索。");
  await expect(error.locator("[data-discovery-error-title]")).not.toContainText(/Streamable|HTTP error|404|MCP|Codex/);
  await expect(error.locator("[data-discovery-error-message]")).not.toContainText(/Streamable|HTTP error|404|MCP|Codex|ECONNREFUSED/);
  await expect(page.locator("[data-discovery-retry]")).toBeDisabled();
  await expect(page.locator("[data-discovery-check-connection]")).toBeVisible();
  await expect(page.locator("[data-discovery-check-connection]")).toHaveText("检查连接");

  await page.route("**/api/discovery/connection", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "unreachable",
        status_label: "连接失败",
        message: "采集服务连接失败",
        credentials_present: true,
        reachable: false,
        connected: false,
        checked_at: "2026-09-15T00:00:00.000Z",
      }),
    });
  });
  await page.locator("[data-discovery-check-connection]").click();
  const diagnosis = page.locator("[data-discovery-connection-diagnosis]");
  await expect(diagnosis).toBeVisible();
  await expect(diagnosis).toHaveAttribute("data-connection-status", "unreachable");
  await expect(diagnosis).toContainText("连接失败");
  await expect(diagnosis).toContainText("采集服务连接失败");
});

test("home discovery maps failed run engine errors without showing raw copy", async ({ page }) => {
  await page.route("**/api/discovery/requests/**/runs", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "drun_e2e_conn",
        status: "failed",
        error: "connect ECONNREFUSED 127.0.0.1:8000",
      }),
    });
  });

  await page.goto("/");
  await openMode(page, "discovery");
  await page.locator("[data-discovery-query]").fill("找北美户外电源评测达人");
  await page.locator("[data-discovery-plan]").click();
  await expect(page.locator("[data-discovery-plan-card]")).toBeVisible();
  await page.locator("[data-discovery-confirm-plan]").click();

  const error = page.locator("[data-discovery-error]");
  await expect(error).toBeVisible();
  await expect(error).toHaveAttribute("data-discovery-error-kind", "connection");
  await expect(error.locator("[data-discovery-error-title]")).toHaveText("采集服务连接失败");
  await expect(error.locator("[data-discovery-error-message]")).not.toContainText(/ECONNREFUSED|127\.0\.0\.1|Streamable|MCP/);
  await expect(page.locator("[data-discovery-retry]")).toBeDisabled();
  await expect(page.locator("[data-discovery-check-connection]")).toBeVisible();
});

test("home discovery empty success shows actual search keywords", async ({ page }) => {
  const emptyHint = "按「portable power station」没有找到线索，可换词再试。";
  const searchKeywords = ["portable power station"];
  await page.route("**/api/discovery/requests/**/runs", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({
        id: "drun_e2e_empty",
        status: "succeeded",
        status_label: "已完成",
        search_keywords: searchKeywords,
        empty_hint: emptyHint,
        candidate_count: 0,
      }),
    });
  });
  await page.route("**/api/discovery/requests/**/results", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "succeeded",
        status_label: "已完成",
        keywords: ["找北美户外评测达人"],
        search_keywords: searchKeywords,
        empty_hint: emptyHint,
        candidates: [],
        counts: { candidate_count: 0, suggested_count: 0 },
        run: {
          id: "drun_e2e_empty",
          status: "succeeded",
          status_label: "已完成",
          search_keywords: searchKeywords,
          empty_hint: emptyHint,
          candidate_count: 0,
        },
        request: { keywords: ["找北美户外评测达人"], status: "succeeded" },
      }),
    });
  });

  await page.goto("/");
  await openMode(page, "discovery");
  await page.locator("[data-discovery-query]").fill("找北美户外评测达人");
  await page.locator("[data-discovery-add-direction]").click();
  await page.locator('[data-discovery-preset="户外电源"]').click();
  await page.locator("[data-discovery-plan]").click();
  await expect(page.locator("[data-discovery-plan-card]")).toBeVisible();
  await page.locator("[data-discovery-confirm-plan]").click();

  const empty = page.locator("[data-discovery-empty='results']");
  await expect(empty).toBeVisible();
  await expect(empty.locator("strong")).toHaveText("没有红人线索");
  await expect(page.locator("[data-discovery-empty-hint]")).toHaveText(emptyHint);
  await expect(page.locator("[data-discovery-empty-hint]")).toContainText("portable power station");
  await expect(page.locator("[data-discovery-panel]")).not.toContainText(/MCP|Codex|MediaCrawler|start_crawl|Harness|Job ID/);
});

test("home discovery shows planning wait instead of idle empty copy", async ({ page }) => {
  await page.route("**/api/discovery/requests", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
    await route.continue();
  });

  await page.goto("/");
  await openMode(page, "discovery");
  await page.locator("[data-discovery-query]").fill("找北美户外电源评测达人");
  await page.locator("[data-discovery-plan]").click();

  const planning = page.locator("[data-discovery-planning]");
  await expect(planning).toBeVisible();
  await expect(planning).toHaveAttribute("aria-busy", "true");
  await expect(planning).toHaveAttribute("data-wait-status", "生成计划");
  await expect(planning.locator("strong")).toHaveText("正在生成计划");
  await expect(page.locator("[data-discovery-planning-reason]")).toContainText("不会启动采集");
  await expect(page.locator("[data-discovery-empty='idle']")).toHaveCount(0);
  await expect(page.locator("[data-discovery-empty='results']")).toHaveCount(0);
  await expect(page.locator("[data-discovery-plan-card]")).toBeVisible();
  await expect(planning).toHaveCount(0);
});

test("home discovery keeps waiting until terminal and never fakes empty results", async ({ page }) => {
  let polls = 0;
  await page.route("**/api/discovery/requests/**/runs", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({
        id: "drun_e2e_wait",
        status: "running",
        status_label: "采集中",
      }),
    });
  });
  await page.route("**/api/discovery/requests/**/results", async (route) => {
    polls += 1;
    const done = polls >= 3;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: done ? "succeeded" : "running",
        status_label: done ? "已完成" : "采集中",
        keywords: ["找北美户外评测达人"],
        search_keywords: ["portable power station"],
        empty_hint: "按「portable power station」没有找到线索，可换词再试。",
        candidates: [],
        run: {
          id: "drun_e2e_wait",
          status: done ? "succeeded" : "running",
          status_label: done ? "已完成" : "采集中",
          search_keywords: ["portable power station"],
        },
        request: { keywords: ["找北美户外评测达人"], status: done ? "succeeded" : "running" },
      }),
    });
  });

  await page.goto("/");
  await openMode(page, "discovery");
  await page.locator("[data-discovery-query]").fill("找北美户外评测达人");
  await page.locator("[data-discovery-plan]").click();
  await expect(page.locator("[data-discovery-plan-card]")).toBeVisible();
  await page.locator("[data-discovery-confirm-plan]").click();

  const loading = page.locator("[data-discovery-loading]");
  await expect(loading).toBeVisible();
  await expect(loading).toHaveAttribute("aria-busy", "true");
  await expect(loading).toHaveAttribute("data-discovery-run-status", /queued|running/);
  await expect(loading.locator("[data-discovery-run-label]")).toHaveText(/排队中|采集中/);
  await expect(page.locator("[data-discovery-cancel-wait]")).toBeVisible();
  await expect(page.locator("[data-discovery-empty='results']")).toHaveCount(0);
  await expect(page.locator("[data-discovery-panel]")).not.toContainText("没有红人线索");

  const empty = page.locator("[data-discovery-empty='results']");
  await expect(empty).toBeVisible({ timeout: 8000 });
  await expect(empty.locator("strong")).toHaveText("没有红人线索");
  expect(polls).toBeGreaterThanOrEqual(3);
});

test("home discovery timeout stays an error with recover, not empty results", async ({ page }) => {
  await page.addInitScript(() => {
    (window as Window & { __discoveryWaitTimeoutMs?: number }).__discoveryWaitTimeoutMs = 1500;
  });
  await page.route("**/api/discovery/requests/**/runs", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({
        id: "drun_e2e_timeout",
        status: "running",
        status_label: "采集中",
      }),
    });
  });
  await page.route("**/api/discovery/requests/**/results", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "running",
        status_label: "采集中",
        keywords: ["找北美户外评测达人"],
        candidates: [],
        run: { id: "drun_e2e_timeout", status: "running", status_label: "采集中" },
        request: { keywords: ["找北美户外评测达人"], status: "running" },
      }),
    });
  });

  await page.goto("/");
  await openMode(page, "discovery");
  await page.locator("[data-discovery-query]").fill("找北美户外评测达人");
  await page.locator("[data-discovery-plan]").click();
  await expect(page.locator("[data-discovery-plan-card]")).toBeVisible();
  await page.locator("[data-discovery-confirm-plan]").click();
  const loading = page.locator("[data-discovery-loading]");
  await expect(loading).toBeVisible();
  await expect(loading).toHaveAttribute("data-discovery-run-status", /queued|running/);
  await expect(page.locator("[data-discovery-empty='results']")).toHaveCount(0);

  const error = page.locator("[data-discovery-error]");
  await expect(error).toBeVisible({ timeout: 8000 });
  await expect(error).toHaveAttribute("data-discovery-error-kind", "timeout");
  await expect(error.locator("[data-discovery-error-title]")).toHaveText("检索尚未完成");
  await expect(error.locator("[data-discovery-error-message]")).toContainText("没有得到完整结果");
  await expect(page.locator("[data-discovery-retry]")).toHaveText("继续等待");
  await expect(page.locator("[data-discovery-cancel-error]")).toHaveText("返回修改");
  await expect(page.locator("[data-discovery-empty='results']")).toHaveCount(0);
  await expect(page.locator("[data-discovery-panel]")).not.toContainText("没有红人线索");
  await page.locator("[data-discovery-retry]").click();
  await expect(loading).toBeVisible();
  await expect(error).toHaveCount(0);
  await expect(error).toBeVisible({ timeout: 8000 });
  await expect(error).toHaveAttribute("data-discovery-error-kind", "timeout");
  await page.locator("[data-discovery-cancel-error]").click();
  await expect(page.locator("[data-discovery-plan-card]")).toBeVisible();
});

test("home discovery cancel wait recovers without fake empty results", async ({ page }) => {
  await page.route("**/api/discovery/requests/**/runs", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({
        id: "drun_e2e_cancel",
        status: "running",
        status_label: "采集中",
      }),
    });
  });
  await page.route("**/api/discovery/requests/**/results", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "running",
        status_label: "采集中",
        keywords: ["找北美户外评测达人"],
        candidates: [],
        run: { id: "drun_e2e_cancel", status: "running", status_label: "采集中" },
        request: { keywords: ["找北美户外评测达人"], status: "running" },
      }),
    });
  });

  await page.goto("/");
  await openMode(page, "discovery");
  await page.locator("[data-discovery-query]").fill("找北美户外评测达人");
  await page.locator("[data-discovery-plan]").click();
  await expect(page.locator("[data-discovery-plan-card]")).toBeVisible();
  await page.locator("[data-discovery-confirm-plan]").click();
  await expect(page.locator("[data-discovery-loading]")).toBeVisible();
  await page.locator("[data-discovery-cancel-wait]").click();
  const error = page.locator("[data-discovery-error]");
  await expect(error).toBeVisible();
  await expect(error).toHaveAttribute("data-discovery-error-kind", "cancelled");
  await expect(page.locator("[data-discovery-retry]")).toHaveText("继续等待");
  await expect(page.locator("[data-discovery-empty='results']")).toHaveCount(0);
  await expect(page.locator("[data-discovery-panel]")).not.toContainText("没有红人线索");
  await page.locator("[data-discovery-cancel-error]").click();
  await expect(page.locator("[data-discovery-plan-card]")).toBeVisible();
});

function stubDiscoveryCandidates(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `cand_e2e_follow_${index + 1}`,
    handle: `Creator${index + 1}`,
    nickname: `Creator ${index + 1}`,
    platform: "youtube",
    followers: 12000 + index * 800,
    avg_views_10: 4100 + index * 50,
    score: 68 + (index % 8),
    status: "suggested",
    has_contact_email: index % 3 !== 0,
    reason: `YouTube · @Creator${index + 1} · ${12000 + index * 800}粉 · 待加入跟进`,
  }));
}

async function mockDiscoveryCandidateResults(page: Page, candidates: Array<Record<string, unknown>>) {
  await page.route("**/api/discovery/requests/**/runs", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({
        id: "drun_e2e_candidates",
        status: "succeeded",
        status_label: "已完成",
        search_keywords: ["portable power station"],
        candidate_count: candidates.length,
      }),
    });
  });
  await page.route("**/api/discovery/requests/**/results", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "succeeded",
        status_label: "已完成",
        keywords: ["找北美户外评测达人"],
        platforms: ["youtube"],
        search_keywords: ["portable power station"],
        candidates,
        counts: { candidate_count: candidates.length, suggested_count: candidates.length },
        run: {
          id: "drun_e2e_candidates",
          status: "succeeded",
          status_label: "已完成",
          search_keywords: ["portable power station"],
          candidate_count: candidates.length,
        },
        request: {
          id: "dreq_e2e_candidates",
          keywords: ["找北美户外评测达人"],
          platforms: ["youtube"],
          status: "succeeded",
        },
      }),
    });
  });
}

async function openDiscoveryResults(page: Page) {
  await page.goto("/");
  await openMode(page, "discovery");
  await page.locator("[data-discovery-query]").fill("找北美户外评测达人");
  await page.locator("[data-discovery-plan]").click();
  await expect(page.locator("[data-discovery-plan-card]")).toBeVisible();
  await page.locator("[data-discovery-confirm-plan]").click();
  await expect(page.locator("[data-discovery-candidates]")).toBeVisible();
}

async function expectNoPageHorizontalScroll(page: Page) {
  const box = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(box.scroll).toBeLessThanOrEqual(box.client + 1);
}

async function candidateRowLayout(card: ReturnType<Page["locator"]>) {
  return card.evaluate((el) => {
    const copy = el.querySelector(".discovery-candidate-copy") as HTMLElement | null;
    const actions = el.querySelector(".discovery-candidate-actions") as HTMLElement | null;
    if (!copy || !actions) {
      throw new Error("discovery candidate row is missing copy or actions");
    }
    const cardBox = el.getBoundingClientRect();
    const copyBox = copy.getBoundingClientRect();
    const actionsBox = actions.getBoundingClientRect();
    return {
      cardWidth: cardBox.width,
      copyWidth: copyBox.width,
      copyRight: copyBox.right,
      copyTop: copyBox.top,
      copyBottom: copyBox.bottom,
      actionsLeft: actionsBox.left,
      actionsTop: actionsBox.top,
      actionsRight: actionsBox.right,
      cardRight: cardBox.right,
      gridColumnStart: getComputedStyle(actions).gridColumnStart,
      template: getComputedStyle(el).gridTemplateColumns,
    };
  });
}

test("home discovery follow confirm stays in viewport without scrolling the list", async ({ page }) => {
  const livePosts: string[] = [];
  const followPosts: string[] = [];
  page.on("request", (item) => {
    if (item.method() !== "POST") return;
    const path = new URL(item.url()).pathname;
    if (LIVE_SIDE_EFFECT.test(path)) livePosts.push(path);
    if (path.includes("/follow")) followPosts.push(path);
  });

  const candidates = stubDiscoveryCandidates(24);
  await mockDiscoveryCandidateResults(page, candidates);
  await page.route("**/api/discovery/candidates/**", async (route) => {
    if (route.request().method() === "POST" && /\/follow/.test(new URL(route.request().url()).pathname)) {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ detail: "e2e visibility test does not write follow" }),
      });
      return;
    }
    await route.continue();
  });

  await openDiscoveryResults(page);
  await expect(page.locator("[data-discovery-candidate]")).toHaveCount(24);

  const listBox = await page.locator("[data-discovery-candidates]").boundingBox();
  const viewport = page.viewportSize();
  expect(listBox?.height || 0).toBeGreaterThan(viewport?.height || 0);
  await expect(page.locator("[data-discovery-candidate]").last()).not.toBeInViewport();

  const firstFollow = page.locator("[data-discovery-follow]").first();
  await firstFollow.scrollIntoViewIfNeeded();
  await firstFollow.click();

  const confirm = page.locator("[data-discovery-follow-confirm]");
  await expect(confirm).toBeVisible();
  await expect(confirm).toBeInViewport();
  await expect(confirm).toHaveAttribute("data-discovery-follow-mode", "single");
  await expect(confirm.locator("[data-discovery-follow-yes]")).toBeInViewport();
  await expect(confirm.locator("[data-discovery-follow-yes]")).toHaveText("确认加入跟进");
  await expect(confirm).toContainText("不会发信，也不会改正式阶段");
  await expect(page.locator("[data-discovery-candidates] [data-discovery-follow-confirm]")).toHaveCount(0);
  await expect(page.locator("[data-discovery-candidate]").last()).not.toBeInViewport();
  expect(followPosts).toEqual([]);
  expect(livePosts).toEqual([]);

  await page.locator("[data-discovery-follow-no]").click();
  await expect(page.locator("[data-discovery-follow-confirm]")).toHaveCount(0);

  await page.locator("[data-discovery-select-all]").check();
  await page.locator("[data-discovery-batch-follow]").click();
  const batchConfirm = page.locator("[data-discovery-follow-confirm]");
  await expect(batchConfirm).toBeVisible();
  await expect(batchConfirm).toBeInViewport();
  await expect(batchConfirm).toHaveAttribute("data-discovery-follow-mode", "selected");
  await expect(batchConfirm.locator("[data-discovery-follow-yes]")).toBeInViewport();
  await expect(batchConfirm.locator("[data-discovery-follow-yes]")).toHaveText("确认加入跟进");
  await expect(page.locator("[data-discovery-candidates] [data-discovery-follow-confirm]")).toHaveCount(0);
  expect(followPosts).toEqual([]);
  expect(livePosts).toEqual([]);
});

test("home discovery candidate rows use workbench layout and dedupe metrics", async ({ page }) => {
  const followPosts: string[] = [];
  page.on("request", (item) => {
    if (item.method() === "POST" && new URL(item.url()).pathname.includes("/follow")) {
      followPosts.push(new URL(item.url()).pathname);
    }
  });

  const candidates = [
    {
      id: "cand_solar",
      handle: "TheSolarLab",
      nickname: "TheSolarLab",
      platform: "youtube",
      followers: 153000,
      avg_views_10: 8597338,
      score: 82.94,
      status: "suggested",
      reason: "YouTube · @TheSolarLab · 15万粉 · 评分 82.94 · 待加入跟进",
      summary: "YouTube · @TheSolarLab · 15万粉 · 评分 82.94 · 待加入跟进",
    },
    {
      id: "cand_gear",
      handle: "OutdoorGearLab",
      nickname: "Outdoor Gear Lab",
      platform: "youtube",
      followers: 89000,
      avg_views_10: 120000,
      score: 88,
      status: "suggested",
      reason: "匹配户外电源评测方向，近期内容稳定",
    },
    {
      id: "cand_long",
      handle: "VeryLongCreatorHandleNameThatShouldWrapInsteadOfScroll",
      nickname: "VeryLongCreatorHandleNameThatShouldWrapInsteadOfScroll",
      platform: "instagram",
      followers: 0,
      score: 0,
      status: "suggested",
      reason: "Instagram · @VeryLongCreatorHandleNameThatShouldWrapInsteadOfScroll · 待加入跟进",
    },
  ];
  await mockDiscoveryCandidateResults(page, candidates);
  await openDiscoveryResults(page);
  await expect(page.locator("[data-discovery-candidate]")).toHaveCount(3);

  const solar = page.locator('[data-discovery-candidate="TheSolarLab"]');
  await expect(solar.locator("[data-discovery-candidate-identity]")).toHaveText("@TheSolarLab");
  await expect(solar.locator("[data-discovery-candidate-meta]")).toHaveText(
    "YouTube · 153k · 近10均播 8597338 · 评分 82.94",
  );
  await expect(solar.locator("[data-discovery-candidate-reason]")).toHaveCount(0);
  await expect(solar).not.toContainText("待加入跟进");
  await expect(solar).not.toContainText("15万粉");
  expect((await solar.innerText()).match(/YouTube/g)?.length).toBe(1);
  expect((await solar.innerText()).match(/82\.94/g)?.length).toBe(1);

  const gear = page.locator('[data-discovery-candidate="OutdoorGearLab"]');
  await expect(gear.locator("[data-discovery-candidate-identity]")).toContainText("@OutdoorGearLab");
  await expect(gear.locator("[data-discovery-candidate-identity]")).toContainText("Outdoor Gear Lab");
  await expect(gear.locator("[data-discovery-candidate-meta]")).toHaveText(
    "YouTube · 89k · 近10均播 120000 · 评分 88",
  );
  await expect(gear.locator("[data-discovery-candidate-reason]")).toHaveText("匹配户外电源评测方向，近期内容稳定");

  const longHandle = page.locator('[data-discovery-candidate="VeryLongCreatorHandleNameThatShouldWrapInsteadOfScroll"]');
  await expect(longHandle.locator("[data-discovery-candidate-meta]")).toHaveText("Instagram");
  await expect(longHandle.locator("[data-discovery-candidate-reason]")).toHaveCount(0);

  await expect(solar.locator("[data-discovery-follow]")).toHaveClass(/btn work/);
  await expect(solar.locator("[data-discovery-favorite]")).toHaveClass(/btn ghost/);
  await expect(solar.locator("[data-discovery-favorite]")).toHaveAttribute("title", "收藏保存在此浏览器");
  await expect(solar.locator("[data-discovery-dismiss]")).toHaveClass(/btn ghost/);
  await solar.locator("[data-discovery-favorite]").click();
  await expect(solar.locator("[data-discovery-favorite]")).toHaveText("已收藏");
  await page.reload();
  await openMode(page, "discovery");
  await page.locator("[data-discovery-query]").fill("找北美户外评测达人");
  await page.locator("[data-discovery-plan]").click();
  await expect(page.locator("[data-discovery-plan-card]")).toBeVisible();
  await page.locator("[data-discovery-confirm-plan]").click();
  await expect(page.locator("[data-discovery-candidates]")).toBeVisible();
  await expect(page.locator('[data-discovery-candidate="TheSolarLab"] [data-discovery-favorite]')).toHaveText("已收藏");

  const wide = await candidateRowLayout(solar);
  expect(wide.gridColumnStart === "auto" || wide.gridColumnStart === "3").toBeTruthy();
  expect(wide.gridColumnStart).not.toBe("2");
  expect(wide.actionsLeft).toBeGreaterThan(wide.copyRight - 2);
  expect(Math.abs(wide.actionsTop - wide.copyTop)).toBeLessThan(48);
  expect(wide.copyWidth).toBeGreaterThan(wide.cardWidth * 0.4);
  expect(wide.cardRight - wide.actionsRight).toBeLessThan(24);
  await expectNoPageHorizontalScroll(page);

  await solar.locator("[data-discovery-follow]").click();
  await expect(page.locator("[data-discovery-follow-confirm]")).toBeVisible();
  await expect(page.locator("[data-discovery-follow-confirm]")).toHaveAttribute("data-discovery-follow-mode", "single");
  await page.locator("[data-discovery-follow-no]").click();
  await expect(page.locator("[data-discovery-follow-confirm]")).toHaveCount(0);
  expect(followPosts).toEqual([]);

  await page.setViewportSize({ width: 720, height: 900 });
  const stacked = await candidateRowLayout(solar);
  expect(stacked.gridColumnStart).toBe("2");
  expect(stacked.actionsTop).toBeGreaterThan(stacked.copyBottom - 4);
  await expectNoPageHorizontalScroll(page);
});

async function stubHomeTodos(page: Page, todos: Array<Record<string, unknown>>) {
  const payload = {
    kols: [],
    tabs: [{ code: "all", count: 0 }],
    tasks: todos,
    workbench: {
      summary: { open: todos.length, overdue: 0, due_today: 1, waiting: 0, insights: 0 },
      todo: todos,
    },
  };
  await page.route("**/api/home/board", (route) => route.fulfill({ json: payload }));
  await page.route("**/api/tasks", (route) => route.fulfill({ json: todos }));
}

async function todoRowLayout(card: ReturnType<Page["locator"]>) {
  return card.evaluate((el) => {
    const act = (el.matches(".todo-card-act") ? el : el.querySelector(".todo-card-act")) as HTMLElement | null;
    const copy = el.querySelector(".todo-card-copy") as HTMLElement | null;
    const main = el.querySelector(".todo-card-main") as HTMLElement | null;
    const status = el.querySelector(".todo-card-status") as HTMLElement | null;
    const pane = el.closest("[data-todo-md]") as HTMLElement | null;
    if (!act || !copy || !main || !status) {
      throw new Error("todo action row is missing mark/copy/status");
    }
    const actBox = act.getBoundingClientRect();
    const copyBox = copy.getBoundingClientRect();
    const mainBox = main.getBoundingClientRect();
    const statusBox = status.getBoundingClientRect();
    const paneBox = pane?.getBoundingClientRect();
    return {
      actWidth: actBox.width,
      copyWidth: copyBox.width,
      paneWidth: paneBox?.width ?? 0,
      actMaxWidth: getComputedStyle(act).maxWidth,
      copyMaxWidth: getComputedStyle(copy).maxWidth,
      paneMaxWidth: pane ? getComputedStyle(pane).maxWidth : "",
      copyTemplate: getComputedStyle(copy).gridTemplateColumns,
      mainRight: mainBox.right,
      mainBottom: mainBox.bottom,
      mainTop: mainBox.top,
      statusLeft: statusBox.left,
      statusTop: statusBox.top,
      statusRight: statusBox.right,
      actRight: actBox.right,
    };
  });
}

test("home todo action rows use full-width workbench layout", async ({ page }) => {
  const due = new Date();
  due.setHours(18, 0, 0, 0);
  const todos = [
    {
      id: "tsk_wide_quote",
      title: "写北美户外评测达人合作报价并核对样品寄送地址",
      source: "manual",
      status: "pending",
      priority: "high",
      kol_name: "TheSolarLab",
      current_stage: "初步接触",
      due_at: due.toISOString(),
      history_summary: "金额待确认，今天需要发出报价",
    },
    {
      id: "tsk_wide_follow",
      title: "跟进 Outdoor Gear Lab 样品签收",
      source: "manual",
      status: "pending",
      kol_name: "OutdoorGearLab",
      due_at: new Date(due.getTime() + 86_400_000).toISOString(),
    },
  ];
  await stubHomeTodos(page, todos);
  await page.goto("/");
  await openMode(page, "todo");
  await expect(page.locator("[data-todo-md]")).toBeVisible();
  const quote = page.locator("[data-todo-card]").filter({ hasText: "写北美户外评测达人合作报价并核对样品寄送地址" });
  await expect(quote).toBeVisible();
  await expect(quote.locator("[data-todo-act]")).toBeVisible();
  await expect(quote.locator("[data-todo-status]")).toContainText("今天到期");

  const wide = await todoRowLayout(quote);
  expect(wide.actMaxWidth).toMatch(/^(none|100%)$/);
  expect(wide.copyMaxWidth).toMatch(/^(none|100%)$/);
  expect(wide.paneMaxWidth).toMatch(/^(none|100%)$/);
  expect(wide.copyTemplate.split(" ").filter(Boolean).length).toBeGreaterThanOrEqual(2);
  expect(wide.statusLeft).toBeGreaterThan(wide.mainRight - 2);
  expect(Math.abs(wide.statusTop - wide.mainTop)).toBeLessThan(48);
  expect(wide.actWidth).toBeGreaterThan(wide.paneWidth * 0.9);
  expect(wide.actWidth).toBeGreaterThan(42 * 16);
  expect(wide.actRight - wide.statusRight).toBeLessThan(24);
  await expectNoPageHorizontalScroll(page);

  await page.setViewportSize({ width: 720, height: 900 });
  const stacked = await todoRowLayout(quote);
  expect(stacked.statusTop).toBeGreaterThan(stacked.mainBottom - 4);
  expect(stacked.actWidth).toBeGreaterThan(stacked.paneWidth * 0.9);
  await expectNoPageHorizontalScroll(page);
});

test("home followed KOL card is a dense fact | AI decision row", async ({ page }) => {
  await page.route("**/api/home/board", (route) => route.fulfill({
    json: {
      kols: [{
        id: "col_xiaomei",
        handle: "小美妆日记",
        brand: "LT",
        owner_name: "钟槿年",
        platform: "小红书",
        stage_code: "INITIAL_CONTACT",
        stage_label: "初步接触",
        days_in_stage: 12,
        mailbox_from: "larry.zhao@amperetime.com",
        suggested_stage: "已回复-有兴趣",
        suggested_stage_code: "INTERESTED",
        unread_count: 0,
        mail_threads: [{
          conversation_id: "3901",
          subject: "Re: LiTime collab",
          unread_count: 0,
          last_direction: "inbound",
          last_from: "amy@example.com",
          last_snippet: "我对这次合作有兴趣",
          last_at: "2026-09-12T10:00:00.000Z",
        }],
      }],
      tasks: [],
      tabs: [{ code: "all", count: 1 }],
    },
  }));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await openMode(page, "lifecycle");
  const card = page.locator('[data-followed-kol="小美妆日记"]');
  await expect(card).toBeVisible();
  await expect(card.locator("[data-kol-band]")).toHaveCount(4);
  await expect(card.locator("[data-kol-band='identity'] [data-stage-label]")).toHaveText("初步接触");
  await expect(card.locator("[data-days-in-stage]")).toHaveText("停留 12 天");
  await expect(card.locator('[data-kol-chip="mailbox"]')).toHaveCount(0);
  await expect(card.locator("[data-latest-fact]")).toContainText("我对这次合作有兴趣");
  await expect(card.locator("[data-latest-fact]")).toContainText("邮件 ·");
  await expect(card.locator("[data-latest-fact]")).not.toContainText("From:");
  await expect(card.locator("[data-latest-fact]")).not.toContainText("Reply-To");
  await expect(card.locator("[data-recommended-action]")).toContainText("建议进入「已回复 · 有兴趣」");
  await expect(card.locator("[data-action-why]")).toContainText("明确表达品牌合作意愿");
  await expect(card).not.toContainText("支撑进入");
  await expect(card).not.toContainText("support_transition");
  await expect(card.locator("[data-action-evidence]")).toContainText("查看判断依据");
  await expect(card.locator("[data-confirm-enter-stage]")).toHaveText("进入已回复 · 有兴趣 →");
  await expect(card.locator("[data-confirm-enter-stage]")).toHaveClass(/work/);
  await expect(card.locator("[data-open-kol-detail]")).toHaveText("查看详情");
  await expect(card.locator("[data-open-original-mail]")).toHaveText("原邮件");
  await expect(card.getByRole("button", { name: "确认阶段", exact: true })).toHaveCount(0);

  const wide = await card.evaluate((el) => {
    const name = el.querySelector("[data-kol-name]")?.getBoundingClientRect();
    const stage = el.querySelector("[data-stage-label]")?.getBoundingClientRect();
    const fact = el.querySelector("[data-latest-fact]")?.getBoundingClientRect();
    const rec = el.querySelector("[data-recommended-action]")?.getBoundingClientRect();
    const primary = el.querySelector("[data-confirm-enter-stage]")?.getBoundingClientRect();
    const detail = el.querySelector("[data-open-kol-detail]")?.getBoundingClientRect();
    return {
      stageBesideName: Boolean(name && stage && Math.abs(name.top - stage.top) < 16 && stage.left + 1 >= name.right - 8),
      factAiSideBySide: Boolean(fact && rec && rec.left + 2 >= fact.right - 8 && Math.abs(fact.top - rec.top) < 48),
      primaryRightOfDetail: Boolean(primary && detail && primary.left + 2 >= detail.right - 8),
      cardWidth: el.clientWidth,
    };
  });
  expect(wide.stageBesideName).toBe(true);
  expect(wide.factAiSideBySide).toBe(true);
  expect(wide.primaryRightOfDetail).toBe(true);
  expect(wide.cardWidth).toBeGreaterThan(900);

  await page.setViewportSize({ width: 720, height: 900 });
  const stacked = await card.evaluate((el) => {
    const fact = el.querySelector("[data-latest-fact]")?.getBoundingClientRect();
    const rec = el.querySelector("[data-recommended-action]")?.getBoundingClientRect();
    return Boolean(fact && rec && rec.top + 1 >= fact.bottom - 8);
  });
  expect(stacked).toBe(true);
});

test("today suggestion convert to todo dedupes", async ({ page }) => {
  await page.goto("/");
  await openMode(page, "todo");
  await expect(page.locator("[data-todo-card]").first()).toBeVisible({ timeout: 15000 });
  await openMode(page, "today");
  const firstSuggest = page.locator("[data-recommended-task]").first();
  const title = (await firstSuggest.locator("strong").innerText()).trim();
  const convert = page.locator("[data-suggestion-to-todo]").first();
  await expect(convert).toHaveText("加入待办");
  await convert.click();
  await expect(page.locator('[data-home-pane="todo"]')).toBeVisible();
  await expect(page.locator("[data-todo-card]").filter({ hasText: title })).toHaveCount(1);
  const afterFirst = await page.locator("[data-todo-card]").count();
  await openMode(page, "today");
  await expect(page.locator("[data-suggestion-to-todo]").first()).toHaveText("已在待办");
  await expect(page.locator("[data-suggestion-to-todo]").first()).toBeDisabled();
  await openMode(page, "todo");
  await expect(page.locator("[data-todo-card]").filter({ hasText: title })).toHaveCount(1);
  await expect(page.locator("[data-todo-card]")).toHaveCount(afterFirst);
});
