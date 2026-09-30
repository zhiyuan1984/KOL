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

/** 管理端知识库已发布的四个问题模板；前端只预填，不得写死问题文案。 */
const QUESTION_TEMPLATES = [
  { slot: "potential", knowledge_id: "kb_q_pool_potential", published_version: 1, title: "公海 · 高潜KOL分析提问模板", body: "请基于公开资料分析这些 KOL 的合作潜力，逐条说明判断依据与资料缺口。", placeholders: [], starter: "公海 · 高潜KOL分析提问模板" },
  { slot: "risk", knowledge_id: "kb_q_pool_risk", published_version: 1, title: "公海 · 高风险KOL分析提问模板", body: "请基于公开资料分析这些 KOL 的合作风险，逐条说明判断依据与资料缺口。", placeholders: [], starter: "公海 · 高风险KOL分析提问模板" },
  { slot: "completeness", knowledge_id: "kb_q_pool_completeness", published_version: 1, title: "公海 · 资料完整度检查提问模板", body: "请检查这些 KOL 的公开资料完整度，列出待补充项与补齐来源。", placeholders: [], starter: "公海 · 资料完整度检查提问模板" },
  { slot: "score", knowledge_id: "kb_q_pool_score", published_version: 1, title: "公海 · KOL评分提问模板", body: "请对这些 KOL 的公开资料做潜力/风险评分，说明口径、依据与置信度。", placeholders: [], starter: "公海 · KOL评分提问模板" },
];

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
  await page.route("**/api/knowledge/question-templates", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({ json: QUESTION_TEMPLATES });
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
  await expect(page.locator("[data-pool-focus-list]")).toBeVisible();
  await expect(page.locator('[data-home-pane="pool"] [data-scope-ai-workspace]')).toBeVisible();
  await expect(page.locator('[data-home-pane="pool"] [data-scope-task-rail]')).toBeVisible();
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

test("public pool keeps the most complete public row when legacy identities overlap", async ({ page }) => {
  await page.route("**/api/home/pool", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      json: {
        entry: "memory", kind: "memory", items: [
          { ...POOL_ITEM, id: "legacy_1", kol_uid: "uid_legacy", homepage_url: "https://youtube.com/@same", followers: "" },
          { ...POOL_ITEM, id: "live_1", kol_uid: "uid_live", homepage_url: "https://youtube.com/@same", followers: "400000", direction: "Vanlife" },
        ],
      },
    });
  });
  await page.goto("/?tab=pool");
  await expect(page.locator("[data-pool-card]")).toHaveCount(1);
  await expect(page.locator("[data-pool-card]")).toContainText("40万");
});

