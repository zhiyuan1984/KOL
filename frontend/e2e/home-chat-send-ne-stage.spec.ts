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
  await expect(page.locator("[data-admin-confirm='draft-send']")).toHaveCount(0);
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

test("draft send opens L3 confirm with object/scope/consequence; cancel does not send", async ({ page, request }) => {
  const ses = await request.post("/api/collaborations/col_xiaomei/session").then((r) => r.json() as Promise<{ id: string }>);
  await page.goto(`/s/${ses.id}`);
  await page.locator("[data-composer-input]").fill("写跟进邮件 @小美妆日记");
  await page.locator("[data-send]").click();
  await expect(page.locator("[data-admin-confirm='draft-send']")).toHaveCount(0);
  await expect(page.locator("[data-workbench] [data-kind='email-card']")).toBeVisible({ timeout: 20000 });
  const sendPosts: string[] = [];
  page.on("request", (req) => {
    if (req.method() === "POST" && /\/api\/drafts\/[^/]+\/send$/.test(new URL(req.url()).pathname)) {
      sendPosts.push(req.url());
    }
  });
  await page.locator('[data-workbench] [data-email-action="send"]').click();
  const dialog = page.locator("[data-admin-confirm='draft-send']");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("data-risk", "L3");
  await expect(dialog.locator("[data-admin-confirm-object]")).not.toHaveText("");
  await expect(dialog.locator("[data-admin-confirm-scope]")).toContainText("外发");
  await expect(dialog.locator("[data-admin-confirm-consequence]")).toContainText("发送不等于推进阶段");
  await expect(dialog.locator("[data-admin-confirm-ok]")).toHaveText("确认发送");
  await page.locator("[data-admin-confirm-cancel]").click();
  await expect(dialog).toHaveCount(0);
  expect(sendPosts).toEqual([]);
  await expect(page.getByText(/已发送原文/)).toHaveCount(0);
});

test("result draft 确认发送 also requires L3 confirm before SMTP", async ({ page }) => {
  const now = new Date().toISOString();
  let sent = false;
  await page.route("**/api/sessions/result-send**", (route) => route.fulfill({
    json: {
      id: "result-send",
      agent_status: "listening",
      collaboration_id: "col_xiaomei",
      messages: [{
        id: "result",
        session_id: "result-send",
        role: "assistant",
        kind: "task_result_card",
        created_at: now,
        payload: {
          type: "task_result",
          title: "合作邮件草稿",
          summary: "已写好一封建联信",
          subject: "Collaboration with LiTime",
          body: "Hi, we would love to collaborate.",
          from: "brand@litime.com",
          to: "kol@example.com",
          draft_id: "draft_json",
          actions: ["确认发送"],
        },
      }],
    },
  }));
  await page.route("**/api/drafts/draft_json/send", async (route) => {
    sent = true;
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto("/s/result-send");
  const sendBtn = page.locator("[data-workbench] [data-result-draft] [data-email-action='send']");
  await expect(sendBtn).toHaveText("确认发送");
  await sendBtn.click();
  const dialog = page.locator("[data-admin-confirm='draft-send']");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("[data-admin-confirm-object]")).toContainText("brand@litime.com");
  await expect(dialog.locator("[data-admin-confirm-object]")).toContainText("kol@example.com");
  await expect(dialog.locator("[data-admin-confirm-consequence]")).toContainText("发送不等于推进阶段");
  expect(sent).toBe(false);
  await page.locator("[data-admin-confirm-ok]").click();
  await expect.poll(() => sent).toBe(true);
});

test("KolMailCard treats auto_advanced as a suggestion, not a written stage", async ({ page }) => {
  const now = new Date().toISOString();
  await page.route("**/api/sessions/auto-adv**", (route) => route.fulfill({
    json: {
      id: "auto-adv",
      agent_status: "listening",
      collaboration_id: "col_ship",
      journey: {
        handle: "Wendell Fishing",
        collaboration_id: "col_ship",
        stage_code: "SAMPLE_PENDING",
        stage_label: "待寄样",
      },
      messages: [
        {
          id: "mail",
          session_id: "auto-adv",
          role: "assistant",
          kind: "kol_mail_card",
          created_at: now,
          payload: {
            direction: "inbound",
            subject: "Your LiTime Product Has Shipped",
            body: "The sample shipped via UPS. Tracking number 1Z999AA10123456784.",
            from: "ops@litime.example",
            current_stage: "SAMPLE_PENDING",
            current_label: "待寄样",
            auto_advanced: { to_stage: "SHIPPED", label: "已发货" },
            judgment: { suggested_stage: "SHIPPED", suggested_label: "已发货", reason: "物流运单" },
          },
        },
        {
          id: "stage",
          session_id: "auto-adv",
          role: "assistant",
          kind: "confirm_stage_card",
          created_at: now,
          payload: {
            current_stage: "SAMPLE_PENDING",
            current_label: "待寄样",
            proposed_stage: "SHIPPED",
            targets: [{ code: "SHIPPED", label: "已发货", track: "main" }],
          },
        },
      ],
    },
  }));
  await page.goto("/s/auto-adv");
  const mail = page.locator("[data-workbench] [data-kind='kol-mail-card']");
  await expect(mail).toBeVisible();
  await expect(mail).not.toContainText("已按事实进入");
  await expect(mail.locator("[data-mail-suggest][data-auto-advanced='suggest']")).toContainText("建议进入 已发货");
  await expect(mail.locator("[data-mail-suggest]")).toContainText("阶段确认卡");
  await expect(mail.locator("[data-mail-confirm]")).toHaveCount(0);
  await expect(mail.locator("[data-mail-stage-select]")).toHaveCount(0);
  const confirm = page.locator("[data-workbench] [data-kind='confirm-stage-card']");
  await expect(confirm).toBeVisible();
  await expect(confirm.locator("[data-confirm-stage]")).toBeVisible();
});
