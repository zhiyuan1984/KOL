import { expect, test, type Page } from "@playwright/test";

/**
 * 「我的红人」右栏的两条硬契约（DESIGN §Home Agent 工作台几何 / §控件尺寸，TECH-FE-01）：
 * 1) 读取没回来之前不许下「还没有跟进中的红人」的结论，也不许报 0 计数；
 * 2) 顶部工具行（搜索 + 全选/分析已选/批量进阶段）不重叠，名单总数只在中栏概览出现一次；
 * 3) 右栏宽度按 DESIGN 的 token 分配，五个模式同一份几何。
 */

test.beforeEach(async ({ request }) => {
  await request.post("/api/demo/reset", { data: { workbench: true } });
  await request.post("/api/me/persona", { data: { persona: "sriphy" } });
});

function row(index: number) {
  return {
    id: `col_${index}`,
    kol_uid: `kol_${index}`,
    handle: `红人${index}`,
    display_name: `红人${index}`,
    platform: "YouTube",
    brand: "LT",
    stage_code: "INITIAL_CONTACT",
    stage_label: "初步接触",
    days_in_stage: index,
    mail_threads: [{
      conversation_id: `thread_${index}`,
      subject: `Re: collab ${index}`,
      unread_count: 0,
      last_direction: "inbound",
      last_snippet: "想和贵品牌合作",
      last_at: "2026-09-12T10:00:00.000Z",
    }],
  };
}

function followingEnvelope(kols: Array<Record<string, unknown>>) {
  return {
    entry: "memory",
    kind: "memory",
    creates_session: false,
    calls_model: false,
    index: "我的跟进",
    authority: "kol_follow_index",
    follow_scope: {
      required: false,
      bound: false,
      mailbox_email: "",
      mailbox_id: "",
      owner_name: "",
      status: "unbound",
      has_token: false,
      updated_at: null,
    },
    kols,
  };
}

async function stubBoard(page: Page) {
  await page.route("**/api/home/board*", (route) => route.fulfill({
    json: { kols: [], follow_scope: { required: false, bound: false }, workbench: {} },
  }));
}

async function openFollowed(page: Page) {
  await page.goto("/");
  await page.locator('[data-home-mode="lifecycle"]').click();
  await expect(page.locator('[data-home-pane="lifecycle"]')).toBeVisible();
}

