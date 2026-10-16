import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { stubFollowingFromServerBoard } from "./kol-surface-stub";

async function saveScreenshot(page: Page, name: string): Promise<void> {
  const dir = process.env.PLAYWRIGHT_OUTPUT_DIR || "test-results";
  await page.screenshot({ path: path.join(dir, name), fullPage: true });
}

async function openFollowed(page: Page) {
  await page.locator('[data-home-mode="lifecycle"]').click();
  await expect(page.locator('[data-home-pane="lifecycle"]')).toBeVisible();
}

/** Current native result cards resolve their server-owned draft snapshot through this read-only query. */
async function stubDraftActionSnapshot(page: Page, draftId: string, subject = "Collaboration with LiTime") {
  await page.route(`**/api/queries/mail.draft-actions?draft_id=${encodeURIComponent(draftId)}`, route => route.fulfill({
    json: {
      draft_id: draftId,
      action: {
        action_id: "mail.send",
        label: "确认发送",
        risk_level: "L3",
        state: "ready",
        allowed: true,
        enabled: true,
        confirmation_version: `draft-send-${draftId}-v1`,
        selection_required: false,
        selection_ready: true,
        confirmation_required: true,
        approval_state: "not_required",
        receipt_id: null,
      },
      snapshot: { from: "brand@litime.com", to: "kol@example.com", cc: "", subject, body: "Hi, we would love to collaborate." },
    },
  }));
}

/** Match the current /s/:id entry: a server snapshot plus a quiet SSE stream, never a client-made stage result. */
async function stubMailDecisionSession(page: Page, sessionId: string, snapshot: Record<string, unknown>) {
  await page.addInitScript(() => localStorage.setItem("ui:right-collapsed", "false"));
  await page.route(new RegExp(`/api/sessions/${sessionId}(?:\\?.*)?$`), route => route.fulfill({ json: snapshot }));
  await page.route(`**/api/sessions/${sessionId}/events`, route => route.fulfill({ contentType: "text/event-stream", body: "" }));
}

test.beforeEach(async ({ page, request }) => {
  await request.post("/api/demo/reset", { data: { workbench: true } });
  await request.post("/api/me/persona", { data: { persona: "sriphy" } });
  await stubFollowingFromServerBoard(page, request);
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
  await expect(page.locator("[data-followed-lifecycle-grid]")).toBeVisible();
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
  // 当前原生工作台把可操作草稿放入右侧结果栏；中栏只保留可定位的成果摘要。
  const draft = page.locator("[data-workbench] .side-body [data-email-action='send']");
  await expect(draft).toBeVisible({ timeout: 20000 });
  await expect(page.locator("[data-session-stream-pane] [data-kind='stage-from-draft']")).toHaveCount(0);
  await expect(page.locator('[data-workbench] [data-confirm-stage]')).toHaveCount(0);
  await expect(page.locator("[data-workbench]")).not.toContainText("确认推进阶段");
  await expect(page.locator("[data-admin-confirm='draft-send']")).toHaveCount(0);
});

