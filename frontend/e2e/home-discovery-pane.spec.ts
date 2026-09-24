import { test, expect, type Page } from "@playwright/test";

const LIVE_SIDE_EFFECT = /\/(send|confirm-stage|start-crawl|crawl-job|actions\/start-crawl)(?:\?|$)/;
const BANNED_FOLLOW = /加入跟进|\+\s*跟进|按所选加入跟进/;
const BANNED_BATCH_PATH = /\/api\/home\/discovery\/batches/;

async function openDiscovery(page: Page, { expectCard = true } = {}) {
  await page.goto("/?tab=discovery");
  // 中栏/右栏由工作台骨架撑起（结果容器在右栏，零高时不能当可见性锚点）。
  await expect(page.locator('[data-home-pane="discovery"] [data-scope-ai-workspace]')).toBeVisible();
  // 没有 run 时中栏就是条件卡；已有 run 时中栏是过程流（卡片按需召回）。
  if (expectCard) await expect(page.locator("[data-discovery-search-card]")).toBeVisible();
}

function stubRun() {
  return {
    id: "drun_e2e",
    run_id: "drun_e2e",
    headline: "北美美妆 YouTube",
    raw_count: 40,
    candidate_count: 2,
    status: "completed",
    work_item_id: "tsk_disc_e2e",
    session_id: "ses_disc_e2e",
    brief_version: 1,
  };
}

function stubCandidates() {
  return [
    {
      id: "cand_solar",
      handle: "TheSolarLab",
      nickname: "Solar Lab",
      platform: "youtube",
      followers: 153000,
      avg_views_10: 8597,
      why: "匹配美妆评测方向",
      band: "A",
      source_url: "https://youtube.com/@TheSolarLab",
      already_in_pool: false,
      status: "suggested",
      run_id: "drun_e2e",
    },
    {
      id: "cand_zero",
      handle: "NoStats",
      nickname: "",
      platform: "instagram",
      followers: 0,
      avg_views_10: 0,
      why: "",
      band: "",
      source_url: "",
      already_in_pool: true,
      status: "suggested",
      run_id: "drun_e2e",
    },
  ];
}

test.beforeEach(async ({ request }) => {
  await request.post("/api/demo/reset", { data: { workbench: true } });
  await request.post("/api/me/persona", { data: { persona: "sriphy" } });
});

test("tab switch only GETs discovery runs and does not create a session", async ({ page }) => {
  const posts: string[] = [];
  const gets: string[] = [];
  page.on("request", (item) => {
    const path = new URL(item.url()).pathname;
    expect(path).not.toMatch(BANNED_BATCH_PATH);
    if (item.method() === "POST") posts.push(path);
    if (item.method() === "GET" && path.startsWith("/api/home/discovery")) gets.push(path);
  });
  await page.goto("/");
  await page.locator('[data-home-mode="discovery"]').click();
  await expect(page.locator("[data-discovery-search-card]")).toBeVisible();
  // 进入即有条件与可编辑的提问框正文，且不再有「尚未搜索」空态。
  await expect(page.locator("[data-discovery-empty='idle']")).toHaveCount(0);
  await expect(page.locator("[data-discovery-panel]")).not.toContainText("尚未搜索");
  await expect(page.locator('[data-home] [data-composer-input]')).toHaveValue(/【发现任务】/);
  await expect(page.locator("[data-discovery-panel]")).not.toContainText(BANNED_FOLLOW);
  expect(posts.filter((path) => path === "/api/sessions" || path.includes("/run") || path.endsWith("/from-text"))).toEqual([]);
  expect(gets.some((path) => path === "/api/home/discovery/runs")).toBeTruthy();
  expect(gets.some((path) => path.includes("/batches"))).toBeFalsy();
});