test("右栏顶部工具行：搜索与批量动作在最上、互不重叠，名单总数只在概览出现一次", async ({ page }) => {
  await stubBoard(page);
  await page.route("**/api/home/following", (route) => route.fulfill({
    json: followingEnvelope([row(1), row(2), row(3)]),
  }));
  await openFollowed(page);
  await expect(page.locator('[data-followed-kol="红人1"]')).toBeVisible();

  // 「我的跟进对象」这一行上下文标签不再展示（公海本来就没有）。
  await expect(page.locator("[data-result-context]")).toHaveCount(0);

  // 右栏顺序：工具行（搜索 + 批量动作）→ 名单；阶段导航和概览属于中栏。
  const order = await page.evaluate(() => {
    const rail = document.querySelector('[data-home-pane="lifecycle"] [data-scope-task-rail]')!;
    const find = (selector: string) => rail.querySelector(selector)!;
    const batch = find("[data-followed-object-batch]");
    const list = find("[data-followed-kol-list]");
    return {
      toolbarIsFirst: find("[data-followed-kol-column]").firstElementChild === find("[data-followed-object-toolbar]"),
      batchBeforeList: Boolean(batch.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING),
    };
  });
  expect(order).toEqual({
    toolbarIsFirst: true,
    batchBeforeList: true,
  });

  // 工具行内两个分组不许压在对方身上。
  const overlap = await page.evaluate(() => {
    const bar = document.querySelector("[data-followed-object-toolbar]") as HTMLElement;
    const rects = [...bar.children].map((child) => child.getBoundingClientRect());
    const hits: string[] = [];
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        const a = rects[i];
        const b = rects[j];
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) {
          hits.push(`${i}x${j}`);
        }
      }
    }
    return hits;
  });
  expect(overlap).toEqual([]);
  await expect(page.locator("[data-followed-object-batch]")).toHaveCSS("margin-left", "0px");

  // 总数只在中栏概览里：右栏工具行不重复「目前跟进了 N 位」。
  const rail = page.locator('[data-home-pane="lifecycle"] [data-scope-task-rail]');
  const center = page.locator('[data-home-pane="lifecycle"] [data-scope-ai-workspace]');
  const railText = await rail.innerText();
  expect(railText).not.toContain("目前跟进了");
  await expect(center.locator("[data-followed-overview-count]")).toHaveText("目前跟进了 3 位");
  await expect(page.locator("[data-followed-lifecycle-grid]")).toBeVisible();
  await expect(page.locator("[data-followed-selected-count]")).toHaveCount(0);
  // 全选始终是明确的全量动作。
  await expect(page.locator(".followed-select-all")).toContainText("全选");

  // 选中之后才报选中数，且搜索框仍保持可用宽度。
  await page.locator('[data-followed-kol="红人1"] input[type="checkbox"]').check();
  await expect(page.locator("[data-followed-selected-count]")).toHaveText("已选 1");
  const boxes = await page.evaluate(() => {
    const box = (selector: string) => {
      const el = document.querySelector(selector) as HTMLElement;
      const rect = el.getBoundingClientRect();
      return { l: rect.left, r: rect.right, w: rect.width };
    };
    const all = document.querySelector(".followed-select-all") as HTMLElement;
    const count = document.querySelector("[data-followed-selected-count]") as HTMLElement;
    return {
      all: box("[data-followed-select-all]"),
      search: box("[data-followed-object-search]"),
      countIsInSelectAll: all.contains(count),
    };
  });
  expect(boxes.countIsInSelectAll).toBe(true);
  expect(boxes.search.w).toBeGreaterThan(150);

  // 验收矩阵里的必测视口 1280×800（L + 矮窗）：换行后仍不许叠在一起。
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator("[data-followed-kol-list]")).toBeVisible();
  const narrow = await page.evaluate(() => {
    const bar = document.querySelector("[data-followed-object-toolbar]") as HTMLElement;
    const rects = [...bar.children].map((child) => child.getBoundingClientRect());
    const hits: string[] = [];
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        const a = rects[i];
        const b = rects[j];
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) {
          hits.push(`${i}x${j}`);
        }
      }
    }
    const search = (document.querySelector("[data-followed-object-search]") as HTMLElement).getBoundingClientRect();
    return { hits, searchWidth: search.width };
  });
  expect(narrow.hits).toEqual([]);
  expect(narrow.searchWidth).toBeGreaterThan(150);
});

test("读取没回来之前不许说「还没有跟进中的红人」，也不报 0 计数", async ({ page }) => {
  await stubBoard(page);
  await page.route("**/api/home/following", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await route.fulfill({ json: followingEnvelope([row(1), row(2)]) });
  });
  await openFollowed(page);

  const rail = page.locator('[data-home-pane="lifecycle"] [data-scope-task-rail]');
  await expect(page.locator('[data-follow-empty="loading"]')).toBeVisible();
  await expect(page.locator('[data-follow-empty="loading"]')).toContainText("正在读取跟进名单");
  await expect(rail).not.toContainText("还没有跟进中的红人");
  await expect(rail).not.toContainText("位在跟");

  // 读完之后：名单出现，等待态消失，总数只在中栏概览里。
  await expect(page.locator('[data-followed-kol="红人1"]')).toBeVisible({ timeout: 15000 });
  await expect(page.locator("[data-follow-empty]")).toHaveCount(0);
  await expect(page.locator("[data-followed-overview-count]")).toHaveText("目前跟进了 2 位");
  expect((await rail.innerText()).includes("目前跟进了")).toBe(false);
});

