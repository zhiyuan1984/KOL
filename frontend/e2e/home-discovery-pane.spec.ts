import { test, expect, type Page } from "@playwright/test";

const LIVE_SIDE_EFFECT = /\/(send|confirm-stage|start-crawl|crawl-job|actions\/start-crawl)(?:\?|$)/;
const BANNED_FOLLOW = /加入跟进|\+\s*跟进|按所选加入跟进/;

async function openDiscovery(page: Page) {
  await page.goto("/?tab=discovery");
  await expect(page.locator('[data-home-pane="discovery"]')).toBeVisible();
}

function stubCandidates() {
  return [
    {
      id: "cand_solar",
      handle: "TheSolarLab",
      nickname: "Solar Lab",
      platform: "youtube",
      followers: 153000,
      avg_plays_10: 8597,
      why: "匹配美妆评测方向",
      band: "A",
      source_url: "https://youtube.com/@TheSolarLab",
      in_library: false,
      status: "suggested",
    },
    {
      id: "cand_zero",
      handle: "NoStats",
      nickname: "",
      platform: "instagram",
      followers: 0,
      avg_plays_10: 0,
      why: "",
      band: "",
      source_url: "",
      in_library: true,
      status: "suggested",
    },
  ];
}

test.beforeEach(async ({ request }) => {
  await request.post("/api/demo/reset", { data: { workbench: true } });
  await request.post("/api/me/persona", { data: { persona: "sriphy" } });
});

test("tab switch only GETs discovery batches and does not create a session", async ({ page }) => {
  const posts: string[] = [];
  const gets: string[] = [];
  page.on("request", (item) => {
    const path = new URL(item.url()).pathname;
    if (item.method() === "POST") posts.push(path);
    if (item.method() === "GET" && path.startsWith("/api/home/discovery")) gets.push(path);
  });
  await page.goto("/");
  await page.locator('[data-home-mode="discovery"]').click();
  await expect(page.locator("[data-discovery-empty='idle']")).toBeVisible();
  await expect(page.locator("[data-discovery-start]")).toHaveText("开始发现");
  await expect(page.locator("[data-discovery-panel]")).toContainText("尚未搜索");
  await expect(page.locator("[data-discovery-panel]")).not.toContainText(BANNED_FOLLOW);
  expect(posts.filter((path) => path === "/api/sessions" || path.includes("/run") || path.endsWith("/from-text"))).toEqual([]);
  expect(gets.some((path) => path.includes("/api/home/discovery/batches"))).toBeTruthy();
});

test("开始发现 prefills Composer without a session and + menu is not connectors admin", async ({ page }) => {
  const posts: string[] = [];
  page.on("request", (item) => {
    if (item.method() === "POST") posts.push(new URL(item.url()).pathname);
  });
  await openDiscovery(page);
  await page.locator("[data-discovery-start]").click();
  const input = page.locator("[data-home] [data-composer-input]");
  await expect(input).toHaveValue(/【发现任务】/);
  await expect(input).toHaveValue(/不会发信/);
  await expect(input).toHaveValue(/不会改阶段/);
  await expect(input).toHaveValue(/不会编造邮箱/);
  await expect(page.locator("[data-home] [data-discovery-lock-chip]")).toContainText("发现任务");
  await expect(page.locator('[data-home] [data-discovery-filter="platform"] [data-discovery-chip="youtube"]')).toBeVisible();
  await expect(page.locator('[data-home] [data-discovery-filter="platform"] [data-discovery-chip="tiktok"]')).toHaveCount(0);
  await expect(page.locator('[data-home] [data-discovery-filter="platform"] [data-discovery-chip="douyin"]')).toHaveCount(0);
  await expect(page.locator('[data-home] [data-discovery-filter="region"] [data-discovery-chip="na"]')).toHaveText("北美");
  await expect(page.locator('[data-home] [data-discovery-filter="region"] [data-discovery-chip="jpkr"]')).toHaveText("日韩");
  await expect(page.locator("[data-nav='new-task']")).toHaveAttribute("href", "/");
  expect(posts.filter((path) => path === "/api/sessions" || path.endsWith("/from-text"))).toEqual([]);

  await page.locator("[data-home] [data-attach]").click();
  const menu = page.getByRole("menu", { name: "添加内容" });
  await expect(menu.getByRole("menuitem", { name: "发现任务" })).toBeVisible();
  await expect(menu).not.toContainText("/admin/connectors");
  await expect(menu).not.toContainText("连接器治理");
});

test("chips override the body and missing platform/keywords disable send", async ({ page }) => {
  await openDiscovery(page);
  await page.locator("[data-discovery-start]").click();
  await page.locator('[data-home] [data-discovery-filter="platform"] [data-discovery-chip="instagram"]').click();
  await expect(page.locator("[data-home] [data-composer-input]")).toHaveValue(/Instagram/);
  await expect(page.locator("[data-discovery-override-hint]")).toBeVisible();
  await expect(page.locator("[data-discovery-override-hint]")).toHaveText("已用芯片覆盖");

  await page.locator('[data-home] [data-discovery-chip="youtube"] .chip-x').first().click();
  await page.locator('[data-home] [data-discovery-chip="instagram"] .chip-x').first().click();
  await expect(page.locator("[data-home] [data-send]")).toBeDisabled();
});

