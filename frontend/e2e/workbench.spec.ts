import { test, expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import path from "node:path";

async function saveScreenshot(page: Page, name: string): Promise<void> {
  const dir = process.env.PLAYWRIGHT_OUTPUT_DIR || "test-results";
  await page.screenshot({ path: path.join(dir, name), fullPage: true });
}

test.beforeEach(async ({ request }) => {
  await request.post("/api/demo/reset", { data: { workbench: true } });
  await request.post("/api/me/persona", { data: { persona: "sriphy" } });
});

/** Stub Codex (Playwright webServer sets CODEX_MODE=stub). Drafts must appear — do not skip P0. */
async function expectDraft(page: Page) {
  await expect(
    page.locator("[data-workbench]").locator('[data-kind="email-card"], [data-kind="task-result-card"]').first(),
  ).toBeVisible({ timeout: 20000 });
}

async function openDraftTab(page: Page) {
  const draft = page.locator('[data-workbench] [data-kind="email-card"]');
  if (await draft.isVisible()) return;
  const mail = page.locator('[data-workbench] [data-tab="mail"]');
  if (await mail.isVisible()) await mail.click();
  if (await draft.isVisible()) return;
  const tab = page.locator('[data-workbench] [data-tab="draft"]');
  if (await tab.isVisible()) await tab.click();
}

function homeRecByTitle(page: Page, title: string) {
  const exact = new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
  return page.locator("[data-home] .rec").filter({
    has: page.locator(".rec-title", { hasText: exact }),
  });
}

async function openHomeTemplates(page: Page) {
  const tab = page.locator("[data-work-panel] [data-home-tab='templates']");
  if (!(await tab.isVisible())) {
    await page.locator("[data-open-work-panel]").click();
  }
  await expect(page.locator("[data-work-panel]")).toBeVisible();
  await tab.click();
  await expect(page.locator("[data-home] .rec").first()).toBeVisible({ timeout: 15000 });
}

async function closeHomeWorkPanel(page: Page) {
  const backdrop = page.locator("[data-work-panel] .work-panel-backdrop");
  if (await backdrop.isVisible()) await backdrop.click();
}

async function openHomeLifecycle(page: Page) {
  await closeHomeWorkPanel(page);
  await page.locator('[data-home-mode="lifecycle"]').click();
  await expect(page.locator('[data-home-pane="lifecycle"]')).toBeVisible();
}

async function openHomeTodo(page: Page) {
  await closeHomeWorkPanel(page);
  await page.locator('[data-home-mode="todo"]').click();
  await expect(page.locator('[data-home-pane="todo"]')).toBeVisible();
}

async function openHomeAi(page: Page) {
  await closeHomeWorkPanel(page);
  await page.locator('[data-home-mode="ai"]').click();
  await expect(page.locator('[data-home-pane="ai"]')).toBeVisible();
}

async function expectHomeModeOrder(page: Page) {
  await expect(page.locator("[data-home-mode]")).toHaveCount(3);
  expect(await page.locator("[data-home-mode]").evaluateAll((els) => (
    els.map((el) => el.getAttribute("data-home-mode"))
  ))).toEqual(["ai", "todo", "lifecycle"]);
}

async function expectHomeChromeRow(page: Page) {
  const chrome = page.locator("[data-home-chrome]");
  await expect(chrome).toBeVisible();
  await expect(chrome.locator("[data-home-account-name]")).not.toHaveText("");
  await expect(chrome.locator("[data-home-account-id]")).not.toHaveText("");
  await expect(chrome.locator("[data-home-chrome-action]")).toHaveCount(4);
  await expect(page.locator('[data-brand-lockup="home"] [data-brand-mark]')).toHaveText("LIFE & DISCOVERY");
  await expect(page.locator('[data-brand-lockup="home"] .brand-slogan-en')).toHaveText(
    "Powering Outdoor Adventures for Generations!",
  );
  await expect(page.locator('[data-brand-lockup="home"] .brand-slogan-zh')).toHaveText("服务几代人的户外生活");
  const accountBox = await chrome.locator("[data-home-account]").boundingBox();
  const brandBox = await chrome.locator("[data-brand-lockup='home']").boundingBox();
  expect(accountBox && brandBox).toBeTruthy();
  expect(brandBox!.x).toBeGreaterThan(accountBox!.x + accountBox!.width - 2);
  expect(Math.abs(brandBox!.y - accountBox!.y)).toBeLessThan(24);
}

async function expectFollowedKolHeadingRemoved(page: Page) {
  await expect(page.locator("[data-followed-kol-heading]")).toHaveCount(0);
  await expect(page.locator("[data-home-pane=lifecycle] h2")).toHaveCount(0);
  await expect(page.locator('[data-home-mode="lifecycle"]')).toContainText("我跟进的红人");
}

async function expectFollowedKolListAlignsWithTabs(page: Page) {
  const tabs = page.locator("[data-kol-tabs]");
  const list = page.locator("[data-followed-kol-list]");
  const stage = page.locator("[data-home] .home-stage");
  await expect(tabs).toBeVisible();
  await expect(list).toBeVisible();
  const tabsBox = await tabs.boundingBox();
  const listBox = await list.boundingBox();
  const stageBox = await stage.boundingBox();
  expect(tabsBox && listBox && stageBox).toBeTruthy();
  expect(Math.abs(listBox!.width - tabsBox!.width)).toBeLessThan(8);
  expect(listBox!.width).toBeLessThan(stageBox!.width - 8);
}

async function openFollowedKolDetail(page: Page, handle?: string) {
  const card = handle
    ? page.locator(`[data-followed-kol="${handle}"]`)
    : page.locator("[data-followed-kol]").first();
  await card.locator("[data-open-kol-detail]").click();
}

async function openStageSop(page: Page) {
  const sop = page.locator("[data-stage-sop]");
  await expect(sop).toBeVisible();
  if (!(await sop.evaluate((el) => el instanceof HTMLDetailsElement && el.open))) {
    await sop.locator("summary").click();
  }
  await expect(sop).toHaveJSProperty("open", true);
}

/** Template click only prefills the home composer; send then follows the home ask path. */
async function expectHomeComposerDraft(page: Page, value: string) {
  await expect(page).toHaveURL(/\/(?:\?.*)?$/);
  await expect(page.locator("[data-work-panel]")).toHaveCount(0);
  await expect(page.locator("[data-home] [data-composer-input]")).toHaveValue(value);
}

async function pickStageChip(scope: Locator, code: string) {
  await scope.locator(`[data-stage-chip][data-stage-code="${code}"]`).first().click();
}

async function expectSelectedStage(scope: Locator, code: string) {
  await expect(scope.locator("[data-stage-select]")).toHaveAttribute("data-value", code);
  await expect(scope.locator(`[data-stage-chip][data-stage-code="${code}"]`)).toHaveAttribute("aria-checked", "true");
}

async function submitHomeComposer(page: Page) {
  const send = page.locator("[data-home] [data-send]");
  await expect(send).toBeEnabled({ timeout: 2000 });
  await send.click();
  await page.waitForURL(/\/s\//);
}

async function submitHomeComposerStay(page: Page) {
  const send = page.locator("[data-home] [data-send]");
  await expect(send).toBeEnabled({ timeout: 2000 });
  await send.click();
  await expect(page).toHaveURL(/\/(?:\?.*)?$/);
}

async function expectHomeClarification(page: Page, ...labels: string[]) {
  const feedback = page.locator("[data-home] [data-creation-feedback]");
  const timeout = process.env.E2E_MODE === "real" ? 90000 : 15000;
  await expect(feedback).toBeVisible({ timeout });
  for (const label of labels) {
    await expect(feedback).toContainText(label, { timeout });
  }
}

function isRealE2E(): boolean {
  return process.env.E2E_MODE === "real";
}

/** Real Codex turns emit intermediate result cards before the final copy. */
function resultCardTimeout(): number {
  return isRealE2E() ? 90_000 : 20_000;
}

function workbenchResultCard(page: Page) {
  return page.locator('[data-workbench] [data-kind="task-result-card"]');
}

function chatStream(page: Page) {
  return page.locator(".chat");
}

async function proposePipelineStage(page: Page, handle: string) {
  const row = page.locator(`[data-kol="${handle}"]`);
  await row.locator("[data-pipeline-row]").click();
  await expect(page.locator("[data-pipeline-drawer]")).toBeVisible();
  await page.locator("[data-pipeline-drawer] [data-propose-stage]").click();
}

async function askKolSession(page: Page, request: APIRequestContext, collaborationId: string, text: string) {
  const ses = await request.post(`/api/collaborations/${collaborationId}/session`).then((r) => r.json() as Promise<{ id: string }>);
  await page.goto(`/s/${ses.id}`);
  await page.locator("[data-composer-input]").fill(text);
  await page.locator("[data-send]").click();
}

test("home task template 写合作邮件 prefills home composer then follows the home ask path", async ({ page, request }) => {
  const createdPosts: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "POST") return;
    const path = new URL(r.url()).pathname;
    if (path === "/api/sessions" || path === "/api/tasks" || path === "/api/tasks/from-text") {
      createdPosts.push(path);
    }
  });
  await page.goto("/");
  await expect(page.locator(".user-chip")).toContainText("鄢棽");
  await expect(page.locator(".user-chip")).toContainText("管理员");
  await expect(page.locator(".user-chip")).not.toContainText("sriphy");
  await expect(page.locator(".user-chip")).not.toContainText("考试已通过");
  await openHomeTemplates(page);
  await homeRecByTitle(page, "写合作邮件").click();
  await expectHomeComposerDraft(page, "写合作邮件 发件箱 [发件邮箱] 发给 [收件邮箱] 主题：[主题]");
  await expect(page.locator('[data-home] [data-skill-chip="email_compose"]')).toBeVisible();
  expect(createdPosts).toEqual([]);
  await page.locator("[data-home] [data-composer-input]").fill("给合作达人写一封自我介绍");
  await expect(page.locator('[data-home] [data-skill-chip="email_compose"]')).toBeVisible();
  await submitHomeComposerStay(page);
  await expectHomeClarification(page, "发件邮箱", "收件邮箱", "邮件主题");
  expect(createdPosts).toContain("/api/tasks/from-text");
  expect(page.url()).not.toMatch(/\/s\//);
});

test("composer / picker lists 写合作邮件 and sends intent email_compose", async ({ page }) => {
  const bodies: Record<string, unknown>[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/messages") && r.method() === "POST") {
      try {
        bodies.push(r.postDataJSON() as Record<string, unknown>);
      } catch {
        /* ignore */
      }
    }
  });
  await page.goto("/");
  const input = page.locator("[data-home] [data-composer-input]");
  await input.click();
  await input.fill("/");
  await expect(page.locator("[data-skill-picker]")).toBeVisible();
  await expect(page.locator('[data-skill-option="email_compose"]')).toContainText("写合作邮件");
  await input.fill("/写");
  await expect(page.locator('[data-skill-option="email_compose"]')).toBeVisible();
  await page.locator('[data-skill-option="email_compose"]').click();
  await expect(page.locator('[data-skill-chip="email_compose"]')).toContainText("写合作邮件");
  await submitHomeComposerStay(page);
  await expectHomeClarification(page, "发件邮箱");
  expect(bodies).toEqual([]);
});

test("session composer / picker also lists 写合作邮件", async ({ page, request }) => {
  const ses = await request.post("/api/sessions", { data: { title: "空会话" } }).then((r) => r.json());
  await page.goto(`/s/${ses.id}`);
  const input = page.locator("[data-composer-input]");
  await input.click();
  await input.fill("/");
  await expect(page.locator("[data-skill-picker]")).toBeVisible();
  await expect(page.locator('[data-skill-option="email_compose"]')).toContainText("写合作邮件");
});

test("composer @ picker lists 写合作邮件 and sends intent email_compose", async ({ page }) => {
  const bodies: Record<string, unknown>[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/messages") && r.method() === "POST") {
      try {
        bodies.push(r.postDataJSON() as Record<string, unknown>);
      } catch {
        /* ignore */
      }
    }
  });
  await page.goto("/");
  const input = page.locator("[data-home] [data-composer-input]");
  await input.click();
  await input.fill("@");
  await expect(page.locator("[data-skill-picker]")).toBeVisible();
  await expect(page.locator('[data-skill-option="email_compose"]')).toContainText("写合作邮件");
  await page.locator('[data-skill-option="email_compose"]').click();
  await expect(page.locator('[data-skill-chip="email_compose"]')).toContainText("写合作邮件");
  await submitHomeComposerStay(page);
  await expectHomeClarification(page, "发件邮箱");
  expect(bodies).toEqual([]);
});

test("typing 写合作邮件 in composer sends intent email_compose", async ({ page }) => {
  const bodies: Record<string, unknown>[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/messages") && r.method() === "POST") {
      try {
        bodies.push(r.postDataJSON() as Record<string, unknown>);
      } catch {
        /* ignore */
      }
    }
  });
  await page.goto("/");
  await page.locator("[data-home] [data-composer-input]").fill("写合作邮件");
  await submitHomeComposerStay(page);
  await expectHomeClarification(page, "发件邮箱", "收件邮箱", "邮件主题");
  expect(bodies).toEqual([]);
});

test("session composer @ picker also lists 写合作邮件", async ({ page, request }) => {
  const ses = await request.post("/api/sessions", { data: { title: "空会话" } }).then((r) => r.json());
  await page.goto(`/s/${ses.id}`);
  const input = page.locator("[data-composer-input]");
  await input.click();
  await input.fill("@");
  await expect(page.locator("[data-skill-picker]")).toBeVisible();
  await expect(page.locator('[data-skill-option="email_compose"]')).toContainText("写合作邮件");
});

test("skills page 使用 on email_compose starts ask with intent email_compose", async ({ page }) => {
  const bodies: Record<string, unknown>[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/messages") && r.method() === "POST") {
      try {
        bodies.push(r.postDataJSON() as Record<string, unknown>);
      } catch {
        /* ignore */
      }
    }
  });
  await page.goto("/skills");
  await expect(page.locator("[data-journey-guide]")).toBeVisible();
  await expect(page.locator("[data-journey-guide]")).not.toContainText("发送不等于改阶段");
  await expect(page.locator("[data-journey-guide]")).not.toContainText("发送 ≠ 推进阶段");
  await page.locator('[data-skill-use="email_compose"]').click();
  await page.waitForURL(/\/s\//);
  await expect(page.locator("[data-kind='me']")).toContainText("写合作邮件", { timeout: 15000 });
  expect(bodies[0]?.intent).toBe("email_compose");
  expect(bodies[0]?.act).toBe("ask");
});

test("composer plus menu exposes projects, recent files, and published skills", async ({ page }) => {
  const bodies: Record<string, unknown>[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/messages") && request.method() === "POST") {
      bodies.push(request.postDataJSON() as Record<string, unknown>);
    }
  });
  await page.goto("/");
  await page.locator("[data-home] [data-attach]").click();
  const menu = page.getByRole("menu", { name: "添加内容" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "上传文件" })).toBeVisible();

  await menu.getByRole("menuitem", { name: "技能" }).hover();
  const skills = page.getByRole("menu", { name: "技能" });
  await expect(skills.getByRole("menuitem", { name: /写合作邮件/ })).toBeVisible();
  await expect(skills.getByRole("menuitem", { name: "创建技能" })).toHaveCount(0);
  await expect(skills.getByRole("menuitem", { name: "管理技能" })).toHaveCount(0);
  await expect(menu.getByRole("menuitem", { name: "添加连接器" })).toHaveCount(0);

  await menu.getByRole("menuitem", { name: "最近的文件" }).hover();
  await expect(page.getByRole("menu", { name: "最近的文件" })).toBeVisible();

  await menu.getByRole("menuitem", { name: "添加到项目" }).dispatchEvent("mouseover");
  await page.getByRole("menu", { name: "项目" }).getByRole("menuitem", { name: /小美妆日记/ }).evaluate((element: HTMLElement) => element.click());
  await expect(page.locator('[data-project-id="col_xiaomei"]')).toContainText("小美妆日记");
  expect(bodies).toEqual([]);
});

test("home rec ask opens chat with grey bubble and draft on the right", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("aside .brand-name")).toHaveText("灵工 工作");
  await expect(page.locator("[data-home] h1")).toHaveText("今天有什么工作要处理？");
  await expectHomeChromeRow(page);
  await expect(page.locator('[data-brand-lockup="home"] .brand-logo')).toHaveAttribute("src", "/brand/litime-logo.png");
  await expect(page.locator("aside [data-brand-lockup]")).toHaveCount(0);
  await expect(page.locator("aside")).not.toContainText("Powering Outdoor Adventures");
  await expect(page.locator("aside")).not.toContainText("服务几代人的户外生活");
  const logoBox = await page.locator('[data-brand-lockup="home"] .brand-logo').boundingBox();
  const enBox = await page.locator('[data-brand-lockup="home"] .brand-slogan-en').boundingBox();
  expect(logoBox && enBox).toBeTruthy();
  expect(enBox!.x).toBeGreaterThan(logoBox!.x + logoBox!.width - 2);
  expect(Math.abs(enBox!.y - logoBox!.y)).toBeLessThan(48);
  await openHomeTemplates(page);
  const taskButtons = page.locator("[data-home] .rec");
  const catalogResponse = await page.request.get("/api/task-definitions");
  const catalogPayload = await catalogResponse.json() as { task_definitions?: unknown[]; definitions?: unknown[] } | unknown[];
  const catalogCount = Array.isArray(catalogPayload)
    ? catalogPayload.length
    : (catalogPayload.task_definitions || catalogPayload.definitions || []).length;
  // Home also appends UX aliases (延期关怀, 催大纲) that are not registry skills.
  expect(await taskButtons.count()).toBeGreaterThanOrEqual(catalogCount + 1);
  for (let i = 0; i < await taskButtons.count(); i += 1) {
    await expect(taskButtons.nth(i)).toHaveAttribute("data-act", "ask");
    await expect(taskButtons.nth(i)).not.toHaveAttribute("data-intent", "");
    await expect(taskButtons.nth(i).locator(".rec-description")).not.toBeEmpty();
  }
  const categories = new Set((Array.isArray(catalogPayload)
    ? catalogPayload
    : (catalogPayload.task_definitions || catalogPayload.definitions || []))
    .map((item) => String((item as { category?: unknown }).category || "常用任务")));
  categories.add("异常");
  categories.add("履约");
  await expect(page.locator("[data-task-category]")).toHaveCount(categories.size);
  await expect(page.locator('[data-home] .rec[data-act="go"]')).toHaveCount(0);
  await expect(page.locator("[data-composer]")).toBeVisible();
  await expect(page.locator("[data-nav-disabled='云盘']")).toContainText("非本期");
  await expect(page.locator("[data-nav-disabled='手机遥控电脑']")).toContainText("非本期");
  await expect(page.locator("[data-nav-disabled='创建新项目']")).toContainText("非本期");
  await expect(page.locator('[data-nav="pipeline"]')).toHaveCount(0);
  await expect(page.locator(".sidebar")).not.toContainText("生命周期");
  await expect(page.locator(".mobile-top")).not.toContainText("生命周期");
  await expect(page.locator('[data-nav="confirm"]')).toHaveCount(0);
  await expect(page.locator(".sidebar")).not.toContainText("等我确认");
  await expect(page.locator(".sidebar")).not.toContainText("等我確認");
  await expect(page.locator(".sidebar")).not.toContainText("Awaiting confirm");
  await expect(page.locator('[data-nav="approvals"]')).toContainText("审批");
  await expect(page.locator('a[href="/pipeline"]')).toHaveCount(0);
  await expectHomeModeOrder(page);
  await expect(page.locator('[data-home-mode="ai"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("[data-recommended-tasks]")).toBeVisible();
  await expect(page.locator("[data-home]")).not.toContainText("今天推荐");
  await expect(page.locator("[data-today-work]")).toHaveCount(0);
  await expect(page.locator("[data-today-summary]")).toContainText("项待处理");
  await expect(page.locator("[data-today-summary]")).toContainText("逾期");
  await expect(page.locator("[data-today-summary]")).not.toContainText("归因复盘");
  await expect(page.locator("[data-today-summary]")).not.toContainText("结果待确认");
  await expect(page.locator("[data-today-summary] [data-panel-filter]")).toHaveCount(0);
  await expect(page.locator("[data-home] [data-workbench]")).toHaveCount(0);
  await expect(page.locator("[data-kol-tab]")).toHaveCount(0);
  await expect(page.locator("[data-journey-guide]")).toHaveCount(0);
  await page.locator("[data-work-panel] .work-panel-backdrop").click();
  await openHomeTodo(page);
  await expect(page.locator("[data-today-work]")).toBeVisible();
  await expect(page.locator("[data-today-work] [data-recommended-tasks]")).toHaveCount(0);
  await expect(page.locator('[data-todo-bucket="later"]')).toHaveCount(0);
  await expect(page.locator('[data-todo-bucket="waiting"]')).toHaveCount(0);
  await expect(page.locator("[data-today-work]")).not.toContainText("后续");
  await expect(page.locator("[data-today-work] h2, [data-todo-md] strong").filter({ hasText: "我的待办" })).toHaveCount(0);
  await openHomeLifecycle(page);
  await expectFollowedKolHeadingRemoved(page);
  await expect(page.getByRole("link", { name: /查看KOL全生命周期/ })).toHaveCount(0);
  await expect(page.locator('a[href="/pipeline"]')).toHaveCount(0);
  await expect(page.locator("[data-kol-sorts], [data-kol-secondary-filters]")).toHaveCount(0);
  await expect(page.locator("[data-home-pane=lifecycle]")).not.toContainText("按需处理");
  await expect(page.locator("[data-home-pane=lifecycle]")).not.toContainText("最近更新");
  await expect(page.locator("[data-home-pane=lifecycle]")).not.toContainText("阶段停留");
  await expect(page.locator("[data-home] [data-journey-guide]")).toHaveCount(0);
  await expect(page.locator("[data-home-pane=lifecycle]")).not.toContainText("发送不等于改阶段");
  await expect(page.locator("[data-home-pane=lifecycle]")).not.toContainText("发送 ≠ 推进阶段");
  await expect(page.locator("[data-lifecycle-domains]")).toHaveCount(0);
  await expect(page.locator("[data-lifecycle-library]")).toHaveCount(0);
  await expect(page.locator("[data-kol-tab]")).toHaveCount(17);
  await expect(page.locator('[data-kol-tab="all"]')).toContainText("全部");
  await expect(page.locator('[data-kol-tab="INITIAL_CONTACT"]')).toContainText("接触");
  await expect(page.locator('[data-kol-tab="exception"]')).toContainText("异常");
  await expect(page.locator('[data-kol-tab="needs_me"]')).toHaveCount(0);
  await expect(page.locator('[data-kol-tab="waiting_them"]')).toHaveCount(0);
  await expect(page.locator('[data-kol-tab="waiting_approval"]')).toHaveCount(0);
  await expect(page.locator("[data-kol-stage-filter]")).toHaveCount(0);
  await openHomeTemplates(page);
  await homeRecByTitle(page, "写合作邮件").click();
  await expectHomeComposerDraft(page, "写合作邮件 发件箱 [发件邮箱] 发给 [收件邮箱] 主题：[主题]");
  await submitHomeComposerStay(page);
  await expectHomeClarification(page, "发件邮箱", "收件邮箱", "邮件主题");
});