test("本地索引为空时，在历史协作投影合并前不下暂无结论", async ({ page }) => {
  // board 桩挂起直到「对账中」断言完成：壳级预热（SHELL_READ_DELAY_MS=350ms）可能先于
  // 点击发出这次读，用固定时延会随机器快慢漂移，这里用显式闸门消除时序依赖。
  let finishBoard!: () => void;
  const boardGate = new Promise<void>((resolve) => { finishBoard = resolve; });
  const scope = {
    required: true,
    bound: true,
    mailbox_email: "larry.zhao@amperetime.com",
    mailbox_id: "mbx_larry",
    owner_name: "赵良玉",
    status: "connected",
    has_token: false,
    updated_at: null,
  };
  await page.route("**/api/home/following", (route) => route.fulfill({
    json: { ...followingEnvelope([]), follow_scope: scope },
  }));
  await page.route("**/api/home/board*", async (route) => {
    await boardGate;
    await route.fulfill({ json: { kols: [row(1)], follow_scope: scope, workbench: {} } });
  });

  await openFollowed(page);

  const center = page.locator('[data-home-pane="lifecycle"] [data-scope-ai-workspace]');
  await expect(page.locator('[data-follow-empty="reconciling"]')).toBeVisible();
  await expect(page.locator('[data-follow-empty="reconciling"]')).toContainText("正在核对跟进名单");
  await expect(page.locator('[data-follow-empty="mailbox"]')).toHaveCount(0);
  await expect(page.locator("[data-follow-empty-actions]")).toHaveCount(0);
  await expect(center.locator("[data-followed-overview-count]")).toHaveCount(0);
  await expect(page.locator("[data-followed-lifecycle-grid]")).toHaveCount(0);

  finishBoard();
  await expect(page.locator('[data-followed-kol="红人1"]')).toBeVisible();
  await expect(page.locator("[data-follow-empty]")).toHaveCount(0);
  await expect(center.locator("[data-followed-overview-count]")).toHaveText("目前跟进了 1 位");
  await expect(page.locator("[data-followed-lifecycle-grid]")).toBeVisible();
});

test("先展示本地名单，历史记录拼接完成后原位更新并提示", async ({ page }) => {
  let finishBoard!: () => void;
  const boardGate = new Promise<void>((resolve) => { finishBoard = resolve; });
  let followingReads = 0;

  // 两端必须自洽：board 桩声明「已绑定邮箱范围」，following 桩也必须给出同一范围，
  // 否则前端会把「本地索引即完整答案」当成结论，不再等旧协作对账。
  const boundScope = {
    required: true,
    bound: true,
    mailbox_email: "larry.zhao@amperetime.com",
    mailbox_id: "mb_larry",
    owner_name: "赵良玉",
    status: "connected",
    has_token: true,
    updated_at: null,
  };
  await page.route("**/api/home/following", (route) => {
    followingReads += 1;
    return route.fulfill({ json: { ...followingEnvelope([row(1), row(2)]), follow_scope: boundScope } });
  });
  await page.route("**/api/home/board*", async (route) => {
    await boardGate;
    await route.fulfill({
      json: {
        kols: [row(1), row(2), row(3)],
        follow_scope: {
          required: true,
          bound: true,
          mailbox_email: "larry.zhao@amperetime.com",
          owner_name: "赵良玉",
          status: "connected",
        },
        workbench: {},
      },
    });
  });

  await openFollowed(page);

  await expect(page.locator('[data-followed-kol="红人1"]')).toBeVisible();
  await expect(page.locator('[data-followed-kol="红人2"]')).toBeVisible();
  await expect(page.locator("[data-followed-interaction]")).toContainText("2 位已加载 · 正在核对最新数据");
  await expect(page.locator('[data-follow-empty="mailbox"]')).toHaveCount(0);

  finishBoard();

  await expect(page.locator('[data-followed-kol="红人3"]')).toBeVisible();
  await expect(page.locator("[data-followed-overview-count]")).toHaveText("目前跟进了 3 位");
  expect(followingReads).toBeGreaterThanOrEqual(2);
});