test("condition card renders in-page and pre-fills the editable ask box", async ({ page }) => {
  const posts: string[] = [];
  page.on("request", (item) => {
    if (item.method() === "POST") posts.push(new URL(item.url()).pathname);
  });
  await openDiscovery(page);
  const card = page.locator("[data-discovery-search-card]");
  await expect(card).not.toContainText("红人检索");
  await expect(card.locator('[data-skill-param="platforms"] [data-discovery-chip="youtube"]')).toBeVisible();
  await expect(card.locator('[data-skill-param="platforms"] [data-discovery-chip="tiktok"]')).toHaveCount(0);
  await expect(card.locator('[data-skill-param="platforms"] [data-discovery-chip="douyin"]')).toHaveCount(0);
  await expect(card.locator('[data-skill-param="region"] [data-discovery-chip="na"]')).toHaveText("北美");
  await expect(card.locator('[data-skill-param="region"] [data-discovery-chip="jpkr"]')).toHaveText("日韩");
  // R2：平台默认 YouTube，地区默认全球英文，方向默认不选。
  await expect(card.locator('[data-skill-param="platforms"] [data-discovery-chip="youtube"]'))
    .toHaveAttribute("aria-pressed", "true");
  await expect(card.locator('[data-skill-param="region"] [data-discovery-chip="global_en"]'))
    .toHaveAttribute("aria-pressed", "true");
  await expect(card.locator('[data-skill-param="directions"] [data-discovery-chip][aria-pressed="true"]')).toHaveCount(0);
  await expect(card.locator("[data-discovery-keywords]")).toHaveValue("camping, portable power station");
  await expect(card.locator("[data-discovery-clear-keywords]")).toBeVisible();
  await expect(card.locator('[data-skill-param="platforms"] [data-discovery-chip="youtube"]'))
    .toHaveCSS("border-top-color", "rgb(65, 132, 255)");
  await expect(card.locator('[data-skill-param="platforms"] [data-discovery-chip="instagram"]'))
    .toHaveCSS("color", "rgb(107, 107, 107)");
  await expect(card.locator('[data-skill-param="platforms"] [data-discovery-chip="youtube"]'))
    .toHaveCSS("font-weight", "400");
  await expect(card.locator('[data-skill-param="min_followers"] input'))
    .toHaveAttribute("data-discovery-pristine", "true");
  await expect(card.locator('[data-skill-param-group="followers_range"] .ai-discovery-label'))
    .toContainText("粉丝数");
  await expect(card.locator('[data-skill-param-group="followers_range"] .ai-discovery-label'))
    .not.toContainText("粉丝数范围");
  // R3：条件摘要改为提问框里可编辑的【发现任务】正文，卡片上不再有摘要卡。
  const input = page.locator("[data-home] [data-composer-input]");
  await expect(input).toHaveValue(/【发现任务】/);
  await expect(input).toHaveValue(/平台：YouTube/);
  await expect(input).toHaveValue(/地区：全球英文/);
  await expect(page.locator("[data-discovery-request-preview]")).toBeVisible();
  await page.locator("[data-discovery-request-edit]").click();
  await expect(input).toBeEditable();
  await expect(page.locator("[data-discovery-summary]")).toHaveCount(0);
  // 正文可编辑：改关键词，卡片跟着走（逗号/空格都被解析成词）。
  await input.fill("【发现任务】\n平台：YouTube\n地区：全球英文\n方向：（未选）\n关键词：beauty review\n粉丝：10000–2000000\n近10条均播 ≥ 5000\n期望人数：30");
  await expect(card.locator("[data-discovery-keywords]")).toHaveValue("beauty, review");
  expect(posts.filter((path) => path === "/api/sessions" || path.endsWith("/from-text"))).toEqual([]);
});

test("keyword clear synchronizes the discovery brief", async ({ page }) => {
  await openDiscovery(page);
  const card = page.locator("[data-discovery-search-card]");
  const input = page.locator("[data-home] [data-composer-input]");
  const send = page.locator("[data-home] [data-ai-prompt-submit]");

  await card.locator("[data-discovery-clear-keywords]").click();
  await expect(card.locator("[data-discovery-keywords]")).toHaveValue("");
  await expect(input).toHaveValue(/关键词：（未填）/);
  await expect(send).toBeDisabled();
});

test("modified query values use regular dark text", async ({ page }) => {
  await openDiscovery(page);
  const card = page.locator("[data-discovery-search-card]");
  const camping = card.locator('[data-skill-param="directions"] [data-discovery-chip="camping"]');
  const followers = card.locator('[data-skill-param="min_followers"] input');

  await camping.click();
  await expect(camping).toHaveCSS("color", "rgb(26, 26, 26)");
  await expect(camping).toHaveCSS("font-weight", "400");

  await followers.fill("25000");
  await expect(followers).toHaveAttribute("data-discovery-pristine", "false");
  await expect(followers).toHaveCSS("color", "rgb(26, 26, 26)");
  await expect(followers).toHaveCSS("font-weight", "400");
});

test("the ask arrow and latest-control share size, with a pink ready arrow", async ({ page }) => {
  await openDiscovery(page);
  const send = page.locator("[data-home] [data-ai-prompt-submit]");
  await expect(send).toBeEnabled();
  const sendBox = await send.boundingBox();
  expect(sendBox).not.toBeNull();
  expect(sendBox?.width).toBe(32);
  expect(sendBox?.height).toBe(32);
  await expect(send).toHaveCSS("color", "rgb(219, 24, 96)");
  await expect(send.locator('[data-send-arrow="ready"]')).toHaveCSS("color", "rgb(219, 24, 96)");

  const jumpBox = await page.evaluate(() => {
    const probe = document.createElement("button");
    probe.className = "scope-scroll-jump";
    document.body.append(probe);
    const style = getComputedStyle(probe);
    const box = { width: style.width, height: style.height };
    probe.remove();
    return box;
  });
  expect(jumpBox).toEqual({ width: "32px", height: "32px" });
});