test("inbound mail card replies only; stage write stays on confirm_stage card", async ({ page }) => {
  const sessionId = "inbound-reply-only";
  const now = new Date().toISOString();
  const stageWrites: string[] = [];
  page.on("request", request => {
    if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/confirm-stage")) stageWrites.push(request.url());
  });
  await stubMailDecisionSession(page, sessionId, {
    id: sessionId,
    agent_status: "listening",
    collaboration_id: "col_xiaomei",
    journey: { collaboration_id: "col_xiaomei", handle: "小美妆日记", stage_code: "INITIAL_CONTACT", stage_label: "初步接触" },
    messages: [
      {
        id: "inbound-mail",
        session_id: sessionId,
        role: "assistant",
        kind: "kol_mail_card",
        created_at: now,
        payload: {
          collaboration_id: "col_xiaomei",
          handle: "小美妆日记",
          direction: "inbound",
          conversation_id: "thread-xiaomei",
          subject: "Re: Collaboration Opportunity with LiTime",
          body: "Hi, I am interested and would love to collaborate.",
          from: "xiaomei.beauty@xiaomei-beauty.cn",
          to: "brand@litime.com",
          mailbox: "brand@litime.com",
          current_stage: "INITIAL_CONTACT",
          current_label: "初步接触",
          judgment: { suggested_stage: "INTERESTED", suggested_label: "已回复-有兴趣", reason: "对方明确表达合作意向。", evidence: [{ source: "body", snippet: "would love to collaborate" }] },
        },
      },
      {
        id: "stage-confirmation",
        session_id: sessionId,
        role: "assistant",
        kind: "confirm_stage_card",
        created_at: now,
        payload: {
          collaboration_id: "col_xiaomei",
          current_stage: "INITIAL_CONTACT",
          current_label: "初步接触",
          proposed_stage: "INTERESTED",
          expected_version: 4,
          targets: [{ code: "INTERESTED", label: "已回复-有兴趣", track: "main" }],
        },
      },
    ],
  });
  await page.goto(`/s/${sessionId}`);
  const workbench = page.locator("[data-mail-decision-workbench]");
  await expect(workbench).toBeVisible();
  const card = workbench.locator('[data-kind="kol-mail-card"]').filter({ hasText: "would love to collaborate" });
  await expect(card).toBeVisible();
  const reply = workbench.locator("[data-mail-reply]");
  await expect(reply).toBeVisible();
  await expect(card.locator("[data-mail-confirm]")).toHaveCount(0);
  await expect(card.locator("[data-mail-stage-select]")).toHaveCount(0);
  await expect(card.locator("[data-stage-diff]")).toHaveCount(0);
  await reply.click();
  await expect(page.locator("[data-composer-input]")).toHaveValue(/回复会话 thread-xiaomei.*收件: xiaomei\.beauty@xiaomei-beauty\.cn/);
  await expect(workbench).toContainText("已预填回复要求");
  await expect(workbench.getByRole("button", { name: "核对阶段变更 · R3 需确认" })).toBeVisible();
  await workbench.getByRole("button", { name: "核对阶段变更 · R3 需确认" }).click();
  const confirm = page.locator('[data-kind="confirm-stage-card"]');
  await expect(confirm).toBeVisible();
  await expect(confirm).toHaveAttribute("data-risk", "L3");
  await expect(confirm).toContainText("初步接触");
  await expect(confirm.locator("[data-confirm-stage]")).toBeVisible();
  expect(stageWrites).toEqual([]);
  await expect(page.locator("body")).not.toContainText("Starry KOL MCP");
});

test("draft send opens L3 confirm with object/scope/consequence; cancel does not send", async ({ page, request }) => {
  const ses = await request.post("/api/collaborations/col_xiaomei/session").then((r) => r.json() as Promise<{ id: string }>);
  await page.goto(`/s/${ses.id}`);
  // The server-generated email-card snapshot is read through its current draft-action query.
  await stubDraftActionSnapshot(page, "draft_xiaomei");
  await page.locator("[data-composer-input]").fill("写跟进邮件 @小美妆日记");
  await page.locator("[data-send]").click();
  await expect(page.locator("[data-admin-confirm='draft-send']")).toHaveCount(0);
  await expect(page.locator("[data-workbench] .side-body [data-kind='email-card']")).toBeVisible({ timeout: 20000 });
  const sendPosts: string[] = [];
  page.on("request", (req) => {
    if (req.method() === "POST" && /\/api\/actions\/mail\.send$/.test(new URL(req.url()).pathname)) {
      sendPosts.push(req.url());
    }
  });
  await page.locator('[data-workbench] .side-body [data-email-action="send"]').click();
  const dialog = page.locator("[data-admin-confirm='draft-send']");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("data-risk", "L3");
  await expect(dialog.locator("[data-admin-confirm-object]")).not.toHaveText("");
  await expect(dialog.locator("[data-admin-confirm-scope]")).toContainText("外发");
  await expect(dialog.locator("[data-admin-confirm-consequence]")).toContainText("发送不会推进正式阶段");
  await expect(dialog.locator("[data-admin-confirm-ok]")).toHaveText("确认发送");
  await saveScreenshot(page, "chat_l3_draft_send_confirm.png");
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
  await page.route("**/api/actions/mail.send", async (route) => {
    sent = true;
    await route.fulfill({ json: { ok: true } });
  });
  await stubDraftActionSnapshot(page, "draft_json");
  await page.goto("/s/result-send");
  const sendBtn = page.locator("[data-workbench] .side-body [data-result-draft] [data-email-action='send']");
  await expect(sendBtn).toHaveText("确认发送");
  await sendBtn.click();
  const dialog = page.locator("[data-admin-confirm='draft-send']");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("[data-admin-confirm-object]")).toContainText("brand@litime.com");
  await expect(dialog.locator("[data-admin-confirm-object]")).toContainText("kol@example.com");
  await expect(dialog.locator("[data-admin-confirm-consequence]")).toContainText("发送不会推进正式阶段");
  await saveScreenshot(page, "chat_l3_result_draft_send_confirm.png");
  expect(sent).toBe(false);
  await page.locator("[data-admin-confirm-ok]").click();
  await expect.poll(() => sent).toBe(true);
});