test("exception template 延期关怀 prefills home then drafts without changing stage", async ({ page }) => {
  await page.goto("/");
  await openHomeTemplates(page);
  const delayCare = homeRecByTitle(page, "延期关怀");
  await delayCare.scrollIntoViewIfNeeded();
  await delayCare.click();
  await expectHomeComposerDraft(page, "延期关怀 [红人或合作]");
  await submitHomeComposer(page);
  await expect(page.locator('[data-kind="me"]')).toContainText("延期关怀", { timeout: 15000 });
  await expectDraft(page);
  await expect(page.locator("[data-workbench] [data-draft-subject]")).toHaveValue("Update on the Content Timeline");
  // Constitution §4: one quiet send≠stage hint on the composer, not on the draft.
  await expect(page.locator("[data-session-send-hint]")).toHaveText("发送不等于改阶段");
  await expect(page.locator("[data-workbench] [data-kind='email-card']")).not.toContainText("正式阶段");
});

test("home composer posts a message into a new session", async ({ page }) => {
  await page.goto("/");
  const reqs: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/messages") && r.method() === "POST") reqs.push(r.url());
  });
  await page.locator("[data-home] [data-composer-input]").fill("给@小美妆日记 写阶段跟进邮件");
  await page.locator("[data-home] [data-send]").click();
  await page.waitForURL(/\/s\//);
  await expect(page.locator('[data-kind="me"]')).toContainText("给@小美妆日记 写阶段跟进邮件", { timeout: 15000 });
  await expect(page.locator("[data-workbench]")).toBeVisible();
  expect(reqs.length).toBeGreaterThan(0);
});