test("a terminal discovery error stops the process trail before later success events", async ({ page }) => {
  const failedRun = {
    id: "drun_failed",
    run_id: "drun_failed",
    status: "failed",
    error: "读取远程采集日志未完成",
    work_item_id: "tsk_disc_failed",
    brief_version: 1,
  };
  await page.route("**/api/home/discovery/runs**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/candidates")) {
      await route.fulfill({ json: { run_id: "drun_failed", candidates: [] } });
      return;
    }
    if (path.endsWith("/drun_failed")) {
      await route.fulfill({ json: { run: failedRun } });
      return;
    }
    await route.fulfill({ json: { runs: [failedRun] } });
  });
  await page.route("**/api/tasks/tsk_disc_failed/events", (route) => route.fulfill({
    json: {
      events: [
        { type: "queued" },
        { type: "crawl.started" },
        { type: "crawl.error", message: "读取远程采集日志未完成" },
        { type: "crawl.result_ready" },
        { type: "run.step", label: "整理候选" },
        { type: "artifact_ready" },
      ],
    },
  }));

  await openDiscovery(page, { expectCard: false });
  const process = page.locator("[data-discovery-process]");
  await expect(process).toContainText("失败原因：读取远程采集日志未完成");
  await expect(process).not.toContainText("采集完成");
  await expect(process).not.toContainText("整理候选");
  await expect(process).not.toContainText("已排出候选");
});

test("a failed run keeps one business status block and folds the engine detail", async ({ page }) => {
  const failedRun = {
    id: "drun_capacity_failed",
    run_id: "drun_capacity_failed",
    status: "rank_failed",
    raw_count: 32,
    candidate_count: 17,
    error: "Selected model is at capacity. Please try a different model.",
    work_item_id: "tsk_capacity_failed",
    brief_version: 1,
  };
  await page.route("**/api/home/discovery/runs**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/candidates")) {
      await route.fulfill({ json: { run_id: "drun_capacity_failed", candidates: [] } });
      return;
    }
    if (path.endsWith("/drun_capacity_failed")) {
      await route.fulfill({ json: { run: failedRun } });
      return;
    }
    await route.fulfill({ json: { runs: [failedRun] } });
  });
  await page.route("**/api/tasks/tsk_capacity_failed/events", (route) => route.fulfill({ json: { events: [] } }));

  await openDiscovery(page, { expectCard: false });
  const summary = page.locator("[data-discovery-ai-summary]");
  await expect(summary).toContainText("需要处理");
  await expect(summary).toContainText("检索没有完成");
  await expect(summary).toContainText("原始 32 · 入围 17");
  await expect(summary).toContainText("检索没有完成，可稍后重试。");
  await expect(summary.locator("[data-discovery-retry]")).toHaveText("重试");
  await expect(summary.locator("[data-discovery-error-detail]")).toBeHidden();
  await expect(page.locator("[data-discovery-error]")).toHaveCount(0);
  await expect(page.getByText(/历史发现/)).toHaveCount(0);

  await summary.locator("[data-discovery-error-details-toggle]").click();
  await expect(summary.locator("[data-discovery-error-detail]"))
    .toContainText("生成服务结束状态：failed；Selected model is at capacity.");
});

test("a discovery task record opens its linked run instead of a chat session", async ({ page }) => {
  const run = stubRun();
  await mockExistingRun(page);
  await page.route(/\/api\/tasks(?:\?.*)?$/, (route) => route.fulfill({
    json: [{
      id: "tsk_disc_e2e",
      title: "AI发现 · youtube · camping",
      task_type: "discovery_crawl",
      status: "completed",
      priority: "normal",
      discovery_run_id: "drun_e2e",
    }],
  }));

  await page.goto("/?tab=todo");
  await expect(page.locator("[data-todo-list]")).toBeVisible();
  await page.locator('[data-today-todo="tsk_disc_e2e"] [data-today-todo-act]').click();
  await expect(page).toHaveURL(/\?tab=discovery/);
  await expect(page.locator("[data-discovery-headline]")).toContainText(run.headline);
  await expect(page.locator("[data-discovery-panel]")).not.toContainText("历史发现");
});

test("condition chips rewrite the ask-box body and no card button remains", async ({ page }) => {
  await openDiscovery(page);
  const card = page.locator("[data-discovery-search-card]");
  const input = page.locator("[data-home] [data-composer-input]");
  await card.locator('[data-skill-param="directions"] [data-discovery-chip="camping"]').click();
  await expect(input).toHaveValue(/户外露营/);
  await expect(card.locator("[data-discovery-keywords]")).toHaveValue(/camping/);
  await expect(page.locator("[data-discovery-summary]")).toHaveCount(0);
  await expect(page.locator("[data-discovery-reset]")).toHaveCount(0);
  await expect(page.locator("[data-discovery-submit]")).toHaveCount(0);
  // 框线稿 §15：卡片底部不留说明文案（「不会发信」这句已从模板正文删除）。
  await expect(card.locator("[data-discovery-no-side-effect]")).toHaveCount(0);
});

