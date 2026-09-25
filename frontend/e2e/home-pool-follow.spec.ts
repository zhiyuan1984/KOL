import { test, expect, type Page } from "@playwright/test";

const LIVE_SIDE_EFFECT = /\/(send|confirm-stage|start-crawl|crawl-job|actions\/start-crawl)(?:\?|$)/;

const POOL_ITEM = {
  id: "kpi_outdoor",
  company_id: "company:amperetime",
  kol_uid: "uid_outdoor",
  handle: "户外充电君",
  display_name: "户外充电君",
  platform: "youtube",
  homepage_url: "https://www.youtube.com/@outdoor",
  avatar_url: "https://yt3.ggpht.com/outdoor-avatar.jpg",
  followers: "120000",
  avg_plays: "30000",
  engagement: "0.042",
  direction: "vanlife",
  region: "北美",
  style: "",
  ingest_source: "starry",
  ingested_at: "2026-08-01T00:00:00Z",
  idle: true,
  public_stage: "公海",
  pool_status: "open",
  has_conversation: false,
};

/** 已有邮件会话 + 有负责人 = 已建联且有主，前后端都必须过滤掉。 */
const POOL_CONTACTED_ITEM = {
  ...POOL_ITEM,
  id: "kpi_contacted",
  kol_uid: "uid_contacted",
  handle: "已建联红人",
  display_name: "已建联红人",
  owner_name: "负责人",
  last_conversation_id: "conv_contacted",
};

/** 无主：三个归属信号都空。已有往来也算公海，且必须排在有主行前面。 */
const POOL_UNOWNED_ITEM = {
  ...POOL_ITEM,
  id: "kpi_unowned",
  kol_uid: "uid_unowned",
  handle: "无主红人",
  display_name: "无主红人",
  homepage_url: "",
  owner_name: null,
  owner_mailbox: null,
  owner_user_id: null,
  has_conversation: true,
  last_conversation_id: "conv_unowned",
};

const FOLLOW_REFUSED = {
  ...POOL_ITEM,
  id: "kpi_refused",
  kol_uid: "uid_refused",
  handle: "小美妆日记",
  display_name: "小美妆日记",
  homepage_url: "",
  follow_id: "kfi_refused",
  employee_id: "u_sriphy",
  employee_name: "Sriphy",
  scope_brand: "LT",
  status: "active",
  claimed_at: "2026-08-20T00:00:00Z",
  collaboration_id: "col_refused",
  last_effective_mail_at: null,
  days_since_interaction: null,
  release_due_at: null,
  countdown: false,
  cron_eligible: false,
  last_interaction_at: null,
  public_stage: "已拒绝",
};

const FOLLOW_NEAR = {
  ...FOLLOW_REFUSED,
  id: "kpi_near",
  kol_uid: "uid_near",
  handle: "旅行充电站",
  display_name: "旅行充电站",
  follow_id: "kfi_near",
  collaboration_id: "col_near",
  last_effective_mail_at: "2026-09-05T00:00:00Z",
  days_since_interaction: 12,
  release_due_at: "2026-09-19T00:00:00Z",
  countdown: true,
  cron_eligible: true,
  last_interaction_at: "2026-09-05T00:00:00Z",
  public_stage: "跟进中",
};

async function stubKol172(page: Page) {
  await page.route("https://yt3.ggpht.com/**", async (route) => {
    await route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 56 56"><rect width="56" height="56" fill="#dbeafe"/></svg>',
    });
  });
  await page.route("**/api/home/pool", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      json: {
        entry: "memory",
        kind: "memory",
        creates_session: false,
        calls_model: false,
        index: "公海",
        items: [POOL_ITEM, POOL_CONTACTED_ITEM, POOL_UNOWNED_ITEM],
        kols: [POOL_ITEM, POOL_CONTACTED_ITEM, POOL_UNOWNED_ITEM],
      },
    });
  });
  await page.route("**/api/home/following", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      json: {
        entry: "memory",
        kind: "memory",
        creates_session: false,
        calls_model: false,
        index: "我的跟进",
        employee_id: "u_sriphy",
        authority: "kol_follow_index",
        kols: [FOLLOW_REFUSED, FOLLOW_NEAR],
      },
    });
  });
  await page.route("**/api/home/kol-analyze/enqueue", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = route.request().postDataJSON() as { kol_uids?: string[]; people?: string[] };
    await route.fulfill({
      status: 201,
      json: {
        entry: "command",
        kind: "command",
        creates_session: false,
        calls_model: false,
        task_type: "kol_analyze",
        work_item_id: "tsk_analyze_1",
        people: body.kol_uids || body.people || [],
        artifact_type: "kol_analyze_brief",
        recognizeTaskIntent: false,
      },
    });
  });
  await page.route("**/api/kols/*/claim", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = route.request().postDataJSON() as { confirm?: boolean; confirmed?: boolean };
    if (!body.confirm && !body.confirmed) {
      await route.fulfill({
        status: 422,
        json: { code: "l3_confirm_required", message: "领取公海正式档案需要 L3 确认" },
      });
      return;
    }
    await route.fulfill({
      status: 201,
      json: {
        entry: "command",
        kind: "command",
        creates_session: false,
        calls_model: false,
        ok: true,
        reused: false,
        created: true,
        follow: { ...FOLLOW_NEAR, follow_id: "kfi_claimed", kol_uid: POOL_ITEM.kol_uid, countdown: false },
      },
    });
  });
  await page.route("**/api/follows/*/release", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await route.fulfill({
      json: {
        entry: "command",
        kind: "command",
        creates_session: false,
        calls_model: false,
        ok: true,
        action: "release",
        follow_id: "kfi_refused",
        kol_uid: "uid_refused",
        stage_unchanged: "REJECTED",
      },
    });
  });
}