test("public pool restores the central interaction and uses a structured right result rail", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?tab=pool");
  const workspace = page.locator('[data-home-pane="pool"]');
  const center = workspace.locator("[data-scope-ai-workspace]");
  const rail = workspace.locator("[data-scope-task-rail]");
  const list = workspace.locator("[data-pool-focus-list]");
  const row = workspace.locator("[data-pool-card]").first();
  await expect(center).toBeVisible();
  await expect(center).toContainText("公海现有KOL共2位供你选择");
  await expect(center.locator("[data-pool-analysis-actions]")).toBeVisible();
  await expect(center.locator("[data-pool-analysis]")).toHaveCount(3);
  await expect(center.locator("[data-pool-jev-assess]")).toHaveText("KOL评分");
  await expect(center.locator("[data-pool-analysis-actions]")).toHaveCSS("border-bottom-width", "0px");
  await expect(center.locator("[data-pool-analysis='potential']")).toHaveCSS("text-decoration-line", "underline");
  await expect(center.locator("[data-composer-input]")).toBeVisible();
  await expect(rail).toBeVisible();
  await expect(rail.locator("[data-pool-toolbar]")).toBeVisible();
  await expect(rail.locator("[data-pool-filter='new']")).toHaveText("未首次建联");
  await expect(rail.locator("[data-pool-filter='overdue']")).toHaveText("14天未联系");
  await expect(rail.locator("[data-pool-sort='ingested']")).toBeVisible();
  await expect(rail.locator("[data-pool-sort='followers']")).toBeVisible();
  await expect(rail.locator("[data-pool-sort='score']")).toBeVisible();
  await expect(rail.locator("[data-pool-sort='score']")).toHaveAttribute("data-sort-direction", "desc");
  await rail.locator("[data-pool-sort='followers']").click();
  await expect(rail.locator("[data-pool-sort='followers']")).toHaveAttribute("data-sort-direction", "desc");
  await rail.locator("[data-pool-sort='followers']").click();
  await expect(rail.locator("[data-pool-sort='followers']")).toHaveAttribute("data-sort-direction", "asc");
  await expect(rail).not.toContainText("资料维护");
  const toolRows = await rail.locator("[data-pool-toolbar]").evaluate((toolbar) => {
    const box = (selector: string) => (toolbar.querySelector(selector) as HTMLElement)?.getBoundingClientRect();
    const search = box("[data-pool-search]");
    const selectAll = box("[data-pool-select-all]");
    const firstFilter = box("[data-pool-filter='new']");
    const secondFilter = box("[data-pool-filter='overdue']");
    const firstSort = box("[data-pool-sort='ingested']");
    if (!search || !selectAll || !firstFilter || !secondFilter || !firstSort) throw new Error("public-pool tools are incomplete");
    const middle = (rect: DOMRect) => rect.y + rect.height / 2;
    return {
      search: middle(search), selectAll: middle(selectAll), firstFilter: middle(firstFilter), secondFilter: middle(secondFilter), firstSort: middle(firstSort),
    };
  });
  expect(toolRows.search).toBe(toolRows.selectAll);
  expect(toolRows.search).toBe(toolRows.firstFilter);
  expect(toolRows.search).toBe(toolRows.secondFilter);
  expect(toolRows.firstSort).toBeGreaterThan(toolRows.search);
  await expect(list).toBeVisible();
  await expect(row).toBeVisible();
  const centerBox = await center.boundingBox();
  const railBox = await rail.boundingBox();
  expect(railBox?.x).toBeGreaterThanOrEqual((centerBox?.x || 0) + (centerBox?.width || 0));
  expect((await list.boundingBox())?.width).toBeGreaterThanOrEqual(360);
  expect((await list.boundingBox())?.width).toBeLessThanOrEqual(820);
  expect((await row.boundingBox())?.width).toBeLessThanOrEqual((railBox?.width || Number.POSITIVE_INFINITY) + 1);
  await expect(workspace.locator("[data-pool-overview]")).not.toContainText("公开对象池");
  await expect(workspace.locator("[data-pool-reason]")).toHaveCount(0);
  await expect(row.locator(".pool-profile-link")).toHaveText("主页");
  const searchBox = await workspace.locator("[data-pool-search]").boundingBox();
  // 宽度是缩短版（~96px）的 2 倍；高度必须仍是控件档 28px。
  expect(searchBox?.width).toBeGreaterThanOrEqual(176);
  // 评分是 KOL 记忆里的事实：有评分「评分 N」、无评分「未评分」；卡片上没有评分动作入口。
  const scoredRow = page.locator("[data-pool-kol='uid_outdoor']");
  await expect(scoredRow.locator(".pool-row-meta .pool-profile-link + [data-pool-score='missing']")).toHaveCount(1);
  await expect(page.locator("[data-pool-score-kol]")).toHaveCount(0);
  expect((await workspace.locator("[data-pool-search]").boundingBox())?.height).toBe(28);
  expect((await workspace.locator("[data-pool-kol='uid_outdoor'] [data-pool-claim]").boundingBox())?.height).toBe(28);
});