test("idle discovery keeps the task-rail width and full brief above the dock", async ({ page }) => {
  await page.setViewportSize({ width: 1966, height: 900 });
  await stubNoRuns(page);
  await openDiscovery(page);
  const workspace = page.locator('[data-home-pane="discovery"]');
  await expect(workspace).toHaveClass(/is-result-idle/);
  const rail = workspace.locator('[data-scope-task-rail]');
  const center = workspace.locator('[data-scope-ai-workspace]');
  expect(Math.round((await rail.boundingBox())!.width)).toBe(820);
  const discoveryRailWidth = Math.round((await rail.boundingBox())!.width);
  expect(await center.evaluate((element) => element.clientWidth)).toBeGreaterThan(820);
  const card = workspace.locator('[data-discovery-search-card]');
  const followerMin = card.locator('[data-skill-param="min_followers"]');
  const followerMax = card.locator('[data-skill-param="max_followers"]');
  expect(Math.abs((await followerMin.boundingBox())!.y - (await followerMax.boundingBox())!.y)).toBeLessThan(2);
  const finalField = card.locator('[data-skill-param="expect_count"]');
  await finalField.scrollIntoViewIfNeeded();
  const finalBox = await finalField.boundingBox();
  const dockBox = await workspace.locator('.home-composer-dock').boundingBox();
  expect(finalBox && dockBox && finalBox.y + finalBox.height <= dockBox.y).toBeTruthy();
  await page.locator('[data-home-mode="today"]').click();
  const todayRail = page.locator('[data-home-pane="today"] [data-scope-task-rail]');
  await expect(todayRail).toBeVisible();
  expect(Math.round((await todayRail.boundingBox())!.width)).toBe(discoveryRailWidth);
  for (const width of [1024, 720, 480]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
  }
});

test("compact discovery thresholds stay visible above the dock", async ({ page }) => {
  // Reference view from the design review: all core conditions, including
  // expected count, must fit before the fixed composer at 916px wide.
  await page.setViewportSize({ width: 916, height: 916 });
  await stubNoRuns(page);
  await openDiscovery(page);

  const workspace = page.locator('[data-home-pane="discovery"]');
  const card = workspace.locator('[data-discovery-search-card]');
  const followerRange = card.locator('[data-skill-param-group="followers_range"]');
  const metricPair = card.locator('[data-skill-param-group="discovery_metrics"]');
  const followerMin = card.locator('[data-skill-param="min_followers"]');
  const followerMax = card.locator('[data-skill-param="max_followers"]');
  const avgPlays = card.locator('[data-skill-param="min_avg_plays_10"]');
  const expectedCount = card.locator('[data-skill-param="expect_count"]');

  await expect(followerRange).toHaveAccessibleName("粉丝数范围");
  await expect(metricPair).toBeVisible();
  await expect(followerMin.locator("input")).toHaveValue("10,000");
  await expect(followerMax.locator("input")).toHaveValue("2,000,000");
  await expect(avgPlays.locator("input")).toHaveValue("5,000");
  await expect(expectedCount.locator("input")).toHaveValue("30");

  const minBox = await followerMin.boundingBox();
  const maxBox = await followerMax.boundingBox();
  const playsBox = await avgPlays.boundingBox();
  const countBox = await expectedCount.boundingBox();
  const keywordBox = await card.locator("[data-discovery-keywords]").boundingBox();
  const minInputBox = await followerMin.locator("input").boundingBox();
  const playsInputBox = await avgPlays.locator("input").boundingBox();
  const dockBox = await workspace.locator('.home-composer-dock').boundingBox();
  expect(minBox && maxBox && Math.abs(minBox.y - maxBox.y) < 2).toBeTruthy();
  expect(playsBox && countBox && Math.abs(playsBox.y - countBox.y) < 2).toBeTruthy();
  // All primary controls share the same left baseline; compact numeric fields
  // no longer stretch to the width of the keyword field.
  expect(keywordBox && minInputBox && Math.abs(keywordBox.x - minInputBox.x) < 2).toBeTruthy();
  expect(keywordBox && playsInputBox && Math.abs(keywordBox.x - playsInputBox.x) < 2).toBeTruthy();
  expect(keywordBox && minInputBox && minInputBox.width < keywordBox.width).toBeTruthy();
  for (const field of ["platforms", "region", "directions", "keywords"]) {
    await expect(card.locator(`[data-skill-param="${field}"]`)).toHaveCSS("border-bottom-width", "1px");
  }
  expect(countBox && dockBox && countBox.y + countBox.height <= dockBox.y).toBeTruthy();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
});

test("+ menu no longer offers the discovery template (AI发现 pane owns discovery)", async ({ page }) => {
  const posts: string[] = [];
  page.on("request", (item) => {
    if (item.method() === "POST") posts.push(new URL(item.url()).pathname);
  });
  await openDiscovery(page);
  await page.locator("[data-home] [data-attach]").click();
  const menu = page.getByRole("menu", { name: "添加内容" });
  await expect(menu).toBeVisible();
  // 所有者 2026-09-23 定稿：+ 菜单只有 文件/技能/知识库/数字员工/连接器/项目 六组，没有作业组，
  // 发现任务从「AI发现」面的条件卡开始（见本文件其余用例）。
  await expect(menu.locator('[data-menu-section="作业"]')).toHaveCount(0);
  await expect(menu.getByRole("menuitem", { name: "发现红人模板" })).toHaveCount(0);
  await expect(menu.locator("[data-composer-subpanel]")).toHaveCount(0);
  // 菜单不是连接器治理入口。
  await expect(menu).not.toContainText("/admin/connectors");
  expect(posts.filter((path) => path === "/api/sessions" || path.endsWith("/from-text"))).toEqual([]);
});