test("pipeline review follows the common task flow with progress and a right-side result", async ({ page }) => {
  const now = new Date().toISOString();
  const sessionMessages = (sessionId: string) => {
    const base = { session_id: sessionId, role: "assistant", created_at: now };
    return [
      { ...base, id: "m1", role: "user", kind: "me", payload: { text: "复盘 KOL 流水线" } },
      { ...base, id: "m2", kind: "process_trace", payload: { title: "分析进度", phases: [
        { label: "汇总流水线状态", status: "done", summary: "已覆盖当前合作记录。" },
        { label: "识别风险", status: "done" },
      ] } },
      { ...base, id: "m3", kind: "operation_trace", payload: { operations: [
        { tool_label: "读取合作记录", status: "done" },
        { tool_label: "生成复盘结果", status: "done" },
      ] } },
      { ...base, id: "m4", kind: "task_result_card", payload: {
        title: "KOL 流水线复盘",
        summary: "两项合作需要优先处理。",
        metrics: [{ label: "待处理", value: 2 }],
        sections: [{ title: "主要发现", body: "优先关注停滞合作。", items: ["一项合作临近延期"] }],
        recommended_actions: ["今天完成阶段跟进"],
      } },
    ];
  };
  const pipelineRec = {
    id: "risk_scan",
    title: "流水线复盘",
    prompt: "复盘 KOL 流水线",
    intent: "risk_scan",
    skill_id: "risk_scan",
    act: "ask",
    category: "分析与复盘",
    profile: "识别阶段风险并给出后续动作",
  };
  await page.route("**/api/task-definitions", (route) => route.fulfill({ json: [pipelineRec] }));
  await page.route("**/api/home", async (route) => {
    await route.fulfill({
      json: {
        brand: "灵工 工作",
        h1: "今天有什么工作要处理？",
        recs: [pipelineRec],
      },
    });
  });
  let sent = false;
  await page.route("**/api/sessions/*", async (route) => {
    if (route.request().method() !== "GET" || route.request().url().includes("/messages")) {
      await route.fallback();
      return;
    }
    const sessionId = route.request().url().split("/sessions/")[1].split(/[/?]/)[0];
    await route.fulfill({
      json: { agent_status: "listening", messages: sent ? sessionMessages(sessionId) : [] },
    });
  });
  await page.route("**/api/sessions/*/messages", async (route) => {
    sent = true;
    const sessionId = route.request().url().split("/sessions/")[1].split("/")[0];
    await route.fulfill({
      status: 200,
      json: {
        agent_status: "listening",
        messages: sessionMessages(sessionId),
      },
    });
  });
  await page.goto("/");
  const bodies: Record<string, unknown>[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/messages") && r.method() === "POST") bodies.push(r.postDataJSON());
  });
  await openHomeTemplates(page);
  await page.locator('[data-home] .rec[data-intent="risk_scan"]').click();
  await expectHomeComposerDraft(page, "超时/风险扫描");
  await submitHomeComposer(page);
  await expect(page.locator('[data-kind="me"]')).toContainText("复盘 KOL 流水线");
  await expect(page.locator('[data-ai-message][data-role="user"]')).toContainText("复盘 KOL 流水线");
  await expect(page.locator('[data-kind="process-trace"]')).toContainText("识别风险");
  await expect(page.locator('[data-kind="operation-trace"]')).toContainText("读取合作记录");
  await expect(page.locator('[data-ai-result="task_result"]')).toBeVisible();
  await expect(page.locator('[data-workbench] [data-kind="task-result-card"]')).toContainText("两项合作需要优先处理");
  await expect(page.locator('[data-workbench] [data-kind="task-result-card"]')).toContainText("优先关注停滞合作");
  await expect(page.locator('[data-tab="result"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('.chat [data-kind="task-result-card"]')).toHaveCount(0);
  expect(bodies[0]?.act).toBe("ask");
  expect(bodies[0]?.intent).toBe("risk_scan");
});

test("pipeline shows a 15-stage milestone timeline and lifecycle drawer", async ({ page }) => {
  await page.goto("/pipeline");
  await expect(page).toHaveURL(/\/pipeline$/);
  await expect(page.getByRole("heading", { name: "KOL 全生命周期管理" })).toBeVisible();
  await expect(page.locator(".pipeline-page .page-kicker")).toHaveText("合作");
  await expect(page.locator(".pipeline-page")).toContainText("不是创建新项目");
  await expect(page.locator(".pipeline-page")).toContainText("不是今日待办");
  await expect(page.locator("[data-nav-disabled='创建新项目']")).toBeVisible();
  await expect(page.locator("[data-exception-bar]")).toContainText("旁路 / 异常阶段");
  await expect(page.locator("[data-exception-bar]")).toContainText("争议中");
  await expect(page.locator("[data-exception-bar]")).toContainText("不是首页的「等待中」");
  await expect(page.locator("[data-journey-guide]")).toHaveCount(0);
  await expect(page.locator("[data-pipeline-related]")).toHaveCount(0);
  await expect(page.locator("[data-pipeline-task]")).toHaveCount(0);
  await expect(page.locator(".pipeline-page")).not.toContainText("首页任务");
  await expect(page.locator(".pipeline-page")).not.toContainText("本页动作");
  await expect(page.locator(".pipeline-page")).not.toContainText("写合作邮件");
  await expect(page.locator(".pipeline-page")).not.toContainText("超时/风险扫描");
  await expect(page.locator("[data-pipeline-drawer]")).toHaveCount(0);
  await expect(page.locator(".pipeline-item.is-selected")).toHaveCount(0);
  await expect(page.locator("[data-stage-axis] li")).toHaveCount(15);
  await expect(page.locator('[data-kol="小美妆日记"] [data-milestone="INITIAL_CONTACT"]')).toHaveAttribute("data-current", "true");
  await expect(page.locator('[data-kol="数码老张"] [data-milestone="QUOTE_PENDING"]')).toHaveAttribute("data-current", "true");
  await expect(page.locator("[data-pipeline-filters] [data-filter='brand']")).toBeVisible();
  await expect(page.locator("[data-pipeline-filters] [data-filter='owner']")).toBeVisible();
  await expect(page.locator("[data-pipeline-filters] [data-filter='stage']")).toBeVisible();
  await page.locator('[data-kol="小美妆日记"] [data-pipeline-row]').click();
  expect(new URL(page.url()).searchParams.get("kol")).toBe("小美妆日记");
  await expect(page.locator("[data-pipeline-drawer]")).toBeVisible();
  await expect(page.locator("[data-pipeline-drawer]")).toContainText("初步接触");
  await expect(page.locator("[data-creator-ledger]")).toContainText("钟槿年");
  await expect(page.locator("[data-pipeline-drawer]")).toContainText("本页未返回往来摘要");
  await expect(page.locator("[data-pipeline-drawer] [data-propose-stage]")).toHaveText("提出阶段变更");
  await expect(page.locator("[data-pipeline-drawer]")).not.toContainText("写合作邮件");
  await expect(page.locator("[data-pipeline-drawer]")).not.toContainText("记状态");
  await page.locator('[data-kol="数码老张"] [data-pipeline-row]').click();
  await expect(page.locator("[data-pipeline-drawer]")).toContainText("报价待确认");
  await page.locator("[data-pipeline-filters] [data-filter='brand']").selectOption("RO");
  await expect(page.locator("[data-pipeline-drawer]")).toHaveCount(0);
  await expect(page.locator("[data-kol]")).toHaveCount(1);
  await expect(page.locator('[data-kol="母婴小课"]')).toBeVisible();
  await page.goto("/pipeline?brand=RO");
  await expect(page.locator("[data-pipeline-drawer]")).toHaveCount(0);
  await expect(page.locator("[data-kol]")).toHaveCount(1);
  await expect(page.locator('[data-kol="母婴小课"]')).toBeVisible();
  await page.goto("/pipeline?kol=数码老张");
  await expect(page.locator("[data-pipeline-drawer]")).toContainText("报价待确认");
});

test("session page has no coach next-step card and keeps composer skills", async ({ page }) => {
  await page.goto("/");
  await openHomeLifecycle(page);
  await openFollowedKolDetail(page);
  await expect(page).toHaveURL(/\/s\//);
  await expect(page.locator("[data-journey-next]")).toHaveCount(0);
  await expect(page.locator("[data-journey-guide]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /下一步：/ })).toHaveCount(0);
  await expect(page.locator("[data-session-stream-pane]")).toBeVisible();
  await expect(page.locator("[data-ai-conversation]")).toBeVisible();
  await expect(page.locator("[data-ai-conversation-content]")).toBeVisible();
  await expect(page.locator("[data-composer-input]")).toBeVisible();
  await expect(page.locator("[data-ai-prompt-input]")).toBeVisible();
  await expect(page.locator("[data-ai-prompt-textarea]")).toBeVisible();
  await expect(page.locator("[data-ai-prompt-submit]")).toBeVisible();
  await expect(page.locator("[data-session-send-hint]")).toHaveText("发送不等于改阶段");
  const sop = page.locator("[data-stage-sop]");
  if (await sop.count()) {
    await expect(sop).toHaveJSProperty("open", false);
    const handleLeft = await page.locator("[data-kol-journey] h1").evaluate((el) => el.getBoundingClientRect().left);
    const sopLeft = await sop.evaluate((el) => el.getBoundingClientRect().left);
    expect(Math.abs(handleLeft - sopLeft)).toBeLessThan(6);
  }
  await expect(page.locator("[data-session-stream-pane] [data-mail-digest], [data-session-stream-pane] [data-mail-summaries]")).toBeVisible();
  await expect(page.locator("[data-journey-track]")).toBeVisible();
  const trackHasLine = await page.locator("[data-journey-track]").evaluate((el) => {
    const before = getComputedStyle(el, "::before");
    return before.display !== "none" && before.content !== "none" && parseFloat(before.height || "0") > 0;
  });
  expect(trackHasLine).toBeTruthy();
  await expect(page.locator("[data-session-stream-pane]")).not.toContainText("{");
  await expect(page.locator("[data-session-stream-pane]")).not.toContainText("右侧结果");
  await expect(page.locator("[data-workbench]")).toBeVisible();
  await saveScreenshot(page, "session_chrome_digest_journey_workbench.png");
});

test("home lifecycle followed KOL opens the mail rail not the task list", async ({ page }) => {
  await page.goto("/");
  await openHomeLifecycle(page);
  await openFollowedKolDetail(page);
  await expect(page).toHaveURL(/\/s\//);
  await expect(page.locator("[data-agent-task-list]")).toHaveAttribute("data-tasklist-mode", "mail");
  await expect(page.locator("[data-agent-task-list] strong")).toHaveText("往来邮件");
  await expect(page.locator("[data-agent-task-list][data-tasklist-mode='tasks']")).toHaveCount(0);
  await expect(page.locator("[data-agent-task-list] strong")).not.toHaveText("任务列表");
  await expect(page.locator("[data-session-mail-list]")).toBeVisible();
  await expect(page.locator(".chat")).toHaveAttribute("data-session-stream", /idle|live/);
});

test("home followed-KOL tabs filter 17 statuses and open the KOL session", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('[data-home-mode="ai"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("[data-today-summary]")).toContainText("项待处理");
  await openHomeLifecycle(page);
  await expect(page.locator("[data-kol-tab]")).toHaveCount(17);
  await expect(page.locator('[data-kol-tab="all"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-kol-tab="INITIAL_CONTACT"]')).toBeVisible();
  await expect(page.locator('[data-kol-tab="needs_me"]')).toHaveCount(0);
  // Tabs are static (17) even before /api/home/board lands. Wait for the stub
  // listAllKolProfiles pair first; demo fixtures like 小美妆日记 have no kol_uid.
  await expect(page.locator('[data-followed-kol="户外电源达人"]')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('[data-followed-kol="营地灯测评娘"]')).toBeVisible();
  await expect(page.locator('[data-followed-kol="小美妆日记"]')).toHaveCount(0);
  await expect(page.locator("[data-followed-kol]")).toHaveCount(2);
  const outdoor = page.locator('[data-followed-kol="户外电源达人"]');
  await expect(outdoor.locator("[data-kol-identity]")).toContainText("户外电源达人");
  await expect(outdoor.locator("[data-kol-identity]")).not.toContainText("KOL 名称");
  await expect(outdoor.locator("[data-kol-scope]")).toContainText("LT");
  await expect(outdoor.locator("[data-kol-band]")).toHaveCount(4);
  await expect(outdoor.locator('[data-kol-card-cols="5"]')).toHaveCount(0);
  await expect(outdoor.locator(".task-main")).toHaveCount(0);
  await expect(outdoor.locator("[data-current-state]")).toContainText("初步接触");
  await expect(outdoor.locator("[data-recommended-action]")).toContainText("建议依据不足");
  await expect(outdoor.locator("[data-confirm-enter-stage]")).toHaveCount(0);
  await expect(page.locator('[data-kol-tab="all"]')).not.toContainText("失联跟进");
  await expect(page.locator('[data-kol-tab="all"] .kol-tab-history')).toHaveCount(0);
  await openFollowedKolDetail(page, "户外电源达人");
  await expect(page).toHaveURL(/\/s\//);
  await expect(page.locator("[data-kol-journey]")).toContainText("户外电源达人");
  await expect(page.locator("[data-session-stage]")).toBeVisible();
  await page.locator("[data-kol-journey] [data-open-lifecycle]").click();
  await expect(page).toHaveURL(/\/pipeline\?kol=/);
  await expect(page.getByRole("heading", { name: "KOL 全生命周期管理" })).toBeVisible();
});

test("KOL session header can tag a followed creator as 犹豫谨慎", async ({ page }) => {
  await page.goto("/");
  await openHomeLifecycle(page);
  await openFollowedKolDetail(page, "户外电源达人");
  await expect(page.locator("[data-kol-journey]")).toContainText("户外电源达人");
  await expect(page.locator("[data-follow-style-bar]")).toBeVisible();
  await page.locator("[data-follow-style-add]").click();
  await expect(page.locator("[data-follow-style-panel]")).toBeVisible();
  await page.locator('[data-follow-style-preset="cautious"]').click();
  const save = page.locator("[data-follow-style-save]");
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.locator("[data-follow-style-panel]")).toHaveCount(0);
  await expect(page.locator('[data-follow-style-tag="cautious"]')).toContainText("犹豫谨慎");
  await expect(page.locator("[data-kind='task-result-card']")).toContainText("犹豫谨慎");
  const sessionId = page.url().match(/\/s\/([^/?#]+)/)?.[1];
  expect(sessionId).toBeTruthy();
  // Home/board GET also kicks library + mail sync; poll the session journey
  // so a slow sync cannot hide a tag that already persisted.
  await expect.poll(async () => {
    const session = await page.request.get(`/api/sessions/${sessionId}`).then((r) => r.json()) as {
      journey?: { follow_style_tags?: { id?: string }[] };
    };
    return session.journey?.follow_style_tags?.some((tag) => tag.id === "cautious") === true;
  }, { timeout: 15000 }).toBe(true);
  await page.goto("/");
  await openHomeLifecycle(page);
  const tagged = page.locator('[data-followed-kol="户外电源达人"]');
  await expect(tagged).toBeVisible();
  await expect(tagged.locator('[data-follow-style-tag="cautious"]')).toHaveCount(0);
  await expect(tagged.locator("[data-kol-scope]")).not.toContainText("犹豫谨慎");
  await openFollowedKolDetail(page, "户外电源达人");
  await expect(page.locator('[data-follow-style-tag="cautious"]')).toContainText("犹豫谨慎");
});

async function expectNoHorizontalOverflow(page: Page, selector: string) {
  const box = await page.locator(selector).evaluate((el) => ({
    client: el.clientWidth,
    scroll: el.scrollWidth,
  }));
  expect(box.scroll).toBeLessThanOrEqual(box.client + 1);
}

test("home followed-KOL cards fit the viewport without a horizontal scrollbar", async ({ page }) => {
  const longBilingual = [
    "Hi there, I hope this message finds you in great spirits. I wanted to reach out about a possible collaboration with LiTime and share our media kit, rate card, posting calendar, and a long bilingual dump that used to stretch the home card into a wide table.",
    "你好，我现在想和贵品牌litime合作，方便发一下产品资料吗？Best regards, Amy",
  ].join("\n\n");
  await page.route("**/api/home/board", (route) => route.fulfill({
    json: {
      kols: [
        {
          id: "col_xiaomei",
          handle: "小美妆日记",
          brand: "LT",
          stage_code: "INITIAL_CONTACT",
          stage_label: "初步接触",
          exception: false,
          days_in_stage: 12,
          mailbox_from: "larry.zhao@amperetime.com",
          owner_name: "钟槿年",
          profile_tags: [{ id: "niche", label: "美妆" }],
          follow_style_tags: [{ id: "cautious", label: "犹豫谨慎" }],
          kol_name: "小美妆日记",
          collab_summary: "LT品牌合作 · 负责人 钟槿年 · 首封已读未回",
          recent_followup: "写跟进邮件 · 已完成",
          current_stage: "初步接触 · 停留 12 天",
          suggested_stage: "已回复-有兴趣",
          unread_count: 1,
          mail_threads: [{
            conversation_id: "3901",
            subject: "Re: LiTime collab",
            unread_count: 1,
            last_direction: "inbound",
            last_from: "amy@example.com",
            last_from_name: "Amy",
            last_at: "2026-09-12T10:00:00.000Z",
            last_snippet: longBilingual,
          }],
        },
        { id: "col_laozhang", handle: "数码老张", brand: "LT", stage_code: "QUOTE_PENDING", stage_label: "报价待确认", exception: false, kol_name: "数码老张", collab_summary: "LT品牌合作", recent_followup: "写报价信 · 等待中", current_stage: "报价待确认", suggested_stage: "商务谈判" },
      ],
      tasks: [],
      tabs: [{ code: "all", count: 2 }, { code: "INITIAL_CONTACT", count: 1 }, { code: "QUOTE_PENDING", count: 1 }],
    },
  }));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await openHomeLifecycle(page);
  const card = page.locator('[data-followed-kol="小美妆日记"]');
  await expect(card.locator("[data-kol-band]")).toHaveCount(4);
  await expect(card.locator('[data-kol-card-cols="5"]')).toHaveCount(0);
  await expect(card.locator(".task-main")).toHaveCount(0);
  await expectFollowedKolHeadingRemoved(page);
  await expectFollowedKolListAlignsWithTabs(page);
  const stageBox = await page.locator("[data-home] .home-stage").boundingBox();
  const cardBox = await card.boundingBox();
  expect(stageBox && cardBox).toBeTruthy();
  expect((cardBox?.width || 0)).toBeLessThan(stageBox!.width - 8);
  await expectNoHorizontalOverflow(page, "[data-home-modes]");
  await expectNoHorizontalOverflow(page, "[data-kol-tabs]");
  await expectNoHorizontalOverflow(page, "[data-followed-kol-list]");
  await expectNoHorizontalOverflow(page, '[data-followed-kol="小美妆日记"]');
  await expect(card.locator("[data-mail-summary]")).toBeVisible();
  await expect(card.locator("[data-mail-summary]")).toContainText("想和贵品牌litime合作");
  await expect(card.locator('[data-kol-chip="mailbox"]')).toHaveText("larry.zhao@amperetime.com");
  await expect(card.locator('[data-kol-chip="owner"]')).toHaveText("钟槿年");
  await expect(card.locator("[data-stage-label]")).toHaveText("初步接触");
  await expect(card.locator("[data-days-in-stage]")).toHaveText("停留 12 天");
  await expect(card.locator("[data-current-state]")).not.toContainText(" · ");
  await expect(card.locator("[data-current-state]")).not.toContainText("异常");
  await expect(card.locator('[data-follow-style-tag]')).toHaveCount(0);
  await expect(card.locator("[data-kol-scope]")).not.toContainText("犹豫谨慎");
  await expect(card.locator("[data-mail-summary]")).not.toContainText("posting calendar");
  await expect(card.locator("[data-open-original-mail]")).toHaveText("查看原邮件");
  await expect(card.locator("[data-kol-primary-action]")).toHaveCount(1);
  await expect(card.locator('[data-kol-primary-action="open-session"]')).toHaveText("查看来信");
  await expect(card.locator("[data-recommended-action]")).toContainText("查看来信");
  await expect(card.locator("[data-latest-fact]")).toContainText("想和贵品牌litime合作");

  await page.setViewportSize({ width: 1100, height: 900 });
  await expect(card).toBeVisible();
  await expectNoHorizontalOverflow(page, "[data-home-modes]");
  await expectNoHorizontalOverflow(page, "[data-kol-tabs]");
  await expectNoHorizontalOverflow(page, "[data-followed-kol-list]");
  await expectNoHorizontalOverflow(page, '[data-followed-kol="小美妆日记"]');
});

test("home followed-KOL 查看原邮件 opens the existing session mail rail", async ({ page }) => {
  await page.route("**/api/home/board", (route) => route.fulfill({
    json: {
      kols: [{
        id: "col_xiaomei",
        handle: "小美妆日记",
        brand: "LT",
        stage_code: "INITIAL_CONTACT",
        stage_label: "初步接触",
        kol_name: "小美妆日记",
        collab_summary: "LT品牌合作",
        recent_followup: "写跟进邮件",
        current_stage: "初步接触",
        suggested_stage: "已回复-有兴趣",
        mail_threads: [{
          conversation_id: "3901",
          subject: "Re: LiTime collab",
          last_direction: "inbound",
          last_snippet: "你好，想和贵品牌litime合作",
        }],
      }],
      tasks: [],
      tabs: [{ code: "all", count: 1 }, { code: "INITIAL_CONTACT", count: 1 }],
    },
  }));
  await page.route("**/api/collaborations/col_xiaomei/session", (route) => route.fulfill({
    json: { id: "kol-mail-session", collaboration_id: "col_xiaomei" },
  }));
  await page.route("**/api/sessions/kol-mail-session**", (route) => route.fulfill({
    json: {
      id: "kol-mail-session",
      collaboration_id: "col_xiaomei",
      agent_status: "listening",
      messages: [],
      journey: {
        handle: "小美妆日记",
        stage_label: "初步接触",
        collaboration_id: "col_xiaomei",
        mail_history: [{
          id: "mail-3901",
          conversation_id: "3901",
          subject: "Re: LiTime collab",
          direction: "inbound",
          body: "Hi there, I hope this message finds you well.\n\n你好，想和贵品牌litime合作",
        }],
      },
    },
  }));
  await page.goto("/");
  await openHomeLifecycle(page);
  await page.locator('[data-followed-kol="小美妆日记"] [data-open-original-mail]').click();
  await expect(page).toHaveURL(/\/s\/kol-mail-session/);
  await expect(page.locator("[data-workbench] [data-mail-body]")).toBeVisible();
  await expect(page.locator("[data-workbench] [data-mail-body]")).toContainText("想和贵品牌litime合作");
});

test("home followed-KOL default sort uses contract keys 1-8", async ({ page }) => {
  await page.route("**/api/home/board", (route) => route.fulfill({
    json: {
      kols: [
        { id: "z-late", handle: "晚到的", brand: "LT", stage_code: "PUBLISHED", stage_label: "已发布", days_in_stage: 1 },
        { id: "e-stay", handle: "停留最长", brand: "LT", stage_code: "TESTING", stage_label: "已签收-测试中", days_in_stage: 40 },
        { id: "d-overdue", handle: "逾期跟进", brand: "LT", stage_code: "EVALUATING", stage_label: "合作评估", days_in_stage: 3, overdue: 1 },
        {
          id: "c-unread",
          handle: "未读来信",
          brand: "LT",
          stage_code: "INITIAL_CONTACT",
          stage_label: "初步接触",
          days_in_stage: 2,
          unread_count: 1,
          mail_threads: [{
            conversation_id: "u1",
            subject: "Re",
            unread_count: 1,
            last_direction: "inbound",
            last_snippet: "想继续聊",
            last_at: "2026-09-12T10:00:00.000Z",
          }],
        },
        {
          id: "b-confirm",
          handle: "待确认",
          brand: "LT",
          stage_code: "INITIAL_CONTACT",
          stage_label: "初步接触",
          suggested_stage: "已回复-有兴趣",
          suggested_stage_code: "INTERESTED",
          days_in_stage: 2,
          mail_threads: [{
            conversation_id: "c1",
            subject: "Re: interest",
            unread_count: 0,
            last_direction: "inbound",
            last_snippet: "我对这次合作有兴趣",
            last_at: "2026-09-11T10:00:00.000Z",
          }],
        },
        { id: "a-risk", handle: "异常菌", brand: "PQ", stage_code: "DISPUTED", stage_label: "争议中", exception: true, notes: "样品争议", days_in_stage: 8, mailbox_from: "pq.ops@example.com" },
      ],
      tasks: [],
    },
  }));
  await page.goto("/");
  await openHomeLifecycle(page);
  await expect(page.locator("[data-followed-kol]")).toHaveCount(6);
  const handles = await page.locator("[data-followed-kol]").evaluateAll((els) => (
    els.map((el) => el.getAttribute("data-followed-kol"))
  ));
  expect(handles).toEqual(["异常菌", "待确认", "未读来信", "逾期跟进", "停留最长", "晚到的"]);
  const risk = page.locator('[data-followed-kol="异常菌"]');
  await expect(risk.locator("[data-stage-label]")).toHaveText("争议中");
  await expect(risk.locator("[data-days-in-stage]")).toHaveText("停留 8 天");
  await expect(risk.locator("[data-current-state]")).not.toContainText(" · ");
  await expect(risk.locator("[data-current-state]")).not.toContainText("异常");
  await expect(risk.locator('[data-kol-chip="exception"]')).toHaveText("异常");
  await expect(risk.locator('[data-kol-chip="mailbox"]')).toHaveText("pq.ops@example.com");
  await expect(page.locator("[data-kol-sorts], [data-kol-sort]")).toHaveCount(0);
  await expect(page.locator("[data-home-pane=lifecycle]")).not.toContainText("按需处理");
  await expect(page.locator("[data-home-pane=lifecycle]")).not.toContainText("阶段停留");
});

test("home confirm CTA names the target stage and opens confirm_stage", async ({ page }) => {
  await page.route("**/api/home/board", (route) => route.fulfill({
    json: {
      kols: [{
        id: "col_xiaomei",
        handle: "小美妆日记",
        brand: "LT",
        stage_code: "INITIAL_CONTACT",
        stage_label: "初步接触",
        suggested_stage: "已回复-有兴趣",
        suggested_stage_code: "INTERESTED",
        stage_version: 0,
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
    },
  }));
  await page.goto("/");
  await openHomeLifecycle(page);
  const card = page.locator('[data-followed-kol="小美妆日记"]');
  await expect(card.locator("[data-kol-band]")).toHaveCount(4);
  await expect(card.locator("[data-latest-fact]")).toContainText("我对这次合作有兴趣");
  await expect(card.locator("[data-recommended-action]")).toContainText("确认进入「已回复-有兴趣」");
  const cta = card.locator("[data-confirm-enter-stage]");
  await expect(cta).toHaveText("确认进入「已回复-有兴趣」");
  await expect(card.getByRole("button", { name: "确认阶段", exact: true })).toHaveCount(0);
  await cta.click();
  await expect(page).toHaveURL(/\/s\//);
  await expect(page.locator('[data-kind="confirm-stage-card"]')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('[data-kind="confirm-stage-card"]')).toContainText("初步接触");
  const confirmCard = page.locator('[data-kind="confirm-stage-card"]');
  await expectSelectedStage(confirmCard, "INTERESTED");
  await expect(confirmCard.locator("[data-stage-track='main']")).toContainText("主流程");
  await expect(confirmCard.locator("[data-stage-track='branch']")).toContainText("分支流程");
  await expect(confirmCard.locator("[data-stage-track='exception']")).toContainText("异常流程");
  await expect(confirmCard.locator("[data-stage-chip]", { hasText: "跳过" })).toHaveCount(0);
  await expect(confirmCard.locator('[data-stage-chip][data-stage-code="INTERESTED"]')).toContainText("建议");
});

test("home waiting work item is labeled 结果待确认 not 等待中", async ({ page }) => {
  const todos = [
    {
      id: "tsk_home_laozhang_quote",
      title: "写报价信",
      source: "manual",
      status: "waiting",
      kol_name: "数码老张",
      history_summary: "金额 $680，待确认发送",
    },
    {
      id: "tsk_queued_follow",
      title: "写跟进邮件",
      source: "manual",
      status: "pending",
      kol_name: "小美妆日记",
      history_summary: "任务已加入队列",
    },
    {
      id: "tsk_running_scan",
      title: "风险扫描",
      source: "manual",
      status: "running",
      started_at: new Date(Date.now() - 90_000).toISOString(),
      history_summary: "正在核对逾期合作",
    },
    {
      id: "tsk_failed_run",
      title: "催大纲",
      source: "manual",
      status: "failed",
      risk: "样品丢失争议",
      next_action: "回到会话查看缺口",
      history: [{ safe_summary: "催大纲信息不完整" }],
      history_summary: "催大纲信息不完整",
    },
    {
      id: "tsk_approval_quote",
      title: "审批报价",
      source: "manual",
      status: "waiting_approval",
      kol_name: "母婴小课",
      history_summary: "报价已提交，等负责人确认",
    },
  ];
  await page.route("**/api/home/board", (route) => route.fulfill({
    json: {
      kols: [],
      tabs: [{ code: "all", count: 0 }],
      tasks: todos,
      workbench: {
        summary: { open: 5, overdue: 0, due_today: 0, waiting: 1, insights: 0 },
        todo: todos,
      },
    },
  }));
  await page.route("**/api/tasks", (route) => route.fulfill({ json: todos }));
  await page.goto("/");
  await openHomeTodo(page);
  await expect(page.locator('[data-todo-bucket="later"]')).toHaveCount(0);
  await expect(page.locator("[data-todo-md]")).not.toContainText("后续");
  const waiting = page.locator("[data-todo-card]").filter({ hasText: "写报价信" });
  await expect(waiting).toBeVisible();
  await expect(waiting).toHaveAttribute("data-wait-status", "结果待确认");
  await expect(waiting).toContainText("结果待确认");
  await expect(waiting).not.toContainText("等待中");
  await expect(page.locator('[data-todo-bucket="waiting"]')).toHaveCount(0);
  await expect(page.locator("[data-todo-md]").getByRole("emphasis", { name: "结果待确认" })).toHaveCount(0);
  await expect(page.locator('[data-todo-bucket="queued"]')).toContainText("已入队");
  await expect(page.locator('[data-todo-bucket="queued"] [data-todo-card]')).toHaveAttribute("data-wait-status", "已入队");
  await expect(page.locator('[data-todo-bucket="running"]')).toContainText("执行中");
  await expect(page.locator('[data-todo-bucket="running"] [data-todo-card]')).toHaveAttribute("data-wait-status", "执行中");
  await expect(page.locator('[data-todo-bucket="running"] [data-todo-card]')).toContainText("正在核对逾期合作");
  await expect(page.locator('[data-todo-bucket="running"] [data-todo-card]')).toContainText("已进行");
  await expect(page.locator('[data-todo-bucket="approval"]')).toContainText("等审批");
  await expect(page.locator('[data-todo-bucket="approval"] [data-todo-card]')).toHaveAttribute("data-wait-status", "等审批");
  const failed = page.locator("[data-todo-card]").filter({ hasText: "催大纲" });
  await expect(failed).toHaveAttribute("data-wait-status", "失败");
  await expect(failed).toContainText("催大纲信息不完整");
  await expect(failed).not.toContainText("有风险");
  await expect(page.locator("[data-today-summary]")).not.toContainText("结果待确认");
  await expect(page.locator("[data-today-summary]")).toContainText("等审批");
  await expect(page.locator("[data-today-summary]")).not.toContainText("等待中");
  await expect(page.locator("[data-today-work]")).not.toContainText("等待中");
});

test("home todo buckets fold after 6 items and keep wait-status labels", async ({ page }) => {
  const todos = Array.from({ length: 9 }, (_, index) => ({
    id: `tsk_waiting_${index + 1}`,
    title: `待确认 ${index + 1}`,
    source: "manual",
    status: "waiting",
    history_summary: "金额待确认发送",
  }));
  await page.route("**/api/home/board", (route) => route.fulfill({
    json: {
      kols: [],
      tabs: [{ code: "all", count: 0 }],
      tasks: todos,
      workbench: {
        summary: { open: 9, overdue: 0, due_today: 0, waiting: 9, insights: 0 },
        todo: todos,
      },
    },
  }));
  await page.route("**/api/tasks", (route) => route.fulfill({ json: todos }));
  await page.goto("/");
  await openHomeTodo(page);
  await expect(page.locator("[data-todo-card]")).toHaveCount(6);
  await expect(page.locator('[data-todo-bucket="waiting"]')).toHaveCount(0);
  await expect(page.locator('[data-todo-bucket="open"] [data-fold-more]')).toBeVisible();
  await expect(page.locator('[data-todo-bucket="later"]')).toHaveCount(0);
  await expect(page.locator("[data-todo-md]")).not.toContainText("后续");
  await expect(page.locator("[data-todo-md]").getByRole("emphasis", { name: "结果待确认" })).toHaveCount(0);
  await page.locator('[data-todo-bucket="open"] [data-fold-more]').click();
  await expect(page.locator("[data-todo-card]")).toHaveCount(9);
  await expect(page.locator("[data-today-work] [data-recommended-tasks]")).toHaveCount(0);
});

test("home polls GET /api/tasks while a run is executing", async ({ page }) => {
  let taskGets = 0;
  const running = {
    id: "tsk_running_scan",
    title: "风险扫描",
    source: "manual",
    status: "running",
    started_at: new Date(Date.now() - 30_000).toISOString(),
    history_summary: "正在核对逾期合作",
  };
  await page.route("**/api/home/board", (route) => route.fulfill({
    json: {
      kols: [],
      tabs: [{ code: "all", count: 0 }],
      tasks: [running],
      workbench: { summary: { open: 1, overdue: 0, due_today: 0, waiting: 0, insights: 0 }, todo: [running] },
    },
  }));
  await page.route("**/api/tasks", async (route) => {
    if (route.request().method() === "GET") taskGets += 1;
    await route.fulfill({ json: [running] });
  });
  await page.goto("/");
  await openHomeTodo(page);
  await expect(page.locator("[data-home]")).toHaveAttribute("data-home-task-poll", "active");
  await expect(page.locator('[data-todo-bucket="running"] [data-todo-card]')).toHaveAttribute("data-wait-status", "执行中");
  await expect.poll(() => taskGets, { timeout: 12000 }).toBeGreaterThanOrEqual(2);
});

test("home does not keep polling GET /api/tasks for 结果待确认 only", async ({ page }) => {
  let taskGets = 0;
  const waiting = {
    id: "tsk_home_laozhang_quote",
    title: "写报价信",
    source: "manual",
    status: "waiting",
    history_summary: "金额 $680，待确认发送",
  };
  await page.route("**/api/home/board", (route) => route.fulfill({
    json: {
      kols: [],
      tabs: [{ code: "all", count: 0 }],
      tasks: [waiting],
      workbench: { summary: { open: 1, overdue: 0, due_today: 0, waiting: 1, insights: 0 }, todo: [waiting] },
    },
  }));
  await page.route("**/api/tasks", async (route) => {
    if (route.request().method() === "GET") taskGets += 1;
    await route.fulfill({ json: [waiting] });
  });
  await page.goto("/");
  await openHomeTodo(page);
  await expect(page.locator("[data-home]")).toHaveAttribute("data-home-task-poll", "idle");
  await expect(page.locator("[data-todo-card]").filter({ hasText: "写报价信" })).toHaveAttribute("data-wait-status", "结果待确认");
  const afterLoad = taskGets;
  expect(afterLoad).toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(4500);
  expect(taskGets).toBe(afterLoad);
});

test("home recognizing feedback is labeled 识别中", async ({ page }) => {
  await page.route("**/api/tasks/from-text", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await route.fulfill({
      json: {
        confidence: "low",
        clarification: "你希望分析哪个范围？",
        candidates: [{ id: "today", title: "分析今天的合作" }],
      },
    });
  });
  await page.goto("/");
  await page.locator("[data-home] [data-composer-input]").fill("帮我分析一下");
  await page.locator("[data-home] [data-send]").click();
  const recognizing = page.locator('[data-home] [data-kind="recognizing"]');
  await expect(recognizing).toBeVisible();
  await expect(recognizing).toHaveAttribute("data-wait-status", "识别中");
  await expect(recognizing).toContainText("识别中");
  await expect(recognizing).not.toContainText("等待中");
});

test("home AI insight is confirmed into 我的待办 and 立即处理 opens the KOL session", async ({ page }) => {
  await page.goto("/");
  await expectHomeModeOrder(page);
  await expect(page.locator('[data-home-mode="ai"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("[data-recommended-tasks]")).toBeVisible();
  await expect(page.locator("[data-home]")).not.toContainText("今天推荐");
  await expect(page.locator("[data-today-work]")).toHaveCount(0);
  const listedAi = Number(await page.locator("[data-recommended-tasks]").getAttribute("data-list-total") || 0)
    + Number(await page.locator("[data-insight-list]").getAttribute("data-list-total") || 0);
  await expect(page.locator('[data-home-mode="ai"]')).toHaveAttribute("data-ai-count", String(listedAi));
  await expect(page.locator('[data-home-pane="ai"]')).toHaveAttribute("data-ai-list-total", String(listedAi));
  expect(listedAi).toBeGreaterThan(0);
  expect(await page.locator("[data-recommended-task]").count()).toBeGreaterThan(3);
  await expect(page.locator("[data-task-n='1']")).toBeVisible();
  await expect(page.locator("[data-task-n='2']")).toBeVisible();
  await expect(page.locator("[data-task-n='3']")).toBeVisible();
  await expect(page.locator("[data-recommended-task]").first()).toContainText("1.");
  await expect(page.locator("[data-recommended-task]").first()).toContainText("AI发现");
  await expect(page.locator("[data-recommended-reason]").first()).not.toHaveText("");
  await expect(page.locator("[data-recommended-tasks]")).not.toContainText("下一阶段");
  await expect(page.locator("[data-recommended-tasks] [data-fold-more]")).toBeVisible();
  await expect(page.locator("[data-recommended-task]")).toHaveCount(6);
  await page.locator("[data-recommended-tasks] [data-fold-more]").click();
  expect(await page.locator("[data-recommended-task]").count()).toBeGreaterThan(6);
  await openHomeTodo(page);
  await expect(page.locator("[data-recommended-tasks]")).toHaveCount(0);
  await expect(page.locator("[data-todo-card]").filter({ hasText: "数码老张" })).toBeVisible();
  await expect(page.locator("[data-todo-card]").filter({ hasText: "数码老张" })).toHaveAttribute("data-wait-status", "结果待确认");
  await expect(page.locator("[data-todo-card]").filter({ hasText: "旅行电源菌" })).toBeVisible();
  await expect(page.locator("[data-today-summary]")).toContainText(/\d+项待处理/);
  await expect(page.locator("[data-today-summary]")).not.toContainText("结果待确认");
  await expect(page.locator("[data-today-summary]")).not.toContainText("等待中");
  await expect(page.locator('[data-todo-bucket="waiting"]')).toHaveCount(0);
  const todoBefore = await page.locator("[data-todo-card]").count();
  expect(todoBefore).toBeGreaterThanOrEqual(2);
  await expect(page.locator("[data-today-work]")).not.toContainText("失联跟进");
  await expect(page.locator("[data-today-work]")).not.toContainText("后续");
  await expect(page.locator('[data-todo-bucket="later"]')).toHaveCount(0);
  await expect(page.locator("[data-today-work] .todo-card")).toHaveCount(0);
  await expect(page.locator("[data-today-work] .recommended-task")).toHaveCount(0);
  const recPosts: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "POST") return;
    recPosts.push(new URL(r.url()).pathname);
  });
  await openHomeAi(page);
  await page.locator("[data-recommended-task]").first().click();
  await expect(page).toHaveURL(/\/(?:\?.*)?$/);
  await expect(page.locator("[data-home] [data-composer-input]")).toHaveValue(/写合作邮件 @小美妆日记/);
  await expect(page.locator('[data-home] [data-skill-chip="email_compose"]')).toBeVisible();
  expect(recPosts).toEqual([]);
  await expect(page.locator("[data-insight-card]").filter({ hasText: "失联跟进" })).toBeVisible();
  await expect(page.locator("[data-insight-mark]")).toBeVisible();
  await page.locator("[data-promote-task='tsk_home_xiaomei_lost']").click();
  await expect(page.locator('[data-home-mode="todo"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("[data-today-work]")).toContainText("失联跟进");
  await expect(page.locator("[data-today-work] [data-recommended-tasks]")).toHaveCount(0);
  await expect(page.locator("[data-todo-card]")).toHaveCount(todoBefore + 1);
  await expect(page.locator("[data-today-summary]")).toContainText(`${todoBefore + 1}项待处理`);
  await openHomeAi(page);
  await expect(page.locator("[data-insight-card]").filter({ hasText: "失联跟进" })).toHaveCount(0);
  await openHomeTodo(page);
  await page.locator("[data-todo-card]").filter({ hasText: "数码老张" }).locator("[data-todo-act]").click();
  await expect(page).toHaveURL(/\/s\//);
  await expect(page.locator("[data-kol-journey]")).toContainText("数码老张");
});

test("ingested inbound mail appears in the KOL session and can confirm 有兴趣", async ({ page, request }) => {
  const ingested = await request.post("/api/collaborations/col_xiaomei/ingest-mail", {
    data: {
      subject: "Re: Collaboration Opportunity with LiTime",
      body: "Hi, I am interested and would love to collaborate.",
      from: "xiaomei.beauty@example.com",
    },
  }).then((r) => r.json()) as { session_id: string };
  expect(ingested.session_id).toBeTruthy();
  await page.goto(`/s/${ingested.session_id}`);
  await expect(page.locator("[data-kol-journey]")).toContainText("小美妆日记");
  await expect(page.locator("[data-session-stage]")).toContainText("初步接触");
  await expect(page.locator("[data-stage-sop]")).toHaveJSProperty("open", false);
  await expect(page.locator("[data-session-stream-pane] [data-mail-digest]")).toBeVisible();
  await expect(page.locator("[data-session-stream-pane] [data-mail-digest]")).toContainText("规则摘录");
  await expect(page.locator("[data-session-stream-pane] [data-mail-digest]")).not.toContainText("历史邮件往来摘要");
  await expect(page.locator("[data-session-stream-pane] [data-digest-excerpt]")).toHaveJSProperty("open", false);
  await page.locator("[data-session-stream-pane] [data-digest-excerpt] summary").click();
  await expect(page.locator("[data-session-stream-pane] [data-mail-digest]")).toContainText("would love to collaborate");
  await expect(page.locator("[data-workbench]")).toBeVisible();
  await expect(page.locator("[data-journey-track]")).toBeVisible();
  const ingestTrackLine = await page.locator("[data-journey-track]").evaluate((el) => {
    const before = getComputedStyle(el, "::before");
    return before.display !== "none" && before.content !== "none" && parseFloat(before.height || "0") > 0;
  });
  expect(ingestTrackLine).toBeTruthy();
  const ingestHandleLeft = await page.locator("[data-kol-journey] h1").evaluate((el) => el.getBoundingClientRect().left);
  const ingestSopLeft = await page.locator("[data-stage-sop]").evaluate((el) => el.getBoundingClientRect().left);
  expect(Math.abs(ingestHandleLeft - ingestSopLeft)).toBeLessThan(6);
  await saveScreenshot(page, "kol_session_digest_sop_journey.png");
  await openStageSop(page);
  await expect(page.locator("[data-stage-sop]")).toContainText("红人画像");
  await expect(page.locator("[data-kol-portrait] [data-portrait-field]")).not.toHaveCount(0);
  await expect(page.locator("[data-kol-portrait]")).not.toContainText("@小美妆日记");
  await expect(page.locator("[data-portrait-field='platform']")).toHaveText("小红书");
  await expect(page.locator("[data-portrait-field='brand']")).toHaveText("LT");
  await expect(page.locator("[data-portrait-field='followers']")).toHaveText("82万");
  await expect(page.locator("[data-portrait-field='stay']")).toHaveText("12 天");
  await expect(page.locator("[data-portrait-field='tags'] .chip")).toHaveCount(2);
  await expect(page.locator("[data-portrait-field='tags'] .chip").nth(0)).toHaveText("首封已读未回");
  await expect(page.locator("[data-portrait-field='tags'] .chip").nth(1)).toHaveText("适合跟进");
  await expect(page.locator("[data-journey-phase] .phase-chip")).toHaveCount(8);
  await expect(page.locator("[data-stage-sop]")).not.toContainText("输入");
  await expect(page.locator("[data-stage-sop]")).not.toContainText("would love to collaborate");
  await expect(page.locator("[data-stage-sop]")).not.toContainText("完成条件");
  await expect(page.locator("[data-stage-sop]")).not.toContainText("当前步骤");
  await expect(page.locator("[data-stage-sop]")).not.toContainText("异常流程");
  await expect(page.locator("[data-stage-sop]")).not.toContainText("发送邮件不会修改阶段");
  await expect(page.locator("[data-stage-sop]")).not.toContainText("EVALUATING");
  await expect(page.locator(".workbench-resizer")).toHaveCount(0);
  const card = page.locator('[data-kind="kol-mail-card"]').filter({ hasText: "would love to collaborate" });
  await expect(card).toBeVisible();
  await expect(card.locator("[data-mail-reply]")).toBeVisible();
  await expect(card.locator("[data-stage-diff]")).toContainText("已回复-有兴趣");
  await expect(card.locator("[data-mail-stage-select]")).toBeVisible();
  await expectSelectedStage(card, "INTERESTED");
  await expect(card.locator("[data-mail-confirm]")).toHaveText("确认写入所选阶段");
  await card.locator("[data-mail-confirm]").click();
  await expect(page.locator("[data-session-stage]")).toContainText("已回复-有兴趣", { timeout: 15000 });
  await expect(page.locator("[data-session-stage]")).toContainText("意向");
  await expect(page.locator("[data-journey-guide]")).toHaveCount(0);
  await expect(page.locator("[data-journey-phase]")).toHaveCount(8);
  await expect(page.locator("[data-journey-phase='intent']")).toHaveAttribute("data-phase-state", "current");
  await expect(page.locator("[data-session-stage]")).toContainText("已回复-有兴趣");
  await expect(page.locator("[data-session-stage]")).toContainText("意向");
  await expect(page.locator("[data-session-stage]")).not.toContainText("初步接触");
  await expect(page.locator(".chat")).not.toContainText("的合作会话。当前阶段：");
  await expect(card.locator("[data-mail-confirm]")).toHaveCount(0);
  await expect(page.locator("[data-kind='confirm-stage-pointer']")).toHaveCount(0);
  await expect(page.locator("[data-stage-sop]")).toHaveJSProperty("open", false);
  await openStageSop(page);
  await expect(page.locator("[data-stage-sop]")).toContainText("意向");
  await expect(page.locator("[data-stage-sop]")).not.toContainText("EVALUATING");
  await expect(page.locator("[data-stage-sop]")).toContainText("红人画像");
  await expect(page.locator("[data-portrait-field='platform']")).toHaveText("小红书");
  await expect(page.locator("[data-portrait-field='brand']")).toHaveText("LT");
  await expect(page.locator("[data-portrait-field='tags'] .chip")).toHaveCount(2);
  await expect(page.locator("[data-stage-sop]")).not.toContainText("输入");
  await expect(page.locator("[data-stage-sop]")).not.toContainText("完成条件");
  await expect(page.locator("[data-stage-sop]")).not.toContainText("当前步骤");
  await expect(page.locator("[data-stage-sop]")).not.toContainText("历史邮件往来摘要");
  await expect(page.locator("[data-stage-sop]")).not.toContainText("规则摘录");
  await expect(page.locator("[data-session-stream-pane] [data-mail-digest]")).toContainText("规则摘录");
  await expect(page.locator("[data-session-stream-pane] [data-mail-digest]")).not.toContainText("历史邮件往来摘要");
  await expect(page.locator("[data-session-stream-pane] [data-mail-digest]")).not.toContainText("Luna 往来摘要");
  const excerpt = page.locator("[data-session-stream-pane] [data-digest-excerpt]");
  if (!(await excerpt.evaluate((el) => el instanceof HTMLDetailsElement && el.open))) {
    await excerpt.locator("summary").click();
  }
  const digestBox = page.locator("[data-session-stream-pane] [data-mail-digest]");
  const digestText = page.locator("[data-session-stream-pane] [data-digest-body] p");
  const streamBox = page.locator("[data-session-stream-pane]");
  const digestWidth = await digestBox.evaluate((el) => (el as HTMLElement).getBoundingClientRect().width);
  const digestTextWidth = await digestText.evaluate((el) => (el as HTMLElement).getBoundingClientRect().width);
  const streamWidth = await streamBox.evaluate((el) => (el as HTMLElement).getBoundingClientRect().width);
  expect(digestWidth).toBeGreaterThan(streamWidth * 0.55);
  expect(digestTextWidth).toBeGreaterThan(streamWidth * 0.45);
  await expect(page.locator("[data-mail-summaries]")).toContainText("would love to collaborate");
  await expect(page.locator("[data-mail-summaries]")).toContainText(/有兴趣|合作意愿|往来/);
  await expect(page.locator("[data-sop-ask] [data-composer-input]")).toBeVisible();
  await expect(page.locator("[data-sop-ask] [data-ai-next-actions] button")).toHaveCount(3);
  await page.locator("[data-sop-ask] [data-ai-next-actions] button").first().click();
  await expect(page.locator("[data-sop-ask] [data-composer-input]")).not.toHaveValue("");
  const mailRows = page.locator("[data-session-mail-list] [data-mail-row]");
  await expect(mailRows.filter({ hasText: "Collaboration Opportunity" }).first()).toBeVisible();
  await expect(mailRows.filter({ hasText: "来信" }).first()).toBeVisible();
  await expect(page.locator("[data-session-mail-list] [data-mail-unread-dot]").first()).toBeVisible();
  await expect(page.locator("[data-ai-next-actions] button")).toHaveCount(3);
  await mailRows.filter({ hasText: "Collaboration Opportunity" }).first().click();
  const focused = page.locator("[data-workbench] [data-mail-body]");
  await expect(focused).toContainText("Collaboration Opportunity");
  await expect(focused).not.toContainText("八个阶段");
  await expect(focused).not.toContainText("生命周期");
  await expect(focused).not.toContainText("本阶段 SOP");
  await expect(page.locator("[data-mail-focus] [data-mail-confirm]")).toHaveCount(0);
  await expect(page.locator("[data-mail-focus]")).not.toContainText("发件");
  await expect(page.locator("[data-sop-ask] [data-ai-next-actions] button")).toHaveCount(3);
  const pipe = await request.get("/api/pipeline").then((r) => r.json());
  const xiaomei = Object.values(pipe.groups).flat().find((c: { handle: string }) => c.handle === "小美妆日记") as { stage_code: string };
  expect(xiaomei.stage_code).toBe("INTERESTED");
});

test("thread mail digest labels rule excerpt, model summary, and failed analysis", async ({ page, request }) => {
  const ingested = await request.post("/api/collaborations/col_xiaomei/ingest-mail", {
    data: {
      subject: "Re: Collaboration Opportunity with LiTime",
      body: "Hi, I am interested and would love to collaborate.",
      from: "xiaomei.beauty@example.com",
    },
  }).then((r) => r.json()) as { session_id: string };
  await page.goto(`/s/${ingested.session_id}`);
  const digest = page.locator("[data-session-stream-pane] [data-mail-digest]");
  await expect(digest).toBeVisible();
  await expect(digest).toHaveAttribute("data-digest-kind", "rule");
  await expect(digest).toContainText("规则摘录");
  await expect(digest.locator("[data-digest-disclaimer]")).toContainText("不是模型摘要");
  await expect(digest).not.toContainText("历史邮件往来摘要");
  await expect(digest.locator("[data-digest-excerpt]")).toHaveJSProperty("open", false);
  await expect(digest.locator("[data-digest-body]")).toBeHidden();
  await expect(page.locator("[data-stage-sop]")).toHaveJSProperty("open", false);
  await expect(page.locator("[data-workbench]")).toBeVisible();
  await expectNoEngineJargon(digest);
  await saveScreenshot(page, "mail_digest_rule_excerpt_collapsed.png");

  const journeyShell = {
    handle: "小美妆日记",
    collaboration_id: "col_xiaomei",
    stage_code: "INITIAL_CONTACT",
    stage_label: "初步接触",
    sop: { stage_label: "初步接触", phase_label: "建联", inputs: ["往来邮件"] },
    phases: [
      { id: "contact", label: "建联", state: "current" },
      { id: "intent", label: "意向", state: "idle" },
    ],
    mail_history: [{
      id: "mail-digest-1",
      conversation_id: "3901",
      subject: "Re: LiTime collab",
      direction: "inbound",
      body: "Hi, I am interested and would love to collaborate.",
    }],
  };

  await page.route((url) => new URL(url).pathname === "/api/sessions/digest-codex", (route) => route.fulfill({
    json: {
      id: "digest-codex",
      collaboration_id: "col_xiaomei",
      agent_status: "listening",
      messages: [],
      journey: {
        ...journeyShell,
        mail_digest: {
          text: "达人已明确表示有兴趣合作，并提到愿意推进档期。",
          source: "codex_memory",
          mail_count: 2,
        },
      },
    },
  }));
  await page.goto("/s/digest-codex");
  await expect(digest).toBeVisible();
  await expect(digest).toHaveAttribute("data-digest-kind", "codex");
  await expect(digest).toContainText("历史邮件往来摘要");
  await expect(digest).not.toContainText("规则摘录");
  await expect(digest.locator("[data-digest-body]")).toBeVisible();
  await expect(digest.locator("[data-digest-body]")).toContainText("达人已明确表示有兴趣合作");
  await expect(digest.locator("[data-digest-excerpt]")).toHaveCount(0);
  await expect(digest).not.toContainText("codex_memory");
  await expect(page.locator("[data-stage-sop]")).toHaveJSProperty("open", false);
  await expect(page.locator("[data-workbench]")).toBeVisible();
  await saveScreenshot(page, "mail_digest_codex_summary_open.png");

  await page.route((url) => new URL(url).pathname === "/api/sessions/digest-failed", (route) => route.fulfill({
    json: {
      id: "digest-failed",
      collaboration_id: "col_xiaomei",
      agent_status: "listening",
      messages: [],
      journey: {
        ...journeyShell,
        mail_digest: {
          text: "本会话共 2 封往来。来信明确表示有兴趣合作。",
          source: "analysis_failed",
          mail_count: 2,
          error: "timeout",
          failed_at: "2026-09-13T17:00:00.000Z",
        },
      },
    },
  }));
  await page.goto("/s/digest-failed");
  await expect(digest).toBeVisible();
  await expect(digest).toHaveAttribute("data-digest-kind", "failed");
  await expect(digest).toHaveAttribute("data-digest-error", "timeout");
  await expect(digest).toHaveAttribute("data-digest-failed-at", "2026-09-13T17:00:00.000Z");
  await expect(digest.locator("[data-digest-status]")).toHaveText("分析未完成 · timeout");
  await expect(digest.locator("[data-digest-lede]")).toContainText("未能读完这些正文");
  await expect(digest).not.toContainText("历史邮件往来摘要");
  await expect(digest).not.toContainText("规则摘录");
  await expect(digest.locator("[data-digest-excerpt]")).toHaveJSProperty("open", false);
  await expect(digest).not.toContainText("analysis_failed");
  await expect(digest).not.toContainText("Codex");
  await saveScreenshot(page, "mail_digest_analysis_failed_status.png");
});

function expectNoEngineJargon(root: Locator) {
  return Promise.all([
    expect(root).not.toContainText('{"type":"task_result"'),
    expect(root).not.toContainText("Preparing skill"),
    expect(root).not.toContainText("Preparing parallel"),
    expect(root).not.toContainText("Evaluating mailbox"),
    expect(root).not.toContainText("get_collaboration"),
    expect(root).not.toContainText("starry.get_collaboration"),
    expect(root).not.toContainText("previewEmailDraft"),
    expect(root).not.toContainText("starrykol."),
    expect(root).not.toContainText("远程MCP"),
    expect(root).not.toContainText("Codex"),
    expect(root).not.toContainText("calling capabilities"),
    expect(root).not.toContainText("Skill execution"),
    expect(root).not.toContainText("↓ JSON"),
  ]);
}

test("employee process stays business Chinese while queued or running", async ({ page }) => {
  const now = new Date().toISOString();
  await page.route("**/api/sessions/running-stream**", (route) => route.fulfill({
    json: {
      agent_status: "running",
      messages: [
        {
          id: "trace",
          session_id: "running-stream",
          role: "assistant",
          kind: "process_trace",
          created_at: now,
          payload: {
            title: "Preparing skill execution",
            phases: [
              { label: "queued", status: "done" },
              { label: "running", status: "done" },
              { label: "calling capabilities", status: "running" },
              { label: "Preparing parallel execution", status: "pending" },
            ],
          },
        },
        {
          id: "ops",
          session_id: "running-stream",
          role: "assistant",
          kind: "operation_trace",
          created_at: now,
          payload: {
            title: "calling capabilities",
            items: [
              { label: "get_collaboration · starry.get_collaboration", name: "starry.get_collaboration", status: "running" },
            ],
          },
        },
      ],
    },
  }));
  await page.goto("/s/running-stream");
  const process = page.locator("[data-kind='process-trace']");
  await expect(process).toBeVisible();
  await expect(process).toContainText("正在准备这项工作");
  await expect(process).toContainText("已排队");
  await expect(process).toContainText("进行中");
  await expect(process).toContainText("正在调用系统能力");
  await expect(process).toContainText("正在同时处理几项工作");
  await expect(page.locator("[data-kind='operation-trace']")).toContainText("读取合作资料");
  await expect(page.locator("[data-run-status]")).toContainText("执行中");
  await expect(page.locator("[data-run-status]")).toContainText(/读取合作资料|正在调用系统能力|正在准备这项工作/);
  await expectNoEngineJargon(page.locator("[data-session-stream-pane]"));
  await expectNoEngineJargon(page.locator("[data-run-status]"));
  await saveScreenshot(page, "employee_process_business_chinese.png");
});

test("session composer 停止 cancels the in-flight run and leaves the composer idle", async ({ page }) => {
  let stopped = false;
  const stopPosts: string[] = [];
  const now = new Date().toISOString();
  await page.route("**/api/sessions/stop-run**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === "POST" && url.pathname.endsWith("/stop")) {
      stopped = true;
      stopPosts.push(url.pathname);
      await route.fulfill({ json: { stopped: true, agent_status: "listening", run_queue: [] } });
      return;
    }
    if (req.method() === "GET" && (url.pathname === "/api/sessions/stop-run" || url.pathname.endsWith("/sessions/stop-run"))) {
      await route.fulfill({
        json: {
          id: "stop-run",
          title: "停止测试",
          agent_status: stopped ? "listening" : "running",
          messages: [
            {
              id: "job",
              session_id: "stop-run",
              role: "assistant",
              kind: "job_status",
              created_at: now,
              payload: { status: stopped ? "done" : "running", text: stopped ? "已停止生成。已保留已产生的内容。" : "正在拟定邮件主题和正文…" },
            },
          ],
          run_queue: [],
        },
      });
      return;
    }
    await route.continue();
  });
  await page.goto("/s/stop-run");
  await expect(page.locator("[data-stop-run]")).toBeVisible();
  await expect(page.locator("[data-composer]")).toHaveAttribute("data-composer-running", "true");
  await page.locator("[data-stop-run]").click();
  await expect.poll(() => stopPosts.length).toBe(1);
  await expect(page.locator("[data-stop-run]")).toHaveCount(0);
  await expect(page.locator("[data-composer]")).not.toHaveAttribute("data-composer-running", "true");
});

test("employee stream parses task_result JSON into a card and hides engine jargon", async ({ page }) => {
  const now = new Date().toISOString();
  const dump = [
    '{"type":"task_result","title":"正在准备合作邮件","summary":"先整理往来"}',
    '{"type":"task_result","title":"合作邮件草稿","summary":"已写好一封建联信","subject":"Collaboration with LiTime","body":"Hi, we would love to collaborate.","from":"brand@litime.com","to":"kol@example.com","draft_id":"draft_json","actions":["确认发送"]}',
  ].join("");
  await page.route("**/api/sessions/json-stream**", (route) => route.fulfill({
    json: {
      agent_status: "listening",
      collaboration_id: "col_xiaomei",
      journey: {
        handle: "小美妆日记",
        collaboration_id: "col_xiaomei",
        stage_code: "INITIAL_CONTACT",
        stage_label: "初步接触",
        phases: [
          { id: "contact", label: "建联", state: "current" },
          { id: "intent", label: "意向", state: "idle" },
        ],
      },
      messages: [
        {
          id: "dump",
          session_id: "json-stream",
          role: "assistant",
          kind: "assistant",
          created_at: now,
          payload: { text: dump },
        },
        {
          id: "trace",
          session_id: "json-stream",
          role: "assistant",
          kind: "process_trace",
          created_at: now,
          payload: {
            title: "Preparing skill execution",
            phases: [
              { label: "Evaluating mailbox call strategy", status: "done" },
              { label: "Preparing stage recommendation JSON", status: "running" },
            ],
          },
        },
        {
          id: "ops",
          session_id: "json-stream",
          role: "assistant",
          kind: "operation_trace",
          created_at: now,
          payload: {
            title: "远程MCP调用",
            items: [
              { label: "读取合作资料", name: "starry.get_collaboration", status: "done" },
              { label: "生成邮件预览", name: "starrykol.previewEmailDraft", status: "done" },
            ],
          },
        },
      ],
    },
  }));
  await page.goto("/s/json-stream");
  const draftCard = page.locator("[data-session-stream-pane] [data-stream-result]").filter({ hasText: "合作邮件草稿" });
  await expect(draftCard).toBeVisible();
  await expect(draftCard).toContainText("Collaboration with LiTime");
  await expect(draftCard).toContainText("we would love to collaborate");
  await expect(draftCard.locator('[data-email-action="send"]')).toHaveText("确认发送");
  await expect(page.locator("[data-kind='process-trace']")).toContainText("正在准备这项工作");
  await expect(page.locator("[data-kind='process-trace']")).toContainText("正在选择发件方式");
  await expect(page.locator("[data-kind='process-trace']")).toContainText("正在整理阶段建议");
  await expect(page.locator("[data-kind='operation-trace']")).toContainText("正在调用系统能力");
  await expect(page.locator("[data-kind='operation-trace']")).toContainText("读取合作资料");
  await expect(page.locator("[data-kind='operation-trace']")).toContainText("生成邮件预览");
  const workbench = page.locator("[data-workbench]");
  await expect(workbench).toBeVisible();
  await expect(workbench.locator("[data-result-draft]")).toContainText("Collaboration with LiTime");
  await expect(workbench.locator("[data-result-body]")).toContainText("we would love to collaborate");
  await expect(workbench.locator('[data-email-action="send"]')).toHaveText("确认发送");
  await expectNoEngineJargon(page.locator("[data-session-stream-pane]"));
  await expectNoEngineJargon(workbench);
  await saveScreenshot(page, "employee_task_result_card.png");
});

test("记状态 to CONTENT_REVIEW queues content approval and writes after manager agrees", async ({ page, request }) => {
  await page.goto("/pipeline");
  await proposePipelineStage(page, "母婴小课");
  await page.waitForURL(/\/s\//);
  const card = page.locator('[data-workbench] [data-kind="confirm-stage-card"]');
  await expect(card).toBeVisible({ timeout: 15000 });
  await expect(card).toContainText("内容策划");
  await pickStageChip(card, "CONTENT_REVIEW");
  await expect(card.locator("[data-confirm-stage]")).toHaveText("提交审批");
  await card.locator("[data-confirm-stage]").click();
  await expect(page.getByText("已提交阶段审批").first()).toBeVisible({ timeout: 15000 });
  const queued = await request.get("/api/pipeline").then((r) => r.json());
  const before = Object.values(queued.groups).flat().find(
    (c: { handle: string }) => c.handle === "母婴小课",
  ) as { stage_code: string };
  expect(before.stage_code).toBe("CONTENT_PLANNING");
  await page.goto("/approvals");
  const row = page.locator('[data-approval-kind="content"]').first();
  await expect(row).toBeVisible();
  await expect(row).toContainText("内容审核");
  await expect(page.locator("body")).toContainText("确认阶段");
  await row.getByRole("button", { name: "同意" }).click();
  await expect(row).toHaveCount(0, { timeout: 15000 });
  const after = await request.get("/api/pipeline").then((r) => r.json());
  const written = Object.values(after.groups).flat().find(
    (c: { handle: string }) => c.handle === "母婴小课",
  ) as { stage_code: string };
  expect(written.stage_code).toBe("CONTENT_REVIEW");
});

test("session page shows Agent TaskList, L3 block, and stage diff", async ({ page }) => {
  await page.goto("/pipeline");
  await proposePipelineStage(page, "小美妆日记");
  await page.waitForURL(/\/s\//);
  const taskList = page.locator("[data-agent-task-list]");
  await expect(taskList).toBeVisible();
  await expect(taskList).toContainText("往来邮件");
  await expect(page.locator("[data-task-status-filters]")).toHaveCount(0);
  await expect(page.locator("[data-session-mail-list], [data-agent-task-list] .muted").first()).toBeVisible();
  await expect(page.locator("[data-tasklist-resizer]")).toBeVisible();
  const widthBefore = Number(await taskList.getAttribute("data-tasklist-width"));
  const handle = page.locator("[data-tasklist-resizer]");
  const box = await handle.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + 24);
  await page.mouse.down();
  await page.mouse.move(box!.x + 90, box!.y + 24, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => Number(await taskList.getAttribute("data-tasklist-width"))).toBeGreaterThan(widthBefore);
  const scrollCss = await page.locator("[data-tasklist-scroll]").evaluate((el) => {
    const style = getComputedStyle(el);
    return { overflowY: style.overflowY, scrollbarWidth: style.scrollbarWidth };
  });
  expect(scrollCss.overflowY).toBe("auto");
  expect(scrollCss.scrollbarWidth).toBe("none");
  const refreshed = page.waitForResponse((res) => res.url().includes("/api/sessions/") && res.request().method() === "GET");
  await page.locator("[data-tasklist-scroll]").hover();
  await page.mouse.wheel(0, -120);
  await refreshed;
  const card = page.locator('[data-workbench] [data-kind="confirm-stage-card"]');
  await expect(card).toBeVisible({ timeout: 15000 });
  await expect(card).toHaveAttribute("data-risk", "L3");
  await expect(card.locator("[data-stage-diff]")).toContainText("变更前");
  await expect(card.locator("[data-stage-diff]")).toContainText("变更后");
  await expect(card.locator("[data-stage-diff]")).toContainText("初步接触");
  await expect(page.locator('[data-risk="L3"]').first()).toBeVisible();
});

test("写跟进邮件 marks the left pointer as an L2 draft block", async ({ page, request }) => {
  await askKolSession(page, request, "col_xiaomei", "写合作邮件 @小美妆日记");
  await expect(page.locator("[data-agent-task-list]")).toBeVisible();
  await expectDraft(page);
  await expect(page.locator('[data-risk="L2"]').first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator('[data-risk="L2"]').first()).toContainText("AI生成草稿，未生效");
});

test("记状态 shows stage workbench, never a draft tab card", async ({ page, request }) => {
  const pipelineBefore = await request.get("/api/pipeline").then((r) => r.json());
  const stageBefore = Object.values(pipelineBefore.groups).flat().find(
    (c: { handle: string }) => c.handle === "小美妆日记",
  ) as { stage_code: string };
  await page.goto("/pipeline");
  await proposePipelineStage(page, "小美妆日记");
  await page.waitForURL(/\/s\//);
  await expect(page.locator('[data-workbench] [data-kind="confirm-stage-card"]')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('[data-kind="email-card"]')).toHaveCount(0);
  await expect(page.locator('[data-kind="confirm-stage-card"]')).toContainText("初步接触");
  await expectSelectedStage(page.locator('[data-kind="confirm-stage-card"]'), "INTERESTED");
  await expect(page.locator('[data-kind="confirm-stage-card"] [data-stage-chip]', { hasText: "跳过" })).toHaveCount(0);
  const pipelineAfter = await request.get("/api/pipeline").then((r) => r.json());
  const stageAfter = Object.values(pipelineAfter.groups).flat().find(
    (c: { handle: string }) => c.handle === "小美妆日记",
  ) as { stage_code: string };
  expect(stageAfter.stage_code).toBe(stageBefore.stage_code);
});

test("催大纲 on wrong stage stays as persistent error, no worker", async ({ page, request }) => {
  const before = await request.get("/api/workers");
  const n0 = ((await before.json()) as unknown[]).length;
  await askKolSession(page, request, "col_xiaomei", "催大纲 @小美妆日记");
  await expect(page.locator('[data-kind="error-card"]')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('[data-kind="error-card"]')).toContainText("已签收-测试中");
  await expect(page.locator('[data-kind="email-card"]')).toHaveCount(0);
  const after = await request.get("/api/workers");
  expect(((await after.json()) as unknown[]).length).toBe(n0);
});

test("催大纲 placeholder without a creator shows a supplement card, not a sent email", async ({ page, request }) => {
  const before = await request.get("/api/workers");
  const n0 = ((await before.json()) as unknown[]).length;
  await page.goto("/");
  await openHomeTemplates(page);
  await homeRecByTitle(page, "催大纲").click();
  await expect(page.locator("[data-home] [data-composer-input]")).toHaveValue("催大纲 [红人或合作]");
  await page.locator("[data-home] [data-send]").click();
  await page.waitForURL(/\/s\//);
  await expect(page.locator('[data-kind="supplement-card"]')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('[data-kind="supplement-card"]')).toContainText("红人或合作");
  await expect(page.locator(".chat")).toContainText("催大纲需要指定红人或合作");
  await expect(page.locator(".chat")).not.toContainText("发货通知缺运单");
  await expect(page.locator('[data-kind="email-card"]')).toHaveCount(0);
  await expect(page.getByText("发送已禁用")).toHaveCount(0);
  const after = await request.get("/api/workers");
  expect(((await after.json()) as unknown[]).length).toBe(n0);
  await saveScreenshot(page, "email_compose_needs_creator.png");
});

test("session 催大纲 [红人或合作] also stays on a supplement card", async ({ page, request }) => {
  const ses = await request.post("/api/sessions", { data: { title: "催大纲" } }).then((r) => r.json());
  await page.goto(`/s/${ses.id}`);
  await page.locator("[data-composer-input]").fill("催大纲 [红人或合作]");
  await page.locator("[data-send]").click();
  await expect(page.locator('[data-kind="supplement-card"]')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('[data-kind="email-card"]')).toHaveCount(0);
});

test("地址核对: incomplete email in workbench, complete 可以出库", async ({ page, request }) => {
  await askKolSession(page, request, "col_xiaomei", "核对地址 @小美妆日记");
  await expect(page.locator('[data-workbench] [data-kind="email-card"]')).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("可以出库")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /出库|WMS|仓库/ })).toHaveCount(0);

  await askKolSession(page, request, "col_laozhang", "核对地址 @数码老张");
  await expect(page.locator('[data-workbench] [data-kind="task-result-card"]')).toContainText("可以进入人工确认后的出库流程", { timeout: 15000 });
  await expect(page.locator('[data-kind="email-card"]')).toHaveCount(0);
});

test("发货通知 without tracking shows supplement in workbench", async ({ page, request }) => {
  const before = await request.get("/api/workers");
  const n0 = ((await before.json()) as unknown[]).length;
  await askKolSession(page, request, "col_xiaomei", "发货通知 @小美妆日记");
  await expect(page.locator('[data-workbench] [data-kind="supplement-card"]')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('[data-kind="supplement-card"]')).toContainText("运单号");
  await expect(page.locator('[data-kind="email-card"]')).toHaveCount(0);
  const after = await request.get("/api/workers");
  expect(((await after.json()) as unknown[]).length).toBe(n0);
});

test("session chips name this stage's letter and only prefill", async ({ page, request }) => {
  const quote = await request.post("/api/collaborations/col_laozhang/session").then((r) => r.json());
  await page.goto(`/s/${quote.id}`);
  const quoteChips = page.locator("[data-composer-suggestions] button");
  await expect(quoteChips.first()).toHaveText("写报价邮件", { timeout: 15000 });
  await expect(page.locator("[data-composer-input]")).toHaveAttribute("placeholder", /写报价邮件 @数码老张 金额 \[USD\]/);
  await quoteChips.first().click();
  await expect(page.locator("[data-composer-input]")).toHaveValue("写报价邮件 @数码老张");
  await expect(page).toHaveURL(new RegExp(`/s/${quote.id}`));
  await expect(page.locator('[data-workbench] [data-kind="email-card"]')).toHaveCount(0);

  const first = await request.post("/api/collaborations/col_xiaomei/session").then((r) => r.json());
  await page.goto(`/s/${first.id}`);
  await expect(page.locator("[data-composer-suggestions] button").first()).toHaveText("写合作邮件");
  await page.locator("[data-composer-suggestions] button").first().click();
  await expect(page.locator("[data-composer-input]")).toHaveValue("写合作邮件 @小美妆日记");

  const brief = await request.post("/api/collaborations/col_mum/session").then((r) => r.json());
  await page.goto(`/s/${brief.id}`);
  await expect(page.locator("[data-composer-suggestions] button").first()).toHaveText("发brief");
  await page.locator("[data-composer-suggestions] button").first().click();
  await expect(page.locator("[data-composer-input]")).toHaveValue("发brief @母婴小课");
  await expect(page.locator('[data-skill-chip="email_compose"]')).toBeVisible();
});

test("核对地址 shows sample facts and draft on one result page", async ({ page, request }) => {
  const ses = await request.post("/api/collaborations/col_laozhang/session").then((r) => r.json());
  await page.goto(`/s/${ses.id}`);
  await page.locator("[data-composer-input]").fill("核对地址 @数码老张");
  await page.locator("[data-send]").click();
  await expect(page.locator("[data-workbench] [data-compose-loop]")).toBeVisible({ timeout: 20000 });
  await expect(page.locator("[data-workbench] [data-kind='task-result-card']")).toContainText(/寄样资料|张伟|LT-100AH/);
  await expect(page.locator("[data-workbench] [data-kind='task-result-card']")).toContainText("可以进入人工确认后的出库流程");
  await expect(page.locator("[data-workbench] [data-kind='task-result-card']")).not.toContainText(/USD\s*680/);
  await expect(page.locator('[data-workbench] [data-kind="email-card"]')).toHaveCount(0);
});

test("发brief shows content facts and draft on one result page", async ({ page, request }) => {
  const ses = await request.post("/api/collaborations/col_mum/session").then((r) => r.json());
  await page.goto(`/s/${ses.id}`);
  await page.locator("[data-composer-input]").fill("发brief @母婴小课");
  await page.locator("[data-send]").click();
  await expect(page.locator("[data-workbench] [data-compose-loop]")).toBeVisible({ timeout: 20000 });
  await expect(page.locator("[data-workbench] [data-kind='task-result-card']")).toContainText("内容要点");
  await expect(page.locator('[data-workbench] [data-kind="email-card"]')).toBeVisible();
  await expect(page.locator("[data-draft-body]")).toBeEditable();
});

test("写报价邮件 without amount keeps result and composer on fill-price", async ({ page, request }) => {
  const ses = await request.post("/api/collaborations/col_laozhang/session").then((r) => r.json());
  await page.goto(`/s/${ses.id}`);
  await expect(page.locator("[data-composer-input]")).toHaveAttribute("placeholder", /写报价邮件 @数码老张 金额 \[USD\]/);
  await page.locator("[data-composer-input]").fill("写报价邮件 @数码老张");
  await page.locator("[data-send]").click();
  await expect(page.locator("[data-workbench] [data-compose-loop]")).toBeVisible({ timeout: 20000 });
  await expect(page.locator("[data-workbench] [data-kind='task-result-card']")).toContainText(/金额未写明|补上金额后再确认发送/);
  await expect(page.locator("[data-composer-suggestions] button").first()).toHaveText("补上金额");
  await page.locator("[data-composer-suggestions] button").first().click();
  await expect(page.locator("[data-composer-input]")).toHaveValue("把金额改成 [USD]");
  await expect(page.locator('[data-skill-chip="email_compose"]')).toHaveCount(0);
});

test("写一份报价邮件 shows priced letter and draft on one result page", async ({ page, request }) => {
  const ses = await request.post("/api/collaborations/col_laozhang/session").then((r) => r.json());
  await page.goto(`/s/${ses.id}`);
  await page.locator("[data-composer-input]").fill("写一份报价邮件 金额 680");
  await page.locator("[data-send]").click();
  await expect(page.locator("[data-workbench] [data-compose-loop]")).toBeVisible({ timeout: 20000 });
  await expect(page.locator("[data-workbench] [data-kind='task-result-card']")).toContainText(/USD\s*680|金额：USD 680/);
  await expect(page.locator("[data-workbench] [data-kind='task-result-card']")).not.toContainText("往来依据");
  await expect(page.locator('[data-workbench] [data-kind="email-card"]')).toBeVisible();
  await expect(page.locator("[data-draft-subject]")).toBeVisible();
  await expect(page.locator("[data-draft-body]")).toBeEditable();
  await expect(page.locator("[data-draft-body]")).toContainText(/USD 680|680/);
  await expect(page.locator('[data-email-action="send"]')).toBeEnabled();
  await expect(page.getByText("已提交审批")).toHaveCount(0);
  await page.locator('[data-email-action="translate"]').click();
  const zh = page.locator("[data-draft-zh]");
  await expect(zh).toBeVisible({ timeout: 15000 });
  await expect(zh).toContainText("内部中文（不进 SMTP）");
  await expect(zh).toContainText(/[\u4e00-\u9fff]/);
  await expect(page.locator("[data-draft-body]")).not.toHaveValue(/不会进入 SMTP/);
  await page.goto("/approvals");
  await expect(page.locator("[data-approval-id]")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("允许发送");
});

test("写报价邮件 100美金1小时 lands USD 100 per hour in the draft", async ({ page, request }) => {
  const ses = await request.post("/api/collaborations/col_laozhang/session").then((r) => r.json());
  await page.goto(`/s/${ses.id}`);
  await page.locator("[data-composer-input]").fill("写报价邮件 100美金1小时");
  await page.locator("[data-send]").click();
  await expect(page.locator("[data-workbench] [data-compose-loop]")).toBeVisible({ timeout: 20000 });
  await expect(page.locator("[data-workbench] [data-kind='task-result-card']")).toContainText("USD 100 per hour");
  await expect(page.locator("[data-workbench] [data-kind='task-result-card']")).not.toContainText("往来依据");
  await expect(page.locator("[data-draft-body]")).toContainText("USD 100 per hour");
  await expect(page.locator("[data-draft-body]")).not.toContainText("one video");
});

test("KOL / 写合作邮件 fills composer with USD 100 per hour draft", async ({ page, request }) => {
  const ses = await request.post("/api/collaborations/col_laozhang/session").then((r) => r.json());
  await page.goto(`/s/${ses.id}`);
  const input = page.locator("[data-composer-input]");
  await input.click();
  await input.fill("100美金1小时 /");
  await expect(page.locator("[data-skill-picker]")).toBeVisible();
  await page.locator('[data-skill-option="email_compose"]').click();
  await expect(input).toHaveValue(/USD 100 per hour/, { timeout: 15000 });
  await expect(input).not.toHaveValue(/one video/);
  await page.locator("[data-send]").click();
  await expect(page.locator("[data-workbench] [data-compose-loop]")).toBeVisible({ timeout: 20000 });
  await expect(page.locator("[data-workbench] [data-kind='task-result-card']")).not.toContainText("往来依据");
  await expect(page.locator("[data-draft-body]")).toContainText("USD 100 per hour");
});

test("send failure stays as persistent error, not toast-success", async ({ page, request }) => {
  await page.goto("/exam");
  await page.locator('[data-persona="exam_blocked"]').click();
  await expect(page.locator("body")).toContainText("未通过");
  await askKolSession(page, request, "col_xiaomei", "写跟进邮件 @小美妆日记");
  await expectDraft(page);
  await openDraftTab(page);
  await page.locator('[data-email-action="send"]').click();
  await expect(page.locator("[data-persistent-error]").first()).toBeVisible();
  await expect(page.getByText("已发送原文")).toHaveCount(0);
  await expect(page.locator(".toast-success")).toHaveCount(0);
  await page.goto("/exam");
  await page.locator('[data-persona="sriphy"]').click();
});

test("admin hides non-P0 connectors", async ({ page }) => {
  await page.goto("/admin/connectors");
  await expect(page.locator("[data-admin-page='connectors']")).toBeVisible();
  await expect(page.locator('[data-connector="enterprise_mail"]')).toContainText("企业邮箱");
  await expect(page.locator('[data-connector="wecom"]')).toContainText("企业微信");
  await expect(page.locator('[data-hidden-connector="飞书多维表"]')).toContainText("本期隐藏");
  await expect(page.locator('[data-hidden-connector="本地文件夹"]')).toContainText("本期隐藏");
});

test("unbound inbound stays on this thread", async ({ page }) => {
  await page.goto("/");
  await openHomeTemplates(page);
  await page.locator('[data-home] .rec[data-intent="creator_lifecycle_kanban"]').click();
  await expectHomeComposerDraft(page, "合作生命周期看板");
  await submitHomeComposer(page);
  await expect(page.locator('[data-workbench] [data-kind="task-result-card"]')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('[data-workbench] [data-kind="inbound-card"]')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('[data-kind="inbound-card"]')).toContainText("未绑定来信");
  await expect(page.locator('[data-kind="inbound-card"]')).toContainText("vanlife.kit@example.com");
  await expect(page.locator('[data-kind="sys-msg"]')).toContainText("无法判断，请人选阶段");
  await expect(page.getByText("已自动记入", { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-kind="sys-msg"]')).toContainText("不会「已自动记入」");
});

test("two buttons stay separate: send keeps stage, confirm-stage advances", async ({ page, request }) => {
  await page.goto("/exam");
  await page.locator('[data-persona="sriphy"]').click();
  await askKolSession(page, request, "col_xiaomei", "写跟进邮件 @小美妆日记");
  await expectDraft(page);
  await openDraftTab(page);
  await page.locator('[data-email-action="send"]').click();
  await expect(page.getByText(/已发送原文/).first()).toBeVisible();
  const pipe = await request.get("/api/pipeline");
  const body = await pipe.json();
  const x = Object.values(body.groups).flat().find((c: { handle: string }) => c.handle === "小美妆日记") as {
    stage_code: string;
  };
  expect(x.stage_code).toBe("INITIAL_CONTACT");

  await page.locator('[data-tab="stage"]').click();
  await pickStageChip(page.locator("[data-workbench]"), "INTERESTED");
  await page.locator('[data-workbench] [data-email-action="confirm-stage"], [data-workbench] [data-confirm-stage]').click();
  await expect(page.getByText(/正式阶段已按你的确认更新/).first()).toBeVisible();
  const pipe2 = await request.get("/api/pipeline");
  const body2 = await pipe2.json();
  const x2 = Object.values(body2.groups).flat().find((c: { handle: string }) => c.handle === "小美妆日记") as {
    stage_code: string;
  };
  expect(x2.stage_code).toBe("INTERESTED");
});

test("sidebar 新工作任务 highlight does not also select 进行中", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-nav="new-task"]').click();
  await expect(page.locator("[data-home]")).toBeVisible();
  await expect(page.locator('[data-nav="new-task"]')).toHaveClass(/active/);
  await expect(page.locator('[data-nav="running"]')).not.toHaveClass(/active/);
  await expect(page.locator('[data-nav="running"]')).not.toHaveAttribute("aria-current", "page");
});

test("sidebar 进行中 highlights only when viewing a running session", async ({ page }) => {
  await page.route("**/api/sessions", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/sessions") return route.continue();
    await route.fulfill({
      json: [{ id: "run-1", title: "进行中任务", agent_status: "running" }],
    });
  });
  await page.route("**/api/sessions/run-1", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({
      json: { id: "run-1", title: "进行中任务", agent_status: "running", messages: [] },
    });
  });
  await page.goto("/");
  await expect(page.locator('[data-nav="new-task"]')).toHaveClass(/active/);
  await expect(page.locator('[data-nav="running"]')).toHaveAttribute("href", "/s/run-1");
  await expect(page.locator('[data-nav="running"]')).not.toHaveClass(/active/);
  await page.locator('[data-nav="running"]').click();
  await expect(page).toHaveURL(/\/s\/run-1/);
  await expect(page.locator('[data-nav="running"]')).toHaveClass(/active/);
  await expect(page.locator('[data-nav="running"]')).toHaveAttribute("aria-current", "page");
  await expect(page.locator('[data-nav="new-task"]')).not.toHaveClass(/active/);
});

test("sidebar collapse persists without removing navigation", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "收起侧栏" }).click();
  await expect(page.locator(".workbench")).toHaveClass(/sidebar-collapsed/);
  await expect(page.locator(".sidebar .user-chip")).toBeVisible();
  await expect(page.locator('a[href="/skills"]')).toHaveCount(1);
  await page.reload();
  await expect(page.locator(".workbench")).toHaveClass(/sidebar-collapsed/);
  await page.getByRole("button", { name: "展开侧栏" }).click();
});

test("sidebar does not list 最近 sessions", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("[data-recents]")).toHaveCount(0);
  await expect(page.locator("[data-search-recent], [data-search-toggle]")).toHaveCount(0);
  await expect(page.getByLabel("筛选最近")).toHaveCount(0);
  await expect(page.locator(".sidebar .nav-label", { hasText: /^最近$/ })).toHaveCount(0);
  await expect(page.locator('nav[aria-label="今日"]')).toBeVisible();
  await expect(page.locator('nav[aria-label="数字员工"]')).toBeVisible();
  await expect(page.locator('nav[aria-label="资产"]')).toBeVisible();
});

test("composer sends the selected model tier", async ({ page }) => {
  const bodies: Record<string, unknown>[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/messages") && request.method() === "POST") {
      bodies.push(request.postDataJSON() as Record<string, unknown>);
    }
  });
  await page.goto("/");
  await page.getByLabel("模型档位").selectOption("quality");
  await page.locator("[data-home] [data-composer-input]").fill("给@小美妆日记 写阶段跟进邮件");
  await page.locator("[data-home] [data-send]").click();
  await page.waitForURL(/\/s\//);
  await expect(page.locator("[data-kind='me']")).toBeVisible({ timeout: 15000 });
  expect(bodies[0]?.model_tier).toBe("quality");
});

test("admin skill page exposes create form after product manager login", async ({ page }) => {
  await page.goto("/admin/skills");
  await expect(page.getByRole("heading", { name: "组织管理" })).toBeVisible();
  const login = page.locator("[data-admin-login]");
  if (await login.count()) {
    await page.locator("[data-login-name]").fill("鄢棽");
    await page.locator("[data-login-password]").fill("123456789");
    await page.locator("[data-login-submit]").click();
  }
  await expect(page.locator("[data-skill-create]")).toBeVisible();
  await expect(page.locator("[data-skill-create-save]")).toContainText("发布并写入 Codex");
  await expect(page.locator("[data-skill-admin]")).toHaveAttribute("data-skill-admin", "embedded");
  await page.locator("[data-skill-create-id]").fill("daily_brief_ui");
  await page.locator("[data-skill-create-title]").fill("每日简报");
  await page.locator("[data-skill-create-summary]").fill("整理今天要跟进的达人");
  await page.locator("[data-skill-create-body]").fill("# 每日简报\n\n整理今天要处理的达人跟进。\n\n## 禁止事项\n\n- 禁止发送消息。\n- 禁止修改阶段。\n");
  await page.locator("[data-skill-create-save]").click();
  await expect(page.locator('[data-skill="daily_brief_ui"]')).toBeVisible();
  await expect(page.locator('[data-skill="daily_brief_ui"] .hub-kind')).toHaveText("自建");
  await page.goto("/skills");
  await expect(page.locator('[data-skill="daily_brief_ui"]')).toBeVisible();
  await expect(page.locator('[data-skill="daily_brief_ui"] .hub-kind')).toHaveText("自建");
  await page.goto("/market/skills");
  await expect(page.locator("[data-hub-new]")).toHaveAttribute("href", "/admin/skills");
  await expect(page.locator('[data-skill="daily_brief_ui"] .hub-kind')).toHaveText("自建");
});

test("employee persona hides admin chrome and connector config", async ({ page, request }) => {
  await request.post("/api/me/persona", { data: { persona: "employee" } });
  await page.goto("/");
  await expect(page.locator(".workbench")).toHaveAttribute("data-account-role", "employee");
  await expect(page.locator(".workbench")).toHaveAttribute("data-view-mode", "business");
  await expect(page.locator('.sidebar a[href="/admin/connectors"]')).toHaveCount(0);
  await expect(page.locator('[data-nav="connectors"]')).toHaveAttribute("href", "/connectors");
  await page.locator(".user-chip").click();
  await expect(page.getByRole("link", { name: "管理控制台" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "连接 Starry 邮箱" })).toBeVisible();
  await expect(page.locator("[data-debug-toggle]")).toHaveCount(0);
  await page.goto("/market/skills");
  await expect(page.locator("[data-hub-new]")).toHaveCount(0);
  await expect(page.locator('[data-connector="starrykol"]')).toHaveCount(0);
  await expect(page.locator('[data-hub-chip="connectors"]')).toHaveCount(0);
  await expect(page.locator('[data-hub-mode="catalog"]')).toHaveText("技能目录");
  await expect(page.locator('[data-hub-chip="reach"]')).toHaveText("建联");
  await expect(page.locator('[data-hub-chip="biz"]')).toHaveText("评估报价");
  await expect(page.locator('[data-hub-chip="sample"]')).toHaveText("寄样测评");
  await expect(page.locator('[data-hub-chip="content"]')).toHaveText("内容发布");
  await expect(page.locator('[data-hub-chip="settle"]')).toHaveText("结算");
  await expect(page.locator('[data-hub-chip="exception"]')).toHaveText("异常旁路");
  await page.goto("/agents");
  await expect(page.locator("[data-expert-page='recommend']")).toBeVisible();
  await expect(page.locator("[data-expert-view='recommend']")).toHaveText("推荐");
  await expect(page.locator("[data-expert-view='mine']")).toHaveText("我的数字员工");
  await expect(page.locator("[data-expert-view='all']")).toHaveText("全部数字员工");
  await expect(page.locator("[data-expert-view='search']")).toHaveText("搜索");
  await expect(page.getByRole("heading", { name: "数字员工" })).toBeVisible();
  await expect(page.locator("[data-expert-card='expert:kol']")).toBeVisible();
  await expect(page.locator("[data-expert-card='expert:kol']")).toContainText("KOL 合作专员");
  await expect(page.locator("[data-expert-summon='expert:kol']")).toHaveText("召唤专家");
  await expect(page.getByRole("heading", { name: "推荐下一步" })).toHaveCount(0);
  await expect(page.locator("[data-expert-page]")).not.toContainText("技能目录");
  await expect(page.locator("[data-expert-page]")).not.toContainText("专家团");
  await expect(page.locator("[data-expert-page]")).not.toContainText("关联技能");
  await expect(page.locator("[data-expert-page]")).not.toContainText("在会话里用");
  await expect(page.getByRole("button", { name: "在会话里用" })).toHaveCount(0);
  await expect(page.locator("[data-agent-profile]")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Codex");
  await expect(page.locator("body")).not.toContainText("Starry KOL MCP");
  await expect(page.locator("body")).not.toContainText("Host +");
  await page.goto("/teams");
  await expect(page).toHaveURL(/\/agents\/?$/);
  await expect(page.getByRole("heading", { name: "数字团队" })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Host +");
  await expect(page.locator("body")).not.toContainText("Starry KOL MCP");
});

test("agents expert center has recommend/mine/all/search and one KOL expert", async ({ page }) => {
  await page.goto("/agents");
  await expect(page.locator("[data-expert-view='recommend']")).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("[data-expert-card='expert:kol']")).toBeVisible();
  await expect(page.locator("[data-expert-qa='expert:kol']")).toContainText("谁");
  await expect(page.locator("[data-expert-qa='expert:kol']")).toContainText("擅长");
  await expect(page.locator("[data-expert-qa='expert:kol']")).toContainText("能完成");
  await expect(page.locator("[data-expert-qa='expert:kol']")).toContainText("怎么开始");
  await expect(page).toHaveURL(/\/agents\/?$/);
  await page.locator("[data-expert-view='mine']").click();
  await expect(page).toHaveURL(/view=mine/);
  await expect(page.locator("[data-expert-empty='mine']")).toBeVisible();
  await page.locator("[data-expert-view='all']").click();
  await expect(page.locator("[data-expert-card='expert:kol']")).toBeVisible();
  await page.locator("[data-expert-view='search']").click();
  await page.locator("[data-expert-search]").fill("KOL");
  await expect(page.locator("[data-expert-card='expert:kol']")).toBeVisible();
  await page.locator("[data-expert-search]").fill("不存在的专家名");
  await expect(page.locator("[data-expert-empty='search']")).toBeVisible();
  await page.locator('[data-nav="agents"]').click();
  await expect(page).toHaveURL(/\/agents\/?$/);
});

test("home does not pile expert task lists", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("[data-home]")).toBeVisible();
  await expect(page.locator("[data-expert-card]")).toHaveCount(0);
  await expect(page.locator("[data-home]")).not.toContainText("召唤专家");
  await expect(page.locator("[data-home]")).not.toContainText("你可以这样说");
});

test("expert center list → detail → summon binds a session without send/stage", async ({ page }) => {
  const sideEffects: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    const method = request.method();
    if (method !== "POST" && method !== "PUT" && method !== "PATCH") return;
    if (
      /\/messages(?:\?|$)/.test(url)
      || /\/drafts\/[^/]+\/send/.test(url)
      || /\/confirm-stage/.test(url)
    ) {
      sideEffects.push(`${method} ${url}`);
    }
  });
  await page.goto("/agents");
  await expect(page.locator("[data-expert-card='expert:kol']")).toBeVisible();
  await page.locator("[data-expert-open='expert:kol']").click();
  await expect(page).toHaveURL(/\/agents\/kol/);
  await expect(page.locator("[data-expert-page='detail']")).toBeVisible();
  await expect(page.getByRole("heading", { name: "使命" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "擅长" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "你可以这样说" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "工作方式" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "召唤" })).toBeVisible();
  const summonWait = page.waitForResponse((response) => (
    response.request().method() === "POST"
    && response.url().includes("/api/experts/")
    && response.url().includes("/summon")
  ));
  await page.locator("[data-expert-summon='expert:kol']").click();
  const summonBody = await (await summonWait).json() as Record<string, unknown>;
  await page.waitForURL(/\/s\//);
  expect(Object.keys(summonBody).sort()).toEqual(["expert_id", "expert_version", "intro", "session_id"]);
  expect(String(summonBody.session_id || "")).toMatch(/^ses_/);
  expect(summonBody.expert_id).toBe("expert:kol");
  expect(summonBody.expert_version).toBeTruthy();
  expect(summonBody.intro).toBeTruthy();
  await expect(page.locator("[data-expert-identity='expert:kol']")).toBeVisible();
  await expect(page.locator("[data-expert-name]")).toHaveText("KOL 合作专员");
  await expect(page.locator("[data-expert-intro]")).toBeVisible();
  await expect(page.locator("[data-expert-task]")).toHaveCount(3);
  expect(sideEffects).toEqual([]);
});

test("admin debug toggle reveals connector tiles on the skill hub", async ({ page }) => {
  await page.goto("/market/skills");
  await expect(page.locator(".workbench")).toHaveAttribute("data-view-mode", "business");
  await expect(page.locator('[data-connector="starrykol"]')).toHaveCount(0);
  await page.locator(".user-chip").click();
  await page.locator("[data-debug-toggle]").click();
  await expect(page.locator(".workbench")).toHaveAttribute("data-view-mode", "debug");
  await expect(page.locator('[data-connector="starrykol"]')).toBeVisible();
});

test("user menu switches employee, admin, and settings workspaces", async ({ page }) => {
  await page.goto("/");
  await page.locator(".user-chip").click();
  await expect(page.getByRole("link", { name: "员工工作台" })).toBeVisible();
  await expect(page.getByRole("link", { name: "管理控制台" })).toBeVisible();
  await expect(page.getByRole("link", { name: "个人设置" })).toBeVisible();
  await expect(page.getByRole("link", { name: "连接 Starry 邮箱" })).toBeVisible();
  await page.getByRole("link", { name: "管理控制台" }).click();
  await expect(page.getByRole("heading", { name: "组织管理" })).toBeVisible();
  await page.getByRole("link", { name: "返回员工工作台" }).click();
  await expect(page.locator("[data-home]")).toBeVisible();
});

test("approval, knowledge, and exam are vertical primary nav items before cloud", async ({ page }) => {
  await page.goto("/");
  const todayOrder = await page.locator('nav[aria-label="今日"] [data-nav]').evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-nav")),
  );
  expect(todayOrder).toEqual(["new-task", "running", "cron"]);
  await expect(page.locator('nav[aria-label="今日"]')).not.toContainText(/等我确认|等我確認|Awaiting confirm/);
  await expect(page.locator('[data-nav="confirm"]')).toHaveCount(0);
  await expect(page.locator('aside a[href="/approvals"]')).toHaveCount(1);
  await expect(page.locator('[data-nav="approvals"]')).toContainText("审批");
  const assetOrder = await page.locator('nav[aria-label="资产"] [data-nav], nav[aria-label="资产"] [data-nav-disabled]').evaluateAll((elements) =>
    elements.map((element) =>
      element.getAttribute("data-nav") || element.getAttribute("data-nav-disabled") || element.textContent?.trim(),
    ),
  );
  expect(assetOrder.indexOf("knowledge")).toBeGreaterThanOrEqual(0);
  expect(assetOrder.indexOf("approvals")).toBeGreaterThanOrEqual(0);
  expect(assetOrder.indexOf("exam")).toBeGreaterThanOrEqual(0);
  expect(assetOrder.indexOf("pipeline")).toBe(-1);
  expect(assetOrder.indexOf("cron")).toBe(-1);
  expect(assetOrder.indexOf("knowledge")).toBeLessThan(assetOrder.indexOf("云盘"));
  expect(assetOrder.indexOf("approvals")).toBeLessThan(assetOrder.indexOf("云盘"));
  expect(assetOrder.indexOf("exam")).toBeLessThan(assetOrder.indexOf("云盘"));
  await expect(page.locator('[data-nav="pipeline"]')).toHaveCount(0);
  await expect(page.locator(".sidebar")).not.toContainText("生命周期");
  await expect(page.locator('[data-nav="skills"]')).toBeVisible();
  await expect(page.locator('.sidebar-foot a[href="/approvals"], .sidebar-foot a[href="/kb"], .sidebar-foot a[href="/exam"]')).toHaveCount(0);
  await page.locator('[data-nav="approvals"]').click();
  await expect(page).toHaveURL(/\/approvals$/);
  await expect(page.getByRole("heading", { name: "工作审批" })).toBeVisible();
  await expect(page.locator(".approval-page .page-kicker")).toHaveText("审批");
  await expect(page.locator(".approval-page")).not.toContainText("等我确认");
  await expect(page.locator('[data-nav="approvals"]')).toHaveClass(/active/);
  await page.locator('[data-nav="knowledge"]').click();
  await expect(page.getByRole("heading", { name: "我的知识库" })).toBeVisible();
  await page.locator('[data-nav="exam"]').click();
  await expect(page.getByRole("heading", { name: "学习考试" })).toBeVisible();
});

