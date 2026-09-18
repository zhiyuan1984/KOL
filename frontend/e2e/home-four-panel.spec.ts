import { test, expect, type Page } from "@playwright/test";
import { stubFollowingFromServerBoard, stubHomeBoardAndFollowing } from "./kol-surface-stub";

async function openMode(page: Page, mode: "today" | "todo" | "discovery" | "pool" | "lifecycle") {
  await page.locator(`[data-home-mode="${mode}"]`).click();
  await expect(page.locator(`[data-home-pane="${mode}"]`)).toBeVisible();
}

test.beforeEach(async ({ page, request }) => {
  await request.post("/api/demo/reset", { data: { workbench: true } });
  await request.post("/api/me/persona", { data: { persona: "sriphy" } });
  await stubFollowingFromServerBoard(page, request);
});

test("home four-panel tab order and pane visibility", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("[data-home-mode]")).toHaveCount(5);
  expect(await page.locator("[data-home-mode]").evaluateAll((els) => (
    els.map((el) => el.getAttribute("data-home-mode"))
  ))).toEqual(["today", "todo", "discovery", "pool", "lifecycle"]);
  await expect(page.locator('[data-home-mode="today"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-home-mode="today"]')).toContainText("今日任务");
  await expect(page.locator('[data-home-mode="todo"]')).toContainText("我的待办");
  await expect(page.locator('[data-home-mode="discovery"]')).toContainText("AI发现");
  await expect(page.locator('[data-home-mode="pool"]')).toContainText("公海");
  await expect(page.locator('[data-home-mode="lifecycle"]')).toContainText("我跟进的红人");

  await expect(page.locator("[data-home] h1")).toHaveText("今天有什么工作要处理？");
  await expect(page.locator('[data-home-pane="today"]')).toBeVisible();
  await expect(page.locator("[data-today-list]")).toBeVisible();
  await expect(page.locator('[data-home-pane="today"]')).not.toContainText("今天推荐");
  await expect(page.locator('[data-home-pane="today"]')).not.toContainText("已入队");
  await expect(page.locator('[data-home-pane="today"]')).not.toContainText("加入待办");
  await expect(page.locator('[data-home-pane="today"]')).not.toContainText("正式待办");
  await expect(page.locator('[data-home-pane="today"]')).not.toContainText("待办");
  await expect(page.locator('[data-home-pane="today"]')).not.toContainText("AI发现");
  await expect(page.locator("[data-today-suggestions], [data-recommended-task], [data-insight-list]")).toHaveCount(0);
  await expect(page.locator('[data-home-pane="todo"]')).toHaveCount(0);
  await expect(page.locator('[data-home-pane="discovery"]')).toHaveCount(0);
  await expect(page.locator('[data-home-pane="pool"]')).toHaveCount(0);
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
  await expect(page.locator("[data-discovery-panel]")).toContainText("尚未搜索");
  await expect(page.locator("[data-discovery-panel]")).not.toContainText("加入待办");
  await expect(page.locator("[data-discovery-panel]")).not.toContainText("加入跟进");
  await expect(page.locator("[data-discovery-live]")).toHaveAttribute("data-discovery-live", "false");
  await expect(page.locator("[data-discovery-empty='idle']")).toBeVisible();
  await expect(page.locator("[data-discovery-start]")).toHaveText("开始发现");

  await openMode(page, "pool");
  await expect(page.locator("[data-home] h1")).toHaveCount(0);
  await expect(page.locator('[data-home-pane="pool"]')).toBeVisible();
  await expect(page.locator("[data-discovery-panel]")).toHaveCount(0);
  await expect(page.locator('[data-home-pane="lifecycle"]')).toHaveCount(0);

  await openMode(page, "lifecycle");
  await expect(page.locator("[data-home] h1")).toHaveCount(0);
  await expect(page.locator("[data-home]")).toHaveAttribute("data-followed-chrome", "compact");
  await expect(page.locator("[data-today-summary]")).toBeHidden();
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

  await openMode(page, "todo");
  await expect(page.locator("[data-today-summary]")).toBeVisible();
  await expect(page.locator("[data-today-summary]")).toContainText("项未了结");
  await expect(page.locator("[data-home]")).not.toHaveAttribute("data-followed-chrome", "compact");
});


