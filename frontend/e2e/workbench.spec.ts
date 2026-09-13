import { test, expect, type Page } from "@playwright/test";
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

async function openHomeLifecycle(page: Page) {
  await page.locator('[data-home-mode="lifecycle"]').click();
  await expect(page.locator('[data-home-pane="lifecycle"]')).toBeVisible();
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

async function pipelineAction(page: Page, handle: string, label: string) {
  const row = page.locator(`[data-kol="${handle}"]`);
  await row.locator("[data-pipeline-row]").click();
  await row.locator('[data-pipeline-tab="actions"]').click();
  await row.getByRole("button", { name: label, exact: true }).click();
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
  await expect(page.locator('[data-brand-lockup="home"] .brand-slogan-en')).toHaveText(
    "Powering Outdoor Adventures for Generations!",
  );
  await expect(page.locator('[data-brand-lockup="home"] .brand-slogan-zh')).toHaveText("服务几代人的户外生活");
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
  await expect(page.locator('[data-nav="pipeline"]')).toContainText("生命周期");
  await expect(page.locator('[data-nav="pipeline"]')).not.toContainText("创建新项目");
  await expect(page.locator('a[href="/pipeline"]').first()).toHaveText("生命周期");
  await expect(page.locator('a[href="/pipeline"]').nth(1)).toContainText("生命周期");
  await expect(page.locator("[data-home-mode]")).toHaveCount(3);
  await expect(page.locator('[data-home-mode="todo"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("[data-today-work]")).toBeVisible();
  await expect(page.locator("[data-today-summary]")).toContainText("项待处理");
  await expect(page.locator("[data-today-summary]")).toContainText("逾期");
  await expect(page.locator("[data-today-summary]")).not.toContainText("归因复盘");
  await expect(page.locator("[data-today-summary] [data-panel-filter]")).toHaveCount(0);
  await expect(page.locator("[data-home] [data-workbench]")).toHaveCount(0);
  await expect(page.locator("[data-kol-tab]")).toHaveCount(0);
  await expect(page.locator("[data-journey-guide]")).toHaveCount(0);
  await page.locator("[data-work-panel] .work-panel-backdrop").click();
  await openHomeLifecycle(page);
  await expect(page.getByRole("link", { name: /查看KOL全生命周期/ })).toHaveCount(0);
  await expect(page.locator('a[href="/pipeline"]')).toHaveCount(2);
  await expect(page.locator("[data-home] [data-journey-guide]")).toHaveCount(0);
  await expect(page.locator("[data-lifecycle-domains]")).toHaveCount(0);
  await expect(page.locator("[data-lifecycle-library]")).toHaveCount(0);
  await expect(page.locator("[data-kol-tab]")).toHaveCount(17);
  await expect(page.locator('[data-kol-tab="all"]')).toContainText("全部");
  await expect(page.locator('[data-kol-tab="exception"]')).toContainText("异常");
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
  await expect(page.locator("[data-workbench] [data-kind='email-card']")).toContainText("Update on the Content Timeline");
  // The draft card owns the stage guardrail; ChatBlocks intentionally filters
  // the duplicated generic sys-msg for “正式阶段建议保持”.
  await expect(page.locator("[data-workbench]")).toContainText("正式阶段");
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

test("pipeline shows a 15-stage milestone timeline and detail tabs", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-nav="pipeline"]').click();
  await expect(page).toHaveURL(/\/pipeline$/);
  await expect(page.getByRole("heading", { name: "KOL 全生命周期管理" })).toBeVisible();
  await expect(page.locator(".pipeline-page .page-kicker")).toHaveText("合作");
  await expect(page.locator(".pipeline-page")).toContainText("不是创建新项目");
  await expect(page.locator("[data-nav-disabled='创建新项目']")).toBeVisible();
  await expect(page.locator("[data-exception-bar]")).toContainText("异常 KOL");
  await expect(page.locator("[data-exception-bar]")).toContainText("争议中");
  await expect(page.locator("[data-journey-guide]")).toContainText("发送 ≠ 推进阶段");
  await expect(page.locator("[data-pipeline-related]")).toContainText("写合作邮件");
  await expect(page.locator("[data-pipeline-related]")).toContainText("超时/风险扫描");
  await expect(page.locator("[data-stage-axis] li")).toHaveCount(15);
  await expect(page.locator('[data-kol="小美妆日记"] [data-milestone="INITIAL_CONTACT"]')).toHaveAttribute("data-current", "true");
  await expect(page.locator('[data-kol="数码老张"] [data-milestone="QUOTE_PENDING"]')).toHaveAttribute("data-current", "true");
  await page.locator('[data-kol="小美妆日记"] [data-pipeline-row]').click();
  await expect(page.locator('[data-kol="小美妆日记"] [data-pipeline-tab="overview"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-pipeline-panel="overview"]')).toContainText("初步接触");
  await expect(page.locator('[data-kol="小美妆日记"] button:has-text("记状态")')).toHaveCount(0);
  await page.locator('[data-pipeline-tab="creator"]').click();
  await expect(page.locator("[data-creator-ledger]")).toContainText("钟槿年");
  await expect(page.locator("[data-creator-ledger]")).toContainText("互动率");
  await page.locator('[data-pipeline-tab="actions"]').click();
  await expect(page.locator('[data-kol="小美妆日记"] button:has-text("记状态")')).toBeVisible();
  await page.locator('[data-kol="数码老张"] [data-pipeline-row]').click();
  await expect(page.locator('[data-pipeline-panel="overview"]')).toContainText("报价待确认");
});

test("session page has no coach next-step card and keeps composer skills", async ({ page }) => {
  await page.goto("/");
  await openHomeLifecycle(page);
  await page.locator("[data-followed-kol] .task-main").first().click();
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
  }
});

test("home lifecycle followed KOL opens the mail rail not the task list", async ({ page }) => {
  await page.goto("/");
  await openHomeLifecycle(page);
  await page.locator("[data-followed-kol] .task-main").first().click();
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
  await expect(page.locator('[data-home-mode="todo"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("[data-today-summary]")).toContainText("项待处理");
  await openHomeLifecycle(page);
  await expect(page.locator("[data-kol-tab]")).toHaveCount(17);
  await expect(page.locator('[data-kol-tab="all"]')).toHaveAttribute("aria-selected", "true");
  // Tabs are static (17) even before /api/home/board lands. Wait for the stub
  // listAllKolProfiles pair first; demo fixtures like 小美妆日记 have no kol_uid.
  await expect(page.locator('[data-followed-kol="户外电源达人"]')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('[data-followed-kol="营地灯测评娘"]')).toBeVisible();
  await expect(page.locator('[data-followed-kol="小美妆日记"]')).toHaveCount(0);
  await expect(page.locator("[data-followed-kol]")).toHaveCount(2);
  await expect(page.locator('[data-followed-kol="户外电源达人"] [data-kol-name]')).toContainText("户外电源达人");
  await expect(page.locator('[data-followed-kol="户外电源达人"] [data-collab-summary]')).toContainText("LT");
  await expect(page.locator('[data-followed-kol="户外电源达人"] [data-kol-card-cols="5"]')).toBeVisible();
  await expect(page.locator('[data-followed-kol="户外电源达人"] [data-kol-status-line]')).toBeVisible();
  await expect(page.locator('[data-followed-kol="户外电源达人"] [data-kol-status-line] [data-recent-followup]')).toBeVisible();
  await expect(page.locator('[data-followed-kol="户外电源达人"] [data-kol-status-line] [data-current-stage]')).toContainText("初步接触");
  await expect(page.locator('[data-followed-kol="户外电源达人"] [data-kol-status-line] [data-suggested-stage]')).toContainText("已回复-有兴趣");
  await expect(page.locator('[data-followed-kol="户外电源达人"] [data-kol-primary-action]')).toHaveCount(1);
  await expect(page.locator('[data-kol-tab="all"]')).not.toContainText("失联跟进");
  await expect(page.locator('[data-kol-tab="all"] .kol-tab-history')).toHaveCount(0);
  await page.locator('[data-followed-kol="户外电源达人"] .task-main').click();
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
  await page.locator('[data-followed-kol="户外电源达人"] .task-main').click();
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
  await expect(tagged.locator('[data-follow-style-tag="cautious"]')).toContainText("犹豫谨慎", { timeout: 15000 });
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
          profile_tags: [{ id: "niche", label: "美妆" }],
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
  const board = page.locator("[data-home-pane=lifecycle]");
  await expect(card.locator('[data-kol-card-cols="5"]')).toBeVisible();
  await expect(card.locator(".kol-card-field")).toHaveCount(5);
  const boardBox = await board.boundingBox();
  const cardBox = await card.boundingBox();
  expect(boardBox && cardBox).toBeTruthy();
  expect((cardBox?.width || 0)).toBeGreaterThan((boardBox?.width || 0) * 0.7);
  expect((cardBox?.width || 0)).toBeLessThanOrEqual((boardBox?.width || 0) + 1);
  await expectNoHorizontalOverflow(page, "[data-followed-kol-list]");
  await expectNoHorizontalOverflow(page, '[data-followed-kol="小美妆日记"]');
  await expect(card.locator("[data-mail-summary]")).toBeVisible();
  await expect(card.locator("[data-mail-summary]")).toContainText("想和贵品牌litime合作");
  await expect(card.locator("[data-mail-summary]")).not.toContainText("posting calendar");
  await expect(card.locator("[data-open-original-mail]")).toHaveText("查看原邮件");
  await expect(card.locator("[data-kol-primary-action]")).toHaveCount(1);
  await expect(card.locator('[data-kol-primary-action="open-session"]')).toHaveText("查看来信");

  await page.setViewportSize({ width: 1100, height: 900 });
  await expect(card).toBeVisible();
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
  const waiting = page.locator("[data-todo-card]").filter({ hasText: "写报价信" });
  await expect(waiting).toBeVisible();
  await expect(waiting).toHaveAttribute("data-wait-status", "结果待确认");
  await expect(waiting).toContainText("结果待确认");
  await expect(waiting).not.toContainText("等待中");
  await expect(page.locator('[data-todo-bucket="waiting"]')).toContainText("结果待确认");
  await expect(page.locator('[data-todo-bucket="waiting"]')).toContainText("写报价信");
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
  await expect(page.locator("[data-today-summary]")).toContainText("结果待确认");
  await expect(page.locator("[data-today-summary]")).toContainText("等审批");
  await expect(page.locator("[data-today-summary]")).not.toContainText("等待中");
  await expect(page.locator("[data-today-work]")).not.toContainText("等待中");
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
  await expect(page.locator("[data-todo-card]").filter({ hasText: "数码老张" })).toBeVisible();
  await expect(page.locator("[data-todo-card]").filter({ hasText: "数码老张" })).toHaveAttribute("data-wait-status", "结果待确认");
  await expect(page.locator("[data-todo-card]").filter({ hasText: "旅行电源菌" })).toBeVisible();
  await expect(page.locator("[data-today-summary]")).toContainText(/\d+项待处理/);
  await expect(page.locator("[data-today-summary]")).toContainText("结果待确认");
  await expect(page.locator("[data-today-summary]")).not.toContainText("等待中");
  const todoBefore = await page.locator("[data-todo-card]").count();
  expect(todoBefore).toBeGreaterThanOrEqual(2);
  await expect(page.locator("[data-today-work]")).not.toContainText("失联跟进");
  expect(await page.locator("[data-recommended-task]").count()).toBeGreaterThan(3);
  await expect(page.locator("[data-task-n='1']")).toBeVisible();
  await expect(page.locator("[data-task-n='2']")).toBeVisible();
  await expect(page.locator("[data-task-n='3']")).toBeVisible();
  await expect(page.locator("[data-recommended-task]").first()).toContainText("1.");
  await expect(page.locator("[data-recommended-task]").first()).toContainText("AI发现");
  await expect(page.locator("[data-recommended-reason]").first()).not.toHaveText("");
  await expect(page.locator("[data-recommended-tasks]")).not.toContainText("下一阶段");
  await expect(page.locator("[data-today-work] .todo-card")).toHaveCount(0);
  await expect(page.locator("[data-today-work] .recommended-task")).toHaveCount(0);
  const recPosts: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "POST") return;
    recPosts.push(new URL(r.url()).pathname);
  });
  await page.locator("[data-recommended-task]").first().click();
  await expect(page).toHaveURL(/\/(?:\?.*)?$/);
  await expect(page.locator("[data-home] [data-composer-input]")).toHaveValue(/写合作邮件 @小美妆日记/);
  await expect(page.locator('[data-home] [data-skill-chip="email_compose"]')).toBeVisible();
  expect(recPosts).toEqual([]);
  await page.locator('[data-home-mode="ai"]').click();
  await expect(page.locator("[data-insight-card]").filter({ hasText: "失联跟进" })).toBeVisible();
  await expect(page.locator("[data-insight-mark]")).toBeVisible();
  await page.locator("[data-promote-task='tsk_home_xiaomei_lost']").click();
  await expect(page.locator('[data-home-mode="todo"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("[data-today-work]")).toContainText("失联跟进");
  await expect(page.locator("[data-todo-card]")).toHaveCount(todoBefore + 1);
  await expect(page.locator("[data-today-summary]")).toContainText(`${todoBefore + 1}项待处理`);
  await page.locator('[data-home-mode="ai"]').click();
  await expect(page.locator("[data-insight-card]").filter({ hasText: "失联跟进" })).toHaveCount(0);
  await page.locator('[data-home-mode="todo"]').click();
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
  await openStageSop(page);
  await expect(page.locator("[data-stage-sop]")).toContainText("红人画像");
  await expect(page.locator("[data-stage-sop]")).toContainText("输入");
  await expect(page.locator("[data-stage-sop]")).toContainText("would love to collaborate");
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
  await expect(card.locator("[data-mail-stage-select]")).toHaveValue("INTERESTED");
  await expect(card.locator("[data-mail-confirm]")).toHaveText("确认写入所选阶段");
  await card.locator("[data-mail-confirm]").click();
  await expect(page.locator("[data-session-stage]")).toContainText("已回复-有兴趣", { timeout: 15000 });
  await expect(page.locator("[data-session-stage]")).toContainText("意向");
  await expect(page.locator("[data-journey-guide]")).toHaveCount(0);
  await expect(page.locator("[data-journey-phase]")).toHaveCount(8);
  await expect(page.locator("[data-journey-phase='intent']")).toHaveAttribute("data-phase-state", "current");
  await expect(page.locator(".chat")).toContainText("当前阶段：已回复-有兴趣（意向）");
  await expect(page.locator(".chat")).not.toContainText("当前阶段：初步接触");
  await expect(card.locator("[data-mail-confirm]")).toHaveCount(0);
  await expect(page.locator("[data-kind='confirm-stage-pointer']")).toHaveCount(0);
  await expect(page.locator("[data-stage-sop]")).toHaveJSProperty("open", false);
  await openStageSop(page);
  await expect(page.locator("[data-stage-sop]")).toContainText("意向");
  await expect(page.locator("[data-stage-sop]")).not.toContainText("EVALUATING");
  await expect(page.locator("[data-stage-sop]")).toContainText("红人画像");
  await expect(page.locator("[data-stage-sop]")).not.toContainText("完成条件");
  await expect(page.locator("[data-stage-sop]")).not.toContainText("当前步骤");
  await expect(page.locator("[data-stage-sop]")).toContainText("历史邮件往来摘要");
  await expect(page.locator("[data-stage-sop]")).not.toContainText("Luna 往来摘要");
  const digestBox = page.locator("[data-stage-sop] [data-mail-digest]");
  const digestText = page.locator("[data-stage-sop] [data-mail-summary] p");
  const sopBox = page.locator("[data-stage-sop]");
  const digestWidth = await digestBox.evaluate((el) => (el as HTMLElement).getBoundingClientRect().width);
  const digestTextWidth = await digestText.evaluate((el) => (el as HTMLElement).getBoundingClientRect().width);
  const sopWidth = await sopBox.evaluate((el) => (el as HTMLElement).getBoundingClientRect().width);
  expect(digestWidth).toBeGreaterThan(sopWidth * 0.7);
  expect(digestTextWidth).toBeGreaterThan(sopWidth * 0.65);
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

test("记状态 to CONTENT_REVIEW queues content approval and writes after manager agrees", async ({ page, request }) => {
  await page.goto("/pipeline");
  await pipelineAction(page, "母婴小课", "记状态");
  await page.waitForURL(/\/s\//);
  const card = page.locator('[data-workbench] [data-kind="confirm-stage-card"]');
  await expect(card).toBeVisible({ timeout: 15000 });
  await expect(card).toContainText("内容策划");
  await card.locator("[data-stage-select]").selectOption("CONTENT_REVIEW");
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
  await pipelineAction(page, "小美妆日记", "记状态");
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

test("写跟进邮件 marks the left pointer as an L2 draft block", async ({ page }) => {
  await page.goto("/pipeline");
  await pipelineAction(page, "小美妆日记", "写合作邮件");
  await page.waitForURL(/\/s\//);
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
  await pipelineAction(page, "小美妆日记", "记状态");
  await page.waitForURL(/\/s\//);
  await expect(page.locator('[data-workbench] [data-kind="confirm-stage-card"]')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('[data-kind="email-card"]')).toHaveCount(0);
  await expect(page.locator('[data-kind="confirm-stage-card"]')).toContainText("初步接触");
  await expect(page.locator('[data-kind="confirm-stage-card"] [data-stage-select]')).toHaveValue("INTERESTED");
  const pipelineAfter = await request.get("/api/pipeline").then((r) => r.json());
  const stageAfter = Object.values(pipelineAfter.groups).flat().find(
    (c: { handle: string }) => c.handle === "小美妆日记",
  ) as { stage_code: string };
  expect(stageAfter.stage_code).toBe(stageBefore.stage_code);
});

test("催大纲 on wrong stage stays as persistent error, no worker", async ({ page, request }) => {
  const before = await request.get("/api/workers");
  const n0 = ((await before.json()) as unknown[]).length;
  await page.goto("/pipeline");
  await pipelineAction(page, "小美妆日记", "催大纲");
  await page.waitForURL(/\/s\//);
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

test("地址核对: incomplete email in workbench, complete 可以出库", async ({ page }) => {
  await page.goto("/pipeline");
  await pipelineAction(page, "小美妆日记", "寄样地址核对");
  await page.waitForURL(/\/s\//);
  await expect(page.locator('[data-workbench] [data-kind="email-card"]')).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("可以出库")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /出库|WMS|仓库/ })).toHaveCount(0);

  await page.goto("/pipeline");
  await pipelineAction(page, "数码老张", "寄样地址核对");
  await page.waitForURL(/\/s\//);
  await expect(page.locator('[data-workbench] [data-kind="task-result-card"]')).toContainText("可以进入人工确认后的出库流程", { timeout: 15000 });
  await expect(page.locator('[data-kind="email-card"]')).toHaveCount(0);
});

test("发货通知 without tracking shows supplement in workbench", async ({ page, request }) => {
  const before = await request.get("/api/workers");
  const n0 = ((await before.json()) as unknown[]).length;
  await page.goto("/pipeline");
  await pipelineAction(page, "小美妆日记", "发货通知");
  await page.waitForURL(/\/s\//);
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

test("send failure stays as persistent error, not toast-success", async ({ page }) => {
  await page.goto("/exam");
  await page.locator('[data-persona="exam_blocked"]').click();
  await expect(page.locator("body")).toContainText("未通过");
  await page.goto("/pipeline");
  await pipelineAction(page, "小美妆日记", "写跟进信");
  await page.waitForURL(/\/s\//);
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
  await page.goto("/admin");
  await page.getByRole("button", { name: "KOL 配置" }).click();
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
  await page.goto("/pipeline");
  await pipelineAction(page, "小美妆日记", "写跟进信");
  await page.waitForURL(/\/s\//);
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
  await page.locator('[data-workbench] [data-stage-select]').first().selectOption("INTERESTED");
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
  await expect(page.getByRole("link", { name: "连接器", exact: true })).toHaveCount(0);
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
  await expect(page.getByRole("heading", { name: "我的智能体" })).toBeVisible();
  await expect(page.locator("[data-agent-page='work']")).toBeVisible();
  await expect(page.getByRole("heading", { name: "推荐下一步" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "最近在用" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "运行中" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "失败" })).toBeVisible();
  await expect(page.locator("[data-agent-profile]")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Codex");
  await expect(page.locator("body")).not.toContainText("Starry KOL MCP");
  await expect(page.locator("body")).not.toContainText("Host +");
  await page.goto("/teams");
  await expect(page).toHaveURL(/\/agents\?tab=teams/);
  await expect(page.getByRole("heading", { name: "智能体团队" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Host +");
  await expect(page.locator("body")).not.toContainText("Starry KOL MCP");
});

test("agents page keeps spec collapsed and teams as a secondary tab", async ({ page }) => {
  await page.goto("/agents");
  await expect(page.locator("[data-agent-section='next']")).toBeVisible();
  await expect(page.locator("[data-agent-section='failed']")).toBeVisible();
  await expect(page.locator("[data-agent-failed] button", { hasText: "重试" }).first()).toBeVisible();
  await expect(page.locator("[data-agent-spec-body]")).toHaveCount(0);
  await page.locator("[data-agent-tab='spec']").click();
  await expect(page.locator("[data-agent-page='spec']")).toBeVisible();
  await expect(page.locator("[data-agent-profile]").first()).toBeVisible();
  await expect(page.locator("[data-agent-spec-body]")).toHaveCount(0);
  await page.locator("[data-agent-spec-toggle]").first().click();
  await expect(page.locator("[data-agent-spec-body]").first()).toBeVisible();
  await page.locator("[data-agent-tab='teams']").click();
  await expect(page.getByRole("heading", { name: "智能体团队" })).toBeVisible();
  await expect(page.locator("[data-team]").first()).toBeVisible();
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
  const assetOrder = await page.locator('nav[aria-label="资产"] [data-nav], nav[aria-label="资产"] [data-nav-disabled]').evaluateAll((elements) =>
    elements.map((element) =>
      element.getAttribute("data-nav") || element.getAttribute("data-nav-disabled") || element.textContent?.trim(),
    ),
  );
  expect(assetOrder.indexOf("knowledge")).toBeGreaterThanOrEqual(0);
  expect(assetOrder.indexOf("approvals")).toBeGreaterThanOrEqual(0);
  expect(assetOrder.indexOf("exam")).toBeGreaterThanOrEqual(0);
  expect(assetOrder.indexOf("pipeline")).toBeGreaterThanOrEqual(0);
  expect(assetOrder.indexOf("knowledge")).toBeLessThan(assetOrder.indexOf("云盘"));
  expect(assetOrder.indexOf("approvals")).toBeLessThan(assetOrder.indexOf("云盘"));
  expect(assetOrder.indexOf("exam")).toBeLessThan(assetOrder.indexOf("云盘"));
  expect(assetOrder.indexOf("pipeline")).toBeLessThan(assetOrder.indexOf("云盘"));
  await expect(page.locator('[data-nav="skills-connectors"]')).toBeVisible();
  await expect(page.locator('.sidebar-foot a[href="/approvals"], .sidebar-foot a[href="/kb"], .sidebar-foot a[href="/exam"]')).toHaveCount(0);
  await page.locator('[data-nav="knowledge"]').click();
  await expect(page.getByRole("heading", { name: "我的知识库" })).toBeVisible();
  await page.locator('[data-nav="exam"]').click();
  await expect(page.getByRole("heading", { name: "学习考试" })).toBeVisible();
});

test("connector nav opens the connector management tab directly", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "连接器", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/connectors$/);
  await expect(page.getByRole("button", { name: "连接器", exact: true })).toHaveClass(/active/);
  await expect(page.getByRole("heading", { name: "连接器配置" })).toBeVisible();
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
  await expect(page.getByRole("button", { name: "连接 Starry" }).first()).toBeVisible();
  await page.locator('[data-admin-tab="starry"]').first().click();
  await expect(page).toHaveURL(/\/admin\/starry$/);
  await expect(page.locator('[data-admin-tab="starry"]').first()).toHaveClass(/active/);
  await expect(page.locator("[data-starry-bind]")).toBeVisible();
  await expect(page.getByRole("heading", { name: "连接 Starry KOL" })).toBeVisible();
  await expect(page.locator("[data-starry-status]")).toBeVisible();
  await page.locator("[data-starry-probe]").click();
  await expect(page.locator(".mailbox-pick, .error, [role='status']").first()).toBeVisible({ timeout: 15000 });
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
  await expect(page.getByLabel("下载 JSON")).toBeVisible();
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
  await expect(page.locator("[data-home-mode]")).toHaveCount(3);
  await expect(page.locator('[data-home-mode="todo"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("[data-today-summary]")).toContainText("1项待处理");
  await expect(page.locator("[data-today-work] [data-todo-card]")).toHaveCount(1);
  await expect(page.locator("[data-today-work]")).toContainText("手动跟进");
  await expect(page.locator("[data-today-work]")).not.toContainText("AI 风险发现");
  await page.locator('[data-home-mode="ai"]').click();
  await expect(page.locator("[data-insight-card]")).toHaveCount(1);
  await expect(page.locator("[data-insight-card]")).toContainText("AI 风险发现");
  await expect(page.locator("[data-insight-mark]")).toBeVisible();
  await openHomeLifecycle(page);
  await expect(page.locator("[data-kol-tab]")).toHaveCount(17);
  await expect(page.getByRole("link", { name: /查看KOL全生命周期/ })).toHaveCount(0);
  await expect(page.locator("[data-followed-kol]")).toHaveCount(4);
  await expect(page.locator("[data-followed-kol] [data-kol-status-line]")).toHaveCount(4);
  await expect(page.locator('[data-followed-kol="小美妆日记"] [data-kol-card-cols="5"]')).toBeVisible();
  await expect(page.locator('[data-followed-kol="小美妆日记"] [data-kol-status-line] [data-recent-followup]')).toContainText("写跟进邮件");
  await expect(page.locator('[data-followed-kol="小美妆日记"] [data-kol-status-line] [data-current-stage]')).toContainText("初步接触");
  await expect(page.locator('[data-followed-kol="小美妆日记"] [data-kol-status-line] [data-suggested-stage]')).toContainText("已回复-有兴趣");
  const card = page.locator('[data-followed-kol="小美妆日记"]');
  await expect(card.locator(".kol-card-field")).toHaveCount(5);
  await expect(card.locator("[data-kol-primary-action]")).toHaveCount(1);
  const cardBox = await card.boundingBox();
  const nameBox = await card.locator("[data-kol-name]").boundingBox();
  const summaryBox = await card.locator("[data-collab-summary]").boundingBox();
  const followBox = await card.locator("[data-recent-followup]").boundingBox();
  const stageBox = await card.locator("[data-current-stage]").boundingBox();
  const suggestBox = await card.locator("[data-suggested-stage]").boundingBox();
  expect(cardBox && nameBox && summaryBox && followBox && stageBox && suggestBox).toBeTruthy();
  expect((cardBox?.width || 0)).toBeLessThanOrEqual(1280);
  await expectNoHorizontalOverflow(page, "[data-followed-kol-list]");
  await page.locator('[data-kol-tab="INITIAL_CONTACT"]').click();
  await expect(page.locator("[data-followed-kol]")).toHaveCount(1);
  await expect(page.locator("[data-followed-kol]")).toContainText("小美妆日记");
  await page.locator('[data-kol-tab="exception"]').click();
  await expect(page.locator("[data-followed-kol]")).toContainText("旅行电源菌");
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
    await expect(page.locator('[data-kind="operation-trace"]').last()).toContainText("远程MCP调用");
    await expect(page.locator('[data-kind="operation-trace"]').last()).toContainText("查询风险会话");
    await expect(page.locator('[data-kind="operation-trace"]').last()).toContainText("starrykol.pageRiskConversations");
    await expect(page.locator('[data-kind="operation-trace"]').last()).toContainText("汇总风险会话");
    await expect(page.locator('[data-kind="operation-trace"]').last()).toContainText("starrykol.summarizeRiskConversations");
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