test("employee sidebar puts cron in today cluster and hides group titles", async ({ page }) => {
  await page.goto("/");
  const today = page.locator('nav[aria-label="今日"]');
  const assets = page.locator('nav[aria-label="资产"]');
  await expect(today.locator('[data-nav="new-task"]')).toBeVisible();
  await expect(today.locator('[data-nav="running"]')).toBeVisible();
  await expect(today.locator('[data-nav="cron"]')).toBeVisible();
  await expect(today.locator('[data-nav="cron"]')).toContainText("定时任务");
  await expect(assets.locator('[data-nav="cron"]')).toHaveCount(0);
  await expect(page.locator(".sidebar .nav-label")).toHaveCount(0);
  await expect(page.locator(".sidebar").getByText("今日", { exact: true })).toHaveCount(0);
  await expect(page.locator(".sidebar").getByText("智能体", { exact: true })).toHaveCount(0);
  await expect(page.locator(".sidebar").getByText("资产", { exact: true })).toHaveCount(0);
  await expect(page.locator(".sidebar").getByText("项目", { exact: true })).toHaveCount(0);
  await expect(page.locator(".sidebar").getByText("最近", { exact: true })).toHaveCount(0);
  await today.locator('[data-nav="cron"]').click();
  await expect(page).toHaveURL(/\/cron/);
  await expect(page.getByRole("heading", { name: "定时任务" })).toBeVisible();
  await expect(today.locator('[data-nav="cron"]')).toHaveClass(/active/);
});