test("ask-box send follows the platform and keyword guard", async ({ page }) => {
  await openDiscovery(page);
  const card = page.locator("[data-discovery-search-card]");
  const send = page.locator("[data-home] [data-ai-prompt-submit]");
  const youtube = card.locator('[data-skill-param="platforms"] [data-discovery-chip="youtube"]');
  const instagram = card.locator('[data-skill-param="platforms"] [data-discovery-chip="instagram"]');
  const keywords = card.locator("[data-discovery-keywords]");

  // R2/R5：平台默认 YouTube + 默认关键词，所以提问框的发送按钮默认可用。
  await expect(send).toBeEnabled();

  // 清空关键词：blur 才写回 brief（卡片只在解析得出词时回写输入框）。
  await keywords.fill("");
  await keywords.blur();
  await expect(send).toBeDisabled();

  await keywords.fill("户外露营");
  await keywords.blur();
  await expect(send).toBeEnabled();

  // 平台单选：先取消默认 YouTube，再选择 Instagram；再次点击 Instagram
  // 取消选择，条件不完整时发送按钮回到禁用。
  await youtube.click();
  await expect(youtube).toHaveAttribute("aria-pressed", "false");
  await expect(send).toBeDisabled();
  await instagram.click();
  await expect(instagram).toHaveAttribute("aria-pressed", "true");
  await expect(send).toBeEnabled();
  await instagram.click();
  await expect(instagram).toHaveAttribute("aria-pressed", "false");
  await expect(send).toBeDisabled();
});

// 下面三条只关心提交路径，不关心已有 run：列表恒为空。
async function stubNoRuns(page: Page) {
  await page.route("**/api/home/discovery/runs**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/candidates")) {
      void route.fulfill({ json: { run_id: "drun_e2e", candidates: [] } });
      return;
    }
    if (/\/runs\/[^/]+$/.test(path)) {
      void route.fulfill({ json: { run: null } });
      return;
    }
    void route.fulfill({ json: { runs: [] } });
  });
  await page.route("**/api/tasks/**/events", (route) => route.fulfill({ json: { events: [] } }));
}

const RUN_ACCEPTED = {
  run_id: "drun_e2e",
  id: "drun_e2e",
  work_item_id: "tsk_disc_e2e",
  session_id: "ses_disc_e2e",
  brief_version: 1,
};

test("send on the discovery path shows ▪ and clears the box before the request resolves", async ({ page }) => {
  const gate: { release?: () => void } = {};
  const held = new Promise<void>((resolve) => { gate.release = resolve; });
  await stubNoRuns(page);
  await page.route("**/api/home/discovery/run", async (route) => {
    await held;
    await route.fulfill({ json: RUN_ACCEPTED });
  });

  await openDiscovery(page);
  const input = page.locator("[data-home] [data-composer-input]");
  await expect(input).toHaveValue(/【发现任务】/);
  await page.locator("[data-home] [data-ai-prompt-submit]").click();

  // 提交中发送键是 ▪（纯客户端状态），且正文立刻清空，都不等接口返回。
  const stop = page.locator("[data-home] [data-send-state='stop']");
  await expect(stop).toHaveAttribute("aria-label", "停止生成");
  await expect(input).toHaveValue("");

  gate.release?.();
  await expect(stop).toHaveCount(0);
});

test("a 502 on submit offers 重试, and retrying resubmits", async ({ page }) => {
  let attempts = 0;
  await stubNoRuns(page);
  await page.route("**/api/home/discovery/run", async (route) => {
    attempts += 1;
    if (attempts === 1) {
      await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({}) });
      return;
    }
    await route.fulfill({ json: RUN_ACCEPTED });
  });

  await openDiscovery(page);
  await page.locator("[data-home] [data-ai-prompt-submit]").click();
  await expect(page.locator("[data-home] .composer-err").first()).toContainText("502");
  const retry = page.locator("[data-home] [data-home-discovery-submit-error] button");
  await expect(retry).toBeVisible();
  await retry.click();
  await expect.poll(() => attempts).toBe(2);
  // 重试成功后错误文案与重试入口一起收起。
  await expect(page.locator("[data-home] [data-home-discovery-submit-error]")).toHaveCount(0);
  await expect(page.locator("[data-home] .composer-err")).toHaveCount(0);
});