async function openFollow(page: Page) {
  await page.locator('[data-home-mode="lifecycle"]').click();
  await expect(page.locator('[data-home-pane="lifecycle"]')).toBeVisible();
}

async function openPool(page: Page) {
  await page.locator('[data-home-mode="pool"]').click();
  await expect(page).toHaveURL(/[?&]tab=pool/);
  await expect(page.locator('[data-home-pane="pool"]')).toBeVisible();
}

test.beforeEach(async ({ page, request }) => {
  await request.post("/api/demo/reset", { data: { workbench: true } });
  await request.post("/api/me/persona", { data: { persona: "sriphy" } });
  await stubKol172(page);
});

test("pool is a separate entry and cards have no mail digest", async ({ page }) => {
  const sessionPosts: string[] = [];
  page.on("request", (item) => {
    if (item.method() === "POST" && new URL(item.url()).pathname.startsWith("/api/sessions")) {
      sessionPosts.push(new URL(item.url()).pathname);
    }
  });
  await page.goto("/");
  await expect(page.locator('[data-nav="pool"]')).toHaveCount(0);
  await expect(page.locator('[data-home-mode="pool"]')).toBeVisible();
  await page.locator('[data-home-mode="pool"]').click();
  await expect(page).toHaveURL(/[?&]tab=pool/);
  await expect(page.locator('[data-home-pane="pool"]')).toBeVisible();
  await expect(page.locator("[data-pool-toolbar][data-home-entry='list-pool']")).toBeVisible();
  await expect(page.locator("[data-pool-card]").first()).toBeVisible();
  await expect(page.locator("[data-pool-card]")).toHaveCount(2);
  await expect(page.locator("[data-pool-kol='uid_contacted']")).toHaveCount(0);
  await expect(page.locator("[data-pool-kol='uid_unowned']")).toHaveCount(1);
  // 无主优先：无主行排在未建联的有主行前面。
  await expect(page.locator("[data-pool-card]").first()).toHaveAttribute("data-pool-kol", "uid_unowned");
  await expect(page.locator("[data-pool-card] [data-mail-summary]")).toHaveCount(0);
  // 公海不出现邮件摘要方言。整面板断言，不依赖卡片顺序或数量。
  const poolPane = page.locator('[data-home-pane="pool"]');
  await expect(poolPane).not.toContainText("未读");
  await expect(poolPane).not.toContainText("14 日计时");
  await expect(poolPane).not.toContainText("私有");
  await expect(page.locator("[data-kol-tab]")).toHaveCount(0);
  expect(sessionPosts).toEqual([]);
});

test("empty pool sync sends an explicit command and renders the refreshed public index", async ({ page }) => {
  const syncPosts: string[] = [];
  await page.route("**/api/home/board*", (route) => route.fulfill({
    json: { kols: [], tasks: [], library: { count: 0 }, mail: {}, entries: [] },
  }));
  await page.route("**/api/home/pool", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({ json: { entry: "memory", kind: "memory", items: [], kols: [] } });
  });
  await page.route("**/api/home/pool/sync", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    syncPosts.push(new URL(route.request().url()).pathname);
    await route.fulfill({
      json: {
        entry: "command",
        kind: "command",
        creates_session: false,
        creates_turn: false,
        calls_model: false,
        ok: true,
        count: 1,
        items: [POOL_ITEM],
        kols: [POOL_ITEM],
      },
    });
  });

  await page.goto("/?tab=pool");
  await expect(page.locator("[data-pool-empty='none']")).toBeVisible();
  await page.locator("[data-pool-sync-library]").click();
  await expect.poll(() => syncPosts).toEqual(["/api/home/pool/sync"]);
  await expect(page.locator("[data-pool-kol='uid_outdoor']")).toBeVisible();
  await expect(page.locator("[data-pool-sync-library]")).toHaveCount(0);
});