async function expectNoPageHorizontalScroll(page: Page) {
  const box = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(box.scroll).toBeLessThanOrEqual(box.client + 1);
}

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
  await stubHomeBoardAndFollowing(page, payload);
  await page.route("**/api/tasks", (route) => route.fulfill({ json: todos }));
}

async function todoRowLayout(card: ReturnType<Page["locator"]>) {
  return card.evaluate((el) => {
    const line = el.querySelector(".today-todo-line1") as HTMLElement | null;
    const title = el.querySelector(".today-todo-title") as HTMLElement | null;
    const status = el.querySelector(".today-todo-label") as HTMLElement | null;
    const act = el.querySelector(".today-todo-act") as HTMLElement | null;
    const pane = el.closest("[data-todo-md]") as HTMLElement | null;
    if (!line || !title || !status || !act) {
      throw new Error("todo action row is missing status/title/act");
    }
    const titleBox = title.getBoundingClientRect();
    const statusBox = status.getBoundingClientRect();
    const actBox = act.getBoundingClientRect();
    const paneBox = pane?.getBoundingClientRect();
    return {
      paneWidth: paneBox?.width ?? 0,
      paneMaxWidth: pane ? getComputedStyle(pane).maxWidth : "",
      titleRight: titleBox.right,
      titleTop: titleBox.top,
      statusLeft: statusBox.left,
      statusTop: statusBox.top,
      actLeft: actBox.left,
      actTop: actBox.top,
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
  await expect(quote).toHaveAttribute("data-todo-status", "今天到期");
  await expect(quote.locator("[data-todo-act]")).toHaveText("处理");
  const follow = page.locator("[data-todo-card]").filter({ hasText: "跟进 Outdoor Gear Lab 样品签收" });
  await expect(follow).toHaveAttribute("data-todo-bucket", "later");
  await expect(follow).toContainText("后续");
  await expect(follow.locator("[data-todo-act]")).toHaveText("打开");

  const wide = await todoRowLayout(quote);
  expect(wide.paneMaxWidth).toMatch(/^(none|100%)$/);
  expect(wide.actLeft).toBeGreaterThan(wide.titleRight - 8);
  expect(Math.abs(wide.actTop - wide.titleTop)).toBeLessThan(48);
  expect(wide.statusLeft).toBeLessThan(wide.titleRight);
  await expectNoPageHorizontalScroll(page);

  await page.setViewportSize({ width: 720, height: 900 });
  await expect(quote.locator("[data-todo-act]")).toBeVisible();
  await expectNoPageHorizontalScroll(page);
});

test("home followed KOL card is a dense fact | AI decision row", async ({ page }) => {
  await stubHomeBoardAndFollowing(page, {
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
  });
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
  await expect(card.locator("[data-confirm-enter-stage]")).toHaveClass(/ghost/);
  await expect(page.locator("[data-followed-batch-confirm]")).toHaveClass(/ghost/);
  await expect(card.locator("[data-open-kol-detail]")).toHaveText("查看详情");
  await expect(card.locator("[data-open-kol-detail]")).not.toHaveClass(/btn/);
  await expect(card.locator("[data-open-original-mail]")).toHaveText("查看互动");
  await expect(card.getByRole("button", { name: "确认阶段", exact: true })).toHaveCount(0);

  const wide = await card.evaluate((el) => {
    const name = el.querySelector("[data-kol-name]")?.getBoundingClientRect();
    const stage = el.querySelector("[data-stage-label]")?.getBoundingClientRect();
    const fact = el.querySelector("[data-latest-fact]")?.getBoundingClientRect();
    const rec = el.querySelector("[data-recommended-action]")?.getBoundingClientRect();
    const primary = el.querySelector("[data-confirm-enter-stage]")?.getBoundingClientRect();
    const recBand = el.querySelector('[data-kol-band="action"]')?.getBoundingClientRect();
    const column = document.querySelector("[data-followed-kol-column]");
    return {
      stageBesideName: Boolean(name && stage && Math.abs(name.top - stage.top) < 16 && stage.left + 1 >= name.right - 8),
      factAiSideBySide: Boolean(fact && rec && rec.left + 2 >= fact.right - 8 && Math.abs(fact.top - rec.top) < 48),
      gutter: fact && rec ? Math.max(0, rec.left - fact.right) : 0,
      primaryInAi: Boolean(
        primary && recBand
        && primary.left + 2 >= recBand.left - 4
        && primary.right <= recBand.right + 4
      ),
      cardWidth: el.clientWidth,
      columnWidth: column instanceof HTMLElement ? column.clientWidth : 0,
    };
  });
  expect(wide.stageBesideName).toBe(true);
  expect(wide.factAiSideBySide).toBe(false);
  expect(wide.gutter).toBe(0);
  expect(wide.primaryInAi).toBe(true);
  expect(wide.cardWidth).toBeGreaterThan(700);
  expect(wide.cardWidth).toBeLessThanOrEqual(wide.columnWidth);

  const type = await card.evaluate((el) => {
    const read = (node: Element | null) => {
      if (!(node instanceof HTMLElement)) return null;
      const cs = getComputedStyle(node);
      return { size: Number.parseFloat(cs.fontSize), weight: Number.parseFloat(cs.fontWeight), color: cs.color };
    };
    return {
      name: read(el.querySelector("[data-kol-name]")),
      stage: read(el.querySelector("[data-stage-label]")),
      kicker: read(el.querySelector(".kol-split-kicker")),
      fact: read(el.querySelector("[data-latest-fact] .kol-mail-digest")),
      ai: read(el.querySelector("[data-recommended-action] .kol-suggestion")),
      why: read(el.querySelector("[data-action-why]")),
      detail: read(el.querySelector("[data-open-kol-detail]")),
      mail: read(el.querySelector("[data-open-original-mail]")),
    };
  });
  expect(type.name!.size).toBeGreaterThanOrEqual(15);
  expect(type.name!.weight).toBeGreaterThanOrEqual(600);
  expect(["rgb(26, 26, 26)", "rgb(0, 0, 0)"]).toContain(type.name!.color);
  if (type.stage) {
    expect(type.stage.size).toBeGreaterThanOrEqual(13);
    expect(type.stage.weight).toBeLessThan(type.name!.weight);
  }
  if (type.kicker) expect(type.kicker.size).toBeGreaterThanOrEqual(13);
  if (type.fact) expect(type.fact.size).toBeGreaterThanOrEqual(13);
  if (type.ai) expect(type.ai.size).toBeGreaterThanOrEqual(13);
  if (type.why) expect(type.why.size).toBeGreaterThanOrEqual(13);
  expect(type.detail!.size).toBeGreaterThanOrEqual(13);
  expect(["rgb(107, 107, 107)", "rgb(102, 102, 102)"]).toContain(type.detail!.color);
  if (type.mail) expect(type.mail.size).toBeGreaterThanOrEqual(13);
  if (wide.columnWidth > 1000) {
    expect(wide.cardWidth).toBeLessThan(wide.columnWidth - 24);
  }

  await page.setViewportSize({ width: 720, height: 900 });
  const stacked = await card.evaluate((el) => {
    const fact = el.querySelector("[data-latest-fact]")?.getBoundingClientRect();
    const rec = el.querySelector("[data-recommended-action]")?.getBoundingClientRect();
    return Boolean(fact && rec && rec.top + 1 >= fact.bottom - 8);
  });
  expect(stacked).toBe(true);
});

async function countFilledFollowedWorkCtas(page: Page): Promise<number> {
  return page.locator("[data-followed-kol-list] [data-kol-primary-action]").evaluateAll((els) => (
    els.filter((el) => {
      if (el.classList.contains("work") || el.getAttribute("data-cta-visual") === "filled") return true;
      return getComputedStyle(el).backgroundColor === "rgb(199, 59, 122)";
    }).length
  ));
}

test("home followed list keeps one strong work CTA", async ({ page }) => {
  await stubHomeBoardAndFollowing(page, {
    kols: [
        {
          id: "col_stage_a",
          handle: "阶段甲",
          brand: "LT",
          stage_code: "INITIAL_CONTACT",
          stage_label: "初步接触",
          suggested_stage: "已回复-有兴趣",
          suggested_stage_code: "INTERESTED",
          days_in_stage: 3,
          mail_threads: [{
            conversation_id: "thread-a",
            subject: "Re: collab A",
            unread_count: 0,
            last_direction: "inbound",
            last_snippet: "我对这次合作有兴趣",
            last_at: "2026-09-12T10:00:00.000Z",
          }],
        },
        {
          id: "col_stage_b",
          handle: "阶段乙",
          brand: "LT",
          stage_code: "INITIAL_CONTACT",
          stage_label: "初步接触",
          suggested_stage: "已回复-有兴趣",
          suggested_stage_code: "INTERESTED",
          days_in_stage: 2,
          mail_threads: [{
            conversation_id: "thread-b",
            subject: "Re: collab B",
            unread_count: 0,
            last_direction: "inbound",
            last_snippet: "我对这次合作有兴趣",
            last_at: "2026-09-11T10:00:00.000Z",
          }],
        },
        {
          id: "col_draft_row",
          handle: "起草卡",
          brand: "LT",
          stage_code: "QUOTE_PENDING",
          stage_label: "报价待确认",
          days_in_stage: 1,
        },
      ],
      tasks: [{
        id: "tsk_draft_row",
        title: "写跟进邮件",
        skill_id: "email_compose",
        status: "pending",
        collaboration_id: "col_draft_row",
        kol_name: "起草卡",
      }],
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await openMode(page, "lifecycle");
  const list = page.locator("[data-followed-kol-list]");
  const stageA = page.locator('[data-followed-kol="阶段甲"]');
  const stageB = page.locator('[data-followed-kol="阶段乙"]');
  const draft = page.locator('[data-followed-kol="起草卡"]');
  await expect(list.locator("[data-followed-kol]")).toHaveCount(3);
  await expect(stageA.locator("[data-confirm-enter-stage]")).toHaveText("进入已回复 · 有兴趣 →");
  await expect(draft.locator("[data-kol-primary-action]")).toHaveText("准备回复");
  await expect(list.locator("[data-open-kol-detail]")).toHaveCount(3);
  await expect(list.locator("[data-open-kol-detail].btn.work")).toHaveCount(0);

  await page.mouse.move(0, 0);
  await expect(list.locator("[data-kol-primary-action].btn.work")).toHaveCount(0);
  await expect(stageA.locator("[data-kol-primary-action]")).toHaveClass(/ghost/);
  await expect(stageB.locator("[data-kol-primary-action]")).toHaveClass(/ghost/);
  await expect(draft.locator("[data-kol-primary-action]")).toHaveClass(/ghost/);
  await expect(page.locator("[data-followed-batch-confirm]")).toHaveClass(/ghost/);
  expect(await countFilledFollowedWorkCtas(page)).toBe(0);

  await stageA.hover();
  await expect(stageA).toHaveAttribute("data-cta-emphasis", "strong");
  await expect(stageA.locator("[data-confirm-enter-stage]")).toHaveClass(/work/);
  await expect(stageB.locator("[data-confirm-enter-stage]")).toHaveClass(/ghost/);
  await expect(draft.locator("[data-kol-primary-action]")).toHaveClass(/ghost/);
  expect(await countFilledFollowedWorkCtas(page)).toBe(1);

  await stageB.locator("[data-confirm-enter-stage]").focus();
  await expect(stageB).toHaveAttribute("data-cta-emphasis", "strong");
  await expect(stageB.locator("[data-confirm-enter-stage]")).toHaveClass(/work/);
  await expect(stageA.locator("[data-confirm-enter-stage]")).toHaveClass(/ghost/);
  expect(await countFilledFollowedWorkCtas(page)).toBe(1);

  await draft.hover();
  await expect(draft.locator("[data-kol-primary-action]")).toHaveClass(/work/);
  await expect(draft.locator("[data-cta-role='draft']")).toHaveAttribute("data-cta-visual", "filled");
  await expect(stageA.locator("[data-confirm-enter-stage]")).toHaveClass(/ghost/);
  await expect(stageB.locator("[data-confirm-enter-stage]")).toHaveClass(/ghost/);
  expect(await countFilledFollowedWorkCtas(page)).toBe(1);

  await page.mouse.move(0, 0);
  await stageA.locator("[data-followed-select]").check();
  await stageB.locator("[data-followed-select]").check();
  await expect(stageA).toHaveAttribute("data-selected", "true");
  await expect(stageB).toHaveAttribute("data-selected", "true");
  await expect(page.locator("[data-followed-selected-count]")).toHaveText("已选 2 / 8");
  await expect(page.locator("[data-followed-batch-confirm]")).toHaveClass(/work/);
  await expect(page.locator("[data-followed-batch-confirm]")).toHaveText("确认进入已回复 · 有兴趣（2）");
  await expect(stageA.locator("[data-confirm-enter-stage]")).toHaveClass(/ghost/);
  await expect(stageB.locator("[data-confirm-enter-stage]")).toHaveClass(/ghost/);
  await expect(draft.locator("[data-kol-primary-action]")).toHaveClass(/ghost/);
  expect(await countFilledFollowedWorkCtas(page)).toBe(0);
  await expect(page.locator("[data-home-pane='lifecycle'] .btn.work")).toHaveCount(1);
  expect(await list.locator("[data-followed-kol]").count()).toBeGreaterThan(1);
});

test("home followed multi-select shows one filled top CTA", async ({ page }) => {
  await stubHomeBoardAndFollowing(page, {
    kols: [
        {
          id: "col_stage_a",
          handle: "阶段甲",
          brand: "LT",
          stage_code: "INITIAL_CONTACT",
          stage_label: "初步接触",
          suggested_stage: "已回复-有兴趣",
          suggested_stage_code: "INTERESTED",
          days_in_stage: 3,
          mail_threads: [{
            conversation_id: "thread-a",
            subject: "Re: collab A",
            unread_count: 0,
            last_direction: "inbound",
            last_snippet: "我对这次合作有兴趣",
            last_at: "2026-09-12T10:00:00.000Z",
          }],
        },
        {
          id: "col_stage_b",
          handle: "阶段乙",
          brand: "LT",
          stage_code: "INITIAL_CONTACT",
          stage_label: "初步接触",
          suggested_stage: "已回复-有兴趣",
          suggested_stage_code: "INTERESTED",
          days_in_stage: 2,
          mail_threads: [{
            conversation_id: "thread-b",
            subject: "Re: collab B",
            unread_count: 0,
            last_direction: "inbound",
            last_snippet: "我对这次合作有兴趣",
            last_at: "2026-09-11T10:00:00.000Z",
          }],
        },
        {
          id: "col_draft_row",
          handle: "起草卡",
          brand: "LT",
          stage_code: "QUOTE_PENDING",
          stage_label: "报价待确认",
          days_in_stage: 1,
        },
      ],
      tasks: [{
        id: "tsk_draft_row",
        title: "写跟进邮件",
        skill_id: "email_compose",
        status: "pending",
        collaboration_id: "col_draft_row",
        kol_name: "起草卡",
      }],
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await openMode(page, "lifecycle");
  const list = page.locator("[data-followed-kol-list]");
  const stageA = page.locator('[data-followed-kol="阶段甲"]');
  const stageB = page.locator('[data-followed-kol="阶段乙"]');
  const draft = page.locator('[data-followed-kol="起草卡"]');
  const topCta = page.locator("[data-followed-batch-confirm]");
  await expect(list.locator("[data-followed-kol]")).toHaveCount(3);
  await expect(list.locator("[data-followed-select]")).toHaveCount(3);
  await page.mouse.move(0, 0);
  await expect(list.locator("[data-kol-primary-action].btn.ghost")).toHaveCount(3);
  await expect(list.locator("[data-kol-primary-action].btn.work")).toHaveCount(0);
  await expect(topCta).toHaveClass(/ghost/);
  await expect(topCta).toBeDisabled();
  expect(await countFilledFollowedWorkCtas(page)).toBe(0);

  await stageA.locator("[data-followed-select]").check();
  await expect(topCta).toHaveClass(/work/);
  await expect(topCta).toHaveText("进入已回复 · 有兴趣 →");
  await expect(stageA.locator("[data-confirm-enter-stage]")).toHaveClass(/ghost/);
  await expect(stageB.locator("[data-confirm-enter-stage]")).toHaveClass(/ghost/);
  await expect(draft.locator("[data-kol-primary-action]")).toHaveClass(/ghost/);
  await expect(page.locator("[data-home-pane='lifecycle'] .btn.work")).toHaveCount(1);

  await stageB.locator("[data-followed-select]").check();
  await expect(page.locator("[data-followed-selected-count]")).toHaveText("已选 2 / 8");
  await expect(topCta).toHaveClass(/work/);
  await expect(topCta).toHaveText("确认进入已回复 · 有兴趣（2）");
  await expect(list.locator("[data-kol-primary-action].btn.work")).toHaveCount(0);
  await expect(page.locator("[data-home-pane='lifecycle'] .btn.work")).toHaveCount(1);
  await stageA.hover();
  await expect(stageA.locator("[data-confirm-enter-stage]")).toHaveClass(/ghost/);

  await topCta.click();
  const dialog = page.locator("[data-followed-batch-confirm-dialog]");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("不会发信");
  await expect(dialog).toContainText("发送与改阶段分开");
  await expect(dialog.locator("[data-followed-batch-item]")).toHaveCount(2);
  await expect(dialog.locator("[data-followed-batch-confirm-yes]")).toHaveClass(/work/);
  await expect(dialog.locator("[data-followed-batch-confirm-yes]")).toHaveText("打开阶段确认");
  await dialog.locator("[data-followed-batch-confirm-no]").click();
  await expect(dialog).toHaveCount(0);
  await expect(topCta).toHaveClass(/work/);
  await expect(list.locator("[data-kol-primary-action].btn.work")).toHaveCount(0);
});

test("today pane has no recommend convert and no 待办 copy", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('[data-home-pane="today"]')).toBeVisible();
  await expect(page.locator("[data-today-list]")).toBeVisible();
  await expect(page.locator("[data-recommended-task], [data-suggestion-to-todo], [data-today-suggestions]")).toHaveCount(0);
  await expect(page.locator('[data-home-pane="today"]')).not.toContainText("今天推荐");
  await expect(page.locator('[data-home-pane="today"]')).not.toContainText("已入队");
  await expect(page.locator('[data-home-pane="today"]')).not.toContainText("加入待办");
  await expect(page.locator('[data-home-pane="today"]')).not.toContainText("正式待办");
  await expect(page.locator('[data-home-pane="today"]')).not.toContainText("待办");
  await openMode(page, "todo");
  await expect(page.locator("[data-todo-card]").first()).toBeVisible({ timeout: 15000 });
});

test("home four tabs live in ?tab= and switching does not POST sessions", async ({ page }) => {
  const sessionPosts: string[] = [];
  page.on("request", (item) => {
    if (item.method() !== "POST") return;
    const path = new URL(item.url()).pathname;
    if (path === "/api/sessions" || /\/collaborations\/[^/]+\/session$/.test(path) || path.endsWith("/run")) {
      sessionPosts.push(path);
    }
  });

  await page.goto("/");
  await expect(page).toHaveURL(/\/(?:\?|$)/);
  await expect(page.locator('[data-home-pane="today"]')).toBeVisible();
  await expect(page.locator("[data-today-list]")).toBeVisible();
  await expect(page.locator("[data-today-candidates], [data-today-suggestions]")).toHaveCount(0);

  await openMode(page, "todo");
  await expect(page).toHaveURL(/[?&]tab=todo/);
  await expect(page.locator('[data-home-pane="todo"]')).toBeVisible();

  await openMode(page, "discovery");
  await expect(page).toHaveURL(/[?&]tab=discovery/);
  await expect(page.locator('[data-home-pane="discovery"]')).toBeVisible();

  await openMode(page, "pool");
  await expect(page).toHaveURL(/[?&]tab=pool/);
  await expect(page.locator('[data-home-pane="pool"]')).toBeVisible();

  await openMode(page, "lifecycle");
  await expect(page).toHaveURL(/[?&]tab=lifecycle/);
  await expect(page.locator('[data-home-pane="lifecycle"]')).toBeVisible();
  await expect(page.locator("[data-followed-object-search]")).toBeVisible();
  await expect(page.locator("[data-kol-stage-filter]")).toBeVisible();

  await page.goto("/?tab=todo");
  await expect(page.locator('[data-home-pane="todo"]')).toBeVisible();
  await page.goto("/?tab=discovery");
  await expect(page.locator('[data-home-pane="discovery"]')).toBeVisible();
  await page.goto("/?tab=lifecycle");
  await expect(page.locator('[data-home-pane="lifecycle"]')).toBeVisible();
  await page.goto("/?tab=pool");
  await expect(page.locator('[data-home-pane="pool"]')).toBeVisible();
  await expect(page.locator("[data-home-mode]")).toHaveCount(5);
  await expect(page.locator('[data-home-mode="pool"]')).toHaveAttribute("aria-selected", "true");
  expect(sessionPosts).toEqual([]);
});

test("home composer copy is 让 Agent 分析/安排 and not 添加待办", async ({ page }) => {
  await page.goto("/");
  const input = page.locator("[data-home] [data-composer-input]");
  await expect(input).toBeVisible();
  await expect(input).toHaveAttribute("placeholder", "有问题，尽管问");
  await expect(page.locator("[data-home]")).not.toContainText("添加待办");
  await expect(page.locator(".home-composer-dock[data-home-entry='composer-analyze']")).toBeVisible();
});