test("▪ during a discovery submit aborts the client side and posts no cancel", async ({ page }) => {
  const gate: { release?: () => void } = {};
  const held = new Promise<void>((resolve) => { gate.release = resolve; });
  const taskEventGets: string[] = [];
  const cancelPosts: string[] = [];
  page.on("request", (item) => {
    const path = new URL(item.url()).pathname;
    if (path === "/api/tasks/tsk_disc_e2e/events") taskEventGets.push(path);
    if (item.method() === "POST" && path !== "/api/home/discovery/run") cancelPosts.push(path);
  });
  await stubNoRuns(page);
  await page.route("**/api/home/discovery/run", async (route) => {
    await held;
    await route.fulfill({ json: RUN_ACCEPTED });
  });

  await openDiscovery(page);
  await page.locator("[data-home] [data-ai-prompt-submit]").click();
  const stop = page.locator("[data-home] [data-send-state='stop']");
  await expect(stop).toBeVisible();
  await stop.click();
  await expect(page.locator("[data-home] [data-home-stopping]")).toBeVisible();

  gate.release?.();
  // ▪ 只中止客户端后续动作：run 不写进面板（不订阅过程事件），也不调任何停止接口。
  await expect(stop).toHaveCount(0);
  expect(taskEventGets).toEqual([]);
  expect(cancelPosts).toEqual([]);
});

test("submit posts /api/home/discovery/run, shows process copy, and ingests to pool", async ({ page }) => {
  const livePosts: string[] = [];
  const runPosts: string[] = [];
  const runBodies: unknown[] = [];
  const followPosts: string[] = [];
  const claimPosts: string[] = [];
  const ingestBodies: unknown[] = [];
  let eventTick = 0;
  let ran = false;
  page.on("request", (item) => {
    const path = new URL(item.url()).pathname;
    expect(path).not.toMatch(BANNED_BATCH_PATH);
    if (item.method() !== "POST") return;
    if (LIVE_SIDE_EFFECT.test(path)) livePosts.push(path);
    if (path === "/api/home/discovery/run") runPosts.push(path);
    if (path.includes("/follow")) followPosts.push(path);
    if (path.includes("/claim")) claimPosts.push(path);
  });

  await page.route("**/api/home/discovery/runs**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/candidates")) {
      void route.fulfill({ json: { run_id: "drun_e2e", candidates: ran ? stubCandidates() : [] } });
      return;
    }
    if (/\/runs\/[^/]+$/.test(path)) {
      void route.fulfill({ json: { run: ran ? stubRun() : null } });
      return;
    }
    void route.fulfill({ json: { runs: ran ? [stubRun()] : [] } });
  });
  await page.route("**/api/home/discovery/run", async (route) => {
    ran = true;
    runBodies.push(route.request().postDataJSON());
    await route.fulfill({
      json: {
        run_id: "drun_e2e",
        id: "drun_e2e",
        work_item_id: "tsk_disc_e2e",
        session_id: "ses_disc_e2e",
        agent_status: "running",
        brief_version: 1,
      },
    });
  });
  await page.route("**/api/home/discovery/ingest", async (route) => {
    ingestBodies.push(route.request().postDataJSON());
    await route.fulfill({
      json: {
        status: "completed",
        run_id: "drun_e2e",
        items: [
          { candidate_id: "cand_solar", status: "imported" },
        ],
        counts: { selected: 1, imported: 1, already_imported: 0, failed: 0 },
        claimed: false,
      },
    });
  });
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
  // 唯一的提交入口是 AI 提问框的发送按钮：默认 YouTube + 默认关键词即可提交。
  await page.locator("[data-home] [data-ai-prompt-submit]").click();
  await expect.poll(() => runPosts).toEqual(["/api/home/discovery/run"]);
  // 提交载荷必须带着条件与阈值名字（后端按 min_avg_plays_10 / expect_count 读）。
  expect(runBodies).toEqual([expect.objectContaining({
    platforms: ["youtube"],
    keywords: ["camping", "portable power station"],
    min_avg_plays_10: 5000,
    expect_count: 30,
  })]);
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
  await expect(missing).toContainText("匹配：暂无足够内容证据");
  await expect(missing.locator("[data-discovery-source-missing]")).toHaveText("看来源 · 来源链接缺失");
  await expect(missing.locator("[data-discovery-in-library]")).toHaveText("已在库");

  await expect(page.locator("[data-discovery-panel]")).not.toContainText(BANNED_FOLLOW);
  await expect(page.locator("[data-discovery-panel]")).not.toContainText("发送邮件");
  await expect(page.locator("[data-coach-next], [data-next-step-card]")).toHaveCount(0);
  await expect(page.locator("[data-discovery-ai-summary]")).toContainText("已完成");
  await expect(page.locator("[data-discovery-next-plan]")).toContainText("核对线索后选择入库对象");
  await expect(page.locator("[data-discovery-conversion-overview]")).toContainText("转化概览");
  await expect(page.locator('[data-discovery-conversion-count="ready"]')).toContainText("可入库");
  await expect(page.locator("[data-discovery-ingest]")).toBeDisabled();
  await page.locator('[data-discovery-result-filter="existing"]').click();
  await expect(page.locator('[data-discovery-candidate="NoStats"]')).toBeVisible();
  await expect(page.locator('[data-discovery-select="cand_zero"]')).toBeDisabled();
  await page.locator('[data-discovery-result-filter="all"]').click();

  await page.locator('[data-discovery-select="cand_solar"]').check();
  await expect(page.locator("[data-discovery-select-all]")).toBeVisible();
  await page.locator("[data-discovery-select-all]").check();
  const ingest = page.locator("[data-discovery-ingest]");
  await expect(ingest).toHaveText("入库公海（1）");
  await expect(page.locator("[data-discovery-panel] .btn.work")).toHaveCount(1);
  await ingest.click();
  const confirm = page.locator("[data-discovery-ingest-confirm]");
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText("写入 Starry 并进入公海");
  await expect(confirm).toContainText("不会建联");
  await expect(confirm).toContainText("不会发信");
  await confirm.locator("[data-discovery-ingest-yes]").click();
  await expect(page.locator("[data-discovery-toast]")).toHaveText("去公海看这批");
  await expect(page.locator("[data-discovery-pool-link]")).toHaveAttribute("href", "/?tab=pool");
  await expect(page.locator('[data-home-mode="lifecycle"]')).toHaveAttribute("aria-selected", "false");
  expect(ingestBodies).toEqual([{
    run_id: "drun_e2e",
    candidate_ids: ["cand_solar"],
    expected_brief_version: 1,
    confirmed: true,
  }]);
  expect(followPosts).toEqual([]);
  expect(claimPosts).toEqual([]);
  expect(livePosts).toEqual([]);
  await expect(page.locator("[data-nav='running'] .nav-badge")).toHaveText("1");
});