test("未绑定邮箱范围时，首开我的红人不为旧协作对账等 board", async ({ page }) => {
  let boardServed = false;
  const followingReads: string[] = [];
  await page.route("**/api/home/following", (route) => {
    followingReads.push(new URL(route.request().url()).pathname);
    return route.fulfill({ json: followingEnvelope([row(1), row(2)]) });
  });
  await page.route("**/api/home/board*", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    boardServed = true;
    await route.fulfill({ json: { kols: [row(1), row(2)], workbench: {}, library: { count: 0 } } });
  });

  await openFollowed(page);

  // 名单与结论都在 board 落地之前就已经给出（未绑定范围 → 本地索引即完整答案）。
  await expect(page.locator('[data-followed-kol="红人1"]')).toBeVisible();
  await expect(page.locator("[data-followed-overview-count]")).toHaveText("目前跟进了 2 位");
  await expect(page.locator("[data-followed-summary-pending]")).toHaveCount(0);
  expect(boardServed).toBe(false);
  expect(followingReads.length).toBe(1);
});

test("全选覆盖当前筛选结果，不截断前 8 位", async ({ page }) => {
  await stubBoard(page);
  await page.route("**/api/home/following", (route) => route.fulfill({
    json: followingEnvelope(Array.from({ length: 12 }, (_, index) => row(index + 1))),
  }));
  await openFollowed(page);
  await expect(page.locator('[data-followed-kol="红人1"]')).toBeVisible();

  // 12 位在跟：全选应覆盖全部 12 位。
  const checkbox = page.locator("[data-followed-select-all]");
  await expect(page.locator(".followed-select-all")).toContainText("全选");
  await checkbox.check();
  await expect(page.locator("[data-followed-selected-count]")).toHaveText("已选 12");
  await expect(checkbox).toBeChecked();
});

test("我的红人右栏与今日任务、公海共用 DESIGN 记录的工作台几何", async ({ page }) => {
  await stubBoard(page);
  await page.route("**/api/home/following", (route) => route.fulfill({ json: followingEnvelope([row(1)]) }));
  await page.route("**/api/home/pool", (route) => route.fulfill({
    json: { entry: "memory", kind: "memory", creates_session: false, calls_model: false, index: "公海", items: [], kols: [] },
  }));

  const railWidth = (pane: string) =>
    page.locator(`[data-home-pane="${pane}"] [data-scope-task-rail]`).evaluate((el) => Math.round(el.getBoundingClientRect().width));

  for (const viewport of [1966, 1440]) {
    await page.setViewportSize({ width: viewport, height: 900 });
    await page.goto("/");

    await page.locator('[data-home-mode="today"]').click();
    await expect(page.locator('[data-home-pane="today"] [data-scope-task-rail]')).toBeVisible();
    const columns = await page.locator('[data-home-pane="today"]').evaluate((ws) => {
      const rail = ws.querySelector("[data-scope-task-rail]") as HTMLElement;
      return { workspace: (ws as HTMLElement).clientWidth, rail: rail.getBoundingClientRect().width };
    });
    // DESIGN「Home Agent 工作台几何」：clamp(360px, 54%, 820px)。40%/680 的老值在这里会得到 639/433。
    const expected = Math.min(Math.max(0.54 * columns.workspace, 360), 820);
    expect(Math.abs(columns.rail - expected)).toBeLessThanOrEqual(2);
    const today = await railWidth("today");

    await page.locator('[data-home-mode="lifecycle"]').click();
    await expect(page.locator('[data-home-pane="lifecycle"] [data-followed-kol]').first()).toBeVisible();
    const lifecycle = await railWidth("lifecycle");

    await page.locator('[data-home-mode="pool"]').click();
    await expect(page.locator('[data-home-pane="pool"] [data-scope-task-rail]')).toBeVisible();
    const pool = await railWidth("pool");

    // 五个模式一份几何：右栏宽度逐像素相同，任何模式都不许自开覆写。
    expect(lifecycle).toBe(today);
    expect(pool).toBe(today);
    expect(today).toBeGreaterThanOrEqual(360);
    expect(today).toBeLessThanOrEqual(820);
    if (viewport >= 1966) expect(today).toBe(820);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  }
});