test("selection prefills composer and enqueue is not from-text", async ({ page }) => {
  const posts: string[] = [];
  const livePosts: string[] = [];
  const enqueueBodies: Array<Record<string, unknown>> = [];
  page.on("request", (item) => {
    if (item.method() !== "POST") return;
    const path = new URL(item.url()).pathname;
    posts.push(path);
    if (LIVE_SIDE_EFFECT.test(path)) livePosts.push(path);
    if (path === "/api/home/kol-analyze/enqueue") {
      enqueueBodies.push(item.postDataJSON() as Record<string, unknown>);
    }
  });
  await page.goto("/?tab=pool");
  await expect(page.locator("[data-pool-card]").first()).toBeVisible();
  await page.locator("[data-pool-kol='uid_outdoor'] [data-pool-select]").check();
  await page.locator("[data-analyze-selected]").click();
  const input = page.locator("[data-home] [data-composer-input]");
  await expect(input).toHaveValue(/分析已选/);
  await input.fill(`${await input.inputValue()}\n补充：只要公开资料建议`);
  await page.locator("[data-home] [data-send]").click();
  await expect(page.locator("[data-analyze-queued]")).toContainText("已入队，等待 Codex");
  await expect(page.locator("[data-analyze-queued]")).not.toContainText("正在思考");
  expect(posts.some((path) => path === "/api/home/kol-analyze/enqueue")).toBe(true);
  expect(posts.some((path) => path === "/api/tasks/from-text")).toBe(false);
  expect(posts.some((path) => path === "/api/sessions")).toBe(false);
  expect(enqueueBodies[0]?.kol_uids).toEqual(["uid_outdoor"]);
  expect(livePosts).toEqual([]);
  await expect(page.locator("[data-running-count]")).toHaveText("1");
  await expect(page.locator('[data-nav="running"]')).toHaveAttribute("href", /tab=todo/);
  await page.locator('[data-home-mode="today"]').click();
  await expect(page.locator("[data-home] [data-composer-input]")).not.toHaveValue(/分析已选/);
});

test("pool bulk analysis is limited to the current filtered result", async ({ page }) => {
  await page.goto("/?tab=pool");
  await expect(page.locator("[data-pool-card]")).toHaveCount(2);

  // Keep an existing selection, then move to a different visible result set.
  await page.locator("[data-pool-kol='uid_outdoor'] [data-pool-select]").check();
  await page.locator("[data-pool-filter]").selectOption("overdue");
  await expect(page.locator("[data-pool-card]")).toHaveCount(1);
  await expect(page.locator("[data-pool-kol='uid_unowned']")).toBeVisible();
  await page.locator("[data-pool-select-all]").check();
  await expect(page.locator("[data-pool-selected-count]")).toHaveText("当前已选 1 / 8");

  // The hidden selection remains available when the filter is removed, but it
  // cannot slip into a batch operation launched from the current result set.
  await page.locator("[data-analyze-selected]").click();
  const input = page.locator("[data-home] [data-composer-input]");
  await expect(input).toHaveValue(/无主红人/);
  await expect(input).not.toHaveValue(/户外充电君/);

  await page.locator("[data-pool-select-all]").uncheck();
  await expect(page.locator("[data-analyze-selected]")).toBeDisabled();
});

test("follow cards stay object cards and brief prefers 拒信", async ({ page }) => {
  await page.goto("/");
  await openFollow(page);
  await expect(page.locator("[data-followed-kol-list]")).toBeVisible();
  await expect(page.locator("[data-followed-brief]")).toBeVisible();
  await expect(page.locator("[data-followed-brief]")).toHaveAttribute("data-brief-priority", "refused");
  await expect(page.locator("[data-kol-work-card]").first()).toBeVisible();
  await expect(page.locator("[data-clock-none]").first()).toContainText("尚未有效往来");
  await expect(page.locator("[data-discovery-candidate]")).toHaveCount(0);
  await page.locator("[data-followed-select]").first().check();
  await expect(page.locator("[data-analyze-selected]")).toBeEnabled();
  await page.locator("[data-analyze-selected]").click();
  await expect(page.locator("[data-home] [data-composer-input]")).toHaveValue(/分析已选/);
});