test("submit hides the condition card; 改条件再搜 brings it back to the center", async ({ page }) => {
  let ran = false;
  await page.route("**/api/home/discovery/runs**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/candidates")) {
      void route.fulfill({ json: { run_id: "drun_e2e", candidates: [] } });
      return;
    }
    if (/\/runs\/[^/]+$/.test(path)) {
      void route.fulfill({ json: { run: ran ? stubRun() : null } });
      return;
    }
    void route.fulfill({ json: { runs: ran ? [stubRun()] : [] } });
  });
  await page.route("**/api/home/discovery/run", async (route) => {
    ran = true;
    await route.fulfill({
      json: { run_id: "drun_e2e", id: "drun_e2e", work_item_id: "tsk_disc_e2e", brief_version: 1 },
    });
  });
  await page.route("**/api/tasks/tsk_disc_e2e/events", (route) => route.fulfill({
    json: {
      events: [
        { type: "queued", created_at: "2026-09-24T06:32:05.000Z" },
        { type: "crawl.started", created_at: "2026-09-24T06:32:06.000Z" },
        { type: "run.think", status: "running", summary: "先按匹配度给候选排序", created_at: "2026-09-24T06:32:07.000Z" },
      ],
    },
  }));

  await openDiscovery(page);
  await expect(page.locator("[data-discovery-edit-conditions]")).toHaveCount(0);
  await page.locator("[data-home] [data-ai-prompt-submit]").click();

  // 提交后卡片收起：中栏换成过程流（含简报 worker 的 Codex 推理），右栏是结果容器。
  await expect(page.locator("[data-discovery-search-card]")).toHaveCount(0);
  await expect(page.locator("[data-scope-ai-workspace] [data-discovery-process]")).toContainText("正在采集");
  await expect(page.locator("[data-scope-ai-workspace] [data-discovery-think]")).toContainText("Codex 推理");
  await expect(page.locator("[data-scope-ai-workspace] [data-discovery-step-time]").first()).toHaveText(/^\d{2}:\d{2}:\d{2}$/);
  await expect(page.locator("[data-scope-ai-workspace] [data-discovery-think-time]")).toHaveText(/^\d{2}:\d{2}:\d{2}$/);
  await expect(page.locator("[data-scope-task-rail] [data-discovery-panel]")).toHaveCount(1);
  await expect(page.locator("[data-scope-ai-workspace] [data-discovery-panel]")).toHaveCount(0);

  // 恢复入口在过程流头部：改条件再搜把卡片调回中栏，不会自动重跑。
  const edit = page.locator("[data-discovery-edit-conditions]");
  await expect(edit).toBeVisible();
  await edit.click();
  await expect(page.locator("[data-scope-ai-workspace] [data-discovery-search-card]")).toHaveCount(1);
});

async function mockExistingRun(page: Page) {
  await page.route("**/api/home/discovery/runs**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/candidates")) {
      void route.fulfill({ json: { run_id: "drun_e2e", candidates: stubCandidates() } });
      return;
    }
    if (/\/runs\/[^/]+$/.test(path)) {
      void route.fulfill({ json: { run: stubRun() } });
      return;
    }
    void route.fulfill({ json: { runs: [stubRun()] } });
  });
}