test("scoring confirm bar states which criteria the score will use", async ({ page }) => {
  await page.goto("/?tab=pool");
  await page.locator("[data-pool-kol='uid_outdoor'] [data-pool-select]").check();
  await page.locator("[data-pool-jev-assess]").click();
  const confirm = page.locator("[data-pool-score-confirm]");
  await expect(confirm).toBeVisible();
  // 没设过 AI 发现条件时不得声称用了条件；设过时必须说明口径。
  await expect(confirm).toContainText("评分口径：");
  await expect(confirm).toContainText(/未设置 AI 发现条件|当前 AI 发现条件/);
  await expect(confirm).toContainText("已选 1 位");
});

test("pool cards say why a KOL is unscored", async ({ page }) => {
  const card = (uid: string, extra: Record<string, unknown> = {}) => ({
    ...POOL_ITEM,
    id: `kpi_${uid}`,
    kol_uid: uid,
    handle: uid,
    display_name: `@${uid}`,
    homepage_url: `https://www.youtube.com/@${uid}`,
    ...extra,
  });
  await page.route("**/api/home/pool", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      json: {
        entry: "memory",
        kind: "memory",
        library: { ok: true, count: 4 },
        items: [
          card("uid_low", {
            assessed_at: "2026-09-27T00:00:00Z",
            potential_score: null,
            potential_confidence: 0.55,
            assessment_state: "low_confidence",
            assessment_criteria: "平台 youtube · 地区 global_en · 近10条均播 ≥5000",
          }),
          card("uid_failed", { assessed_at: "2026-09-27T00:00:00Z", potential_score: null, assessment_state: "failed" }),
          card("uid_thin", { followers: "", avg_plays: "", engagement: "", direction: "" }),
          card("uid_fresh"),
        ],
      },
    });
  });

  await page.goto("/?tab=pool");
  // 评过但置信度不足：说清置信度，并解释低于 70% 不给分。
  const low = page.locator("[data-pool-kol='uid_low'] [data-pool-score='missing']");
  await expect(low).toHaveText("已评估 · 置信度 55%");
  await expect(low).toHaveAttribute("data-pool-score-state", "low_confidence");
  await expect(low).toHaveAttribute("title", /低于 70%/);
  // 口径随卡片可见：同一批对象在不同 AI 发现条件下的分不可比。
  await expect(low).toHaveAttribute("title", /口径 平台 youtube/);
  // 调用失败：不伪装成「未评分」。
  const failed = page.locator("[data-pool-kol='uid_failed'] [data-pool-score='missing']");
  await expect(failed).toHaveText("评分失败");
  await expect(failed).toHaveAttribute("data-pool-score-state", "failed");
  // 从未评过 + 缺公开指标：点名缺了哪几项。
  const thin = page.locator("[data-pool-kol='uid_thin'] [data-pool-score='missing']");
  await expect(thin).toHaveText("未评分");
  await expect(thin).toHaveAttribute("data-pool-score-state", "unscored");
  await expect(thin).toHaveAttribute("title", /缺 粉丝数、均播、互动率、内容方向/);
  // 从未评过但资料齐：只提示可以执行评分。
  const fresh = page.locator("[data-pool-kol='uid_fresh'] [data-pool-score='missing']");
  await expect(fresh).toHaveText("未评分");
  await expect(fresh).toHaveAttribute("title", /可用中栏「KOL评分」执行/);
});

