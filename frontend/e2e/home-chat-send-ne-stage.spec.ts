import { test, expect, type Page } from "@playwright/test";

async function openFollowed(page: Page) {
  await page.locator('[data-home-mode="lifecycle"]').click();
  await expect(page.locator('[data-home-pane="lifecycle"]')).toBeVisible();
}

test.beforeEach(async ({ request }) => {
  await request.post("/api/demo/reset", { data: { workbench: true } });
  await request.post("/api/me/persona", { data: { persona: "sriphy" } });
});

test("followed KOL pane is an object list, not task-status or 15-stage chips", async ({ page }) => {
  await page.goto("/");
  await openFollowed(page);
  await expect(page.locator("[data-kol-tabs]")).toHaveCount(0);
  await expect(page.locator("[data-kol-tab]")).toHaveCount(0);
  await expect(page.locator(".kol-owner-tabs")).toHaveCount(0);
  await expect(page.locator('[data-home-pane="lifecycle"]')).not.toContainText("需要我处理");
  await expect(page.locator('[data-kol-tab="INITIAL_CONTACT"]')).toHaveCount(0);
  await expect(page.locator('[data-kol-tab="SETTLING"]')).toHaveCount(0);
  await expect(page.locator("[data-followed-object-toolbar]")).toBeVisible();
  await expect(page.locator("[data-followed-object-search]")).toBeVisible();
  await expect(page.locator("[data-followed-kol-list]")).toBeVisible();
  await expect(page.locator("[data-followed-origin]")).toHaveAttribute("data-followed-origin", "collaboration");
  await expect(page.locator("[data-kol-stage-filter]")).toBeVisible();
  await expect(page.locator('[data-home-pane="lifecycle"]')).not.toContainText("正式阶段共 15 个");
  await expect(page.locator('[data-home-pane="lifecycle"]')).not.toContainText("这一状态还没有");
  await expect(page.locator('a[href="/pipeline"]')).toHaveCount(0);
  await expect(page.locator("[data-followed-kol]").first()).toBeVisible({ timeout: 15000 });
  await page.locator("[data-followed-object-search]").fill("___no_such_followed_object___");
  await expect(page.locator("[data-follow-empty='filtered']")).toBeVisible();
  await expect(page.locator("[data-follow-empty='filtered'] strong")).toHaveText("没有匹配的跟进对象");
  await expect(page.locator("[data-follow-empty='filtered']")).toContainText("跟进中的红人");
  await expect(page.locator("[data-follow-empty='filtered']")).not.toContainText("这一状态还没有");
});

test("session-open failure stays on Home with an honest error", async ({ page }) => {
  await page.route("**/api/collaborations/*/session", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ detail: "未能打开会话，请稍后重试。" }),
    });
  });
  await page.goto("/");
  await openFollowed(page);
  await expect(page.locator("[data-followed-kol]").first()).toBeVisible({ timeout: 15000 });
  await page.locator("[data-followed-kol]").first().locator("[data-open-kol-detail]").click();
  await expect(page).toHaveURL(/\/(?:\?.*)?$/);
  await expect(page).not.toHaveURL(/\/pipeline/);
  await expect(page.locator("[data-home-session-error]")).toBeVisible();
  await expect(page.locator("[data-home-session-error]")).toContainText("未能打开会话");
  await expect(page.locator('[data-home-pane="lifecycle"]')).toBeVisible();
});

test("send chrome has no stage picker; Chat header is not a lifecycle board", async ({ page, request }) => {
  const ses = await request.post("/api/collaborations/col_xiaomei/session").then((r) => r.json() as Promise<{ id: string }>);
  await page.goto(`/s/${ses.id}`);
  await expect(page.locator("[data-kol-journey]")).toContainText("小美妆日记");
  await expect(page.locator("[data-journey-track]")).toHaveCount(0);
  await expect(page.locator("[data-open-lifecycle]")).toHaveCount(0);
  await expect(page.locator("[data-kol-journey]")).not.toContainText("在生命周期中打开");
  await expect(page.locator("[data-kol-journey]")).not.toContainText("八个阶段");
  await expect(page.locator("[data-team-rail]")).toHaveCount(0);
  await page.locator("[data-composer-input]").fill("写跟进邮件 @小美妆日记");
  await page.locator("[data-send]").click();
  await expect(
    page.locator("[data-workbench]").locator('[data-kind="email-card"], [data-kind="task-result-card"]').first(),
  ).toBeVisible({ timeout: 20000 });
  await expect(page.locator("[data-workbench] [data-kind='stage-from-draft']")).toHaveCount(0);
  await expect(page.locator('[data-workbench] [data-email-action="confirm-stage"]')).toHaveCount(0);
  await expect(page.locator("[data-workbench] [data-kind='email-card']")).not.toContainText("确认推进阶段");
});

test("inbound mail card replies only; stage write stays on confirm_stage card", async ({ page, request }) => {
  const ingested = await request.post("/api/collaborations/col_xiaomei/ingest-mail", {
    data: {
      subject: "Re: Collaboration Opportunity with LiTime",
      body: "Hi, I am interested and would love to collaborate.",
      from: "xiaomei.beauty@example.com",
    },
  }).then((r) => r.json()) as { session_id: string };
  await page.goto(`/s/${ingested.session_id}`);
  const card = page.locator('[data-kind="kol-mail-card"]').filter({ hasText: "would love to collaborate" });
  await expect(card).toBeVisible();
  await expect(card.locator("[data-mail-reply]")).toBeVisible();
  await expect(card.locator("[data-mail-confirm]")).toHaveCount(0);
  await expect(card.locator("[data-mail-stage-select]")).toHaveCount(0);
  await expect(card.locator("[data-stage-diff]")).toHaveCount(0);
  await page.locator("[data-composer-input]").fill("提出阶段变更 @小美妆日记 到 已回复-有兴趣");
  await page.locator("[data-send]").click();
  const confirm = page.locator('[data-kind="confirm-stage-card"]');
  await expect(confirm).toBeVisible({ timeout: 20000 });
  await expect(confirm).toContainText("初步接触");
  await expect(confirm.locator("[data-confirm-stage]")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Starry KOL MCP");
});