test("ingest 404 stays an empty-state and does not claim", async ({ page }) => {
  const claimPosts: string[] = [];
  page.on("request", (item) => {
    const path = new URL(item.url()).pathname;
    if (item.method() === "POST" && path.includes("/claim")) claimPosts.push(path);
  });
  await mockExistingRun(page);
  await page.route("**/api/home/discovery/ingest", (route) => route.fulfill({
    status: 404,
    contentType: "application/json",
    body: JSON.stringify({ detail: "not found" }),
  }));
  await openDiscovery(page, { expectCard: false });
  await page.locator('[data-discovery-select="cand_solar"]').check();
  await page.locator("[data-discovery-select-all]").check();
  await page.locator("[data-discovery-ingest]").click();
  await page.locator("[data-discovery-ingest-yes]").click();
  await expect(page.locator("[data-discovery-empty='ingest-missing']")).toBeVisible();
  await expect(page.locator("[data-discovery-empty='ingest-missing']")).toContainText("入库接口尚未提供");
  await expect(page.locator("[data-discovery-toast]")).toHaveCount(0);
  expect(claimPosts).toEqual([]);
});

test("ingest 422 keeps L3 open; 409 voids the old confirm", async ({ page }) => {
  let ingestStatus = 422;
  const bodies: unknown[] = [];
  await mockExistingRun(page);
  await page.route("**/api/home/discovery/ingest", async (route) => {
    bodies.push(route.request().postDataJSON());
    if (ingestStatus === 422) {
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({ status: "needs_confirmation", confirmed: false, claimed: false }),
      });
      return;
    }
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        detail: { code: "brief_version_mismatch", message: "发现 Brief 已变化，原确认作废。", brief_version: 2 },
      }),
    });
  });
  await openDiscovery(page, { expectCard: false });
  await page.locator('[data-discovery-select="cand_solar"]').check();
  await page.locator("[data-discovery-select-all]").check();
  await page.locator("[data-discovery-ingest]").click();
  await page.locator("[data-discovery-ingest-yes]").click();
  await expect(page.locator("[data-discovery-ingest-confirm]")).toBeVisible();
  await expect(page.locator("[data-discovery-ingest-error]")).toContainText("需要确认后才能入库公海");
  expect(bodies[0]).toMatchObject({
    run_id: "drun_e2e",
    expected_brief_version: 1,
    confirmed: true,
  });

  ingestStatus = 409;
  await page.locator("[data-discovery-ingest-yes]").click();
  await expect(page.locator("[data-discovery-ingest-confirm]")).toHaveCount(0);
  await expect(page.locator("[data-discovery-brief-mismatch]")).toContainText("原确认作废");
  await expect(page.locator("[data-discovery-toast]")).toHaveCount(0);
});

test("L3 cancel after 422 posts cancel:true and does not claim", async ({ page }) => {
  const bodies: Array<Record<string, unknown>> = [];
  const claimPosts: string[] = [];
  page.on("request", (item) => {
    const path = new URL(item.url()).pathname;
    if (item.method() === "POST" && path.includes("/claim")) claimPosts.push(path);
  });
  await mockExistingRun(page);
  await page.route("**/api/home/discovery/ingest", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    bodies.push(body);
    if (body.cancel === true) {
      await route.fulfill({
        json: { status: "cancelled", cancelled: true, claimed: false, items: [] },
      });
      return;
    }
    await route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({ status: "needs_confirmation", confirmed: false, claimed: false }),
    });
  });
  await openDiscovery(page, { expectCard: false });
  await page.locator('[data-discovery-select="cand_solar"]').check();
  await page.locator("[data-discovery-select-all]").check();
  await page.locator("[data-discovery-ingest]").click();
  await page.locator("[data-discovery-ingest-no]").click();
  expect(bodies).toEqual([]);

  await page.locator("[data-discovery-ingest]").click();
  await page.locator("[data-discovery-ingest-yes]").click();
  await expect(page.locator("[data-discovery-ingest-error]")).toContainText("需要确认后才能入库公海");
  await page.locator("[data-discovery-ingest-no]").click();
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[0]).toMatchObject({
    run_id: "drun_e2e",
    expected_brief_version: 1,
    confirmed: true,
  });
  expect(bodies[1]).toMatchObject({
    run_id: "drun_e2e",
    expected_brief_version: 1,
    cancel: true,
  });
  expect(bodies[1].confirmed).toBeUndefined();
  await expect(page.locator("[data-discovery-ingest-confirm]")).toHaveCount(0);
  await expect(page.locator("[data-discovery-toast]")).toHaveCount(0);
  expect(claimPosts).toEqual([]);
});

test("service-down and filtered empty states stay honest", async ({ page }) => {
  await page.route("**/api/home/discovery/runs**", (route) => route.fulfill({
    status: 502,
    contentType: "application/json",
    body: JSON.stringify({ detail: "upstream down" }),
  }));
  await openDiscovery(page);
  await expect(page.locator("[data-discovery-empty='down']")).toBeVisible();
  await expect(page.locator("[data-discovery-empty='down']")).toContainText("服务不可用");
  await expect(page.locator("[data-discovery-panel]")).not.toContainText("没有红人线索");
});