test("pool first paint reads only what the pool needs", async ({ page }) => {
  const reads: Array<{ path: string; t: number }> = [];
  const started = Date.now();
  page.on("request", (item) => {
    if (item.method() !== "GET") return;
    const url = new URL(item.url());
    if (!url.pathname.startsWith("/api/")) return;
    reads.push({ path: url.pathname + url.search, t: Date.now() - started });
  });

  await page.goto("/?tab=pool");
  await expect(page.locator("[data-pool-search]")).toBeVisible();
  await expect(page.locator("[data-pool-card]").first()).toBeVisible();
  await page.waitForTimeout(700);

  const pool = reads.find((row) => row.path === "/api/home/pool");
  expect(pool, "公海面必须自己发公海读").toBeTruthy();
  expect(reads.some((row) => row.path === "/api/knowledge/question-templates"), "四个入口的模板可用性要读").toBe(true);

  // 与公海首屏无关、且按 tab/交互才该发生的读：公海首屏一条都不该出现。
  for (const never of [
    "/api/home/today-brief",
    "/api/home/todo-brief",
    "/api/home/today-tasks",
    "/api/home/todo-tasks",
    "/api/tasks?view=open",
    "/api/skills",
    "/api/skills/market",
    "/api/knowledge",
    "/api/knowledge/market",
    "/api/knowledge/composer",
    "/api/knowledge/skill-templates",
    "/api/projects",
    "/api/files/recent",
  ]) {
    expect(reads.some((row) => row.path === never), `${never} 不该在公海首屏发出`).toBe(false);
  }

  // 壳读（侧栏 badge / 任务目录 / 任务定义）允许发生，但必须让位到公海读之后。
  const poolAt = pool?.t ?? 0;
  const before = reads.filter((row) => row.t < poolAt + 80).map((row) => row.path);
  // board 是壳级预热（我的红人对账 / 今日待办推荐的共享来源）：允许发生，但必须让位首屏。
  for (const shell of ["/api/home/board", "/api/tasks", "/api/task-definitions", "/api/sessions", "/api/mail/box", "/api/cron/jobs", "/api/approvals/badge", "/api/version"]) {
    expect(before.includes(shell), `${shell} 应让位首屏`).toBe(false);
  }
});
test("empty pool sync sends an explicit command and renders the refreshed public index", async ({ page }) => {
  const syncPosts: string[] = [];
  await page.route("**/api/home/pool", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({ json: { entry: "memory", kind: "memory", items: [], kols: [], library: { ok: false, count: 0 } } });
  });
  await page.route("**/api/home/pool/sync", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        json: {
          entry: "command",
          kind: "command",
          status: "succeeded",
          ok: true,
          count: 1,
          missing_metrics: 1,
          message: "已同步 1 个红人档案；其中 1 条缺公开指标（粉丝/均播/互动/方向），Jev 评分会判为资料不足",
          items: [POOL_ITEM],
          kols: [POOL_ITEM],
        },
      });
      return;
    }
    if (route.request().method() !== "POST") return route.fallback();
    syncPosts.push(new URL(route.request().url()).pathname);
    await route.fulfill({
      status: 202,
      json: {
        entry: "command",
        kind: "command",
        creates_session: false,
        creates_turn: false,
        calls_model: false,
        accepted: true,
        started: true,
        status: "running",
      },
    });
  });

  await page.goto("/?tab=pool");
  await expect(page.locator("[data-pool-empty='none']")).toBeVisible();
  await page.locator("[data-pool-sync-library]").click();
  await expect.poll(() => syncPosts).toEqual(["/api/home/pool/sync"]);
  await expect(page.locator("[data-pool-kol='uid_outdoor']")).toBeVisible();
  await expect(page.locator("[data-pool-sync-library]")).toHaveCount(0);
  // 同步回执要如实带体检结果，而不是只说「已同步 N 条」。
  await expect(page.locator("[data-pool-sync-notice]")).toContainText("缺公开指标");
});

test("pool reading state does not claim the library is unsynced before the reads return", async ({ page }) => {
  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  await page.route("**/api/home/pool", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await delay(1500);
    await route.fulfill({ json: { entry: "memory", kind: "memory", items: [], kols: [], library: { ok: false, count: 0 } } });
  });

  await page.goto("/?tab=pool");
  const pane = page.locator('[data-home-pane="pool"]');
  // 读取期间是真实等待态：有原因，但没有结论，也没有同步 CTA。
  await expect(pane.locator("[data-pool-empty='loading']")).toBeVisible();
  await expect(pane).not.toContainText("红人库还没有同步");
  await expect(pane.locator("[data-pool-sync-library]")).toHaveCount(0);
  // 读到「公海 0 条 + 库 0 条」之后，才给出「尚未同步」与可执行的同步入口。
  await expect(pane.locator("[data-pool-sync-library]")).toBeVisible();
  await expect(pane).toContainText("红人库还没有同步");
});