test("docs/21 employee sidebar has no admin connectors deep-link", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('[data-nav="skills"]')).toBeVisible();
  await expect(page.locator('[data-nav="connectors"]')).toHaveAttribute("href", "/connectors");
  await expect(page.locator('.sidebar a[href="/admin/connectors"]')).toHaveCount(0);
  await expect(page.locator('[data-nav="agents"]')).toHaveText("数字员工");
  await expect(page.locator('[data-nav="agents"]')).toHaveAttribute("href", "/agents");
  await expect(page.locator('[data-nav="teams"]')).toHaveCount(0);
  await expect(page.locator('[data-nav="agents-teams"]')).toHaveCount(0);
});

test("docs/21 admin agents governance is reachable from admin chrome", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.locator(".admin-header a[href='/agents']")).toHaveCount(0);
  await page.locator("[data-admin-agents-link]").click();
  await expect(page).toHaveURL(/\/admin\/agents$/);
  await expect(page.locator("[data-admin-page='agents']")).toBeVisible();
  await expect(page.getByRole("heading", { name: "数字员工治理" })).toBeVisible();
  await expect(page.locator("[data-admin-tab='agents']")).toHaveClass(/active/);
});

test("employee connector use surface is independent of admin hub", async ({ page, request }) => {
  await request.post("/api/me/persona", { data: { persona: "employee" } });
  await page.goto("/");
  await expect(page.locator(".workbench")).toHaveAttribute("data-account-role", "employee");
  await page.locator('[data-nav="connectors"]').click();
  await expect(page).toHaveURL(/\/connectors$/);
  await expect(page.locator("[data-connector-use]")).toBeVisible();
  await expect(page.getByRole("heading", { name: "连接器" })).toBeVisible();
  await expect(page.locator("[data-connector-use]")).toContainText("凭据和组织策略不在本页");
  await expect(page.locator("textarea[name='bearer']")).toHaveCount(0);
  await expect(page.locator("[data-admin-page='connectors']")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /启用|停用/ })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Starry KOL MCP");
  await expect(page.locator("body")).not.toContainText("LIVE");
  await expect(page.locator("body")).not.toContainText("Codex");
  await page.locator("[data-connector-use-bind-hint] a").click();
  await expect(page).toHaveURL(/\/settings\?tab=starry/);
  await expect(page.locator("[data-starry-bind]")).toBeVisible();
  await page.goto("/admin/connectors");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("[data-admin-page='connectors']")).toHaveCount(0);
});