test("claim is L3 and posts confirm to /api/kols/:kolUid/claim", async ({ page }) => {
  const claims: Array<{ path: string; body: Record<string, unknown> }> = [];
  page.on("request", (item) => {
    if (item.method() !== "POST") return;
    const path = new URL(item.url()).pathname;
    if (/\/api\/kols\/.+\/claim$/.test(path)) {
      claims.push({ path, body: item.postDataJSON() as Record<string, unknown> });
    }
  });
  await page.goto("/?tab=pool");
  const compactRow = page.locator("[data-pool-kol='uid_outdoor']");
  await expect(compactRow).toBeVisible();
  const height = await compactRow.evaluate((node) => node.getBoundingClientRect().height);
  // The four structured public-information lines remain compact enough to
  // avoid reintroducing the oversized legacy object-card layout.
  expect(height).toBeGreaterThanOrEqual(112);
  expect(height).toBeLessThanOrEqual(126);
  await expect(compactRow.locator("[data-public-stage]")).toHaveCount(1);
  await expect(compactRow.locator("[data-public-stage]")).toHaveText("未首次建联");
  await expect(compactRow.locator("[data-kol-avatar='source']")).toHaveCount(1);
  await expect(compactRow).not.toContainText("公开资料");
  await expect(compactRow.locator("[data-pool-reason]")).toContainText("公海原因");
  await expect(compactRow.locator("[data-pool-reason]")).toContainText("未首次建联");
  await expect(compactRow).not.toContainText("领取后进入我的跟进");
  // 明确领取未建联的有主行：无主行排在前面，不能靠「第一张卡」取对象。
  await page.locator("[data-pool-kol='uid_outdoor'] [data-pool-claim]").click();
  const confirm = page.locator("[data-claim-follow-confirm]");
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText("不会发信，也不会改正式阶段");
  await page.locator("[data-claim-follow-yes]").click();
  await expect.poll(() => claims.length).toBe(1);
  await expect(page.locator("[data-pool-kol='uid_outdoor'] [data-pool-claim]")).toHaveText("已领取 ✓");
  await expect(page.locator("[data-pool-claim-undo]")).toContainText("已领取");
  await expect(page.locator("[data-pool-kol='uid_outdoor']")).toHaveCount(0);
  expect(claims[0].path).toBe("/api/kols/uid_outdoor/claim");
  expect(claims[0].body.confirm === true || claims[0].body.confirmed === true).toBe(true);
});

test("claim undo restores the compact row through the existing release command", async ({ page }) => {
  const releases: string[] = [];
  page.on("request", (item) => {
    if (item.method() === "POST" && /\/api\/follows\/.+\/release$/.test(new URL(item.url()).pathname)) {
      releases.push(new URL(item.url()).pathname);
    }
  });
  await page.goto("/?tab=pool");
  await page.locator("[data-pool-kol='uid_outdoor'] [data-pool-claim]").click();
  await page.locator("[data-claim-follow-yes]").click();
  await expect(page.locator("[data-pool-claim-undo]")).toBeVisible();
  await page.locator("[data-pool-claim-undo-button]").click();
  await expect.poll(() => releases.length).toBe(1);
  await expect(page.locator("[data-pool-claim-undo]")).toHaveCount(0);
  await expect(page.locator("[data-pool-kol='uid_outdoor'] [data-pool-claim]")).toHaveText("领取跟进");
  expect(releases[0]).toBe("/api/follows/kfi_claimed/release");
});

test("release is L3 and does not change stage", async ({ page }) => {
  const releases: Array<{ path: string; body: Record<string, unknown> }> = [];
  page.on("request", (item) => {
    if (item.method() !== "POST") return;
    const path = new URL(item.url()).pathname;
    if (/\/api\/follows\/.+\/release$/.test(path)) {
      releases.push({ path, body: item.postDataJSON() as Record<string, unknown> });
    }
  });
  await page.goto("/");
  await openFollow(page);
  await page.locator("[data-release-follow]").first().click();
  const confirm = page.locator("[data-release-follow-confirm]");
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText("不会改正式阶段");
  await expect(confirm).toContainText("回公海 ≠ 改阶段");
  await page.locator("[data-release-follow-yes]").click();
  await expect.poll(() => releases.length).toBe(1);
  expect(releases[0].path).toMatch(/^\/api\/follows\/kfi_(refused|near)\/release$/);
  expect(releases[0].body.confirm === true || releases[0].body.confirmed === true).toBe(true);
});

test("tab switch does not create sessions", async ({ page }) => {
  const sessionPosts: string[] = [];
  page.on("request", (item) => {
    if (item.method() === "POST" && new URL(item.url()).pathname.startsWith("/api/sessions")) {
      sessionPosts.push(new URL(item.url()).pathname);
    }
  });
  await page.goto("/");
  await openFollow(page);
  await openPool(page);
  await page.locator('[data-home-mode="today"]').click();
  expect(sessionPosts).toEqual([]);
});