test("pool rows render without waiting for the board read", async ({ page }) => {
  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  await page.route("**/api/home/board*", async (route) => {
    await delay(4000);
    await route.fulfill({ json: { kols: [], tasks: [], library: { count: 9 }, mail: {}, entries: [] } });
  });
  await page.route("**/api/home/pool", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({ json: { entry: "memory", kind: "memory", items: [POOL_ITEM], kols: [POOL_ITEM] } });
  });

  await page.goto("/?tab=pool");
  // board 仍在飞行时，公海对象卡已经出现（读取路径不依赖 board）。
  await expect(page.locator("[data-pool-kol='uid_outdoor']")).toBeVisible({ timeout: 3000 });
});

test("pool KOL scoring uses the existing Jev endpoint and refreshes public signals", async ({ page }) => {
  const posts: Array<{ path: string; body?: Record<string, unknown> }> = [];
  const enriched = { ...POOL_ITEM, avatar_url: "https://yt3.ggpht.com/enriched-avatar.jpg" };
  const assessed = { ...enriched, potential_score: 85, potential_confidence: 0.91, risk_score: 85, risk_confidence: 0.83, assessment_model: "jev-1.13" };
  await page.route("**/api/home/pool/avatar-enrich", async (route) => {
    if (route.request().method() === "POST") {
      posts.push({ path: new URL(route.request().url()).pathname });
      await route.fulfill({ status: 202, json: { status: "running", accepted: true } });
      return;
    }
    await route.fulfill({ json: { status: "succeeded", ok: true, message: "已检查 1 条公开主页，补全 1 个头像。", items: [assessed] } });
  });
  await page.route("**/api/home/pool/jev-assess", async (route) => {
    if (route.request().method() === "POST") {
      posts.push({ path: new URL(route.request().url()).pathname });
      await route.fulfill({ status: 202, json: { status: "running", accepted: true } });
      return;
    }
    await route.fulfill({ json: { status: "succeeded", ok: true, message: "已评估 1 条：高潜 1，高风险 1。", items: [assessed] } });
  });
  await page.route("**/api/home/pool/cleanup-preview", async (route) => {
    await route.fulfill({ json: { scope: "public_pool_only", candidate_count: 2, protected_active_follows: 1 } });
  });
  await page.route("**/api/home/pool/cleanup-missing-homepage", async (route) => {
    posts.push({ path: new URL(route.request().url()).pathname, body: route.request().postDataJSON() as Record<string, unknown> });
    await route.fulfill({ json: { ok: true, deleted: 2, items: [assessed] } });
  });

  await page.goto("/?tab=pool");
  await page.locator("[data-pool-jev-assess]").click();
  // 点击只预填知识库评分模板；不得跳过员工确认直接调用评分接口。
  const input = page.locator("[data-home] [data-composer-input]");
  await expect(input).toHaveValue(/评分/);
  expect(posts.map((item) => item.path)).not.toContain("/api/home/pool/jev-assess");
  await expect(page.locator("[data-pool-score-confirm]")).toBeVisible();
  await page.locator("[data-pool-score-execute]").click();
  await expect.poll(() => posts.map((item) => item.path)).toContain("/api/home/pool/jev-assess");
  await expect(page.locator("[data-pool-kol='uid_outdoor'] [data-jev-potential]")).toHaveText("高潜 85");
  await expect(page.locator("[data-pool-kol='uid_outdoor'] [data-jev-risk]")).toHaveText("高风险 85");
  // 评分显示落在「主页 + 外链图标」之后，而不是只在名称旁。
  await expect(page.locator("[data-pool-kol='uid_outdoor'] .pool-profile-link + [data-pool-score='potential']")).toHaveText("评分 85");
  await expect(page.locator("[data-home-pane='pool']")).not.toContainText("补头像");
  await expect(page.locator("[data-home-pane='pool']")).not.toContainText("清理无主页");
});

