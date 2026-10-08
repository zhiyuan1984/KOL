import { test, expect, type Page } from "@playwright/test";

/**
 * AI发现（?tab=discovery）的页内契约（改造后）：
 * - 提交只走 POST /api/home/discovery/workspace，响应 { task_id, session_id, pending }；
 *   提交后不跳转，中栏是同页事件流 ①技能 → ②引导 → ③条件卡 → ④实际参数 → ⑤确认 → ⑥执行。
 * - 实际参数、确认与回执来自会话受控动作（GET /api/queries/runtime.actions），
 *   过程事件轮询 GET /api/tasks/:id/events；候选快照仍走既有的 run 路径。
 */
const LIVE_SIDE_EFFECT = /\/(send|confirm-stage|start-crawl|crawl-job|actions\/start-crawl)(?:\?|$)/;
/** 会改服务端状态的取消/停止/重试写入：只有对应的员工动作才允许发。 */
const CANCEL_STOP_WRITE = /(?:\/runtime\.cancel|\/runtime\.crawl\.(?:stop|retry)|\/actions\/start-crawl|\/commands)$/;
const BANNED_FOLLOW = /加入跟进|\+\s*跟进|按所选加入跟进/;
const BANNED_BATCH_PATH = /\/api\/home\/discovery\/batches/;

const DISCOVERY_TASK_ID = "tsk_disc_e2e";
const DISCOVERY_SESSION_ID = "ses_disc_e2e";
/** 提交响应里的首轮 pending 回合：由本页接管运行（POST /api/sessions/:id/messages）。 */
const DISCOVERY_PENDING = {
  text: "【发现任务】\n平台：YouTube\n地区：全球英文",
  intent: "crawler_collect",
  task_type: "crawler_collect",
  work_item_id: DISCOVERY_TASK_ID,
  run_id: "run_disc_e2e",
  entities: {},
};

async function openDiscovery(page: Page, { expectCard = true } = {}) {
  await page.goto("/?tab=discovery");
  // 中栏/右栏由工作台骨架撑起（结果容器在右栏，零高时不能当可见性锚点）。
  await expect(page.locator('[data-home-pane="discovery"] [data-scope-ai-workspace]')).toBeVisible();
  // 条件卡是中栏事件流的第三个事件，提交后原位转只读，不再消失。
  if (expectCard) await expect(page.locator("[data-discovery-search-card]")).toBeVisible();
}

/** 会话受控动作（start_crawl）：实际参数、确认与采集回执的唯一来源。 */
function runtimeAction(state: string, crawl: Record<string, unknown> | null = null) {
  return {
    id: "act_disc_e2e",
    skill_id: "crawler_collect",
    operation: "start_crawl",
    arguments: { platforms: "youtube", keywords: ["camping"], max_notes_count: 50 },
    state,
    risk: "L3",
    confirmation_version: "v1",
    blocked_reason: null,
    receipt: null,
    error_code: null,
    ...(crawl ? { crawl } : {}),
  };
}

function runningCrawl(remoteTaskId = "rt_1") {
  return {
    id: "act_disc_e2e",
    remote_task_id: remoteTaskId,
    state: "running",
    status_json: null,
    error_code: null,
    result_state: "ready",
    result_json: {
      task_id: remoteTaskId,
      complete: true,
      captured_at: "2026-10-06T09:00:00.000Z",
      candidates: [{
        id: "cand_rt",
        name: "Runtime 候选",
        platform: "youtube",
        source_url: null,
        followers: 12000,
        avg_views_10: null,
        region: null,
      }],
    },
  };
}

async function stubRuntimeActions(page: Page, read: () => unknown[]) {
  await page.route("**/api/queries/runtime.actions?*", (route) => route.fulfill({ json: { actions: read() } }));
}

/** 首轮 pending 回合由首页运行：stub 会话消息口，别让它打到真实会话。 */
async function stubPendingTurn(page: Page, sessionId = DISCOVERY_SESSION_ID) {
  await page.route(`**/api/sessions/${sessionId}/messages`, (route) => route.fulfill({
    json: { messages: [], agent_status: "listening" },
  }));
}

/** 打开一条已有运行的结果面：走 ?resume= 深链（AI发现不自动认领历史运行）。 */
async function openDiscoveryWithRun(page: Page, taskId = DISCOVERY_TASK_ID, sessionId = DISCOVERY_SESSION_ID) {
  await page.route("**/api/home/discovery/workspace/**/pending", (route) => route.fulfill({ json: { pending: null } }));
  await page.route(`**/api/tasks/${taskId}`, (route) => route.fulfill({ json: { task: resumeTask(taskId, sessionId) } }));
  await page.route(`**/api/tasks/${taskId}/events`, (route) => route.fulfill({ json: { events: [] } }));
  await page.goto(`/?tab=discovery&resume=${taskId}`);
  await expect(page.locator("[data-discovery-search-card]")).toBeVisible();
}

/** ?resume= 现场的最小形态：tickets.input.discovery_workspace（brief + 提交正文 + 身份）。 */
function resumeTask(taskId: string, sessionId: string) {
  return {
    id: taskId,
    session_id: sessionId,
    task_type: "crawler_collect",
    status: "completed",
    input: {
      discovery_workspace: {
        kind: "discovery",
        version: 1,
        agent_id: "agent_crawler",
        profile: "lead",
        submitted_text: "【发现任务】\n平台：YouTube\n地区：全球英文\n关键词：camping",
        brief: {
          platforms: ["youtube"],
          region: "global_en",
          directions: [],
          keywords: ["camping"],
          min_followers: 10_000,
          max_followers: null,
          min_avg_plays_10: 5_000,
          expect_count: 30,
        },
      },
    },
  };
}

/**
 * 发现提交：POST /api/home/discovery/workspace → { task_id, session_id, pending }。
 * onPost 可用于记录载荷，或返回一个 promise 把响应扣住（提交中态的用例）。
 */