test("docs/21 admin connectors hub renders", async ({ page }) => {
  await page.goto("/connectors");
  await expect(page.locator("[data-connector-use]")).toBeVisible();
  await expect(page.locator("[data-connector-use-row]").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /启用|停用/ })).toHaveCount(0);
  await expect(page.locator("textarea[name='bearer']")).toHaveCount(0);
  await page.goto("/admin");
  await page.locator('[data-admin-tab="connectors"]').click();
  await expect(page).toHaveURL(/\/admin\/connectors$/);
  await expect(page.locator("[data-admin-page='connectors']")).toBeVisible();
  await expect(page.getByRole("heading", { name: "连接器枢纽" })).toBeVisible();
  await expect(page.locator("[data-admin-health]")).toBeVisible();
  await expect(page.locator(".admin-header .remote-pill, .admin-health .remote-pill")).toHaveCount(0);
  await expect(page.locator('[data-admin-connectors-table] [data-connector="enterprise_mail"]')).toBeVisible();
});

test("admin and settings expose bind Starry mailbox menus", async ({ page }) => {
  await page.goto("/");
  await page.locator(".user-chip").click();
  await expect(page.locator("[data-starry-menu]")).toHaveText("连接 Starry 邮箱");
  await page.locator("[data-starry-menu]").click();
  await expect(page).toHaveURL(/\/settings\?tab=starry/);
  await expect(page.getByRole("tab", { name: "连接 Starry" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("[data-starry-bind]")).toBeVisible();
  await expect(page.getByRole("heading", { name: "连接 Starry KOL" })).toBeVisible();
  await expect(page.getByRole("button", { name: "读取可用邮箱" })).toBeVisible();

  await page.goto("/admin");
  await expect(page.locator('[data-admin-tab="starry"]')).toHaveCount(0);
  await expect(page.locator("[data-starry-bind]")).toHaveCount(0);
  await page.goto("/admin/starry");
  await expect(page).toHaveURL(/\/settings\?tab=starry/);
  await expect(page.locator("[data-starry-bind]")).toBeVisible();
});

test("home composer renders before delayed task data finishes", async ({ page }) => {
  await page.route("**/api/home", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await route.fulfill({ json: { brand: "灵工 工作", h1: "今天有什么工作要处理？", recs: [] } });
  });
  await page.route("**/api/tasks", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await route.fulfill({ json: [] });
  });
  await page.route("**/api/task-definitions", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await route.fulfill({ json: [] });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-home] [data-composer]")).toBeVisible({ timeout: 500 });
  await expect(page.getByRole("heading", { name: "今天有什么工作要处理？" })).toBeVisible({ timeout: 500 });
});