test("KolMailCard treats auto_advanced as a suggestion, not a written stage", async ({ page }) => {
  const sessionId = "auto-adv";
  const now = new Date().toISOString();
  const stageWrites: string[] = [];
  page.on("request", request => {
    if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/confirm-stage")) stageWrites.push(request.url());
  });
  await stubMailDecisionSession(page, sessionId, {
    id: sessionId,
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
        session_id: sessionId,
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
          judgment: { suggested_stage: "SHIPPED", suggested_label: "已发货", reason: "物流运单", evidence: [{ source: "body", snippet: "Tracking number" }] },
        },
      },
      {
        id: "stage",
        session_id: sessionId,
        role: "assistant",
        kind: "confirm_stage_card",
        created_at: now,
        payload: {
          current_stage: "SAMPLE_PENDING",
          current_label: "待寄样",
          proposed_stage: "SHIPPED",
          expected_version: 9,
          targets: [{ code: "SHIPPED", label: "已发货", track: "main" }],
        },
      },
    ],
  });
  await page.goto(`/s/${sessionId}`);
  // Native sessions keep mail evidence and its derived suggestion in the result rail;
  // the center stream keeps only a concise, non-actionable pointer.
  const mailWorkbench = page.locator("[data-mail-decision-workbench]");
  await expect(mailWorkbench).toBeVisible();
  const mail = mailWorkbench.locator("[data-kind='kol-mail-card']");
  await expect(mail).toBeVisible();
  await expect(mail).not.toContainText("已按事实进入");
  await expect(page.locator("[data-session-stream-pane] [data-kind='kol-mail-card']")).toHaveCount(0);
  await expect(mailWorkbench.locator("[data-stage-suggestion] [data-mail-current-stage]")).toContainText("当前 待寄样");
  await expect(mailWorkbench.locator("[data-stage-suggestion] [data-mail-current-stage]")).toContainText("建议 已发货");
  await expect(mailWorkbench.locator("[data-stage-suggestion] [data-mail-current-stage]")).not.toContainText("当前 已发货");
  await expect(mailWorkbench.locator("[data-stage-suggestion] [data-mail-suggest][data-auto-advanced='suggest']")).toContainText("阶段确认卡");
  await expect(mail).not.toContainText("已按事实进入");
  await expect(mail.locator("[data-mail-confirm]")).toHaveCount(0);
  await expect(mail.locator("[data-mail-stage-select]")).toHaveCount(0);
  // The L3 stage control is deliberately in a closed result-rail details panel;
  // open its normal summary rather than exposing or invoking any stage action.
  const confirmationDetails = page.locator("details.mail-stage-review").filter({ hasText: "正式阶段变更 · 独立确认" });
  await expect(confirmationDetails).toHaveCount(1);
  await expect(confirmationDetails).not.toHaveAttribute("open", "");
  await confirmationDetails.locator("summary").click();
  await expect(confirmationDetails).toHaveAttribute("open", "");
  const confirm = confirmationDetails.locator("[data-kind='confirm-stage-card']");
  await expect(confirm).toBeVisible();
  await expect(confirm).toHaveAttribute("data-risk", "L3");
  await expect(confirm.locator("[data-confirm-stage]")).toBeVisible();
  expect(stageWrites).toEqual([]);
  await saveScreenshot(page, "chat_auto_advanced_as_suggestion.png");
});