async function stubDiscoverySubmit(page: Page, {
  taskId = DISCOVERY_TASK_ID,
  sessionId = DISCOVERY_SESSION_ID,
  pending = DISCOVERY_PENDING as unknown,
  onPost,
}: {
  taskId?: string;
  sessionId?: string;
  pending?: unknown;
  onPost?: (body: unknown) => void | Promise<void>;
} = {}) {
  await page.route("**/api/home/discovery/workspace", async (route) => {
    await onPost?.(route.request().postDataJSON());
    await route.fulfill({ json: { task_id: taskId, session_id: sessionId, pending } });
  });
  await stubPendingTurn(page, sessionId);
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

test("leaving discovery clears its lock before a normal composer submit", async ({ page }) => {
  const discoveryPosts: string[] = [];
  page.on("request", (item) => {
    if (item.method() === "POST" && new URL(item.url()).pathname === "/api/home/discovery/workspace") {
      discoveryPosts.push(new URL(item.url()).pathname);
    }
  });
  await page.goto("/?tab=discovery");
  await expect(page.locator('[data-home-mode="discovery"]')).toHaveAttribute("aria-selected", "true");
  await page.locator('[data-home-mode="pool"]').click();
  await expect(page.locator('[data-home-mode="pool"]')).toHaveAttribute("aria-selected", "true");
  const input = page.locator("[data-home] [data-composer-input]");
  await input.fill("普通工作台问题");
  await page.locator("[data-home] [data-ai-prompt-submit]").click();
  await expect.poll(() => discoveryPosts).toEqual([]);
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
  // 关键词是芯片控件：[data-discovery-keywords] 是容器，输入位在 [data-discovery-keywords-input]。
  await expect(card.locator("[data-discovery-keywords]")).toBeVisible();
  await expect(card.locator('[data-discovery-keyword-chip="camping"]')).toBeVisible();
  await expect(card.locator('[data-discovery-keyword-chip="portable power station"]')).toBeVisible();
  await expect(card.locator("[data-discovery-clear-keywords]")).toBeVisible();
  // 选中/未选中不锁死具体色值（token 会演进）：断言两者可以区分，选中态另有 ✓ 形状信号。
  const selectedBorder = await card.locator('[data-skill-param="platforms"] [data-discovery-chip="youtube"]')
    .evaluate((el) => getComputedStyle(el).borderTopColor);
  const idleBorder = await card.locator('[data-skill-param="platforms"] [data-discovery-chip="instagram"]')
    .evaluate((el) => getComputedStyle(el).borderTopColor);
  expect(selectedBorder).not.toBe(idleBorder);
  await expect(card.locator('[data-skill-param-group="followers_range"] [data-discovery-followers-hint]'))
    .toContainText("不限");
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
  // 正文可编辑：改关键词，卡片跟着走（正文按分隔符解析成词）。
  await input.fill("【发现任务】\n平台：YouTube\n地区：全球英文\n方向：（未选）\n关键词：beauty review\n粉丝：10000–2000000\n近10条均播 ≥ 5000\n期望人数：30");
  await expect(card.locator('[data-discovery-keyword-chip="beauty"]')).toBeVisible();
  await expect(card.locator('[data-discovery-keyword-chip="review"]')).toBeVisible();
  expect(posts.filter((path) => path === "/api/sessions" || path.endsWith("/from-text"))).toEqual([]);
});

test("keyword clear synchronizes the discovery brief", async ({ page }) => {
  await openDiscovery(page);
  const card = page.locator("[data-discovery-search-card]");
  const chips = card.locator("[data-discovery-keyword-chip]");
  const input = page.locator("[data-home] [data-composer-input]");
  const send = page.locator("[data-home] [data-ai-prompt-submit]");

  // 默认两个词 = 两个芯片；点一个 × 只删命中的那一个。
  await expect(chips).toHaveCount(2);
  await card.locator('[data-discovery-keyword-chip="camping"] [data-discovery-keyword-remove]').click();
  await expect(chips).toHaveCount(1);
  await expect(card.locator('[data-discovery-keyword-chip="portable power station"]')).toBeVisible();

  // 清空按钮清空全部：芯片归零、提问框正文回到（未填）、发送键回到禁用。
  await card.locator("[data-discovery-clear-keywords]").click();
  await expect(chips).toHaveCount(0);
  await expect(input).toHaveValue(/关键词：（未填）/);
  await expect(send).toBeDisabled();
});

test("keyword chips keep spaces and ignore duplicates", async ({ page }) => {
  await openDiscovery(page);
  const card = page.locator("[data-discovery-search-card]");
  const chips = card.locator("[data-discovery-keyword-chip]");
  const input = card.locator("[data-discovery-keywords-input]");

  // 回车添加：英文短语里的空格属于词本身，不拆成两个芯片。
  await input.fill("beauty review");
  await input.press("Enter");
  await expect(card.locator('[data-discovery-keyword-chip="beauty review"]')).toBeVisible();
  await expect(chips).toHaveCount(3);
  await expect(input).toHaveValue("");

  // 重复词（大小写不敏感）不重复添加。
  await input.fill("Camping");
  await input.press("Enter");
  await expect(chips).toHaveCount(3);
  await expect(card.locator('[data-discovery-keyword-chip="Camping"]')).toHaveCount(0);
});

test("modifying a condition flips pristine state and appends suggested keywords", async ({ page }) => {
  await openDiscovery(page);
  const card = page.locator("[data-discovery-search-card]");
  const camping = card.locator('[data-skill-param="directions"] [data-discovery-chip="camping"]');
  const followers = card.locator('[data-skill-param="min_followers"] input');

  await expect(followers).toHaveAttribute("data-discovery-pristine", "true");
  // 方向是固定分类：选中后把该方向的关键词并入关键词芯片，但不覆盖人工输入。
  await camping.click();
  await expect(camping).toHaveAttribute("aria-pressed", "true");
  await expect(card.locator('[data-discovery-keyword-chip="outdoor camping"]')).toBeVisible();

  // 阈值一旦改动就不再是默认值（pristine 只负责「还没动过」的视觉弱化）。
  await followers.fill("25000");
  await expect(followers).toHaveAttribute("data-discovery-pristine", "false");
});

test("the ask button and latest-control are round, with a pink ready button", async ({ page }) => {
  await openDiscovery(page);
  const send = page.locator("[data-home] [data-ai-prompt-submit]");
  await expect(send).toBeEnabled();
  const sendBox = await send.boundingBox();
  expect(sendBox).not.toBeNull();
  expect(sendBox?.width).toBe(32);
  expect(sendBox?.height).toBe(32);
  // 唯一的 L1 实底主 CTA：品牌粉实底（--primary）+ 白箭头（--primary-fg），不是粉箭头压在深底上。
  await expect(send).toHaveCSS("background-color", "rgb(219, 24, 96)");
  await expect(send).toHaveCSS("border-radius", "999px");
  await expect(send.locator('[data-send-arrow="ready"]')).toHaveCSS("color", "rgb(255, 255, 255)");

  const jumpBox = await page.evaluate(() => {
    const probe = document.createElement("button");
    probe.className = "scope-scroll-jump";
    document.body.append(probe);
    const style = getComputedStyle(probe);
    const box = { width: style.width, height: style.height, radius: style.borderRadius };
    probe.remove();
    return box;
  });
  // 「回到最新」是正圆，不能退化成 6px 方角（DESIGN v3 §4 圆形控件）。
  expect(jumpBox).toEqual({ width: "32px", height: "32px", radius: "999px" });
});

test("the middle column keeps ①–③ before submit and appends ④–⑥ after", async ({ page }) => {
  await stubNoRuns(page);
  // 还没有任何提案：④ 是等待态，⑤ 不出现确认按钮。
  await stubRuntimeActions(page, () => []);
  await stubDiscoverySubmit(page);

  await openDiscovery(page);
  const flow = page.locator("[data-discovery-flow] [data-discovery-event]");
  const kinds = () => flow.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-discovery-event")));

  await expect(flow).toHaveCount(3);
  expect(await kinds()).toEqual(["skill", "guidance", "conditions"]);

  // ① 技能说明：flat 平铺（使用边界/异常与恢复不再是折叠块）、只读 kicker。
  const skill = page.locator('[data-discovery-event="skill"]');
  await expect(skill).toContainText("采集线索");
  await expect(skill).toContainText("技能交互模板 · 只读");
  await expect(skill.locator('[data-skill-template-context][data-skill-template-flat="true"]')).toBeVisible();
  await expect(skill.locator("[data-skill-template-no-required]")).toBeVisible();
  // ② 引导：说明条件都可选、提交后先核对参数再确认。
  await expect(page.locator('[data-discovery-event="guidance"] [data-discovery-guidance]'))
    .toContainText("提交后先核对实际采集参数");
  // ③ 条件卡：技能块排在条件卡之前（技能说明是流里的第一个事件）。
  await expect(page.locator('[data-discovery-event="conditions"] [data-discovery-search-card]')).toBeVisible();
  expect(await page.evaluate(() => {
    const first = document.querySelector('[data-discovery-event="skill"]');
    const card = document.querySelector('[data-discovery-event="conditions"]');
    return Boolean(first && card && first.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING);
  })).toBeTruthy();
  // 未提交：④⑤⑥ 都不存在。
  for (const kind of ["params", "confirm", "run"]) {
    await expect(page.locator(`[data-discovery-event="${kind}"]`)).toHaveCount(0);
  }

  await page.locator("[data-home] [data-ai-prompt-submit]").click();
  await expect(flow).toHaveCount(6);
  expect(await kinds()).toEqual(["skill", "guidance", "conditions", "params", "confirm", "run"]);
  // 事件块自带的序号与 DOM 顺序一致。
  expect(await flow.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-discovery-event-index"))))
    .toEqual(["1", "2", "3", "4", "5", "6"]);
  // 提交后不跳转：这次协作仍在本页。
  await expect(page).not.toHaveURL(/\/s\//);
  // ④ 参数还没有提案 = 等待态；⑤ 待服务端提出动作，确认按钮此刻不存在。
  await expect(page.locator('[data-discovery-event="params"]')).toHaveAttribute("data-discovery-event-state", "waiting");
  await expect(page.locator("[data-discovery-params-waiting]")).toBeVisible();
  await expect(page.locator("[data-discovery-params-status]")).toHaveText("整理中");
  await expect(page.locator('[data-discovery-event="confirm"]')).toHaveAttribute("data-discovery-event-state", "waiting_proposal");
  await expect(page.locator("[data-discovery-start-detail]")).toContainText("整理本次采集范围");
  await expect(page.locator("[data-discovery-start-confirm]")).toHaveCount(0);
  await expect(page.locator("[data-discovery-start-cancel]")).toHaveCount(0);
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
  await stubDiscoverySubmit(page, { taskId: "tsk_disc_failed", sessionId: "ses_disc_failed" });
  await stubRuntimeActions(page, () => [runtimeAction("running", runningCrawl("rt_failed"))]);
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

  await openDiscovery(page);
  await page.locator("[data-home] [data-ai-prompt-submit]").click();

  // 失败是这条过程流的终点：后面的事件不得被画成后续成功里程碑。
  const trail = page.locator('[data-discovery-flow] [data-discovery-event="run"]');
  await expect(trail.locator('[data-discovery-step="failed"]')).toContainText("失败原因：读取远程采集日志未完成");
  await expect(trail.locator("[data-discovery-run-steps]")).not.toContainText("采集完成");
  await expect(trail.locator("[data-discovery-run-steps]")).not.toContainText("整理候选");
  await expect(trail.locator("[data-discovery-run-steps]")).not.toContainText("已排出候选");
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
  await stubRuntimeActions(page, () => []);
  // 通过 ?resume= 恢复现场：本页绑定该任务，再按 work_item_id 命中这次失败运行
  // （AI发现 不自动认领历史运行，恢复入口就是这条深链）。
  await page.route("**/api/home/discovery/workspace/**/pending", (route) => route.fulfill({ json: { pending: null } }));
  await page.route(/\/api\/tasks\/tsk_capacity_failed(?:\?.*)?$/, (route) => route.fulfill({
    json: { task: resumeTask("tsk_capacity_failed", "ses_capacity_failed") },
  }));

  await page.goto("/?tab=discovery&resume=tsk_capacity_failed");
  const summary = page.locator("[data-discovery-ai-summary]");
  await expect(summary).toContainText("需要处理");
  await expect(summary).toContainText("检索没有完成");
  await expect(summary).toContainText("原始 32 · 入围 17");
  await expect(summary).toContainText("检索没有完成，可稍后重试。");
  await expect(summary.locator("[data-discovery-retry]")).toHaveText("重试");
  await expect(summary.locator("[data-discovery-error-detail]")).toBeHidden();
  await expect(page.getByText(/历史发现/)).toHaveCount(0);

  await summary.locator("[data-discovery-error-details-toggle]").click();
  await expect(summary.locator("[data-discovery-error-detail]"))
    .toContainText("生成服务结束状态：failed；Selected model is at capacity.");
});

test("a discovery task resumes its linked run instead of a chat session", async ({ page }) => {
  await mockExistingRun(page);
  await stubRuntimeActions(page, () => []);
  await openDiscoveryWithRun(page);
  // 打开的是这次运行的结果面：条件卡原位只读、右栏是这批候选，而不是聊天会话。
  await expect(page.locator("[data-discovery-edit-conditions]")).toBeVisible();
  await expect(page.locator('[data-discovery-candidate="TheSolarLab"]')).toBeVisible();
  await expect(page.locator("[data-discovery-panel]")).not.toContainText("历史发现");
});

test("condition chips rewrite the ask-box body and the card footer keeps note plus submit", async ({ page }) => {
  await openDiscovery(page);
  const card = page.locator("[data-discovery-search-card]");
  const input = page.locator("[data-home] [data-composer-input]");
  await card.locator('[data-skill-param="directions"] [data-discovery-chip="camping"]').click();
  await expect(input).toHaveValue(/户外露营/);
  await expect(card.locator('[data-discovery-keyword-chip="camping"]')).toBeVisible();
  // 框线稿 §15：卡片底部只有一行 —— 说明在左、主操作在右。
  await expect(card.locator("[data-discovery-card-note]")).toBeVisible();
  await expect(card.locator("[data-discovery-card-submit]")).toBeVisible();
  await expect(card.locator("[data-discovery-card-submit]")).toHaveText("提交条件，核对参数");
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
  // 双栏按结果可读性分配：右栏拿到 DESIGN 记录的 820 上限，中栏吃掉剩下的宽度，
  // 两列合起来正好是工作台宽度（右栏可以宽于中栏）。
  const centerWidth = await center.evaluate((element) => element.clientWidth);
  expect(centerWidth).toBeGreaterThan(0);
  const workspaceWidth = await workspace.evaluate((element) => element.clientWidth);
  expect(Math.abs(centerWidth + discoveryRailWidth - workspaceWidth)).toBeLessThanOrEqual(4);
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
  const card = workspace.locator("[data-discovery-search-card]");
  const followerRange = card.locator('[data-skill-param-group="followers_range"]');
  const metricPair = card.locator('[data-skill-param-group="discovery_metrics"]');
  const followerMin = card.locator('[data-skill-param="min_followers"]');
  const followerMax = card.locator('[data-skill-param="max_followers"]');
  const avgPlays = card.locator('[data-skill-param="min_avg_plays_10"]');
  const expectedCount = card.locator('[data-skill-param="expect_count"]');

  await expect(followerRange).toHaveAccessibleName("粉丝数范围");
  await expect(metricPair).toBeVisible();
  await expect(followerMin.locator("input")).toHaveValue("10,000");
  // 默认口径是「上限不限」：输入框留空，占位文字写不限。
  await expect(followerMax.locator("input")).toHaveValue("");
  await expect(followerMax.locator("input")).toHaveAttribute("placeholder", "不限");
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
  const keywords = card.locator("[data-discovery-keywords-input]");

  // R2/R5：平台默认 YouTube + 默认关键词，所以提问框的发送按钮默认可用。
  await expect(send).toBeEnabled();

  // 清空关键词（芯片控件）：添加一个词后又清空，条件不完整时发送按钮禁用。
  await keywords.fill("户外露营");
  await keywords.press("Enter");
  await expect(card.locator('[data-discovery-keyword-chip="户外露营"]')).toBeVisible();
  await expect(send).toBeEnabled();
  await card.locator("[data-discovery-clear-keywords]").click();
  await expect(send).toBeDisabled();

  await keywords.fill("户外露营");
  await keywords.press("Enter");
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

// 下面几条只关心提交路径，不关心已有 run：列表恒为空。
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

const WORKSPACE_ACCEPTED = {
  task_id: DISCOVERY_TASK_ID,
  session_id: DISCOVERY_SESSION_ID,
  pending: DISCOVERY_PENDING,
};

/**
 * 新模型（结果明细单决策面）的运行与候选：右栏候选只从 home-discovery runs 来，
 * 不再读 runtime actions 的 result_json。
 */
function homeRunFixture() {
  return {
    id: "run_disc_e2e",
    work_item_id: DISCOVERY_TASK_ID,
    status: "succeeded",
    brief_version: 1,
    created_at: "2026-10-06T09:00:00.000Z",
  };
}

function homeCandidateFixture() {
  return {
    id: "cand_e2e",
    nickname: "E2E 候选",
    platform: "youtube",
    platform_creator_id: "e2e-1",
    followers: 12000,
    avg_plays_10: 8000,
    ingest_readiness: "ready",
    match_reason: "名称含 camping",
  };
}

async function stubRunsWithCandidate(page: Page) {
  await page.route("**/api/home/discovery/runs**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/candidates")) {
      void route.fulfill({ json: { run_id: "run_disc_e2e", candidates: [homeCandidateFixture()] } });
      return;
    }
    if (/\/runs\/[^/]+$/.test(path)) {
      void route.fulfill({ json: { run: homeRunFixture() } });
      return;
    }
    void route.fulfill({ json: { runs: [homeRunFixture()] } });
  });
  await page.route("**/api/tasks/**/events", (route) => route.fulfill({ json: { events: [] } }));
}

test("send on the discovery path shows ▪ and clears the box before the request resolves", async ({ page }) => {
  const gate: { release?: () => void } = {};
  const held = new Promise<void>((resolve) => { gate.release = resolve; });
  await stubNoRuns(page);
  await stubDiscoverySubmit(page, { onPost: () => held });

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

test("the wait card streams one intent copy on the discovery path", async ({ page }) => {
  const gate: { release?: () => void } = {};
  const held = new Promise<void>((resolve) => { gate.release = resolve; });
  await stubNoRuns(page);
  await stubDiscoverySubmit(page, { onPost: () => held });

  await openDiscovery(page);
  await page.locator("[data-home] [data-ai-prompt-submit]").click();

  const card = page.locator("[data-home] [data-kind='recognizing']");
  await expect(card).toHaveAttribute("data-wait-status", "识别中");
  // 逐字流式：先露出开头的字，讲完才 done；文案是那一份统一的意图口径。
  const stream = card.locator("[data-wait-stream]");
  await expect(stream).toContainText("读懂了");
  await expect(stream).toHaveAttribute("data-wait-stream", "done", { timeout: 5000 });
  await expect(stream).toContainText("正在分析你的问题");
  await expect(stream).toContainText("开始执行");
  await expect(card.locator("[data-recognize-elapsed]")).toContainText("已等待");
  // 旧邮件口径不得再出现在等待卡里。
  await expect(card).not.toContainText("发件、收件");

  gate.release?.();
  await expect(card).toHaveCount(0);
});

test("a 403 submit failure stays on the AI发现 surface", async ({ page }) => {
  await stubNoRuns(page);
  await page.route("**/api/home/discovery/workspace", (route) => route.fulfill({
    status: 403,
    contentType: "application/json",
    body: JSON.stringify({ detail: { code: "skill_not_granted", skill_id: "creator_discovery" } }),
  }));

  await openDiscovery(page);
  await page.locator("[data-home] [data-ai-prompt-submit]").click();
  const error = page.locator("[data-home] [data-home-discovery-submit-error-message]");
  await expect(error).toContainText("技能未授权");
  await expect(error).not.toContainText("请求失败 (403)");
  await expect(page.locator("[data-home] [data-home-discovery-submit-error] button")).toBeVisible();

  // 失败态属于 AI发现 这一面：切到任何其他页签都不得跟着出现。
  for (const tab of ["today", "todo", "pool", "lifecycle"]) {
    await page.locator(`[data-home-mode="${tab}"]`).click();
    await expect(page.locator(`[data-home-pane="${tab}"]`)).toBeVisible();
    await expect(page.locator("[data-home] [data-home-discovery-submit-error]")).toHaveCount(0);
    await expect(page.locator("[data-home] [data-home-discovery-submit-error-message]")).toHaveCount(0);
    await expect(page.locator("[data-home] .composer-err")).toHaveCount(0);
  }

  await page.locator('[data-home-mode="discovery"]').click();
  await expect(page.locator("[data-home] [data-home-discovery-submit-error-message]")).toContainText("技能未授权");
});

test("a 502 on submit offers 重试, and retrying resubmits", async ({ page }) => {
  let attempts = 0;
  await stubNoRuns(page);
  await stubPendingTurn(page);
  await page.route("**/api/home/discovery/workspace", async (route) => {
    attempts += 1;
    if (attempts === 1) {
      await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({}) });
      return;
    }
    await route.fulfill({ json: WORKSPACE_ACCEPTED });
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

test("a transient first-analysis dispatch recovers without creating a second workspace", async ({ page }) => {
  let workspacePosts = 0;
  let messagePosts = 0;
  let pendingReads = 0;
  await stubNoRuns(page);
  await page.route("**/api/home/discovery/workspace", (route) => {
    workspacePosts += 1;
    return route.fulfill({ json: WORKSPACE_ACCEPTED });
  });
  await page.route(`**/api/sessions/${DISCOVERY_SESSION_ID}/messages`, (route) => {
    messagePosts += 1;
    if (messagePosts === 1) {
      return route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ detail: "服务正在重启" }),
      });
    }
    return route.fulfill({ json: { messages: [], agent_status: "running", accepted: true } });
  });
  await page.route(`**/api/home/discovery/workspace/${DISCOVERY_TASK_ID}/pending`, (route) => {
    pendingReads += 1;
    return route.fulfill({ json: { pending: DISCOVERY_PENDING } });
  });

  await openDiscovery(page);
  await page.locator("[data-home] [data-ai-prompt-submit]").click();

  await expect.poll(() => messagePosts).toBe(2);
  expect(workspacePosts).toBe(1);
  expect(pendingReads).toBeGreaterThan(0);
  await expect(page.locator("[data-home] [data-home-discovery-submit-error]")).toHaveCount(0);
});

test("▪ during a discovery submit aborts the client side and posts no cancel", async ({ page }) => {
  const gate: { release?: () => void } = {};
  const held = new Promise<void>((resolve) => { gate.release = resolve; });
  const cancelPosts: string[] = [];
  page.on("request", (item) => {
    const path = new URL(item.url()).pathname;
    if (item.method() === "POST" && CANCEL_STOP_WRITE.test(path)) cancelPosts.push(path);
  });
  await stubNoRuns(page);
  await stubDiscoverySubmit(page, { onPost: () => held });

  await openDiscovery(page);
  await page.locator("[data-home] [data-ai-prompt-submit]").click();
  const stop = page.locator("[data-home] [data-send-state='stop']");
  await expect(stop).toBeVisible();
  await stop.click();
  await expect(page.locator("[data-home] [data-home-stopping]")).toBeVisible();

  gate.release?.();
  // ▪ 只中止客户端后续动作：不调用后端取消/停止，也不改任何服务端状态。
  await expect(stop).toHaveCount(0);
  expect(cancelPosts).toEqual([]);
});

test("submit posts the workspace endpoint, streams the run trail, and ingests to pool", async ({ page }) => {
  const livePosts: string[] = [];
  const submitPosts: string[] = [];
  const submitBodies: unknown[] = [];
  const followPosts: string[] = [];
  const claimPosts: string[] = [];
  const ingestBodies: unknown[] = [];
  let eventTick = 0;
  let ran = false;
  let crawlState = "running";
  page.on("request", (item) => {
    const path = new URL(item.url()).pathname;
    expect(path).not.toMatch(BANNED_BATCH_PATH);
    if (item.method() !== "POST") return;
    if (LIVE_SIDE_EFFECT.test(path)) livePosts.push(path);
    if (path === "/api/home/discovery/workspace") submitPosts.push(path);
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
  // 提交只写工作区记录；过程事件与受控动作按 task / session 读。
  await stubDiscoverySubmit(page, {
    onPost: (body) => {
      ran = true;
      submitBodies.push(body);
    },
  });
  await stubRuntimeActions(page, () => [
    runtimeAction(crawlState, crawlState === "running" ? runningCrawl("rt_disc_e2e") : null),
  ]);
  await page.route("**/api/tasks/tsk_disc_e2e/events", (route) => {
    eventTick += 1;
    if (eventTick >= 2) crawlState = "succeeded";
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
  await expect.poll(() => submitPosts).toEqual(["/api/home/discovery/workspace"]);
  // 载荷带着条件与阈值名字（后端按 min_avg_plays_10 / expect_count 读），以及正文与提交身份。
  expect(submitBodies).toEqual([expect.objectContaining({
    version: expect.any(String),
    request_id: expect.any(String),
    text: expect.stringContaining("【发现任务】"),
    brief: expect.objectContaining({
      platforms: ["youtube"],
      keywords: ["camping", "portable power station"],
      min_avg_plays_10: 5000,
      expect_count: 30,
    }),
  })]);
  // 提交后不跳转：⑥ 采集执行的事件流就在本页中栏。
  await expect(page).not.toHaveURL(/\/s\//);
  const trail = page.locator('[data-discovery-flow] [data-discovery-event="run"]');
  await expect(trail).toContainText("排队");
  await expect(trail).toContainText("开始搜索关键词");
  await expect(trail).toContainText("已收到 40 条");
  await expect(trail).toContainText("采集结束去重后 28 条");
  await expect(trail).toContainText("已排出候选");

  // 候选仍来自既有的 run 路径：右栏结果区原位更新。
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
  await expect(page.locator("[data-discovery-next-plan]")).toContainText("核对线索后选择入库对象");
  // 右栏顶部的当前任务状态跟着采集回执走（远端已结束）。
  await expect(page.locator('[data-scope-task-rail] [data-discovery-run-status="completed"]')).toBeVisible();
  await expect(page.locator('[data-scope-task-rail] [data-discovery-run-status-label]')).toContainText("已完成");
  await expect(page.locator('[data-discovery-params-executed]')).toContainText("YouTube");
  await expect(page.locator("[data-discovery-ingest]")).toBeDisabled();
  await page.locator('[data-discovery-result-filter="existing"]').click();
  await expect(page.locator('[data-discovery-candidate="NoStats"]')).toBeVisible();
  await expect(page.locator('[data-discovery-select="cand_zero"]')).toBeDisabled();
  await page.locator('[data-discovery-result-filter="all"]').click();
  await solar.locator('[data-lead-expand]').click();
  await expect(solar.locator('[data-lead-detail]')).toBeVisible();
  // 结果筛选与查看详情都是纯前端交互，不得再次启动发现任务。
  expect(submitPosts).toEqual(["/api/home/discovery/workspace"]);

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
  await expect(page.locator("[data-nav='running'] .nav-badge")).not.toHaveText("0");
});

test("after submit the condition card stays read-only in place and 修改条件 returns it to edit", async ({ page }) => {
  const submitPosts: string[] = [];
  page.on("request", (item) => {
    if (item.method() === "POST" && new URL(item.url()).pathname === "/api/home/discovery/workspace") {
      submitPosts.push(new URL(item.url()).pathname);
    }
  });
  await stubNoRuns(page);
  await stubRuntimeActions(page, () => [runtimeAction("pending")]);
  await stubDiscoverySubmit(page);
  await page.route("**/api/tasks/tsk_disc_e2e/events", (route) => route.fulfill({
    json: {
      events: [
        { type: "queued", created_at: "2026-09-24T06:32:05.000Z" },
        { type: "crawl.started", created_at: "2026-09-24T06:32:06.000Z" },
      ],
    },
  }));
  // 「修改条件」会取消未确认的提案：本用例只关心卡片原位回来，取消别打到真实后端。
  await page.route("**/api/actions/runtime.cancel", (route) => route.fulfill({ json: { state: "cancelled" } }));

  await openDiscovery(page);
  const card = page.locator("[data-discovery-search-card]");
  await expect(card).toHaveAttribute("data-param-mode", "edit");
  await expect(page.locator("[data-discovery-edit-conditions]")).toHaveCount(0);
  await page.locator("[data-home] [data-ai-prompt-submit]").click();

  // 提交后卡片原位转只读（数值保留），不再消失；中栏保留 ④⑤⑥。
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("data-param-mode", "ready");
  await expect(card.locator('[data-discovery-keyword-static="camping"]')).toBeVisible();
  await expect(page.locator('[data-discovery-event="conditions"]')).toHaveAttribute("data-discovery-event-state", "readonly");
  await expect(page.locator("[data-discovery-edit-conditions]")).toHaveText("修改条件");
  const flow = page.locator("[data-discovery-flow] [data-discovery-event]");
  await expect(flow).toHaveCount(6);
  for (const index of ["4", "5", "6"]) {
    await expect(page.locator(`[data-discovery-event-index="${index}"]`)).toBeVisible();
  }
  // ⑥ 步骤与时间来自 /api/tasks/:id/events；未确认前不得声称正在采集。
  const trail = page.locator('[data-discovery-event="run"]');
  await expect(trail).toContainText("排队");
  await expect(trail).toContainText("等待确认");
  await expect(trail).toContainText("还没有开始采集");
  // 步骤标签可能来自真实事件（例如 crawl.started 就叫「正在采集」），所以看状态位而不是整块文本。
  await expect(trail.locator("[data-discovery-run-title]")).toHaveText("等待确认");
  await expect(trail.locator("[data-discovery-run-status]")).toHaveText("待确认");
  await expect(trail.locator("[data-discovery-run-stop]")).toHaveCount(0);
  await expect(trail.locator("[data-discovery-step-time]").first()).toHaveText(/^\d{2}:\d{2}:\d{2}$/);
  // 结果容器只在右栏；下一步计划属于中栏的人机交互。
  await expect(page.locator("[data-scope-task-rail] [data-discovery-panel]")).toHaveCount(1);
  await expect(page.locator("[data-scope-ai-workspace] [data-discovery-panel]")).toHaveCount(0);
  await expect(page.locator("[data-scope-ai-workspace] [data-discovery-next-plan]")).toHaveCount(1);
  await expect(page.locator("[data-scope-task-rail] [data-discovery-next-plan]")).toHaveCount(0);

  // 恢复入口在条件卡块头上：点「修改条件」原位回到编辑，不会自动重跑。
  // 先做一次命中检测（trial），避免流内新事件导致的布局移动把这次点击点空。
  const edit = page.locator("[data-discovery-edit-conditions]");
  await edit.scrollIntoViewIfNeeded();
  await edit.click({ trial: true });
  await edit.click();
  await expect(page.locator('[data-discovery-event="conditions"]')).toHaveAttribute("data-discovery-event-state", "edit", { timeout: 10000 });
  await expect(card).toHaveAttribute("data-param-mode", "edit");
  expect(submitPosts).toEqual(["/api/home/discovery/workspace"]);
});

test("远端采集中尚无候选时不误报筛选无结果", async ({ page }) => {
  const base = runningCrawl("rt_waiting");
  const crawl = { ...base, result_state: "pending", result_json: { ...base.result_json, candidates: [] } };
  await stubRuntimeActions(page, () => [runtimeAction("running", crawl)]);
  await openDiscoveryWithRun(page);
  await expect(page.locator('[data-scope-task-rail] [data-discovery-run-status="running"]')).toBeVisible();
  await expect(page.locator('[data-discovery-empty="filtered"]')).toHaveCount(0);
  await expect(page.locator('[data-discovery-empty="waiting-results"]')).toContainText("正在等待候选结果");
});

test("页内确认闭环：确认只发一次，随后右栏状态与中栏执行事件继续更新", async ({ page }) => {
  const gate: { release?: () => void } = {};
  const held = new Promise<void>((resolve) => { gate.release = resolve; });
  const confirmBodies: unknown[] = [];
  let actions: unknown[] = [runtimeAction("pending")];
  await stubRunsWithCandidate(page);
  await stubRuntimeActions(page, () => actions);
  await stubDiscoverySubmit(page);
  await page.route("**/api/actions/runtime.confirm", async (route) => {
    confirmBodies.push(route.request().postDataJSON());
    await held;
    // 服务端接受确认后：同一动作转为运行中，并带出采集回执与候选。
    actions = [runtimeAction("running", runningCrawl("rt_1"))];
    await route.fulfill({ json: { state: "running" } });
  });
  let events: unknown[] = [];
  await page.route("**/api/tasks/tsk_disc_e2e/events", (route) => route.fulfill({ json: { events } }));

  await openDiscovery(page);
  const card = page.locator("[data-discovery-search-card]");
  // 粉丝上限留空 = 不限（null，不是 0）。
  const maxFollowers = card.locator("input[data-discovery-max-followers]");
  await expect(card.locator('[data-skill-param-group="followers_range"] [data-discovery-followers-hint]')).toBeVisible();
  await maxFollowers.fill("");
  await expect(maxFollowers).toHaveValue("");
  await expect(maxFollowers).toHaveAttribute("placeholder", "不限");

  await page.locator("[data-home] [data-ai-prompt-submit]").click();

  // ④ 实际采集参数来自会话动作的 arguments；采集后核对项来自条件。
  const params = page.locator('[data-discovery-event="params"]');
  await expect(params).toHaveAttribute("data-discovery-event-state", "ready");
  await expect(params.locator("[data-discovery-params-status]")).toHaveText("已核对");
  await expect(params.locator("[data-discovery-params-executed]")).toContainText("YouTube");
  await expect(params.locator('[data-discovery-params-executed] [data-discovery-param="max_notes_count"]')).toContainText("50");
  await expect(params.locator('[data-discovery-params-checked-after] [data-discovery-param="followers"]')).toContainText("不限");

  // ⑤ 待确认：确认前不发采集。
  const confirmBlock = page.locator('[data-discovery-event="confirm"]');
  await expect(confirmBlock).toHaveAttribute("data-discovery-event-state", "pending");
  await expect(page.locator("[data-discovery-start-status]")).toHaveText("等待你确认");
  const confirm = page.locator("[data-discovery-start-confirm]");
  await expect(confirm).toBeEnabled();
  await expect(page.locator("[data-discovery-start-cancel]")).toBeVisible();
  await expect(page.locator('[data-scope-task-rail] [data-discovery-run-status="waiting"]')).toBeVisible();

  await confirm.click();
  // 点击确认后立即是「已确认，正在启动」，确认按钮与取消一起消失（禁止重复提交）。
  await expect(confirmBlock).toContainText("已确认，正在启动");
  await expect(confirm).toHaveCount(0);
  await expect(page.locator("[data-discovery-start-cancel]")).toHaveCount(0);

  gate.release?.();
  await expect.poll(() => confirmBodies)
    .toEqual([{ action_id: "act_disc_e2e", confirmation_version: "v1" }]);
  expect(confirmBodies).toHaveLength(1);
  await expect(page.locator("[data-discovery-start-confirm]")).toHaveCount(0);

  // 服务端接着走：右栏状态头、session runtime 回执与候选，以及中栏执行事件同步更新。
  await expect(page.locator('[data-scope-task-rail] [data-discovery-run-status="running"]')).toBeVisible();
  await expect(page.locator("[data-scope-task-rail] [data-discovery-run-status-label]")).toContainText("采集中");
  events = [{ type: "queued" }, { type: "crawl.started" }];
  const trail = page.locator('[data-discovery-event="run"]');
  await expect(trail.locator("[data-discovery-run-steps]")).toContainText("排队");
  await expect(trail).toContainText("正在采集");
});

test("修改条件让本次核对失效，并取消未确认的提案", async ({ page }) => {
  const posts: string[] = [];
  page.on("request", (item) => {
    if (item.method() === "POST") posts.push(new URL(item.url()).pathname);
  });
  await stubNoRuns(page);
  await stubRuntimeActions(page, () => [runtimeAction("pending")]);
  await stubDiscoverySubmit(page);
  // 「修改条件」会取消未确认的提案：断言它只发一次，别打到真实后端。
  await page.route("**/api/actions/runtime.cancel", (route) => route.fulfill({ json: { state: "cancelled" } }));

  await openDiscovery(page);
  await page.locator("[data-home] [data-ai-prompt-submit]").click();

  // 提交后：条件只读、参数已核对、确认入口可用。
  await expect(page.locator("[data-discovery-search-card]")).toHaveAttribute("data-param-mode", "ready");
  await expect(page.locator('[data-discovery-event="params"]')).toHaveAttribute("data-discovery-event-state", "ready");
  await expect(page.locator("[data-discovery-start-confirm]")).toBeEnabled();

  // 先做一次命中检测（trial），避免流内新事件导致的布局移动把这次点击点空。
  const editConditions = page.locator("[data-discovery-edit-conditions]");
  await editConditions.scrollIntoViewIfNeeded();
  await editConditions.click({ trial: true });
  await editConditions.click();
  // 条件卡回到编辑态，旧核对立即标记失效。
  await expect(page.locator('[data-discovery-event="conditions"]')).toHaveAttribute("data-discovery-event-state", "edit", { timeout: 10000 });
  await expect(page.locator("[data-discovery-search-card]")).toHaveAttribute("data-param-mode", "edit");
  await expect(page.locator('[data-discovery-event="params"]')).toHaveAttribute("data-discovery-event-state", "stale");
  await expect(page.locator("[data-discovery-params-stale]")).toContainText("条件已修改");
  await expect(page.locator("[data-discovery-start-blocked]")).toContainText("条件已修改");
  // 确认入口被拦：要么不存在，要么禁用。
  const confirm = page.locator("[data-discovery-start-confirm]");
  await expect.poll(async () => {
    if (!(await confirm.count())) return "absent";
    return (await confirm.first().isDisabled()) ? "disabled" : "enabled";
  }).not.toBe("enabled");
  // 中栏仍是同一条事件流（⑥ 不清空、也不跳转）。
  await expect(page.locator("[data-discovery-flow] [data-discovery-event]")).toHaveCount(6);

  // 未确认的旧提案被取消：只发一次 cancel，且没有任何 start-crawl / stop / retry 写动作。
  await expect.poll(() => posts.filter((path) => path === "/api/actions/runtime.cancel"))
    .toEqual(["/api/actions/runtime.cancel"]);
  expect(posts.filter((path) => CANCEL_STOP_WRITE.test(path) && path !== "/api/actions/runtime.cancel")).toEqual([]);
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
  await openDiscoveryWithRun(page);
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
  await openDiscoveryWithRun(page);
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
  await openDiscoveryWithRun(page);
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
  await page.route("**/api/discovery/connection", (route) => route.fulfill({
    json: { status: "ok", status_label: "已连接", message: "采集服务响应正常", connected: true },
  }));
  await openDiscovery(page);
  await expect(page.locator("[data-discovery-ai-summary]")).toContainText("服务不可用");
  await expect(page.locator("[data-discovery-headline]")).toHaveText("暂时无法开始发现红人");
  await expect(page.locator("[data-discovery-counts]")).toHaveText("检索尚未开始");
  await expect(page.locator("[data-discovery-primary-finding]")).toContainText("本次任务尚未启动");
  await expect(page.locator("[data-discovery-service-state]")).toContainText("输入条件已保留");
  await expect(page.locator("[data-discovery-service-actions] [data-discovery-retry]")).toHaveText("重新尝试");
  await expect(page.locator("[data-discovery-empty='down']")).toHaveCount(0);
  await expect(page.locator("[data-discovery-panel]")).not.toContainText("没有红人线索");
  await expect(page.locator("[data-discovery-plan='connection']")).toBeVisible();
  await page.locator("[data-discovery-plan-action='connection']").click();
  await expect(page.locator("[data-discovery-plan-connection='ok']")).toContainText("采集服务：已连接");
});

/**
 * 线上取证回归（2026-10-06 19:33–19:36 的真实会话）：
 * - task_events 里 `run.started` 的 safe_summary 是技能 id `crawler_collect`，
 *   早先被整条 blob 匹配 /crawl|采集/，于是员工还没确认就出现一条「正在采集」；
 * - 交付任务收尾（run.completed）后过程流没有停表，⑥ 一直写「正在采集 / 进行中」，
 *   与 ⑤ 的「执行失败」自相矛盾；
 * - runtime.actions 是 created_at DESC，确认卡取的却是最旧一条，
 *   于是「核对后重试」提出的新提案永远不显示，按钮看起来完全无效。
 */
const PREP_STREAM = [
  { type: "run.started", status: "running", label: "任务开始处理", safe_summary: "crawler_collect", created_at: "2026-10-06T11:33:49.984Z" },
  { type: "run.progress", status: "running", label: "加载任务规则", created_at: "2026-10-06T11:33:53.244Z" },
  { type: "run.progress", status: "running", label: "整理结果", created_at: "2026-10-06T11:33:56.486Z" },
  { type: "run.progress", status: "running", label: "校验输出", created_at: "2026-10-06T11:34:06.450Z" },
  { type: "run.completed", status: "completed", label: "结果已生成", created_at: "2026-10-06T11:34:06.539Z" },
];

function rejectedBusyAction() {
  return {
    ...runtimeAction("rejected"),
    error_code: "runtime_probe_crawl_busy",
    execution: { id: "exec_disc_e2e", status: "failed", error_code: "runtime_probe_crawl_busy" },
    progress: {
      state: "rejected",
      label: "采集未启动 · 已有任务占用",
      summary: "此前采集仍占用采集服务，本次启动未执行。请先核对已有任务的终态，再重新核对并确认启动。",
      replace_result: true,
      result: { type: "task_result", title: "采集未启动 · 已有任务占用", summary: "", sections: [], metrics: [], recommended_actions: [] },
    },
    created_at: "2026-10-06T11:34:03.005Z",
  };
}

test("the preparation trail never claims a collection before the employee confirms", async ({ page }) => {
  await stubNoRuns(page);
  await stubRuntimeActions(page, () => [{ ...runtimeAction("pending"), created_at: "2026-10-06T11:34:03.005Z" }]);
  await stubDiscoverySubmit(page);
  await page.route("**/api/tasks/tsk_disc_e2e/events", (route) => route.fulfill({ json: { events: PREP_STREAM } }));

  await openDiscovery(page);
  await page.locator("[data-home] [data-ai-prompt-submit]").click();

  const trail = page.locator('[data-discovery-event="run"]');
  // 提交与准备阶段的记录如实转写（图 1 里那条 19:33:49「正在采集」就是这个事件）。
  await expect(trail).toContainText("任务开始处理");
  await expect(trail).toContainText("加载任务规则");
  await expect(trail.locator("[data-discovery-run-title]")).toHaveText("等待确认");
  await expect(trail.locator("[data-discovery-run-status]")).toHaveText("待确认");
  await expect(trail).not.toContainText("正在采集");
  await expect(trail).not.toContainText("进行中");
  await expect(trail.locator("[data-discovery-run-stop]")).toHaveCount(0);
  await expect(trail.locator('[data-discovery-step="collecting"]')).toHaveCount(0);
});

test("a confirm the server refused reads 未开始 in ⑥ instead of 进行中", async ({ page }) => {
  await stubNoRuns(page);
  await stubRuntimeActions(page, () => [rejectedBusyAction()]);
  await stubDiscoverySubmit(page);
  await page.route("**/api/tasks/tsk_disc_e2e/events", (route) => route.fulfill({ json: { events: PREP_STREAM } }));

  await openDiscovery(page);
  await page.locator("[data-home] [data-ai-prompt-submit]").click();

  // ⑤ 给出服务端结论与原因，不是光秃秃的「执行失败」。
  const confirm = page.locator('[data-discovery-event="confirm"]');
  await expect(confirm).toContainText("执行失败");
  await expect(confirm.locator("[data-discovery-start-reason]")).toContainText("本次启动未执行");
  await expect(confirm.locator("[data-discovery-start-retry]")).toBeEnabled();

  // ⑥ 与 ⑤ 必须一致：采集从未启动，就不能写「正在采集 / 进行中」，也不能给停止入口。
  const trail = page.locator('[data-discovery-event="run"]');
  await expect(trail.locator("[data-discovery-run-title]")).toHaveText("尚未开始");
  await expect(trail.locator("[data-discovery-run-status]")).toHaveText("未开始");
  await expect(trail).not.toContainText("进行中");
  await expect(trail).not.toContainText("已结束");
  await expect(trail.locator("[data-discovery-run-stop]")).toHaveCount(0);
});

test("the newest proposal wins, so 核对后重试 shows a fresh 待确认 card", async ({ page }) => {
  await stubNoRuns(page);
  // 服务端 ORDER BY created_at DESC：最新在前。旧的一条已经失败，新的一条是刚提出的提案。
  await stubRuntimeActions(page, () => [
    { ...runtimeAction("pending"), id: "act_fresh", created_at: "2026-10-06T11:35:56.702Z", progress: null },
    rejectedBusyAction(),
  ]);
  await stubDiscoverySubmit(page);
  await page.route("**/api/tasks/tsk_disc_e2e/events", (route) => route.fulfill({ json: { events: PREP_STREAM } }));
  let retryPosts = 0;
  await page.route("**/api/actions/runtime.crawl.retry", (route) => {
    retryPosts += 1;
    void route.fulfill({ json: { state: "pending" } });
  });

  await openDiscovery(page);
  await page.locator("[data-home] [data-ai-prompt-submit]").click();

  const confirm = page.locator('[data-discovery-event="confirm"]');
  await expect(confirm).toContainText("待确认");
  await expect(confirm.locator("[data-discovery-start-confirm]")).toBeEnabled();
  await expect(confirm).not.toContainText("执行失败");
  expect(retryPosts).toBe(0);
});