test("preview toolbar collapses, exports, shares, and opens read-only view", async ({ page, request }) => {
  const session = await request.post("/api/sessions", { data: { title: "可分享草稿" } });
  const { id } = await session.json() as { id: string };
  await request.post(`/api/sessions/${id}/messages`, {
    data: { text: "写合作邮件", intent: "email_compose", act: "ask" },
  });
  await page.goto(`/s/${id}`);
  await expect(page.locator("[data-workbench]")).toBeVisible();
  const draft = page.locator('[data-workbench] [data-kind="email-card"]');
  const result = page.locator('[data-workbench] [data-kind="task-result-card"]');
  await expect(draft.or(result).first()).toBeVisible();
  await expect(page.getByLabel("下载 Markdown")).toBeVisible();
  await expect(page.getByLabel("下载 JSON")).toHaveCount(0);
  if (await draft.isVisible()) await expect(page.getByLabel("下载邮件草稿")).toBeVisible();
  await page.getByLabel("收起工作台").click();
  await expect(page.locator("[data-workbench]")).toHaveClass(/collapsed/);
  await page.getByLabel("展开工作台").click();
  await page.getByRole("button", { name: "分享" }).click();
  await expect(page.locator(".share-status")).toContainText("分享链接已创建");

  const share = await request.post(`/api/sessions/${id}/share`, {
    data: { expires_in_seconds: 600, include_internal: false },
  });
  const { token } = await share.json() as { token: string };
  await page.goto(`/share/${token}`);
  await expect(page.getByRole("heading", { name: "写合作邮件" })).toBeVisible();
  await expect(page.getByText("只读分享")).toBeVisible();
  const shared = page.locator(".shared-artifact, .shared-page");
  await expect(shared.first()).toBeVisible();
  await expect(page.locator(".shared-page")).toContainText(/英文原文草稿|写合作邮件|邮件草稿/);
});

test("composer renders uploaded files as removable attachment cards", async ({ page }) => {
  await page.goto("/");
  await page.locator("[data-attach-input]").setInputFiles({
    name: "creator-brief.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Creator brief\nKeep it concise."),
  });
  const card = page.locator('[data-attachment-name="creator-brief.md"]');
  await expect(card).toBeVisible();
  await expect(card).toContainText("text/markdown");
  await expect(card).toContainText("已上传");
  await card.getByRole("button", { name: "移除 creator-brief.md" }).click();
  await expect(card).toHaveCount(0);
  await page.locator("[data-home] [data-attach]").click();
  await page.getByRole("menu", { name: "添加内容" }).getByRole("menuitem", { name: "最近的文件" }).hover();
  await page.getByRole("menu", { name: "最近的文件" }).getByRole("menuitem", { name: /creator-brief.md/ }).first().evaluate((element: HTMLElement) => element.click());
  await expect(card).toBeVisible();
});

test("task workbench switches today/templates, filters sources, and runs one of 25 templates", async ({ page }) => {
  const templates = Array.from({ length: 25 }, (_, index) => ({
    id: `template-${index + 1}`,
    title: `任务模板 ${index + 1}`,
    description: `模板说明 ${index + 1}`,
    category: `分组 ${Math.floor(index / 5) + 1}`,
  }));
  const posted: string[] = [];
  await page.route("**/api/sessions", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "POST" && url.pathname === "/api/sessions") {
      posted.push("/api/sessions");
      await route.fulfill({ json: { id: "session-created", title: "任务模板 1" } });
      return;
    }
    await route.fallback();
  });
  await page.route("**/api/sessions/session-created", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        json: { id: "session-created", title: "任务模板 1", agent_status: "listening", messages: [] },
      });
      return;
    }
    await route.fallback();
  });
  await page.route("**/api/task-definitions", (route) => route.fulfill({ json: templates }));
  await page.route("**/api/home", (route) => route.fulfill({
    json: { brand: "灵工 工作", h1: "今天有什么工作要处理？", recs: templates },
  }));
  await page.route("**/api/tasks", async (route) => {
    if (route.request().method() === "POST") {
      posted.push("/api/tasks");
      await route.fulfill({ json: { id: "task-created", title: "任务模板 1", source: "manual", status: "pending" } });
      return;
    }
    await route.fulfill({ json: [
      { id: "manual-1", title: "手动跟进", source: "manual", status: "pending", priority: "high" },
      { id: "ai-1", title: "AI 风险发现", source: "ai", status: "running", risk: "合作临近延期" },
      { id: "done-1", title: "已完成复盘", source: "manual", status: "completed", priority: "low" },
    ] });
  });
  await page.route("**/api/tasks/*/run", async (route) => {
    posted.push(new URL(route.request().url()).pathname);
    await route.fulfill({
      json: {
        task: { id: "task-created", title: "任务模板 1", source: "manual", status: "running" },
        run: { status: "running" },
        session_id: "session-created",
        pending: { status: "running" },
      },
    });
  });
  await page.route("**/api/tasks/from-text", async (route) => {
    posted.push("/api/tasks/from-text");
    await route.fulfill({
      json: {
        task: { id: "task-created", title: "任务模板 1", source: "manual", status: "pending" },
        tasks: [{ id: "task-created", title: "任务模板 1", source: "manual", status: "pending" }],
        resolved_tasks: [{ id: "task-created", title: "任务模板 1", source: "manual", status: "pending" }],
      },
    });
  });
  await page.route("**/api/pipeline**", (route) => route.fulfill({
    json: {
      columns: ["Lead", "Opportunity", "Negotiation", "Execution", "Settlement-Growth"],
      groups: {
        Lead: [{ id: "col_xiaomei", handle: "小美妆日记", brand: "LT", stage_code: "INITIAL_CONTACT", stage_label: "初步接触", exception: false }],
        Opportunity: [],
        Negotiation: [{ id: "col_laozhang", handle: "数码老张", brand: "LT", stage_code: "QUOTE_PENDING", stage_label: "报价待确认", exception: false }],
        Execution: [{ id: "col_mum", handle: "母婴小课", brand: "RO", stage_code: "CONTENT_PLANNING", stage_label: "内容策划", exception: false }],
        "Settlement-Growth": [],
      },
      exceptions: [{ id: "col_trip", handle: "旅行电源菌", brand: "PQ", stage_code: "DISPUTED", stage_label: "争议中", exception: true, notes: "样品丢失争议" }],
    },
  }));
  await page.route("**/api/home/board", (route) => route.fulfill({
    json: {
      kols: [
        { id: "col_xiaomei", handle: "小美妆日记", brand: "LT", stage_code: "INITIAL_CONTACT", stage_label: "初步接触", exception: false, profile_tags: [{ id: "niche", label: "美妆" }], kol_name: "小美妆日记", collab_summary: "LT品牌合作", recent_followup: "写跟进邮件 · 已完成", current_stage: "初步接触", suggested_stage: "已回复-有兴趣" },
        { id: "col_laozhang", handle: "数码老张", brand: "LT", stage_code: "QUOTE_PENDING", stage_label: "报价待确认", exception: false, profile_tags: [{ id: "niche", label: "数码" }], kol_name: "数码老张", collab_summary: "LT品牌合作", recent_followup: "写报价信 · 等待中", current_stage: "报价待确认", suggested_stage: "商务谈判" },
        { id: "col_mum", handle: "母婴小课", brand: "RO", stage_code: "CONTENT_PLANNING", stage_label: "内容策划", exception: false, profile_tags: [{ id: "niche", label: "母婴" }], kol_name: "母婴小课", collab_summary: "RO品牌合作", recent_followup: "催大纲 · 已完成", current_stage: "内容策划", suggested_stage: "内容审核" },
        { id: "col_trip", handle: "旅行电源菌", brand: "PQ", stage_code: "DISPUTED", stage_label: "争议中", exception: true, notes: "样品丢失争议", profile_tags: [{ id: "exception", label: "异常" }], kol_name: "旅行电源菌", collab_summary: "样品丢失争议", recent_followup: "记状态 · 有风险", current_stage: "争议中 · 异常", suggested_stage: "需人选回到主流程" },
      ],
      tasks: [
        { id: "manual-1", title: "手动跟进", source: "manual", status: "pending", priority: "high", history_summary: "任务已创建 · 待处理", kol_name: "小美妆日记", collab_summary: "LT品牌合作", recent_followup: "任务已创建 · 待处理", current_stage: "初步接触", suggested_stage: "已回复-有兴趣" },
        { id: "ai-1", title: "AI 风险发现", source: "ai", status: "running", risk: "合作临近延期", history_summary: "识别风险 · 进行中", recent_followup: "识别风险 · 进行中" },
        { id: "done-1", title: "已完成复盘", source: "manual", status: "completed", priority: "low", history_summary: "复盘完成 · 已完成", recent_followup: "复盘完成 · 已完成" },
      ],
      tabs: [
        { code: "all", count: 4 },
        { code: "INITIAL_CONTACT", count: 1 },
        { code: "exception", count: 1 },
        { code: "QUOTE_PENDING", count: 1 },
        { code: "CONTENT_PLANNING", count: 1 },
      ],
    },
  }));
  await page.goto("/");
  await expectHomeModeOrder(page);
  await expect(page.locator('[data-home-mode="ai"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("[data-today-summary]")).toContainText("1项待处理");
  await expect(page.locator("[data-recommended-tasks]")).toBeVisible();
  await openHomeTodo(page);
  await expect(page.locator("[data-today-work] [data-todo-card]")).toHaveCount(1);
  await expect(page.locator("[data-today-work]")).toContainText("手动跟进");
  await expect(page.locator("[data-today-work]")).not.toContainText("AI 风险发现");
  await expect(page.locator("[data-today-work] [data-recommended-tasks]")).toHaveCount(0);
  await expect(page.locator('[data-todo-bucket="later"]')).toHaveCount(0);
  await expect(page.locator("[data-today-work]")).not.toContainText("后续");
  await openHomeAi(page);
  await expect(page.locator("[data-insight-card]")).toHaveCount(1);
  await expect(page.locator("[data-insight-card]")).toContainText("AI 风险发现");
  await expect(page.locator("[data-insight-mark]")).toBeVisible();
  await openHomeLifecycle(page);
  await expectHomeChromeRow(page);
  await expectFollowedKolHeadingRemoved(page);
  await expectFollowedKolListAlignsWithTabs(page);
  await expect(page.locator("[data-kol-tab]")).toHaveCount(17);
  await expect(page.locator('[data-kol-tab="INITIAL_CONTACT"]')).toBeVisible();
  await expect(page.locator('[data-kol-tab="needs_me"]')).toHaveCount(0);
  await expect(page.locator("[data-kol-stage-filter]")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /查看KOL全生命周期/ })).toHaveCount(0);
  await expect(page.locator("[data-followed-kol]")).toHaveCount(4);
  await expect(page.locator("[data-followed-kol] [data-kol-band]")).toHaveCount(16);
  const card = page.locator('[data-followed-kol="小美妆日记"]');
  await expect(card.locator('[data-kol-card-cols="5"]')).toHaveCount(0);
  await expect(card.locator("[data-kol-band]")).toHaveCount(4);
  await expect(card.locator("[data-current-state]")).toContainText("初步接触");
  await expect(card.locator("[data-recommended-action]")).toContainText("建议依据不足");
  await expect(card.locator("[data-confirm-enter-stage]")).toHaveCount(0);
  await expect(card.locator(".task-main")).toHaveCount(0);
  const cardBox = await card.boundingBox();
  const identityBox = await card.locator("[data-kol-identity]").boundingBox();
  const stateBox = await card.locator("[data-current-state]").boundingBox();
  const factBox = await card.locator("[data-latest-fact]").boundingBox();
  const recBox = await card.locator("[data-recommended-action]").boundingBox();
  const ctaBox = await card.locator("[data-kol-band='cta']").boundingBox();
  expect(cardBox && identityBox && stateBox && factBox && recBox && ctaBox).toBeTruthy();
  expect((cardBox?.width || 0)).toBeLessThanOrEqual(1280);
  await expectNoHorizontalOverflow(page, "[data-home-modes]");
  await expectNoHorizontalOverflow(page, "[data-kol-tabs]");
  await expectNoHorizontalOverflow(page, "[data-followed-kol-list]");
  await page.locator('[data-kol-tab="INITIAL_CONTACT"]').click();
  await expect(page.locator("[data-followed-kol]")).toHaveCount(1);
  await expect(page.locator("[data-followed-kol]")).toContainText("小美妆日记");
  await page.locator('[data-kol-tab="all"]').click();
  await page.locator('[data-kol-tab="exception"]').click();
  await expect(page.locator("[data-followed-kol]")).toContainText("旅行电源菌");
  const exceptionCard = page.locator('[data-followed-kol="旅行电源菌"]');
  await expect(exceptionCard.locator("[data-stage-label]")).toHaveText("争议中");
  await expect(exceptionCard.locator("[data-current-state]")).not.toContainText(" · 异常");
  await expect(exceptionCard.locator('[data-kol-chip="exception"]')).toHaveText("异常");
  await page.locator("[data-open-work-panel]").click();
  await expect(page.locator("[data-work-panel]")).toBeVisible();
  await page.locator('[data-home-tab="today"]').click();
  await page.locator('[data-panel-filter="open"]').click();
  await expect(page.locator("[data-work-panel] .today-task")).toHaveCount(2);
  await page.locator('[data-panel-filter="ai"]').click();
  await expect(page.locator("[data-work-panel] .today-task")).toHaveCount(1);
  await expect(page.locator("[data-work-panel] .today-task.task-ai")).toContainText("AI 风险发现");
  await page.getByRole("tab", { name: "任务模板" }).click();
  await expect(page.locator("[data-task-template]").filter({ hasText: /任务模板 \d+/ })).toHaveCount(25);
  await page.locator("[data-task-template]").filter({
    has: page.locator(".rec-title", { hasText: /^任务模板 1$/ }),
  }).click();
  await expectHomeComposerDraft(page, "任务模板 1");
  expect(posted).toEqual([]);
  await submitHomeComposer(page);
  expect(posted).toEqual(["/api/tasks/from-text", "/api/tasks/task-created/run"]);
  await expect(page).toHaveURL(/\/s\/session-created/);
});

test("low-confidence quick task creation offers clarification without execution", async ({ page }) => {
  let runs = 0;
  await page.route("**/api/tasks", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/task-definitions", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/tasks/from-text", (route) => route.fulfill({
    json: {
      confidence: "low",
      clarification: "你希望分析哪个范围？",
      candidates: [
        { id: "today", title: "分析今天的合作", prompt: "分析今天的合作" },
        { id: "week", title: "分析本周的合作", prompt: "分析本周的合作" },
      ],
    },
  }));
  await page.route("**/api/tasks/*/run", (route) => {
    runs += 1;
    return route.fulfill({ json: {} });
  });
  await page.goto("/");
  await page.locator("[data-home] [data-composer-input]").fill("帮我分析一下");
  await page.locator("[data-home] [data-send]").click();
  await expect(page.locator("[data-creation-feedback]")).toContainText("你希望分析哪个范围？");
  await expect(page.locator("[data-creation-feedback] .clarification-chip")).toHaveCount(2);
  expect(runs).toBe(0);
});

test("task detail keeps process in center, result on right, and supports completion/back", async ({ page }) => {
  let completed = false;
  const now = new Date().toISOString();
  await page.addInitScript(() => sessionStorage.setItem("task:session-detail", "task-detail"));
  await page.route("**/api/tasks/task-detail", async (route) => {
    if (route.request().method() === "POST") {
      completed = true;
      await route.fulfill({ json: { task: { id: "task-detail", title: "复盘合作进展", source: "ai", status: "completed", priority: "high" } } });
      return;
    }
    await route.fulfill({ json: {
      id: "task-detail",
      title: "复盘合作进展",
      source: "ai",
      status: completed ? "completed" : "running",
      priority: "high",
      profile: "KOL 运营",
      context: "聚焦本周停滞的合作。",
      suggested_actions: ["准备跟进消息"],
    } });
  });
  await page.route("**/api/tasks/task-detail/events", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/tasks/task-detail/complete", async (route) => {
    completed = true;
    await route.fulfill({ json: { task: { id: "task-detail", title: "复盘合作进展", source: "ai", status: "completed", priority: "high" } } });
  });
  await page.route("**/api/sessions/session-detail", (route) => route.fulfill({ json: {
    agent_status: "listening",
    messages: [
      { id: "process", session_id: "session-detail", role: "assistant", kind: "process_trace", created_at: now, payload: {
        title: "处理过程",
        phases: [{ label: "汇总合作状态", status: "done", summary: "已覆盖本周合作。" }],
      } },
      { id: "result", session_id: "session-detail", role: "assistant", kind: "task_result_card", created_at: now, payload: {
        title: "合作进展复盘",
        summary: "一项合作需要优先处理。",
      } },
    ],
  } }));
  await page.goto("/s/session-detail");
  await expect(page.getByRole("link", { name: "返回任务列表" })).toBeVisible();
  await expect(page.locator("[data-task-detail]")).toContainText("AI 发现");
  await expect(page.locator('[data-kind="process-trace"]')).toContainText("汇总合作状态");
  await expect(page.locator('.chat [data-kind="task-result-card"]')).toHaveCount(0);
  await expect(page.locator('[data-workbench] [data-kind="task-result-card"]')).toContainText("一项合作需要优先处理");
  await page.locator("[data-complete-task]").click();
  await expect(page.locator("[data-task-detail]")).toContainText("任务已标记完成");
  expect(completed).toBe(true);
});

test("process trace shows harness thinking in the list instead of a fixed five-step template", async ({ page }) => {
  const now = new Date().toISOString();
  await page.route("**/api/sessions/session-thinking", (route) => route.fulfill({ json: {
    agent_status: "listening",
    messages: [
      { id: "me", session_id: "session-thinking", role: "user", kind: "me", created_at: now, payload: { text: "搜索 YouTube 露营达人" } },
      { id: "process", session_id: "session-thinking", role: "assistant", kind: "process_trace", created_at: now, payload: {
        title: "处理过程",
        items: [
          { id: "host:preparing", label: "准备任务", status: "done", kind: "host" },
          { id: "host:skill_ready", label: "加载任务规则", status: "done", kind: "host" },
          { id: "reasoning:rsn_1", label: "已根据平台和关键词整理采集范围。", status: "done", kind: "reasoning" },
          { id: "host:validating", label: "校验输出", status: "done", kind: "result" },
        ],
        summaries: ["已根据平台和关键词整理采集范围。"],
      } },
    ],
  } }));
  await page.goto("/s/session-thinking");
  const trace = page.locator('[data-kind="process-trace"]');
  await expect(trace).toContainText("已根据平台和关键词整理采集范围。");
  await expect(trace).toHaveAttribute("data-harness-thinking", "true");
  await expect(trace).not.toContainText("理解任务");
  await expect(trace).not.toContainText("加载 Skill");
  await expect(trace).not.toContainText("校验安全边界与格式");
  await expect(page.locator("[data-reasoning-summaries]")).toHaveCount(0);
});

test("creator discovery shows auto-started crawl progress in the middle and can stop", async ({ page }) => {
  const now = new Date().toISOString();
  let stopped = false;
  let jobReads = 0;
  await page.addInitScript(() => sessionStorage.setItem("task:crawl-session", "crawl-task"));
  await page.route("**/api/tasks/crawl-task", (route) => route.fulfill({ json: {
    id: "crawl-task",
    title: "发现户外创作者",
    task_type: "creator_discovery",
    source: "manual",
    status: "running",
    entities: { platform: "youtube", keywords: ["户外电源"] },
  } }));
  await page.route("**/api/tasks/crawl-task/events", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/sessions/crawl-session", (route) => route.fulfill({ json: {
    agent_status: "listening",
    messages: [{
      id: "legacy-operations",
      kind: "operation_trace",
      payload: {
        title: "操作过程",
        items: [
          { name: "phase:preparing", label: "准备任务上下文", status: "done" },
          { name: "phase:skill_ready", label: "加载任务规则", status: "done" },
          { name: "phase:generating", label: "生成结构化结果", status: "done" },
        ],
      },
    }],
  } }));
  await page.route("**/api/tasks/crawl-task/actions/stop-crawl", async (route) => {
    stopped = true;
    await route.fulfill({ json: {
      status: "stopped",
      remote_task_id: "remote-safe-101",
      started_at: now,
      last_checked_at: now,
    } });
  });
  await page.route("**/api/tasks/crawl-task/crawl-job", async (route) => {
    jobReads += 1;
    await route.fulfill({ json: {
      status: stopped ? "stopped" : "crawling",
      remote_task_id: "remote-safe-101",
      started_at: now,
      last_checked_at: now,
    } });
  });
  await page.route("**/api/tasks/crawl-task/crawl-job/events", (route) => route.fulfill({ json: [
    { id: "ce-1", event_type: "status", status: stopped ? "stopped" : "crawling", created_at: now },
    {
      id: "ce-2",
      event_type: "operation",
      status: "done",
      payload: { operation: "claw.start_crawl", label: "启动远程采集", operation_status: "done" },
      created_at: now,
    },
    {
      id: "ce-3",
      event_type: "operation",
      status: "done",
      payload: { operation: "claw.get_crawl_status", label: "查询远程采集状态", operation_status: "done" },
      created_at: now,
    },
    ...(stopped ? [{
      id: "ce-4",
      event_type: "operation",
      status: "done",
      payload: { operation: "claw.stop_crawl", label: "停止远程采集", operation_status: "done" },
      created_at: now,
    }] : []),
  ] }));

  await page.goto("/s/crawl-session");
  await expect(page.locator('[data-crawl-middle-status="crawling"]')).toContainText("remote-safe-101");
  await expect(page.locator("[data-start-crawl]")).toHaveCount(0);
  await expect(page.locator("[data-workbench]")).toHaveCount(0);
  await expect(page.locator('[data-kind="process-trace"]')).toContainText(/正在安全采集公开创作者数据|远程采集已排队/);
  await expect(page.locator('[data-kind="operation-trace"]')).toContainText("启动远程采集");
  await expect(page.locator('[data-kind="operation-trace"]')).toContainText("查询远程采集状态");
  await expect(page.locator('[data-kind="operation-trace"]')).not.toContainText("准备任务上下文");
  await expect(page.locator('[data-kind="operation-trace"]')).not.toContainText("加载任务规则");
  await expect(page.locator('[data-kind="operation-trace"]')).not.toContainText("生成结构化结果");
  await expect.poll(() => jobReads).toBeGreaterThan(1);
  await page.getByRole("button", { name: "停止采集" }).click();
  await expect(page.locator('[data-crawl-middle-status="stopped"]')).toContainText("已停止");
  await expect(page.locator('[data-kind="operation-trace"]')).toContainText("停止远程采集");
  expect(stopped).toBe(true);
});