test("selection prefills composer, enqueue is not from-text, and submit starts the run", async ({ page }) => {
  const runBodies: Array<Record<string, unknown>> = [];
  const askBodies: Array<Record<string, unknown>> = [];
  await page.route("**/api/tasks/tsk_analyze_1/run", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = route.request().postDataJSON() as { text?: string };
    const pending = {
      act: "ask",
      text: String(body.text || "分析已选"),
      intent: "kol_analyze",
      work_item_id: "tsk_analyze_1",
      task_type: "kol_analyze",
      run_id: "run_analyze_1",
    };
    await route.fulfill({
      status: 202,
      json: {
        work_item_id: "tsk_analyze_1",
        run_id: "run_analyze_1",
        session_id: "ses_analyze_1",
        status: "pending",
        task: { id: "tsk_analyze_1", title: "分析已选", status: "pending", task_type: "kol_analyze" },
        run: { id: "run_analyze_1" },
        pending,
        pending_message: pending,
      },
    });
  });
  await page.route("**/api/tasks/tsk_analyze_1", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({ json: { id: "tsk_analyze_1", title: "分析已选", status: "pending", task_type: "kol_analyze" } });
  });
  await page.route("**/api/tasks/tsk_analyze_1/events", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({ json: [] });
  });
  await page.route("**/api/tasks/by-session/ses_analyze_1", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({ json: { task: { id: "tsk_analyze_1", title: "分析已选", status: "pending", task_type: "kol_analyze" } } });
  });
  await page.route("**/api/sessions/ses_analyze_1/messages", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await route.fulfill({ json: { accepted: true, agent_status: "running", messages: [] } });
  });
  await page.route("**/api/sessions/ses_analyze_1", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({ json: { agent_status: "running", messages: [], collaboration_id: null, journey: null, run_queue: [] } });
  });
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
    if (path === "/api/tasks/tsk_analyze_1/run") {
      runBodies.push(item.postDataJSON() as Record<string, unknown>);
    }
    if (path === "/api/sessions/ses_analyze_1/messages") {
      askBodies.push(item.postDataJSON() as Record<string, unknown>);
    }
  });
  await page.goto("/?tab=pool");
  await expect(page.locator("[data-pool-card]").first()).toBeVisible();
  await page.locator("[data-pool-kol='uid_outdoor'] [data-pool-select]").check();
  const input = page.locator("[data-home] [data-composer-input]");
  await expect(input).toHaveValue(/分析已选/);
  await expect(input).toHaveValue(/户外充电君/);
  await page.locator("[data-pool-kol='uid_unowned'] [data-pool-select]").check();
  await expect(input).toHaveValue(/户外充电君/);
  await expect(input).toHaveValue(/无主红人/);
  await page.locator("[data-pool-kol='uid_unowned'] [data-pool-select]").uncheck();
  await expect(input).not.toHaveValue(/无主红人/);
  await page.locator("[data-pool-analysis='potential']").click();
  await expect(input).toHaveValue(/合作潜力/);
  await input.fill(`${await input.inputValue()}\n补充：只要公开资料建议`);
  await page.locator("[data-home] [data-send]").click();
  await expect(page).toHaveURL(/\/s\/ses_analyze_1/);
  await expect(page.locator("[data-session-stream-pane]")).toBeVisible();
  await expect.poll(() => runBodies.length).toBe(1);
  await expect.poll(() => askBodies.length).toBe(1);
  expect(String(runBodies[0]?.text || "")).toContain("合作潜力");
  expect(askBodies[0]?.task_type).toBe("kol_analyze");
  expect(String(askBodies[0]?.text || "")).toContain("合作潜力");
  expect(posts.some((path) => path === "/api/home/kol-analyze/enqueue")).toBe(true);
  expect(posts.some((path) => path === "/api/tasks/from-text")).toBe(false);
  expect(posts.some((path) => path === "/api/sessions")).toBe(false);
  expect(enqueueBodies[0]?.kol_uids).toEqual(["uid_outdoor"]);
  expect(livePosts).toEqual([]);
  await page.goto("/?tab=pool");
  await page.locator("[data-pool-kol='uid_outdoor'] [data-pool-select]").check();
  await page.locator("[data-pool-analysis='potential']").click();
  await expect(page.locator("[data-home] [data-composer-input]")).toHaveValue(/合作潜力/);
  await page.locator('[data-home-mode="today"]').click();
  await expect(page.locator("[data-home] [data-composer-input]")).not.toHaveValue(/分析已选/);
});