test("submit posts /api/home/discovery/run, shows process copy, and ingests to pool", async ({ page }) => {
  const livePosts: string[] = [];
  const runPosts: string[] = [];
  const followPosts: string[] = [];
  let eventTick = 0;
  page.on("request", (item) => {
    if (item.method() !== "POST") return;
    const path = new URL(item.url()).pathname;
    if (LIVE_SIDE_EFFECT.test(path)) livePosts.push(path);
    if (path === "/api/home/discovery/run") runPosts.push(path);
    if (path.includes("/follow")) followPosts.push(path);
  });

  await page.route("**/api/home/discovery/batches", (route) => route.fulfill({
    json: {
      batches: [{
        id: "bat_e2e",
        headline: "北美美妆 YouTube",
        raw_count: 40,
        shortlist_count: 2,
        status: "succeeded",
        task_id: "tsk_disc_e2e",
      }],
    },
  }));
  await page.route("**/api/home/discovery/candidates**", (route) => route.fulfill({
    json: { candidates: stubCandidates() },
  }));
  await page.route("**/api/home/discovery/run", (route) => route.fulfill({
    json: { task_id: "tsk_disc_e2e", session_id: "ses_disc_e2e", batch_id: "bat_e2e", agent_status: "running" },
  }));
  await page.route("**/api/home/discovery/ingest", (route) => route.fulfill({
    json: { ingested: [{ id: "cand_solar" }], failed: [], pending_approval: false },
  }));
  await page.route("**/api/tasks/tsk_disc_e2e/events", (route) => {
    eventTick += 1;
    const events = eventTick < 2
      ? [
          { type: "queued" },
          { type: "search_started" },
          { type: "received", count: 40 },
        ]
      : [
          { type: "queued" },
          { type: "search_started" },
          { type: "received", count: 40 },
          { type: "deduped", count: 28 },
          { type: "scoring" },
          { type: "ranked" },
        ];
    void route.fulfill({ json: { events } });
  });
  await page.route("**/api/sessions", (route) => {
    if (route.request().method() === "GET") {
      void route.fulfill({
        json: [{ id: "ses_disc_e2e", title: "发现任务", agent_status: "running" }],
      });
      return;
    }
    void route.continue();
  });

  await openDiscovery(page);
  await page.locator("[data-discovery-start]").click();
  await page.locator("[data-home] [data-send]").click();
  await expect.poll(() => runPosts).toEqual(["/api/home/discovery/run"]);
  await expect(page.locator("[data-discovery-process]")).toContainText("排队");
  await expect(page.locator("[data-discovery-process]")).toContainText("开始搜索关键词");
  await expect(page.locator("[data-discovery-process]")).toContainText("已收到 40 条");
  await expect(page.locator("[data-discovery-headline]")).toContainText("北美美妆 YouTube");
  await expect(page.locator("[data-discovery-counts]")).toHaveText("原始 40 · 入围 2");

  const solar = page.locator('[data-discovery-candidate="TheSolarLab"]');
  await expect(solar.locator("[data-discovery-candidate-identity]")).toContainText("Solar Lab");
  await expect(solar.locator("[data-discovery-candidate-identity]")).toContainText("YouTube");
  await expect(solar.locator("[data-discovery-candidate-meta]")).toContainText("粉丝 153k");
  await expect(solar.locator("[data-discovery-source]")).toHaveText("看来源");
  await expect(solar.locator("[data-discovery-ignore]")).toHaveText("忽略");

  const missing = page.locator('[data-discovery-candidate="NoStats"]');
  await expect(missing).toContainText("粉丝 无");
  await expect(missing).toContainText("均播 无");
  await expect(missing).toContainText("匹配：无");
  await expect(missing.locator("[data-discovery-in-library]")).toHaveText("已在库");

  await expect(page.locator("[data-discovery-panel]")).not.toContainText(BANNED_FOLLOW);
  await expect(page.locator("[data-discovery-panel]")).not.toContainText("发送邮件");
  await expect(page.locator("[data-coach-next], [data-next-step-card]")).toHaveCount(0);

  await page.locator("[data-discovery-select-all]").check();
  const ingest = page.locator("[data-discovery-ingest]");
  await expect(ingest).toHaveText("入库公海（2）");
  await expect(page.locator("[data-discovery-panel] .btn.work")).toHaveCount(1);
  await ingest.click();
  const confirm = page.locator("[data-discovery-ingest-confirm]");
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText("写入 Starry 并进入公海");
  await expect(confirm).toContainText("不会建联");
  await expect(confirm).toContainText("不会发信");
  await confirm.locator("[data-discovery-ingest-yes]").click();
  await expect(page.locator("[data-discovery-toast]")).toHaveText("去公海看这批");
  await expect(page.locator("[data-discovery-pool-link]")).toHaveAttribute("href", "/pipeline");
  await expect(page.locator('[data-home-mode="lifecycle"]')).toHaveAttribute("aria-selected", "false");
  expect(followPosts).toEqual([]);
  expect(livePosts).toEqual([]);
  await expect(page.locator("[data-nav='running'] .nav-badge")).toHaveText("1");
});

test("service-down and filtered empty states stay honest", async ({ page }) => {
  await page.route("**/api/home/discovery/batches", (route) => route.fulfill({
    status: 502,
    contentType: "application/json",
    body: JSON.stringify({ detail: "upstream down" }),
  }));
  await openDiscovery(page);
  await expect(page.locator("[data-discovery-empty='down']")).toBeVisible();
  await expect(page.locator("[data-discovery-empty='down']")).toContainText("服务不可用");
  await expect(page.locator("[data-discovery-panel]")).not.toContainText("没有红人线索");
});