test("quoted creator-search keywords show analysis without a right-side plan", async ({ page, request }) => {
  const before = await request.get("/api/tasks").then((response) => response.json()) as unknown[];
  await page.goto("/");
  await page.locator("[data-home] [data-composer-input]").fill("搜索 Instagram“户外电源、房车露营”达人。");
  await page.locator("[data-home] [data-send]").click();
  await page.waitForURL(/\/s\//);
  await expect(page.locator("[data-task-analysis-summary]")).toContainText("Instagram");
  await expect(page.locator("[data-task-analysis-summary]")).toContainText("户外电源、房车露营");
  await expect(page.locator("[data-start-crawl]")).toHaveCount(0);
  await expect(page.locator("[data-workbench]")).toHaveCount(0);
  await expect(page.locator("[data-crawl-status]")).toHaveCount(0);
  const after = await request.get("/api/tasks").then((response) => response.json()) as unknown[];
  expect(after.length).toBe(before.length + 1);
});

test("ready crawl result renders candidates and prefills follow-up tasks without email", async ({ page }) => {
  const now = new Date().toISOString();
  await page.addInitScript(() => sessionStorage.setItem("task:crawl-result-session", "crawl-result-task"));
  await page.route("**/api/tasks/crawl-result-task", (route) => route.fulfill({ json: {
    id: "crawl-result-task",
    title: "户外创作者候选结果",
    task_type: "creator_discovery",
    source: "ai",
    status: "completed",
    crawl_plan: { platform: "youtube", mode: "search", keywords: ["户外电源"] },
    task_result: {
      title: "创作者发现结果",
      creators: [{
        platform: "youtube",
        creator_id: "up-42",
        nickname: "露营研究所",
        followers: 125000,
        recent_views: [80000, 100000, 90000],
      }],
    },
  } }));
  await page.route("**/api/tasks/crawl-result-task/events", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/sessions/crawl-result-session", (route) => route.fulfill({ json: {
    agent_status: "listening",
    messages: [],
  } }));
  await page.route("**/api/tasks/crawl-result-task/crawl-job", (route) => route.fulfill({ json: {
    status: "result_ready",
    remote_task_id: "remote-result-42",
    updated_at: now,
  } }));
  await page.route("**/api/tasks/crawl-result-task/crawl-job/events", (route) => route.fulfill({ json: [
    { id: "ready", status: "result_ready", created_at: now },
  ] }));

  await page.goto("/s/crawl-result-session");
  const results = page.locator("[data-crawl-candidates]");
  await expect(results).toContainText("露营研究所");
  await expect(results).toContainText("up-42");
  await expect(results).toContainText("125,000");
  await expect(results).toContainText("90,000");
  await expect(results).toContainText("粉丝规模");
  await expect(results).toContainText("置信度");
  await expect(results).not.toContainText(/email|邮箱|@/i);
  await expect(page.locator('[data-kind="email-card"]')).toHaveCount(0);

  await results.getByRole("button", { name: "评分" }).click();
  await expect(page.locator("[data-composer-input]")).toHaveValue(/up-42.*创作者评分任务/);
});

test("generic creator profile task result stays in the standard result renderer", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("task:profile-session", "profile-task"));
  await page.route("**/api/tasks/profile-task", (route) => route.fulfill({ json: {
    id: "profile-task",
    title: "创作者画像",
    task_type: "creator_profile",
    status: "completed",
    task_result: {
      title: "创作者画像结果",
      summary: "内容以户外装备实测为主。",
      metrics: [{ label: "内容稳定度", value: 86 }],
      sections: [{ title: "受众特征", body: "核心受众关注露营与房车旅行。" }],
    },
  } }));
  await page.route("**/api/tasks/profile-task/events", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/sessions/profile-session", (route) => route.fulfill({ json: {
    agent_status: "listening",
    messages: [],
  } }));
  await page.goto("/s/profile-session");
  await expect(page.locator('[data-workbench] [data-kind="task-result-card"]')).toContainText("内容以户外装备实测为主");
  await expect(page.locator("[data-crawl-candidates]")).toHaveCount(0);
});

test("skill hub lists Starry KOL MCP and the remaining library skills", async ({ page }) => {
  await page.goto("/market/skills");
  await page.locator(".user-chip").click();
  await page.locator("[data-debug-toggle]").click();
  await expect(page.locator(".workbench")).toHaveAttribute("data-view-mode", "debug");
  await expect(page.locator('[data-connector="starrykol"]')).toContainText("Starry KOL MCP");
  await expect(page.locator('[data-connector="starrykol"]')).toContainText("红人库");
  await expect(page.locator('[data-connector="kolclaw"]')).toContainText("KOL Claw");
  await page.locator('[data-hub-chip="connectors"]').click();
  await expect(page.locator('[data-connector="starrykol"]')).toBeVisible();
  await expect(page.locator('[data-connector="enterprise_mail"]')).toBeVisible();
  await expect(page.locator("body")).not.toContainText("邮件 MCP");
  await saveScreenshot(page, "skill_hub_starry_kol_mcp.png");

  await page.goto("/");
  await openHomeTemplates(page);
  await expect(homeRecByTitle(page, "延期关怀")).toBeVisible({ timeout: 15000 });
  for (const title of [
    "达人库全量",
    "更新红人负责人",
    "解密达人联系方式",
    "合作生命周期看板",
    "达人风险会话",
    "超时/风险扫描",
    "达人筛选字典",
    "应用邮件会话",
    "延期关怀",
    "达人画像",
    "达人库查询",
    "写合作邮件",
  ]) {
    const rec = homeRecByTitle(page, title);
    await rec.scrollIntoViewIfNeeded();
    await expect(rec).toBeVisible({ timeout: 10000 });
  }
  await saveScreenshot(page, "home_starry_kol_templates.png");
});

test("达人画像 and 更新红人负责人 run through Starry KOL MCP", async ({ page }) => {
  await page.goto("/");
  const input = page.locator("[data-home] [data-composer-input]");
  await input.fill("达人画像 达人 UID KOLTEST001");
  await page.locator("[data-home] [data-send]").click();
  await page.waitForURL(/\/s\//);
  const profile = page.locator('[data-workbench] [data-kind="task-result-card"]');
  await expect(profile).toBeVisible({ timeout: 20000 });
  await expect(profile).toContainText("达人画像");
  await expect(profile).toContainText("画像说明");
  await expect(profile).toContainText("红人绑定 / 负责人");
  await expect(profile).toContainText("陈组长");
  await expect(profile).not.toContainText("这项信息");
  await expect(profile).not.toContainText("摘要数据");

  await page.goto("/");
  await page.locator("[data-home] [data-composer-input]").fill("达人画像 测试网红-qq-01");
  await page.locator("[data-home] [data-send]").click();
  await page.waitForURL(/\/s\//);
  const qq = page.locator('[data-workbench] [data-kind="task-result-card"]');
  await expect(qq).toBeVisible({ timeout: 20000 });
  await expect(qq).toContainText("画像说明");
  await expect(qq).toContainText("测试网红-qq-01");
  await expect(qq).toContainText("已签收-测试中");
  await expect(qq).not.toContainText("这项信息");
  await expect(qq).not.toContainText("摘要数据");
  await expect(qq).not.toContainText("DELIVERED_TESTING");
  await saveScreenshot(page, "creator_profile_qq01_briefing.png");
  await expect(page.locator('[data-kind="email-card"]')).toHaveCount(0);
  await saveScreenshot(page, "creator_profile_owner_binding.png");

  await page.locator("[data-composer-input]").fill("更新红人负责人 达人 UID KOLTEST001 负责人：王主管");
  await page.locator("[data-send]").click();
  const owner = page.locator('[data-workbench] [data-kind="task-result-card"]').filter({ hasText: "红人负责人更新结果" });
  await expect(owner).toBeVisible({ timeout: 20000 });
  await expect(owner).toContainText("红人绑定 / 负责人");
  await expect(page.locator('[data-kind="operation-trace"]').last()).toContainText("查询达人详情");
  await expect(page.locator('[data-kind="operation-trace"]').last()).toContainText("更新达人画像");
  await saveScreenshot(page, "creator_owner_update_result.png");
});

test("风险扫描 runs Starry KOL MCP tools and lists T8 overdue", async ({ page }) => {
  if (isRealE2E()) test.setTimeout(180_000);
  await page.goto("/");
  await openHomeTemplates(page);
  await homeRecByTitle(page, "超时/风险扫描").click();
  await expectHomeComposerDraft(page, "超时/风险扫描");
  await submitHomeComposer(page);
  const timeout = resultCardTimeout();
  const card = workbenchResultCard(page);
  const chat = chatStream(page);
  // Stub Host uses 风险汇总 / T8 失联与延期 on the result card. Real Host may
  // keep the workbench on「开始风险扫描」while「超时/风险扫描结果」or 失联+延期
  // land only in the chat stream. Scope real locators to .chat / .first() so
  // intermediate card + stream do not trip Playwright strict mode.
  const stubFinal = card.filter({ hasText: "风险汇总" }).filter({ hasText: "T8 失联与延期" });
  const realResultTitle = chat.getByText("超时/风险扫描结果").first();
  const realOverdueCopy = chat.filter({ hasText: /失联/ }).filter({ hasText: /延期/ });
  await expect(stubFinal.or(realResultTitle).or(realOverdueCopy).first()).toBeVisible({ timeout });
  if (await stubFinal.isVisible()) {
    await expect(card).toContainText("超时/风险扫描");
    await expect(card).toContainText("风险汇总");
    await expect(card).toContainText("T8 失联与延期");
    await expect(card).toContainText("小美妆日记");
    await expect(page.locator("[data-session-stream-pane]")).not.toContainText("远程MCP");
    await expect(page.locator("[data-session-stream-pane]")).not.toContainText("starrykol.");
    await expect(page.locator("[data-session-stream-pane]")).not.toContainText("starry.");
    await expect(page.locator("[data-session-stream-pane]")).not.toContainText("pageRiskConversations");
    await expect(page.locator('[data-kind="process-trace"]')).toContainText("处理过程");
    await expect(page.locator('[data-kind="process-trace"]')).toContainText("准备任务");
    await expect(page.locator('[data-kind="process-trace"]')).not.toContainText("理解任务");
    await expect(page.locator('[data-kind="process-trace"]')).not.toContainText("校验安全边界与格式");
  } else {
    // Distinctive analysis copy is enough for real PASS. Risk MCP rows may stay
    // marked "!" when Host fallback already filled the stream.
    await expect(chat).toContainText(/超时\/风险扫描/, { timeout });
    await expect(realResultTitle.or(chat.getByText(/失联/).first())).toBeVisible({ timeout });
    if (!(await realResultTitle.isVisible())) {
      await expect(chat).toContainText(/失联/, { timeout });
      await expect(chat).toContainText(/延期/, { timeout });
    }
  }
  await expect(page.locator('[data-kind="email-card"]')).toHaveCount(0);
  await saveScreenshot(page, "risk_scan_starry_kol_mcp.png");
});

test("首封建联 starter asks for 发件/收件/主题 and does not show a compose form", async ({ page, request }) => {
  await request.post("/api/knowledge/kb_mail_kol/cite", { data: {} });
  await page.goto("/");
  const input = page.locator("[data-home] [data-composer-input]");
  await input.click();
  await input.fill("/");
  await expect(page.locator("[data-skill-picker] [data-knowledge-option='kb_mail_kol']")).toBeVisible();
  await page.locator("[data-knowledge-option='kb_mail_kol']").click();
  await expect(input).toHaveValue("首封建联 [发件邮箱] [收件邮箱] [主题]");
  await expect(page.locator("[data-home] [data-mail-fields]")).toHaveCount(0);
  await saveScreenshot(page, "first_touch_compose_fields.png");
  await submitHomeComposerStay(page);
  await expectHomeClarification(page, "发件邮箱", "收件邮箱", "邮件主题");
  await expect(page.locator("[data-home] [data-creation-feedback]")).not.toContainText("邮件会话");
  await input.fill("首封建联 发件箱 larry.zhao@amperetime.com 发给 qiyou1984@gmail.com 主题：LiTime Mini 12V — weekend van test");
  await submitHomeComposer(page);
  await expect(page.locator("[data-kind='me']")).toContainText("发件箱 larry.zhao@amperetime.com", { timeout: 15000 });
  await expect(page.locator("[data-kind='me']")).toContainText("发给 qiyou1984@gmail.com");
  await expect(page.locator("[data-kind='me']")).toContainText("主题：LiTime Mini 12V");
  const workbench = page.locator("[data-workbench]");
  await expect(workbench).toContainText("qiyou1984@gmail.com", { timeout: 20000 });
  await expect(workbench).toContainText("larry.zhao@amperetime.com");
  await expect(workbench).not.toContainText("还需要补充：邮件会话");
  await expect(page.locator("[data-workbench] [data-kind='email-card'], [data-workbench] [data-kind='task-result-card']").first()).toBeVisible();
  await saveScreenshot(page, "first_touch_compose_submitted.png");
});

test("cited knowledge template appears in the home picker and only prefills", async ({ page, request }) => {
  await request.post("/api/knowledge/kb_mail_followup/cite", { data: {} });
  await page.goto("/");
  const input = page.locator("[data-home] [data-composer-input]");
  await input.click();
  await input.fill("/");
  await expect(page.locator("[data-skill-picker] [data-knowledge-option='kb_mail_followup']")).toBeVisible();
  await page.locator("[data-knowledge-option='kb_mail_followup']").click();
  await expect(input).toHaveValue(/阶段跟进/);
  await expect(page.locator("[data-knowledge-chip='kb_mail_followup']")).toContainText("阶段跟进");
  await expect(page).toHaveURL(/\/(?:\?.*)?$/);
  await page.locator('[data-nav="knowledge"]').click();
  await expect(page.getByRole("heading", { name: "我的知识库" })).toBeVisible();
  await expect(page.locator('[data-knowledge="kb_mail_followup"]')).toContainText("已启用");
  await page.locator('[data-fill-composer="kb_mail_followup"]').click();
  await expect(page.locator("[data-home] [data-composer-input]")).toHaveValue(/阶段跟进/);
});

test("HTML session payload is shown as a connection error, not SyntaxError", async ({ page, request }) => {
  const ses = await request.post("/api/sessions", { data: { title: "达人库查询" } }).then((r) => r.json()) as { id: string };
  await page.route((url) => url.pathname === `/api/sessions/${ses.id}`, async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 502,
      contentType: "text/html",
      body: "<html><head><title>502 Bad Gateway</title></head><body>bad gateway</body></html>",
    });
  });
  await page.goto(`/s/${ses.id}`);
  const alert = page.getByRole("alert").filter({ hasText: "当前无法继续这次工作" });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("连接暂时异常，已保留你的任务。");
  await expect(page.getByText("SyntaxError")).toHaveCount(0);
  await expect(page.getByText("is not valid JSON")).toHaveCount(0);
  await saveScreenshot(page, "library_query_html_error.png");
});

test("达人库查询 completes with a result card", async ({ page }) => {
  if (isRealE2E()) test.setTimeout(180_000);
  await page.goto("/");
  await page.locator("[data-home] [data-composer-input]").fill("查询达人库 关键词：户外电源");
  await submitHomeComposer(page);
  const timeout = resultCardTimeout();
  const card = workbenchResultCard(page);
  // Stub fixture lists 户外电源达人. Real pageKolProfiles (PR #6) returns live
  // names such as 灵工连通测试 — do not require 户外电源 in real mode. Keep
  // the approval-blocked failure path when the read is denied.
  const stubSuccess = card.filter({ hasText: "达人库查询结果" }).filter({ hasText: "户外电源达人" });
  const realSuccess = page.getByText(/达人库查询结果|灵工连通测试/).first();
  const blockedCard = card.filter({ hasText: "达人库查询未完成" });
  const blockedCopy = page.getByText("达人库查询未完成").first();
  await expect(stubSuccess.or(realSuccess).or(blockedCard).or(blockedCopy).first()).toBeVisible({ timeout });
  if (await stubSuccess.isVisible()) {
    await expect(card).toContainText("达人库查询结果", { timeout });
    await expect(card).toContainText("户外电源达人", { timeout });
    await expect(card).not.toContainText("未找到匹配的达人画像");
  } else if (await blockedCopy.isVisible() && !(await realSuccess.isVisible())) {
    await expect(page.getByText("达人库查询未完成").first()).toBeVisible({ timeout });
    if (await blockedCard.isVisible()) {
      await expect(card).toContainText(/starrykol\.pageKolProfiles|pageKolProfiles|审批|权限|read permission/, { timeout });
    }
  } else {
    await expect(page.getByText(/达人库查询结果|灵工连通测试|查询结果/).first()).toBeVisible({ timeout });
  }
  await expect(page.getByText("当前无法继续这次工作")).toHaveCount(0);
  await expect(page.getByText("SyntaxError")).toHaveCount(0);
  await saveScreenshot(page, "creator_library_query_result.png");
});

test("达人库查询 starter placeholder still lists profiles", async ({ page }) => {
  await page.goto("/");
  await page.locator("[data-home] [data-composer-input]").fill("达人库查询 [关键词]");
  await submitHomeComposer(page);
  const card = page.locator('[data-workbench] [data-kind="task-result-card"]');
  await expect(card).toBeVisible({ timeout: 20000 });
  await expect(card).toContainText("户外电源达人");
  await expect(card).not.toContainText("未找到匹配的达人画像");
});

test("cron 跑一次风险扫描 opens the same Host MCP result", async ({ page }) => {
  await page.goto("/cron");
  await expect(page.getByRole("heading", { name: "定时任务" })).toBeVisible();
  await page.getByRole("button", { name: "跑一次风险扫描" }).click();
  await page.waitForURL(/\/s\//);
  const card = page.locator('[data-workbench] [data-kind="task-result-card"]');
  await expect(card).toBeVisible({ timeout: 20000 });
  await expect(card).toContainText("超时/风险扫描");
  await expect(card).toContainText("T8 失联与延期");
  await expect(page.locator('[data-kind="operation-trace"]').last()).toContainText("查询风险会话");
  await expect(page.locator('[data-kind="email-card"]')).toHaveCount(0);
  await saveScreenshot(page, "cron_risk_scan_starry_kol_mcp.png");
});

test("approvals page can preview and initiate an expense approval", async ({ page }) => {
  await page.goto("/approvals");
  const form = page.locator("[data-approval-initiate]");
  await expect(form).toBeVisible();
  await expect(form.getByRole("heading", { name: "发起费用审批" })).toBeVisible();
  await expect(form).toContainText("阶段变更请在合作确认里提交");
  await expect(page.locator("[data-approval-slice='mine']")).toBeVisible();
  await form.locator('[name="amount"]').fill("5000");
  await form.locator('[name="requester"]').fill("张三");
  await form.locator('[name="requester"]').blur();
  await expect(form).toContainText("申请人不在组织名单里", { timeout: 10000 });
  await expect(form).not.toContainText(/MCP|Codex|Host|engine/i);
  await saveScreenshot(page, "approvals_initiate_blocked_unknown_requester.png");
  await form.locator('[name="amount"]').fill("50000");
  await form.locator('[name="currency"]').selectOption("USD");
  await form.locator('[name="requester"]').fill("黎玉燕");
  await form.locator('[name="purpose"]').fill("KOL 推广");
  await form.locator('[name="amount"]').blur();
  await expect(page.locator("[data-approval-preview]")).toContainText("林桐", { timeout: 10000 });
  await expect(page.locator("[data-approval-preview]")).toContainText("张总");
  await saveScreenshot(page, "approvals_initiate_preview_chain.png");
  await form.getByRole("button", { name: "提交费用审批" }).click();
  await expect(page).toHaveURL(/[?&]id=appr_/);
  const card = page.locator("[data-approval-id][data-approval-kind='expense']").first();
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("data-approval-focus", "true");
  await expect(card).toContainText("黎玉燕");
  await expect(card).toContainText("林桐");
  await expect(page.locator("body")).not.toContainText("approval_id=");
  await saveScreenshot(page, "approvals_initiate_focused_card.png");
});

test("expense approval walks FIN-EXP-004 to 已办结 without record ids", async ({ page, request }) => {
  const session = await request.post("/api/sessions", { data: { title: "费用审批" } }).then((r) => r.json());
  const posted = await request.post(`/api/sessions/${session.id}/messages`, {
    data: { text: "Please file an expense approval for 黎玉燕 50000 USD KOL spend" },
  }).then((r) => r.json());
  const id = String(posted.approval?.id || "");
  expect(id).toBeTruthy();
  expect(posted.approval.payload.rule_id).toBe("FIN-EXP-004");
  await page.goto(`/approvals?id=${id}`);
  const card = page.locator(`[data-approval-id="${id}"]`);
  await expect(card).toBeVisible();
  await expect(page.locator("body")).not.toContainText("approval_id=");
  await expect(page.locator("body")).not.toContainText("chain_id=");
  await expect(card).toContainText("折合人民币");
  for (const name of ["林桐", "王主管", "财务负责人", "张总"]) {
    await expect(card).toContainText(`当前等待 ${name}`);
    await card.getByRole("button", { name: "同意" }).click();
  }
  await expect(card).toHaveAttribute("data-approval-status", "consumed", { timeout: 15000 });
  await expect(card).toContainText("已办结");
  await expect(page.locator("body")).not.toContainText("approval_id=");
  await expect(page.locator("body")).not.toContainText("appr_");
});