test("pool bulk analysis is limited to the current filtered result", async ({ page }) => {
  await page.goto("/?tab=pool");
  await expect(page.locator("[data-pool-card]")).toHaveCount(2);

  // Keep an existing selection, then move to a different visible result set.
  await page.locator("[data-pool-kol='uid_outdoor'] [data-pool-select]").check();
  await page.locator("[data-pool-filter='overdue']").click();
  await expect(page.locator("[data-pool-card]")).toHaveCount(1);
  await expect(page.locator("[data-pool-kol='uid_unowned']")).toBeVisible();
  await page.locator("[data-pool-select-all]").check();

  // The composer always reflects every selected object, including a selection
  // that is currently outside the filtered result set.
  const input = page.locator("[data-home] [data-composer-input]");
  await expect(input).toHaveValue(/无主红人/);
  await expect(input).toHaveValue(/户外充电君/);

  await page.locator("[data-pool-select-all]").uncheck();
  await expect(input).toHaveValue(/户外充电君/);
  await expect(page.locator("[data-pool-analysis='risk']")).toBeEnabled();
});

test("follow cards stay object cards and brief prefers 拒信", async ({ page }) => {
  await page.goto("/");
  await openFollow(page);
  await expect(page.locator("[data-followed-kol-list]")).toBeVisible();
  await expect(page.locator('button[data-followed-situation="refused"]')).toContainText("核对已拒绝的 1 位对象");
  await expect(page.locator('[data-followed-stage-group="connect"]')).toBeVisible();
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
  // Public identity, state, evidence and context stay in a compact scan row.
  expect(height).toBeGreaterThanOrEqual(96);
  expect(height).toBeLessThanOrEqual(112);
  await expect(compactRow.locator("[data-public-stage]")).toHaveCount(1);
  await expect(compactRow.locator("[data-public-stage]")).toHaveText("未首次建联");
  const nameBox = await compactRow.locator("[data-kol-name]").boundingBox();
  const stageBox = await compactRow.locator("[data-public-stage]").boundingBox();
  expect((stageBox?.x || 0) - ((nameBox?.x || 0) + (nameBox?.width || 0))).toBeLessThanOrEqual(12);
  await expect(compactRow.locator("[data-kol-avatar='source']")).toHaveCount(1);
  expect((await compactRow.locator("[data-kol-avatar='source']").boundingBox())?.width).toBe(56);
  await expect(compactRow).not.toContainText("公开资料");
  await expect(compactRow.locator("[data-pool-reason]")).toHaveCount(0);
  await expect(compactRow.locator(".pool-profile-link")).toHaveText("主页");
  await expect(compactRow).not.toContainText("领取后进入我的跟进");
  // 明确领取未建联的有主行：无主行排在前面，不能靠「第一张卡」取对象。
  await page.locator("[data-pool-kol='uid_outdoor'] [data-pool-claim]").click();
  const confirm = page.locator("[data-claim-follow-confirm]");
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText("不发信，不改阶段");
  await expect(confirm.locator("[data-claim-follow-yes]")).toHaveText("确认");
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
