import { expect, test, type Page } from "@playwright/test";
import { stubHomeFollowing } from "./kol-surface-stub";

const LOCAL_TEST_ACCOUNT = { id: "mail-e2e", name: "邮件测试员工", available_modes: ["business"] };

// The :8894 service deliberately serves only the freshly built SPA. Keep only
// its bootstrap/auth responses local; per-test mail routes are registered
// later and therefore override these routes. Do not add a generic /api/**
// success route: a missing mail fixture must remain observable.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/health", route => route.fulfill({ json: { ok: true } }));
  await page.route("**/api/auth/status", route => route.fulfill({ json: { authenticated: true, account: LOCAL_TEST_ACCOUNT } }));
  await page.route("**/api/me", route => route.fulfill({ json: LOCAL_TEST_ACCOUNT }));
  await page.route("**/api/preferences", route => route.fulfill({ json: {} }));
});

const BOARD = {
  mail: { unread: 1, conversations: 2 },
  follow_scope: {
    bound: true,
    mailbox_email: "larry.zhao@amperetime.com",
    owner_name: "钟槿年",
    status: "connected",
    updated_at: "2026-09-18T01:00:00.000Z",
  },
  kols: [
    {
      id: "col_xiaomei",
      handle: "小美妆日记",
      kol_uid: "KOL_X",
      brand: "LT",
      stage_code: "INITIAL_CONTACT",
      stage_label: "初步接触",
      mail_threads: [{
        conversation_id: "3901",
        subject: "Re: LiTime collab",
        unread_count: 1,
        last_direction: "inbound",
        last_from: "amy@example.com",
        last_from_name: "Amy",
        last_snippet: "你好，想和贵品牌litime合作",
        last_at: "2026-09-12T10:00:00.000Z",
      }],
    },
    {
      id: "col_new",
      handle: "新达人",
      unbound: true,
      mail_threads: [{
        conversation_id: "u-9",
        subject: "Intro",
        unread_count: 0,
        last_direction: "inbound",
        last_from: "new@example.com",
        last_snippet: "还没有档案",
        last_at: "2026-09-11T10:00:00.000Z",
      }],
    },
  ],
  tasks: [],
  tabs: [],
};

async function mockMailMissing(page: Page) {
  await page.route(/\/api\/(?:queries\/mail\.|actions\/mail\.|skills\/mail_|jobs\/mail\.sync\/start)/, async (route) => {
    await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ detail: "not found" }) });
  });
  await page.route("**/api/me/starry-binding", async (route) => {
    await route.fulfill({
      json: {
        bound: true,
        mailbox_email: "larry.zhao@amperetime.com",
        owner_name: "钟槿年",
        status: "connected",
        updated_at: "2026-09-18T01:00:00.000Z",
      },
    });
  });
  await page.route("**/api/home/board**", async (route) => {
    await route.fulfill({ json: BOARD });
  });
  // 演示夹具把合作落在 board 上、不进 B.index，跟进面板用同一份数据补上：
  // 否则「查看互动」只能靠上一次 e2e 留下的 kol_follow_index 记录才通过。
  await stubHomeFollowing(page, BOARD.kols);
}

function sessionPostsOf(page: Page): string[] {
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/api\/(sessions|tasks\/from-text|collaborations\/[^/]+\/session)/.test(request.url())) {
      posts.push(request.url());
    }
  });
  return posts;
}


async function chooseMailTask(page: Page, intent: "mail_summary" | "mail_translate" | "email_compose" | "reply_analysis") {
  const menu = page.locator("details[data-composer-task-menu]");
  await expect(menu).toHaveCount(1);
  await expect(menu.locator("summary")).toHaveText(/选择邮件任务/);
  await menu.locator("summary").click();
  const task = menu.locator(`[data-ai-next="${intent}"]`);
  await expect(task).toBeVisible();
  await task.click();
  return page.locator("[data-composer-input]");
}

async function openLabelPicker(page: Page) {
  const picker = page.locator("details.mail-label-picker");
  await expect(picker).toHaveCount(1);
  const trigger = picker.locator("summary[data-mail-label-picker]");
  await expect(trigger).toBeVisible();
  await trigger.click();
  await expect(page.locator("[data-mail-label-search]")).toBeVisible();
  return picker;
}

async function selectExistingLabel(page: Page, id: string) {
  await page.locator(`[data-mail-label-option="${id}"]`).click();
  await expect(page.locator("[data-mail-label-confirm]")).toBeVisible();
}

test("sidebar 通讯 sits under 定时任务 and /mail uses board fallback", async ({ page }) => {
  const sessionPosts = sessionPostsOf(page);
  await mockMailMissing(page);
  await page.goto("/");
  const today = page.locator('nav[aria-label="今日"]');
  await expect(today.locator('[data-nav="cron"]')).toBeVisible();
  await expect(today.locator('[data-nav="mail"]')).toBeVisible();
  await expect(today.locator('[data-nav="mail"]')).toHaveAttribute("href", "/mail");
  const cronBox = await today.locator('[data-nav="cron"]').boundingBox();
  const mailBox = await today.locator('[data-nav="mail"]').boundingBox();
  expect(cronBox && mailBox && mailBox.y > cronBox.y).toBeTruthy();
  await expect(today.locator('[data-nav="mail"] .nav-badge')).toHaveCount(0);
  await page.locator('[data-nav="mail"]').click();
  await expect(page).toHaveURL(/\/mail/);
  await expect(page.locator("[data-mail-page]")).toBeVisible();
  await expect(page.locator("[data-mail-page]")).toHaveAttribute("data-mail-source", "fallback");
  await expect(page.locator("[data-mail-fallback]")).toBeVisible();

  // 邮箱地址在切换器，同步和未读分别由真实状态区展示。
  await expect(page.locator("[data-mail-box-current]")).toContainText("larry.zhao@amperetime.com");
  await expect(page.locator("[data-mail-box]")).toContainText("同步");
  await expect(page.getByRole("tab", { name: /未读/ })).toContainText("1");
  await expect(page.locator("[data-mail-box]")).not.toContainText("钟槿年");

  // L1 = 对方邮箱 + 主题数；L2 = 主题 + 邮件数（预览文本已不再进列表）。
  const peer = page.locator('[data-mail-correspondent="amy@example.com"]');
  await expect(peer).toContainText("amy@example.com");
  await expect(peer).toContainText("1 个主题");
  await peer.click();
  const threadRow = page.locator('[data-mail-thread-row="3901"]');
  await expect(threadRow).toContainText("Re: LiTime collab");
  await expect(threadRow).not.toContainText("想和贵品牌");
  await page.locator('[data-mail-correspondent="new@example.com"]').click();
  await expect(page.locator('[data-mail-thread-row="u-9"]')).toHaveAttribute("data-mail-match-state", "unbound");
  await expect(page.locator('[data-mail-thread-row="u-9"] [data-mail-unbound-chip]')).toHaveText("未建档");
  await expect(page.locator("[data-mail-page]")).not.toContainText("下一步");
  await expect(page.locator("[data-mail-page]")).not.toContainText("历史邮件往来摘要");
  await page.locator("[data-mi-search]").fill("zzzz-没有这封邮件");
  await expect(page.locator("[data-mail-empty-list]")).toHaveText("没有匹配的会话。");
  expect(sessionPosts).toEqual([]);
});

test("opening a fallback thread and 收取 404 do not create sessions", async ({ page }) => {
  const sessionPosts = sessionPostsOf(page);
  await mockMailMissing(page);
  await page.goto("/mail?box=larry.zhao@amperetime.com&c=3901");
  // 深链自动展开 L1/L2 并把最新一封补成 ?m=，左栏那一行是选中的。
  await expect(page.locator("[data-mail-thread]")).toContainText("Re: LiTime collab");
  await expect(page).toHaveURL(/m=preview-3901/);
  await expect(page.locator("[data-mail-timeline-item][data-mail-selected='true']")).toHaveCount(1);
  await expect(page.locator("[data-mail-body]")).toHaveCount(1);
  await expect(page.locator("[data-mail-body]")).not.toHaveAttribute("open", /.*/);
  await expect(page.locator("[data-mail-summary-card]")).toContainText("尚未生成摘要。可在提问框请求生成；收取邮件不会自动生成摘要。");
  await expect(page.locator("[data-mail-translation]")).toContainText("暂无中文译稿。");
  await page.locator("[data-mail-sync]").click();
  await expect(page.locator("[data-mail-error]")).toContainText("暂时无法收取");
  await expect(page.locator("[data-mail-error]")).toContainText("没有创建会话");
  expect(sessionPosts).toEqual([]);
});

test("未建档会话的任务建议只预填，绝不走已删除的分析入队接口", async ({ page }) => {
  await mockMailMissing(page);
  let legacyEnqueue = 0;
  await page.route("**/api/home/kol-analyze/enqueue", async (route) => {
    legacyEnqueue += 1;
    await route.fulfill({ status: 500, json: { detail: "legacy enqueue must not be called" } });
  });
  await page.goto("/mail?box=larry.zhao@amperetime.com&c=u-9");
  const input = await chooseMailTask(page, "reply_analysis");
  await expect(input).toHaveValue(/分析当前会话/);
  await expect(page).toHaveURL(/\/mail\?/);
  expect(legacyEnqueue).toBe(0);
});

const FORMAL_BOX = {
  entry: "memory",
  kind: "memory",
  creates_session: false,
  creates_turn: false,
  calls_model: false,
  mailbox: "larry.zhao@amperetime.com",
  bound: true,
  unread: 2,
  synced_at: "2026-09-18T01:00:00.000Z",
  error: null,
  last_tool: "pageEmailConversations",
  cursor_at: "2026-09-18T01:00:00.000Z",
  cursor_id: "3901",
};

const FORMAL_CONVERSATION = {
  id: "thr_1",
  mailbox: "larry.zhao@amperetime.com",
  conversation_id: "3901",
  collaboration_id: "col_xiaomei",
  match_state: "matched" as const,
  subject: "Re: LiTime collab",
  peer_email: "amy@example.com",
  peer_name: "Amy",
  last_at: "2026-09-12T10:00:00.000Z",
  last_direction: "inbound",
  last_preview: "想和贵品牌合作",
  unread_count: 1,
  message_count: 2,
  last_receipt: "",
  digest_source: "codex_memory",
  digest_text: "对方已确认档期",
  // The real GET /api/queries/mail.conversations LEFT JOINs collaborations and returns these.
  kol_uid: "KOL_X",
  handle: "小美妆日记",
  stage_code: "QUOTE_PENDING",
};

const FORMAL_THREAD = {
  entry: "memory",
  kind: "memory",
  creates_session: false,
  creates_turn: false,
  calls_model: false,
  conversation: FORMAL_CONVERSATION,
  messages: [
    {
      id: "m2",
      conversation_id: "3901",
      provider_message_id: "mid-2",
      direction: "inbound",
      occurred_at: "2026-09-12T10:00:00.000Z",
      from_addr: "amy@example.com",
      to_addr: "larry.zhao@amperetime.com",
      subject: "Re: LiTime collab",
      title: "达人确认合作意向",
      snippet: "想和贵品牌合作",
      body_text: "Hello\n想和贵品牌litime合作",
      letter_summary: "想和贵品牌合作",
      summary_source: "body_analysis",
      unread: true,
      translation_zh: "你好，想和贵品牌 LiTime 合作。",
      receipt_status: "",
      effective: true,
    },
    {
      id: "m1",
      conversation_id: "3901",
      provider_message_id: "mid-1",
      direction: "outbound",
      occurred_at: "2026-09-10T09:00:00.000Z",
      from_addr: "larry.zhao@amperetime.com",
      to_addr: "amy@example.com",
      subject: "LiTime collab",
      snippet: "Thanks for reaching out",
      body_text: "Thanks for reaching out.",
      letter_summary: "",
      summary_source: "",
      unread: false,
      translation_zh: "感谢联系。",
      receipt_status: "",
      effective: true,
    },
  ],
  digest_text: "对方已确认档期",
  digest_source: "codex_memory",
};

const PERSON_DIGEST = {
  entry: "memory",
  creates_session: false,
  mailbox: "larry.zhao@amperetime.com",
  peer_email: "amy@example.com",
  digest_text: "与 Amy 的往来集中在 LiTime 合作",
  digest_source: "codex_memory",
  digest_generated_at: "2026-09-18T01:00:00.000Z",
};

async function mockFormalMail(page: Page, person: Record<string, unknown> = PERSON_DIGEST) {
  await page.route("**/api/queries/mail.labels**", route => route.fulfill({ json: {
    mailbox: FORMAL_BOX.mailbox, labels: [], assignments: [], selected_label_ids: [], version: 0,
    entry: "memory", creates_session: false, creates_turn: false, calls_model: false,
  } }));
  await page.route("**/api/queries/mail.box**", async (route) => {
    await route.fulfill({ json: FORMAL_BOX });
  });
  // Query-safe: the list URL gains ?box= as soon as a mailbox is switched.
  await page.route("**/api/queries/mail.conversations**", async (route) => {

    await route.fulfill({
      json: {
        entry: "memory",
        creates_session: false,
        mailbox: "larry.zhao@amperetime.com",
        conversations: [FORMAL_CONVERSATION],
      },
    });
  });
  await page.route("**/api/queries/mail.conversation?**", async (route) => {
    await route.fulfill({ json: FORMAL_THREAD });
  });
  await page.route("**/api/queries/mail.person**", async (route) => {
    await route.fulfill({ json: person });
  });
  await page.route("**/api/home/board**", async (route) => {
    await route.fulfill({ json: BOARD });
  });
}

test("returned 往来要点 when GET /api/mail is the primary path", async ({ page }) => {
  await mockFormalMail(page);
  await page.goto("/mail?c=3901");
  await expect(page.locator("[data-mail-page]")).toHaveAttribute("data-mail-source", "api");
  await expect(page.locator("[data-nav='mail'] [data-mail-unread-badge]")).toHaveText("2");
  await expect(page.locator("[data-mail-digest] [data-digest-label]")).toHaveText("往来要点");
  await expect(page.locator("[data-mail-page]")).not.toContainText("历史邮件往来摘要");
  await expect(page.locator("[data-mail-digest] [data-digest-body]")).toContainText("与 Amy 的往来集中在 LiTime 合作");
});

test("通讯阶段变更先经唯一 composer 选择任务，再提交显式合作与阶段绑定", async ({ page }) => {
  await mockFormalMail(page);
  await page.route("**/api/queries/mail.collaboration-stage?**", (route) => route.fulfill({
    json: {
      collaboration_id: "col_xiaomei", found: true, handle: "小美妆日记",
      stage_code: "QUOTE_PENDING", stage_label: "报价待确认",
    },
  }));
  await page.route("**/api/tasks/from-text", (route) => {
    return route.fulfill({ json: { task: { id: "tsk_mail_stage", task_type: "confirm_stage" }, needs_clarification: false } });
  });
  await page.route("**/api/tasks/tsk_mail_stage/run", (route) => route.fulfill({
    status: 202, json: { task: { id: "tsk_mail_stage" }, session_id: "ses_mail_stage" },
  }));
  await page.goto("/mail?c=3901");
  await expect(page.locator("[data-mail-stage-current]")).toHaveText("当前阶段：报价待确认");
  await chooseMailTask(page, "email_compose");
  await page.locator("[data-composer-input]").fill("已有的其它草稿");
  const reading = await page.locator("[data-mail-reading-pane] aside").boundingBox();
  const composer = await page.locator("[data-mi-aibar]").boundingBox();
  expect(reading && composer && reading.y + reading.height <= composer.y).toBeTruthy();
  await page.locator("[data-mail-stage-kol]").click();
  await expect(page.locator("[data-composer-input]")).toHaveValue("提出阶段变更 @小美妆日记 到 [目标阶段]");
  await expect(page.locator('[data-skill-chip="confirm_stage"]')).toBeVisible();
  await page.locator("[data-mail-stage-target]").selectOption("NEGOTIATING");
  await expect(page.locator("[data-composer-input]")).toHaveValue("提出阶段变更 @小美妆日记 到 商务谈判");
  const submitted = page.waitForRequest((request) => request.method() === "POST" && request.url().endsWith("/api/tasks/from-text"));
  await page.locator("[data-send]").click();
  const intake = (await submitted).postDataJSON();
  expect(intake).toMatchObject({
    collaboration_id: "col_xiaomei",
    entities: { mailbox: FORMAL_BOX.mailbox, conversation_id: "3901", handle: "小美妆日记", stage_code: "NEGOTIATING", proposed_stage: "NEGOTIATING" },
  });
  expect(intake.scope).toMatchObject({ intent: "free" });
  await expect(page).toHaveURL(/\/s\/ses_mail_stage/);
});

test("POST /api/jobs/mail.sync/start uses SyncReceipt and does not create sessions", async ({ page }) => {
  const sessionPosts = sessionPostsOf(page);
  await mockFormalMail(page);
  await page.route("**/api/jobs/mail_sync_test", (route) => route.fulfill({ json: { job: { id: "mail_sync_test", status: "queued" } } }));
  await page.route("**/api/jobs/mail.sync/start", async (route) => {
    await route.fulfill({
      json: {
        job: { id: "mail_sync_test", status: "queued" },
        entry: "command",
        kind: "command",
        creates_session: false,
        ok: true,
        mailbox: "larry.zhao@amperetime.com",
        listed: 3,
        inserted: 1,
        updated: 2,
        unread: 2,
        synced_at: "2026-09-18T02:00:00.000Z",
        cursor_at: "2026-09-18T02:00:00.000Z",
      },
    });
  });
  await page.goto("/mail");
  await page.locator("[data-mail-sync]").click();
  await expect(page.locator("[data-mail-notice]")).toContainText("正在排队");
  expect(sessionPosts).toEqual([]);
});

test("邮件任务建议只预填；发送统一经过 intake/run 且保留邮件 scope", async ({ page }) => {
  await mockFormalMail(page);
  const legacyEnqueue: string[] = [];
  await page.route("**/api/home/kol-analyze/enqueue", (route) => {
    legacyEnqueue.push(route.request().url());
    return route.fulfill({ status: 500, json: { detail: "removed route" } });
  });
  let body: Record<string, unknown> | undefined;
  await page.route("**/api/tasks/from-text", (route) => {
    body = route.request().postDataJSON();
    return route.fulfill({ json: { task: { id: "tsk_analysis", title: "会话分析", task_type: "reply_analysis" } } });
  });
  await page.route("**/api/tasks/tsk_analysis/run", (route) => route.fulfill({ status: 202, json: { session_id: "ses_analysis" } }));
  await page.goto("/mail?c=3901");
  const input = await chooseMailTask(page, "reply_analysis");
  await expect(input).toHaveValue(/分析当前会话/);
  expect(body).toBeUndefined();
  expect(legacyEnqueue).toEqual([]);
  await input.fill("请分析本次合作的风险");
  await page.locator("[data-send]").click();
  await expect(page).toHaveURL(/\/s\/ses_analysis/);
  expect(body).toMatchObject({
    intent: "reply_analysis",
    entities: { mailbox: FORMAL_BOX.mailbox, conversation_id: "3901", message_id: "m2", mail_context_complete: true },
    scope: { skills: ["reply_analysis"], intent: "free" },
  });
  expect(legacyEnqueue).toEqual([]);
});

test("L3 uses each message title instead of the L2 conversation subject", async ({ page }) => {
  await mockFormalMail(page);
  await page.goto("/mail?c=3901");

  await expect(page.locator('[data-mail-timeline-item="m2"] [data-mail-timeline-title]')).toHaveText("达人确认合作意向");
  await expect(page.locator('[data-mail-timeline-item="m2"] [data-mail-timeline-title]')).not.toHaveText("Re: LiTime collab");
  // When the provider omits a message title, show its factual body preview
  // instead of a dash or duplicating the conversation subject.
  await expect(page.locator('[data-mail-timeline-item="m1"] [data-mail-timeline-title]')).toHaveText(/无标题 ·/);
});

test("context chips insert at the saved selection and × only dismisses that chip", async ({ page }) => {
  await mockFormalMail(page);
  await page.goto("/mail?c=3901");
  if (await page.locator("[data-mail-fold-head='original']").getAttribute("aria-expanded") === "false") await page.locator("[data-mail-fold-head='original']").click();
  await expect(page.getByRole("button", { name: "更多会话操作" })).toHaveCount(0);
  await page.locator("[data-mail-reply]").click();

  const input = page.locator("[data-composer-input]");
  await input.fill("alpha omega");
  await input.evaluate((node) => {
    const textarea = node as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(6, 11);
    textarea.dispatchEvent(new Event("select", { bubbles: true }));
  });
  await page.locator('[data-composer-chip-insert="subject"]').click();
  const expectedText = "alpha 邮件：Re: LiTime collab";
  await expect(input).toHaveValue(expectedText);
  await expect.poll(() => input.evaluate((node) => ({
    start: (node as HTMLTextAreaElement).selectionStart,
    end: (node as HTMLTextAreaElement).selectionEnd,
  }))).toEqual({ start: expectedText.length, end: expectedText.length });

  await page.locator('[data-composer-draft-chip="subject"] .chip-x').click();
  await expect(page.locator('[data-composer-draft-chip="subject"]')).toHaveCount(0);
  await expect(input).toHaveValue(expectedText);
});

test("邮件任务菜单包含五项固定建议与推荐标签，点选只预填不直接执行", async ({ page }) => {
  await mockFormalMail(page);
  const fromText: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/api/tasks/from-text")) fromText.push(request.url()); });
  await page.goto("/mail?c=3901");
  const menu = page.locator("details[data-composer-task-menu]");
  await expect(menu.locator("summary")).toHaveText(/选择邮件任务/);
  await menu.locator("summary").click();
  await expect(menu.locator("[data-ai-next]")).toHaveCount(5);
  for (const intent of ["mail_summary", "mail_translate", "email_compose", "reply_analysis", "mail_label_recommend"]) await expect(menu.locator(`[data-ai-next="${intent}"]`)).toBeVisible();
  await menu.locator('[data-ai-next="email_compose"]').click();
  await expect(page.locator("[data-composer-input]")).toHaveValue(/起草回复/);
  await expect(page.locator('[data-skill-chip="email_compose"]')).toBeVisible();
  expect(fromText).toEqual([]);
});

test("compose catalog 暂不可用时，固定任务菜单仍完整且邮件页不崩溃", async ({ page }) => {
  await mockFormalMail(page);
  let catalogRequests = 0;
  await page.route("**/api/queries/mail.compose-catalog**", async (route) => {
    catalogRequests += 1;
    await route.fulfill({ status: 500, json: { detail: "obsolete endpoint" } });
  });
  await page.goto("/mail?c=3901");
  await expect(page.locator("[data-mail-state='ok']")).toBeVisible();
  const menu = page.locator("details[data-composer-task-menu]");
  await menu.locator("summary").click();
  await expect(menu.locator("[data-ai-next]")).toHaveCount(5);
  expect(catalogRequests).toBe(1);
  await expect(page.locator("[data-mail-page]")).not.toContainText("无法读取");
});

test("选择邮件任务后，composer 统一提交 intake/run 并进入原任务深链", async ({ page }) => {
  await mockFormalMail(page);
  let intake: Record<string, unknown> | undefined;
  await page.route("**/api/tasks/from-text", async (route) => {
    intake = route.request().postDataJSON();
    await route.fulfill({ json: { task: { id: "tsk_9", title: "写合作邮件", task_type: "email_compose" }, needs_clarification: false } });
  });
  await page.route("**/api/tasks/tsk_9/run", async (route) => {
    await route.fulfill({ json: { task: { id: "tsk_9" }, session_id: "ses_9" } });
  });
  await page.goto("/mail?c=3901");
  const input = await chooseMailTask(page, "email_compose");
  await input.fill("写合作邮件");
  await page.locator("[data-send]").click();
  expect(intake).toMatchObject({ intent: "email_compose", scope: { skills: ["email_compose"], intent: "free" }, entities: { mailbox: FORMAL_BOX.mailbox, conversation_id: "3901" } });
  await expect(page).toHaveURL(/\/s\/ses_9/);
  await expect(page).not.toHaveURL(/^.*\/$/);
});

test("统一 intake 失败时，单一 composer 保留已上传附件以便重试", async ({ page }) => {
  await mockFormalMail(page);
  let intake: Record<string, unknown> | undefined;
  await page.route("**/api/attachments", (route) => route.fulfill({
    json: { id: "att_quote", name: "报价.pdf", path: "/attachments/att_quote.pdf", size: 4, type: "application/pdf" },
  }));
  await page.route("**/api/tasks/from-text", (route) => {
    intake = route.request().postDataJSON();
    return route.fulfill({ status: 500, json: { detail: "intake temporarily unavailable" } });
  });
  await page.goto("/mail?c=3901");
  const input = await chooseMailTask(page, "email_compose");
  await page.locator("[data-attach-input]").setInputFiles({
    name: "报价.pdf", mimeType: "application/pdf", buffer: Buffer.from("test"),
  });
  const attachment = page.locator('[data-composer-chip="attachment"][data-attachment-name="报价.pdf"]');
  await expect(attachment).toBeVisible();
  await input.fill("请基于附件起草合作回复");
  await page.locator("[data-send]").click();
  await expect(page.locator("[data-mail-error]")).toBeVisible();
  expect(intake).toMatchObject({
    intent: "email_compose",
    attachments: [{ id: "att_quote", name: "报价.pdf", path: "/attachments/att_quote.pdf" }],
  });
  await expect(attachment).toBeVisible();
  await expect(page.locator("[data-composer-input]")).toHaveValue("请基于附件起草合作回复");
});

test("unbound mailbox guides to Starry settings", async ({ page }) => {
  await page.route(/\/api\/(?:queries\/mail\.|actions\/mail\.|skills\/mail_|jobs\/mail\.sync\/start)/, async (route) => {
    await route.fulfill({ status: 404, json: { detail: "not found" } });
  });
  await page.route("**/api/me/starry-binding", async (route) => {
    await route.fulfill({ json: { bound: false, status: "unbound" } });
  });
  await page.route("**/api/home/board**", async (route) => {
    await route.fulfill({ json: { kols: [], follow_scope: { bound: false, status: "unbound" } } });
  });
  await page.goto("/mail");
  await expect(page.locator("[data-mail-unbound-guide]")).toBeVisible();
  await expect(page.locator("[data-mail-state='unbound']")).toBeVisible();
  await expect(page.locator("[data-mail-bind]")).toHaveAttribute("href", "/settings?tab=starry");
});

test("followed 查看互动 opens /mail and never /s/:id first", async ({ page }) => {
  await mockMailMissing(page);
  await page.goto("/");
  await page.locator('[data-home-mode="lifecycle"]').click();
  await expect(page.locator('[data-followed-kol="小美妆日记"] [data-open-original-mail]')).toBeVisible();
  await page.locator('[data-followed-kol="小美妆日记"] [data-open-original-mail]').click();
  await expect(page).toHaveURL(/\/mail\?/);
  await expect(page).toHaveURL(/c=3901/);
  await expect(page).not.toHaveURL(/\/s\//);
  await expect(page.locator("[data-mail-page]")).toBeVisible();
});

test("展开 L1 自动选中最新往来并写入 c/m，摘要和原文直接可读", async ({ page }) => {
  await mockFormalMail(page);
  await page.goto("/mail");
  await expect(page.locator("[data-mail-thread-row='3901']")).toHaveCount(0);
  await expect(page.locator("[data-mail-timeline-item]")).toHaveCount(0);
  await page.locator('[data-mail-correspondent="amy@example.com"]').click();
  await expect(page.locator('[data-mail-thread-row="3901"]')).toBeVisible();
  await expect(page).toHaveURL(/[?&]c=3901/);
  await expect(page).toHaveURL(/[?&]m=m2/);
  await expect(page.locator('[data-mail-timeline-item="m2"]')).toHaveAttribute("data-mail-selected", "true");
  await expect(page.locator("[data-mail-reading-pane] [data-mail-content]")).toBeVisible();
  await expect(page.locator("[data-mail-fold-head='summary']")).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("[data-mail-fold-head='original']")).toHaveAttribute("aria-expanded", "true");
});

test("selecting another mail switches content and translation", async ({ page }) => {
  await mockFormalMail(page);
  await page.goto("/mail?c=3901");
  await expect(page.locator("[data-mail-timeline-item]")).toHaveCount(2);
  // 深链「选中最新一封」：?m= 被补上，最新那行是唯一被选中的。
  await expect(page).toHaveURL(/m=m2/);
  await expect(page.locator("[data-mail-timeline-item][data-mail-selected='true']")).toHaveCount(1);
  await expect(page.locator('[data-mail-timeline-item="m2"]')).toHaveAttribute("data-mail-selected", "true");

  await expect(page.locator("[data-mail-content]")).toHaveCount(1);
  const firstId = await page.locator("[data-mail-content]").getAttribute("data-mail-content-id");
  expect(firstId).toBe("m2");

  await page.locator("[data-mail-timeline-item]").nth(1).click();
  await expect(page).toHaveURL(/m=m1/);
  await expect(page.locator("[data-mail-content]")).toHaveCount(1);
  await expect(page.locator("[data-mail-content]")).not.toHaveAttribute("data-mail-content-id", firstId || "");
  await expect(page.locator("[data-mail-content-id='m1']")).toBeVisible();
  await expect(page.locator("[data-mail-translation]")).toHaveAttribute("data-mail-translation-for", "m1");
  await expect(page.locator("[data-mail-translation]")).toContainText("感谢联系。");
});

test("右栏三个折叠可按，点邮件自动展开原文", async ({ page }) => {
  await mockFormalMail(page);
  await page.goto("/mail?c=3901");
  const heads = page.locator("[data-mail-fold-head]");
  await expect(heads).toHaveCount(3);
  await expect(page.locator("[data-mail-fold='summary']")).toContainText("往来摘要");
  await expect(page.locator("[data-mail-fold='translation']")).toContainText("中文翻译");
  await expect(page.locator("[data-mail-fold='original']")).toContainText("原文");
  await expect(page.locator("[data-mail-summary-card]")).toHaveAttribute("data-summary-source", "codex_memory");
  await expect(page.locator("[data-digest-label]")).toHaveText("往来要点");

  // D7 默认翻译/原文收起，先显式展开，再验证可折叠。
  await expect(page.locator("[data-mail-fold-head='translation']")).toHaveAttribute("aria-expanded", "false");
  await page.locator("[data-mail-fold-head='translation']").click();
  await expect(page.locator("[data-mail-translation]")).toBeVisible();
  await page.locator("[data-mail-fold-head='translation']").click();
  await expect(page.locator("[data-mail-fold-head='translation']")).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("[data-mail-translation]")).toBeHidden();
  await page.locator("[data-mail-fold-head='translation']").click();
  await expect(page.locator("[data-mail-translation]")).toBeVisible();

  // 已批准的直接阅读默认展开原文；折叠仍必须可用。
  await expect(page.locator("[data-mail-fold-head='original']")).toHaveAttribute("aria-expanded", "true");
  await page.locator("[data-mail-fold-head='original']").click();
  await expect(page.locator("[data-mail-content]")).toBeHidden();

  // 点 L3 把原文重新展开并展示这一封。
  await page.locator("[data-mail-timeline-item]").first().click();
  await expect(page.locator("[data-mail-fold-head='original']")).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("[data-mail-content]")).toBeVisible();
});

const TWO_BOXES = {
  ...FORMAL_BOX,
  bindings: [
    { mailbox: "larry.zhao@amperetime.com", label: "美国邮箱", owner_name: "赵良玉", unread: 12, bound: true, synced_at: FORMAL_BOX.synced_at, error: null },
    { mailbox: "eu@litime.com", label: "欧洲邮箱", owner_name: "李四", unread: 3, bound: true, synced_at: FORMAL_BOX.synced_at, error: null },
  ],
};

test("the mailbox switcher shows only the current mailbox until opened", async ({ page }) => {
  await page.route("**/api/queries/mail.box**", (route) => route.fulfill({ json: TWO_BOXES }));
  await page.route("**/api/queries/mail.conversations**", (route) => route.fulfill({ json: { conversations: [] } }));
  await page.route("**/api/home/board**", (route) => route.fulfill({ json: BOARD }));
  await page.goto("/mail");

  // 收起态只有完整地址一次：不带 label，也不带人名。
  await expect(page.locator("[data-mail-box-current]")).toContainText("larry.zhao@amperetime.com");
  await expect(page.locator("[data-mail-box-current]")).not.toContainText("美国邮箱");
  await expect(page.locator("[data-mail-box-current]")).not.toContainText("赵良玉");
  await expect(page.locator("[data-mail-box-option]")).toHaveCount(0);
  await expect(page.locator("[data-mail-empty-list]")).toContainText("这只邮箱还没有缓存的往来。点「收取」同步。");

  await page.locator("[data-mail-box-current]").click();
  await expect(page.locator("[data-mail-box-option]")).toHaveCount(2);
  await expect(page.locator('[data-mail-box-option="eu@litime.com"]')).toContainText("欧洲邮箱");
});

test("当前邮箱没有绑定行时，切换器仍然报出这个邮箱", async ({ page }) => {
  // 绑定行还没落库（follow scope 先命名了邮箱）时，收起态必须以 current 为准，
  // 不能退回 bindings[0] 的地址，更不能只剩「选择邮箱」。
  await page.route("**/api/queries/mail.box**", (route) => route.fulfill({
    json: {
      ...FORMAL_BOX,
      mailbox: "larry.zhao@amperetime.com",
      bindings: [{ mailbox: "eu@litime.com", label: "欧洲邮箱", unread: 3, bound: true, synced_at: FORMAL_BOX.synced_at, error: null }],
    },
  }));
  await page.route("**/api/queries/mail.conversations**", (route) => route.fulfill({ json: { conversations: [] } }));
  await page.route("**/api/home/board**", (route) => route.fulfill({ json: BOARD }));
  await page.goto("/mail");

  await expect(page.locator("[data-mail-box-current]")).toContainText("larry.zhao@amperetime.com");
  await expect(page.locator("[data-mail-box-current]")).not.toContainText("选择邮箱");
  await expect(page.locator("[data-mail-box-current]")).not.toContainText("eu@litime.com");
});

test("通讯改版在桌面保留三栏、唯一 composer 和原生阅读区", async ({ page }) => {
  await mockFormalMail(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/mail?c=3901");
  await expect(page.locator("[data-mail-immersive]")).toBeVisible();
  await expect(page.locator("[data-mi-back]")).toContainText("返回工作台");
  await expect(page.locator("[data-mi-search]")).toBeVisible();
  await expect(page.locator("[data-mi-compose]")).toBeVisible();
  const rail = await page.locator("[data-mi-rail]").boundingBox();
  const list = await page.locator("[data-mail-list]").boundingBox();
  const side = await page.locator("[data-mail-side]").boundingBox();
  expect(rail && list && side && rail.x < list.x && list.x < side.x).toBeTruthy();
  await expect(page.locator("[data-mi-threadbar]")).toBeVisible();
  await expect(page.locator("[data-mi-aibar]")).toHaveCount(1);
  await expect(page.locator("[data-composer-input]")).toBeVisible();
  await expect(page.locator("[data-mi-aiinput]")).toHaveCount(0);
  await expect(page.locator("[data-mi-dockfloat]")).toHaveCount(0);
  await expect(page.locator("details[data-composer-task-menu]")).toHaveCount(1);
  const scrollModes = await page.locator("[data-mi-rail], [data-mail-list-scroll], [data-mail-side]").evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).overflowY));
  expect(scrollModes).toEqual(["auto", "auto", "auto"]);
});

test("≤1100px 单栏用页级面板切换，选邮件自动进详情", async ({ page }) => {
  await mockFormalMail(page);
  await page.setViewportSize({ width: 900, height: 800 });
  await page.goto("/mail");
  await page.locator('[data-mail-correspondent="amy@example.com"]').click();
  await expect(page.locator("[data-mail-timeline-item]")).toHaveCount(2);

  const switcher = page.locator("[data-mail-panes]");
  await expect(switcher).toBeVisible();
  await expect(switcher.locator("[data-mail-pane]")).toHaveCount(2);
  await expect(page.locator("[data-mail-pane='detail']")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-mail-list]")).toBeHidden();
  await expect(page.locator("[data-mail-side]")).toBeVisible();

  // 展开联系人已经选择最新邮件；仍能切回列表并用主题重新进入详情。
  await page.locator("[data-mail-pane='list']").click();
  await page.locator('[data-mail-thread-row="3901"]').click();
  await expect(page).toHaveURL(/[?&]m=m2/);
  await expect(page.locator("[data-mail-pane='detail']")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-mail-list]")).toBeHidden();
  await expect(page.locator("[data-mail-side]")).toBeVisible();
  await expect(page.locator("[data-mail-content]")).toBeVisible();
  await expect(page.locator("[data-mail-content]")).toHaveCount(1);
  await expect(page.locator("[data-mail-mobiletabs]")).toBeAttached();
  await expect(page.locator("[data-mail-fold-head='summary']")).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("[data-mail-fold-head='original']")).toHaveAttribute("aria-expanded", "true");

  // 更窄一档：详情面板里的 data-mail-mobiletabs 真的可达，点它切折叠。
  await page.setViewportSize({ width: 760, height: 800 });
  await expect(page.locator("[data-mail-side]")).toBeVisible();
  await expect(page.locator("[data-mail-mobiletabs]")).toBeVisible();
  await page.locator("[data-mail-mobiletabs] button", { hasText: "摘要" }).click();
  await expect(page.locator("[data-mail-fold-head='summary']")).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("[data-mail-fold-head='original']")).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("[data-mail-summary-body]")).toBeVisible();

  // 深链点名了一封邮件（?c=&m=）时，窄屏也要落在详情面板：不能只高亮左栏
  // 就把正文藏起来，用户还得再手动点一次「邮件详情」。
  await page.goto("/mail?c=3901&m=m2");
  await expect(page.locator("[data-mail-pane='detail']")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-mail-side]")).toBeVisible();
  await expect(page.locator("[data-mail-list]")).toBeHidden();
  await expect(page.locator("[data-mail-content]")).toBeVisible();
  await expect(page.locator("[data-mail-content]")).toHaveCount(1);
  await expect(page.locator("[data-mail-fold-head='summary']")).toHaveAttribute("aria-expanded", "true");
  // 仍然可以手动切回列表，说明深链只是初始面板，不是锁死。
  await page.locator("[data-mail-pane='list']").click();
  await expect(page.locator("[data-mail-list]")).toBeVisible();
  await expect(page.locator("[data-mail-side]")).toBeHidden();
});

test("停止 intake 只停本页等待，并说明已提交的统一任务仍在服务器执行", async ({ page }) => {
  await mockFormalMail(page);
  const gate: { release?: () => void } = {};
  const held = new Promise<void>((resolve) => { gate.release = resolve; });
  const runPosts: string[] = [];
  page.on("request", (request) => { if (request.method() === "POST" && /\/api\/tasks\/[^/]+\/run$/.test(new URL(request.url()).pathname)) runPosts.push(new URL(request.url()).pathname); });
  await page.route("**/api/tasks/from-text", async (route) => {
    await held;
    await route.fulfill({ json: { task: { id: "tsk_stop", title: "写合作邮件", task_type: "email_compose" }, needs_clarification: false } });
  });
  await page.goto("/mail?c=3901");
  const input = await chooseMailTask(page, "email_compose");
  await input.fill("写合作邮件");
  await page.locator("[data-send]").click();
  await expect(page.locator("[data-stop-run]")).toBeVisible();
  await page.locator("[data-stop-run]").click();
  await expect(page.locator("[data-stop-run]")).toHaveCount(0);
  await expect(page.locator("[data-mail-notice]")).toContainText("已停止本页等待");
  await expect(page.locator("[data-mail-notice]")).toContainText("服务器仍会继续处理");
  gate.release?.();
  await expect(page.locator("[data-mail-notice]")).toContainText("已在服务器创建");
  await expect(page.locator("[data-mail-notice]")).toContainText("写合作邮件");
  await expect(page).toHaveURL(/\/mail\?/);
  expect(runPosts).toEqual([]);
});

test("mail negotiation workbench: mailbox to conversation to mail, summary stays", async ({ page }) => {
  await page.route("**/api/queries/mail.box**", (route) => route.fulfill({ json: TWO_BOXES }));
  await page.route("**/api/queries/mail.conversations**", (route) => {

    return route.fulfill({ json: { conversations: [FORMAL_CONVERSATION] } });
  });
  await page.route("**/api/queries/mail.conversation?**", (route) => route.fulfill({ json: FORMAL_THREAD }));
  await page.route("**/api/queries/mail.person**", (route) => route.fulfill({ json: PERSON_DIGEST }));
  await page.route("**/api/home/board**", (route) => route.fulfill({ json: BOARD }));
  await page.goto("/mail");

  // 1) 切邮箱
  await page.locator("[data-mail-box-current]").click();
  await page.locator('[data-mail-box-option="larry.zhao@amperetime.com"]').click();
  await expect(page).toHaveURL(/box=larry\.zhao%40amperetime\.com/);

  // 2) 展开 L1/L2 看时间线
  await page.locator('[data-mail-correspondent="amy@example.com"]').click();
  await expect(page.locator("[data-mail-timeline-item]")).toHaveCount(2);

  // 3) 选第二封：正文与翻译跟着邮件 id 走
  const firstContentId = await page.locator("[data-mail-content]").getAttribute("data-mail-content-id");
  await page.locator("[data-mail-timeline-item]").nth(1).click();
  await expect(page).toHaveURL(/m=m1/);
  await expect(page.locator("[data-mail-content]")).toHaveCount(1);
  await expect(page.locator("[data-mail-content]")).not.toHaveAttribute("data-mail-content-id", firstContentId || "");
  await expect(page.locator("[data-mail-translation]")).toHaveAttribute("data-mail-translation-for", "m1");

  // 4) 往来摘要留在右栏
  await expect(page.locator("[data-mail-digest]")).toContainText("与 Amy 的往来集中在 LiTime 合作");
});

test("每封邮件按 unread 标记已读/未读", async ({ page }) => {
  await mockFormalMail(page);
  await page.goto("/mail?c=3901");
  await expect(page.locator("[data-mail-timeline-item]")).toHaveCount(2);
  await expect(page.locator('[data-mail-timeline-item="m2"]')).toHaveAttribute("data-mail-read-state", "unread");
  await expect(page.locator('[data-mail-timeline-item="m2"]')).toContainText("未读");
  await expect(page.locator('[data-mail-timeline-item="m1"]')).toHaveAttribute("data-mail-read-state", "read");
  await expect(page.locator('[data-mail-timeline-item="m2"] [data-mail-time]')).toContainText("收");
  await expect(page.locator('[data-mail-timeline-item="m1"] [data-mail-time]')).toContainText("发");
  // 点开一封会把整个会话标记已读（既有可选端点），左栏标签跟着更新，不再停在未读。
  await page.locator('[data-mail-timeline-item="m2"]').click();
  await expect(page.locator('[data-mail-timeline-item="m2"]')).toHaveAttribute("data-mail-read-state", "read");
  await expect(page.locator("[data-mail-timeline-item][data-mail-read-state='unread']")).toHaveCount(0);
  await expect(page.locator('[data-mail-timeline-item="m2"]')).toContainText("已读");
});

test("保留的 data-mail-* 契约及新唯一 composer、星标和标签选择器全部渲染", async ({ page }) => {
  await mockFormalMail(page);
  await page.goto("/mail?c=3901");
  const required = [
    "[data-mail-page]", "[data-mail-panes]", "[data-mail-pane='list']", "[data-mail-pane='detail']", "[data-mail-source='api']",
    "[data-mail-list]", "[data-mi-topbar]", "[data-mi-search]", "[data-mi-back]", "[data-mi-compose]", "[data-mi-rail]", "[data-mail-filter-unbound]",
    "[data-mail-correspondent]", "[data-mail-thread-row]", "[data-mail-timeline]", "[data-mail-timeline-item]", "[data-mail-selected]",
    "[data-mi-threadbar]", "[data-mi-stagewrap]", "[data-mi-aibar]", "[data-composer-input]", "details[data-composer-task-menu]",
    "[data-mail-side]", "[data-mail-reading-pane]", "[data-mail-thread]", "[data-mail-mobiletabs]", "[data-mail-fold='summary']",
    "[data-mail-fold='translation']", "[data-mail-fold='original']", "[data-mail-summary-card]", "[data-mail-digest]", "[data-mail-translation]",
    "[data-mail-content]", "[data-mail-body]", "[data-mail-label-editor]", "[data-mail-label-picker]", "[data-mail-reading-subject]",
    "[data-mail-sync]", "[data-mail-box]", "[data-mail-box-current]", "[data-mail-list-star='3901']", "[data-mail-star]",
  ];
  for (const selector of required) await expect(page.locator(selector).first(), selector).toBeAttached();
  await expect(page.locator("[data-mi-aiinput], [data-mi-dockfloat], [data-mail-analyze]")).toHaveCount(0);
  const listStar = await page.locator("[data-mail-list-star='3901']").boundingBox();
  const readingStar = await page.locator("[data-mail-star]").boundingBox();
  expect(listStar?.width).toBeGreaterThanOrEqual(24);
  expect(listStar?.height).toBeGreaterThanOrEqual(24);
  expect(readingStar?.width).toBeGreaterThanOrEqual(24);
  await expect(page.locator("[data-mail-list-star='3901'] svg")).toBeVisible();
  await expect(page.locator("[data-mail-star] svg")).toBeVisible();
});

test("首屏骨架保留导航与返回，不呈现虚假的可用邮箱", async ({ page }) => {
  await mockFormalMail(page);
  await page.route("**/api/queries/mail.box**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    await route.fulfill({ json: FORMAL_BOX });
  });
  await page.goto("/mail?c=3901");
  const skeleton = page.locator(".mail-pane-skeleton");
  await expect(skeleton).toBeVisible();
  await expect(page.locator("[data-mail-state='loading']")).toHaveCount(1);
  await expect(page.locator("[data-mi-topbar] [data-mi-back]")).toBeVisible();
  await expect(page.locator("[data-mi-compose]")).toBeDisabled();
  await expect(page.locator("[data-mail-label-confirm]")).toHaveCount(0);
});

test("a long person digest is clamped with an expand toggle", async ({ page }) => {
  const longDigest = "去信寒暄跟进，尚未落到报价、档期或明确兴趣。".repeat(50);
  await mockFormalMail(page, { ...PERSON_DIGEST, digest_text: longDigest });
  await page.goto("/mail?c=3901");

  const body = page.locator("[data-mail-summary-body]");
  await expect(body).toBeVisible();
  const toggle = page.locator("[data-mail-summary-toggle]");
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveText("▶ 查看摘要");
  expect(await body.evaluate((el) => el.clientHeight < el.scrollHeight)).toBe(true);

  await toggle.click();
  await expect(toggle).toHaveText("收起");
  expect(await body.evaluate((el) => el.clientHeight >= el.scrollHeight - 1)).toBe(true);
});


test("mail sync job shows failure, retries and survives a page reload", async ({ page }) => {
  await mockFormalMail(page);
  let status = "queued";
  let polls = 0;
  await page.route("**/api/jobs/mail.sync/start", (route) => route.fulfill({ json: { accepted: true, job: { id: "sync_recovery", status } } }));
  await page.route("**/api/jobs/sync_recovery", (route) => {
    polls += 1;
    const progress = status === "succeeded" ? { index: { listed: 3 }, body: { completed: 2, requested: 3, failed: 0 } } : undefined;
    return route.fulfill({ json: { job: { id: "sync_recovery", status, progress, error_summary: status === "failed" ? "邮件服务暂不可用" : null } } });
  });
  await page.route("**/api/jobs/sync_recovery/retry", (route) => {
    status = "running";
    return route.fulfill({ json: { job: { id: "sync_recovery", status } } });
  });
  await page.goto("/mail");
  await page.locator("[data-mail-sync]").click();
  await expect(page.locator("[data-mail-notice]")).toContainText("正在排队");
  const beforeReload = polls;
  await page.reload();
  await expect.poll(() => polls).toBeGreaterThan(beforeReload);
  status = "failed";
  await expect(page.getByRole("button", { name: "重试同步", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "重试同步", exact: true }).click();
  await expect(page.locator("[data-mail-notice]")).toContainText("正在收取邮件索引");
  status = "succeeded";
  await expect(page.locator("[data-mail-notice]")).toContainText("索引 3 个会话已更新；正文 2 个完成。摘要和翻译未生成。");
});

test("mail sync cancellation uses the job action and preserves a truthful status", async ({ page }) => {
  await mockFormalMail(page);
  let status = "running";
  await page.route("**/api/jobs/mail.sync/start", (route) => route.fulfill({ json: { accepted: true, job: { id: "sync_cancel", status } } }));
  await page.route("**/api/jobs/sync_cancel", (route) => route.fulfill({ json: { job: { id: "sync_cancel", status } } }));
  await page.route("**/api/jobs/sync_cancel/cancel", (route) => {
    status = "cancelled";
    return route.fulfill({ json: { job: { id: "sync_cancel", status } } });
  });
  await page.goto("/mail");
  await page.locator("[data-mail-sync]").click();
  await page.getByRole("button", { name: "取消同步", exact: true }).click();
  await expect(page.getByText("已取消后续同步，已读取的数据保留。", { exact: true })).toBeVisible();
  await expect(page.locator("[data-mail-sync]")).toBeEnabled();
});

// 沉浸式交付验收：模拟 API 的浏览器测试，不冒充真实 Codex/外发验收。
test("沉浸式阶段和常驻主题星标筛选即时更新，取消星标即时移出", async ({ page }) => {
  await mockFormalMail(page);
  await page.route("**/api/queries/mail.conversations**", (route) => route.fulfill({ json: {
    mailbox: FORMAL_BOX.mailbox, conversations: [FORMAL_CONVERSATION, {
      ...FORMAL_CONVERSATION, id: "thr_other", conversation_id: "3902", peer_email: "other@example.com",
      peer_name: "Other", handle: "Other", stage_code: "NEGOTIATING", starred: true,
    }],
  } }));
  await page.route("**/api/actions/mail.star", (route) => route.fulfill({ json: { ok: true } }));
  await page.goto("/mail?c=3901");
  await page.locator(".mi-stagechips button").filter({ hasText: "商务谈判" }).click();
  await expect(page.locator("[data-mail-correspondent]")).toContainText("other@example.com");
  await page.locator("[data-mail-clear-label-filter]").click();
  await page.locator(".mi-folder").filter({ hasText: "星标" }).click();
  await expect(page.locator("[data-mail-list] > h2.sr-only")).toContainText("1 个会话");
  await page.locator('[data-mail-correspondent="other@example.com"]').click();
  const star = page.locator('[data-mail-list-star="3902"]');
  await expect(star).toHaveAttribute("aria-pressed", "true");
  await star.hover();
  await expect(star).toHaveAttribute("aria-label", "取消收藏");
  await star.click();
  await expect(page.locator("[data-mail-list] > h2.sr-only")).toContainText("0 个会话");
});

test("自由 AI 提问附带当前原文快照，且不继承阶段草稿绑定", async ({ page }) => {
  await mockFormalMail(page);
  await page.route("**/api/queries/mail.collaboration-stage?**", (route) => route.fulfill({ json: {
    found: true, collaboration_id: "col_xiaomei", handle: "小美妆日记", stage_code: "QUOTE_PENDING", stage_label: "报价待确认",
  } }));
  await page.route("**/api/queries/mail.conversation?**", (route) => route.fulfill({ json: {
    ...FORMAL_THREAD, messages: [5, 4, 3, 2, 1].map((day) => ({ ...FORMAL_THREAD.messages[0], id: `m${day}`, occurred_at: `2026-10-0${day}T10:00:00Z`, snippet: `INDEX-MARK-${day}`, body_text: `RAW-ORIGINAL-${day}` })),
  } }));
  const payloads: Record<string, unknown>[] = [];
  await page.route("**/api/tasks/from-text", (route) => { payloads.push(route.request().postDataJSON()); return route.fulfill({ json: { task: { id: "tsk_ai" } } }); });
  await page.route("**/api/tasks/tsk_ai/run", (route) => route.fulfill({ status: 202, json: { session_id: "ses_ai" } }));
  await page.goto("/mail?c=3901");
  await expect(page.locator("[data-mail-timeline-item]")).toHaveCount(5);
  await page.locator("[data-mail-stage-kol]").click();
  await page.locator("[data-mail-stage-target]").selectOption("NEGOTIATING");
  await page.locator("[data-composer-input]").fill("请分析这次合作");
  await page.locator("[data-send]").click();
  await expect(page).toHaveURL(/\/s\/ses_ai/);
  expect(payloads).toHaveLength(1);
  const payload = payloads[0];
  expect(payload.intent).toBeUndefined();
  expect(payload.scope).toMatchObject({ skills: [], intent: "free" });
  expect(payload.collaboration_id).toBeUndefined();
  expect(payload.entities).toMatchObject({ mailbox: FORMAL_BOX.mailbox, conversation_id: "3901", message_id: "m5", mail_context_complete: true });
  const text = String(payload.text);
  expect(text).toContain("请分析这次合作");
  expect(text).toContain("报价待确认");
  expect(text).toContain("【实时上下文·通讯】");
  expect(text).toContain("【邮件资料 m5");
  expect(text).toContain("RAW-ORIGINAL-5");
  expect(text).not.toContain("INDEX-MARK-5");
});

test("顶栏搜索只过滤，中文输入法回车不误提交，Esc 无应用历史回首页", async ({ page }) => {
  await mockFormalMail(page);
  let posts = 0;
  await page.route("**/api/tasks/from-text", (route) => { posts += 1; return route.fulfill({ json: {} }); });
  await page.goto("/mail?c=3901");
  await expect(page.locator("[data-mail-timeline-item]")).not.toHaveCount(0);
  const search = page.locator("[data-mi-search]");
  await search.fill("zzzz");
  await expect(page.locator("[data-mail-empty-list]")).toBeVisible();
  await search.evaluate((el) => el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, isComposing: true })));
  expect(posts).toBe(0);
  await search.press("Escape");
  await expect(page).not.toHaveURL(/\/mail/);
});

test("打开通讯和同一常驻 composer 写信后返回，工作台 DOM、草稿与滚动原位保留", async ({ page }) => {
  await mockFormalMail(page);
  await page.goto("/cron");
  await expect(page.locator('[data-nav="mail"]')).toBeVisible();
  await page.locator("[data-cron-page]").evaluate((el) => { el.setAttribute("data-retained-probe", "same-node"); });
  await page.locator('[data-nav="mail"]').click();
  await expect(page.locator("[data-mail-background]")).toHaveAttribute("inert", "");
  await page.locator("[data-mi-compose]").click();
  await page.locator("[data-composer-input]").fill("回复草稿不会因关闭而清除");
  await page.locator("[data-mail-close-compose]").click();
  await expect(page.locator("[data-mi-aibar]")).toHaveCount(1);
  await expect(page.locator("[data-composer-input]")).toHaveValue("回复草稿不会因关闭而清除");
  await page.locator("[data-mi-back]").click();
  await expect(page).toHaveURL(/\/cron$/);
  await expect(page.locator("[data-cron-page]")).toHaveAttribute("data-retained-probe", "same-node");
  await expect(page.locator("[data-mail-immersive]")).toHaveCount(0);
});

for (const viewport of [{ width: 375, height: 667 }, { width: 768, height: 1024 }, { width: 1280, height: 720 }, { width: 1920, height: 1080 }, { width: 1280, height: 400 }]) {
  test(`沉浸式渲染 ${viewport.width}x${viewport.height} 无越界且写信可关闭`, async ({ page }, testInfo) => {
    await mockFormalMail(page);
    await page.setViewportSize(viewport);
    await page.goto("/mail?c=3901");
    await expect(page.locator("[data-mi-search]")).toBeVisible();
    const root = await page.locator("[data-mail-immersive]").boundingBox();
    expect(root?.x).toBe(0); expect(root?.y).toBe(0);
    expect(root?.width).toBe(viewport.width); expect(root?.height).toBe(viewport.height);
    if (viewport.width <= 1100) await page.locator('[data-mail-pane="detail"]').click();
    await page.locator("[data-mi-compose]").click();
    const aibar = await page.locator("[data-mi-aibar]").boundingBox();
    const geometry = await page.locator(".mi-grid, .mail-reading-pane, [data-mi-aibar]").evaluateAll(nodes => nodes.map(node => {
      const r = node.getBoundingClientRect(), s = getComputedStyle(node);
      return { className: node.className, x: r.x, width: r.width, minWidth: s.minWidth, maxWidth: s.maxWidth, margin: s.margin, align: s.alignSelf };
    }));
    expect(aibar && aibar.x >= 0 && aibar.x + aibar.width <= viewport.width, JSON.stringify(geometry)).toBeTruthy();
    expect(aibar && aibar.y >= 0 && aibar.y + aibar.height <= viewport.height).toBeTruthy();
    await page.locator("[data-composer-input]").fill("保留的写信草稿");
    await page.screenshot({ path: testInfo.outputPath(`mail-${viewport.width}x${viewport.height}.png`), fullPage: false });
    await page.locator("[data-mail-close-compose]").click();
    await expect(page.locator("[data-mi-aibar]")).toHaveCount(1);
    await expect(page.locator("[data-composer-input]")).toHaveValue("保留的写信草稿");
  });
}

test("单个已绑定邮箱无默认时，通讯导航直接进入往来且打开不创建 Agent 会话", async ({ page }) => {
  await mockFormalMail(page);
  const sessionPosts = sessionPostsOf(page);
  const fromText: string[] = [];
  page.on("request", request => { if (request.method() === "POST" && request.url().includes("/api/tasks/from-text")) fromText.push(request.url()); });
  const detailRequests: string[] = [];
  page.on("request", request => { if (request.url().includes("/api/queries/mail.conversation?")) detailRequests.push(request.url()); });
  await page.route("**/api/queries/mail.box**", route => {
    const box = new URL(route.request().url()).searchParams.get("box");
    return route.fulfill({ json: { ...FORMAL_BOX, mailbox: box || "", bound: Boolean(box), bindings: [{ mailbox: FORMAL_CONVERSATION.mailbox, bound: true, unread: 1 }] } });
  });
  await page.route("**/api/queries/mail.conversations**", route => {
    const box = new URL(route.request().url()).searchParams.get("box");
    return route.fulfill({ json: { conversations: box === FORMAL_CONVERSATION.mailbox ? [FORMAL_CONVERSATION] : [] } });
  });
  await page.goto("/cron");
  await expect(page.locator('[data-nav="mail"]')).toHaveAttribute("href", "/mail?box=larry.zhao%40amperetime.com");
  await page.locator('[data-nav="mail"]').click();
  await expect(page.locator("[data-mail-unbound-guide]")).toHaveCount(0);
  await expect(page.locator("[data-mail-choose-guide]")).toHaveCount(0);
  await expect(page).toHaveURL(/box=larry\.zhao%40amperetime\.com/);
  await expect(page.locator("[data-mail-state='ok']")).toBeVisible();
  const peer = page.locator('[data-mail-correspondent="amy@example.com"]');
  if (await peer.getAttribute("aria-expanded") !== "true") await peer.click();
  await expect.poll(() => detailRequests.length).toBeGreaterThan(0);
  expect(new URL(detailRequests[0]).searchParams.get("box")).toBe(FORMAL_CONVERSATION.mailbox);
  await expect(page.locator("[data-mail-timeline-item]")).toHaveCount(2);
  expect(sessionPosts).toEqual([]);
  expect(fromText).toEqual([]);
  await page.locator("[data-mi-back]").click();
  await expect(page).toHaveURL(/\/cron$/);
  await page.locator('[data-nav="mail"]').click();
  await expect(page.locator("[data-mail-state='ok']")).toBeVisible();
  await expect(page.locator("[data-mail-choose-guide]")).toHaveCount(0);
});

async function mockSelectableMail(page: Page, mailboxes: string[]) {
  await mockFormalMail(page);
  await page.route("**/api/queries/mail.box**", route => {
    const box = new URL(route.request().url()).searchParams.get("box") || "";
    return route.fulfill({ json: { ...FORMAL_BOX, mailbox: box, bound: mailboxes.includes(box), bindings: mailboxes.map(mailbox => ({ mailbox, bound: true, unread: 1 })) } });
  });
  await page.route("**/api/queries/mail.conversations**", route => {
    const box = new URL(route.request().url()).searchParams.get("box") || "";
    return route.fulfill({ json: { conversations: mailboxes.includes(box) ? [{ ...FORMAL_CONVERSATION, mailbox: box }] : [] } });
  });
}

test("无默认单邮箱直接打开 /mail 自动到往来，保留 c/m 深链和返回历史", async ({ page }) => {
  await mockSelectableMail(page, [FORMAL_CONVERSATION.mailbox]);
  const posts = sessionPostsOf(page);
  await page.goto("/mail?c=3901&m=m2");
  await expect(page.locator("[data-mail-state='ok']")).toBeVisible();
  await expect(page).toHaveURL(/c=3901&m=m2&box=larry\.zhao%40amperetime\.com/);
  await expect(page.locator('[data-mail-timeline-item="m2"]')).toHaveAttribute("data-mail-selected", "true");
  await page.reload();
  await expect(page.locator("[data-mail-state='ok']")).toBeVisible();
  await expect(page.locator("[data-mail-choose-guide]")).toHaveCount(0);
  expect(posts).toEqual([]);
});

test("多个邮箱未选择仍给选择，选中后通讯导航记住本次邮箱不再拦截", async ({ page }) => {
  await mockSelectableMail(page, [FORMAL_CONVERSATION.mailbox, "eu@litime.com"]);
  const posts = sessionPostsOf(page);
  await page.goto("/cron");
  await page.locator('[data-nav="mail"]').click();
  await expect(page.locator("[data-mail-state='choose-mailbox']")).toBeVisible();
  await page.locator('[data-mail-select-box="eu@litime.com"]').click();
  await expect(page.locator("[data-mail-state='ok']")).toBeVisible();
  await expect(page).toHaveURL(/box=eu%40litime\.com/);
  await page.locator("[data-mi-back]").click();
  await expect(page).toHaveURL(/\/cron$/);
  await expect(page.locator('[data-nav="mail"]')).toHaveAttribute("href", "/mail?box=eu%40litime.com");
  await page.locator('[data-nav="mail"]').click();
  await expect(page.locator("[data-mail-state='ok']")).toBeVisible();
  await expect(page.locator("[data-mail-choose-guide]")).toHaveCount(0);
  expect(posts).toEqual([]);
});

test("已记忆邮箱被撤绑后不沿用旧导航，无绑定保持真实未绑定状态", async ({ page }) => {
  await mockSelectableMail(page, [FORMAL_CONVERSATION.mailbox]);
  await page.goto("/mail");
  await expect(page.locator("[data-mail-state='ok']")).toBeVisible();
  await mockSelectableMail(page, []);
  await page.goto("/cron");
  await expect(page.locator('[data-nav="mail"]')).toHaveAttribute("href", "/mail");
  await page.locator('[data-nav="mail"]').click();
  await expect(page.locator("[data-mail-state='unbound']")).toBeVisible();
  await expect(page.locator("[data-mail-choose-guide]")).toHaveCount(0);
});

// 三图改版：UI 接口夹具验证，不冒充生产 PG/真实发信验证。
async function mockLabelStore(page: Page) {
  const entries: { id: string; name: string; count: number }[] = [
    { id: "private_quote", name: "报价待确认", count: 0 },
    { id: "manual_review", name: "待人工核对", count: 0 },
    { id: "follow_up", name: "待跟进", count: 0 },
  ];
  const peerOfConversation = (conversationId: string) => conversationId === FORMAL_CONVERSATION.conversation_id
    ? FORMAL_CONVERSATION.peer_email
    : conversationId === ANOTHER_CONVERSATION.conversation_id ? ANOTHER_CONVERSATION.peer_email : "";
  const assignments = new Map<string, string[]>();
  let version = 0;
  const posts: Record<string, unknown>[] = [];
  let nextFailure = 0;
  const snapshot = (conversationId = "") => ({
    mailbox: FORMAL_BOX.mailbox,
    labels: entries.map(label => ({ ...label, count: [...assignments.values()].filter(ids => ids.includes(label.id)).length })),
    assignments: [...assignments].map(([peer_email, label_ids]) => ({ peer_email, label_ids })),
    selected_label_ids: assignments.get(peerOfConversation(conversationId)) || [], version,
    creates_session: false, creates_turn: false, calls_model: false,
  });
  await page.route("**/api/queries/mail.labels**", route => route.fulfill({ json: { entry: "memory", ...snapshot(new URL(route.request().url()).searchParams.get("conversation_id") || "") } }));
  await page.route("**/api/actions/mail.label", async route => {
    const body = route.request().postDataJSON(); posts.push(body);
    if (nextFailure) { const status = nextFailure; nextFailure = 0; return route.fulfill({ status, json: { detail: "test-only failure" } }); }
    const id = String(body.conversation_id || "");
    if (body.confirm !== true) return route.fulfill({ status: 400, json: { detail: "confirmation required" } });
    if (body.expected_version !== version) return route.fulfill({ status: 409, json: { detail: "stale version" } });
    let label = entries.find(item => body.label_id ? item.id === body.label_id : item.name === body.name);
    if (!label && body.mode === "add" && typeof body.name === "string" && body.name.trim()) {
      label = { id: `manual_${entries.length}`, name: body.name.trim(), count: 0 }; entries.push(label);
    }
    if (!label) return route.fulfill({ status: 422, json: { detail: "unknown existing label" } });
    const peerEmail = peerOfConversation(id);
    if (!peerEmail) return route.fulfill({ status: 404, json: { detail: "unknown conversation" } });
    const assigned = new Set(assignments.get(peerEmail) || []);
    if (body.mode === "add") assigned.add(label.id); else assigned.delete(label.id);
    if (assigned.size) assignments.set(peerEmail, [...assigned]); else assignments.delete(peerEmail);
    version += 1;
    return route.fulfill({ json: { entry: "command", ok: true, conversation_id: id, label_ids: [...assigned], ...snapshot(id) } });
  });
  return { posts, entries, assignments, failNext: (status: number) => { nextFailure = status; } };
}

const ANOTHER_CONVERSATION = { ...FORMAL_CONVERSATION, id: "thr_2", conversation_id: "3902", peer_email: "other@example.com", peer_name: "Other", subject: "Another partnership", stage_code: "NEGOTIATING" };
async function mockTwoConversations(page: Page) {
  await page.route("**/api/queries/mail.conversations**", route => route.fulfill({ json: { mailbox: FORMAL_BOX.mailbox, conversations: [FORMAL_CONVERSATION, ANOTHER_CONVERSATION] } }));
  await page.route("**/api/queries/mail.conversation?**", route => {
    const isOther = new URL(route.request().url()).searchParams.get("id") === "3902";
    return route.fulfill({ json: { ...FORMAL_THREAD, conversation: isOther ? ANOTHER_CONVERSATION : FORMAL_CONVERSATION,
      messages: isOther ? FORMAL_THREAD.messages.map(message => ({ ...message, conversation_id: "3902", id: `other-${message.id}` })) : FORMAL_THREAD.messages } });
  });
}

test("紧凑工作台：全宽顶栏、单一 composer 任务菜单、无空更多按钮", async ({ page }) => {
  await mockFormalMail(page);
  await page.goto("/mail?c=3901");
  await expect(page.locator("[data-mail-state='ok']")).toBeVisible();
  for (const selector of ["[data-mi-back]", "[data-mi-search]", "[data-mi-compose]"]) {
    await expect(page.locator(`[data-mi-topbar] ${selector}`)).toBeVisible();
    await expect(page.locator(selector)).toHaveCount(1);
  }
  for (const removed of ["[data-mi-listhead]", ".mi-keys", "[data-mail-thread-actions]", ".mail-thread-head h2", "[data-mi-aiinput]", "[data-mi-dockfloat]", "[data-mail-analyze]"]) await expect(page.locator(removed)).toHaveCount(0);
  await expect(page.locator("[data-mail-reading-subject]")).toHaveCount(1);
  await expect(page.locator("[data-mi-aibar]")).toHaveCount(1);
  const menu = page.locator("details[data-composer-task-menu]");
  await expect(menu.locator("summary")).toHaveText(/选择邮件任务/);
  await menu.locator("summary").click();
  await expect(menu.locator("[data-ai-next]")).toHaveCount(5);
  await page.locator("[data-mail-box-current]").click();
  await expect(page.locator("[data-mail-box-menu]")).toBeVisible();
  expect(await page.locator("[data-mail-box-menu]").evaluate(element => getComputedStyle(element).position)).toBe("static");
  await expect(page.locator("[data-mail-box-option]")).toHaveCount(1);
  await page.locator("[data-mail-box-current]").press("Escape");
  await expect(page.locator("[data-mail-box-menu]")).toHaveCount(0);
});

test("已有标签可筛选选择；手动输入新标签走 name 创建并打标", async ({ page }) => {
  await mockFormalMail(page);
  const store = await mockLabelStore(page);
  const sessions = sessionPostsOf(page);
  await page.goto("/mail?c=3901");
  await openLabelPicker(page);
  await expect(page.locator("[data-mail-label-input]")).toBeVisible();
  const search = page.locator("[data-mail-label-search]");
  await search.fill("报价");
  await expect(page.locator("[data-mail-label-option]")).toHaveCount(1);
  await expect(page.locator('[data-mail-label-option="private_quote"]')).toContainText("报价待确认");
  expect(store.posts).toHaveLength(0);
  await selectExistingLabel(page, "private_quote");
  expect(store.posts).toHaveLength(0);
  await page.locator("[data-mail-label-confirm]").click();
  await expect(page.locator("[data-mail-label-notice]")).toHaveText("标签已保存。");
  expect(store.posts[0]).toMatchObject({ box: FORMAL_BOX.mailbox, conversation_id: "3901", mode: "add", label_id: "private_quote", expected_version: 0, confirm: true });
  expect(store.posts[0].name).toBeUndefined();
  await expect(page.locator('[data-mail-saved-label="private_quote"]')).toContainText("报价待确认");
  await expect(page.locator('[data-mail-label-filter="private_quote"]')).toContainText("报价待确认");
  await page.reload();
  await expect(page.locator('[data-mail-saved-label="private_quote"]')).toContainText("报价待确认");
  expect(store.posts).toHaveLength(1);
  expect(sessions).toEqual([]);

  // 手动输入新标签：走 name 创建（不存在则新建），打标到当前对方。
  await openLabelPicker(page);
  await page.locator("[data-mail-label-input]").fill("手工跟进");
  await page.locator("[data-mail-label-add]").click();
  await expect(page.locator("[data-mail-label-notice]")).toHaveText("标签已保存。");
  expect(store.posts[1]).toMatchObject({ box: FORMAL_BOX.mailbox, conversation_id: "3901", mode: "add", confirm: true });
  expect(store.posts[1].name).toBe("手工跟进");
  expect(store.posts[1].label_id).toBeUndefined();
  expect(sessions).toEqual([]);
});

test("已有标签复用快照、左侧过滤，移除须独立确认且只解绑", async ({ page }) => {
  await mockFormalMail(page); await mockTwoConversations(page);
  const store = await mockLabelStore(page);
  const sessions = sessionPostsOf(page);
  await page.goto("/mail?c=3901");
  await openLabelPicker(page);
  await selectExistingLabel(page, "private_quote");
  await page.locator("[data-mail-label-confirm]").click();
  await expect(page.locator('[data-mail-saved-label="private_quote"]')).toBeVisible();
  expect(store.posts[0]).toMatchObject({ label_id: "private_quote" });
  expect(store.posts[0].name).toBeUndefined();
  await page.locator('[data-mail-label-filter="private_quote"]').click();
  await expect(page.locator("[data-mail-correspondent]")).toHaveCount(1);
  await page.getByRole("button", { name: "移除标签 报价待确认", exact: true }).click();
  await expect(page.locator("[data-mail-label-confirm]")).toHaveText("确认移除");
  expect(store.posts).toHaveLength(1);
  await page.locator("[data-mail-label-confirm]").click();
  await expect(page.locator("[data-mail-label-notice]")).toHaveText("标签已移除。");
  await expect(page.locator("[data-mail-empty-list]")).toHaveText("没有匹配的会话。");
  await page.locator("[data-mail-clear-label-filter]").click();
  await expect(page.locator("[data-mail-correspondent]")).toHaveCount(2);
  expect(store.entries).toHaveLength(3);
  expect(sessions).toEqual([]);
});

test("已有标签保存失败不乐观显示成功；409 重载后须再次确认", async ({ page }) => {
  await mockFormalMail(page); const store = await mockLabelStore(page);
  await page.goto("/mail?c=3901"); await openLabelPicker(page); await selectExistingLabel(page, "manual_review");
  store.failNext(500); await page.locator("[data-mail-label-confirm]").click();
  await expect(page.locator("[data-mail-label-error]")).toContainText("标签未保存");
  await expect(page.locator('[data-mail-saved-label="manual_review"]')).toHaveCount(0);
  await expect(page.locator("[data-mail-label-confirm]")).toBeEnabled();
  store.failNext(409); await page.locator("[data-mail-label-confirm]").click();
  await expect(page.locator("[data-mail-label-error]")).toContainText("另一处更新");
  await expect(page.locator("[data-mail-label-confirm]")).toBeEnabled();
  await page.locator("[data-mail-label-confirm]").click();
  await expect(page.locator('[data-mail-saved-label="manual_review"]')).toContainText("待人工核对");
  await expect(page.locator("[data-mail-label-error]")).toHaveCount(0);
  expect(store.posts).toHaveLength(3);
});

async function openCurrentLabelChooser(page: Page, conversationId: string) {
  const editor = page.locator(`[data-mail-label-editor][data-mail-label-object="${conversationId}"]`);
  await expect(editor).toHaveCount(1);
  const trigger = editor.locator("[data-mail-label-picker]");
  await expect(trigger).toHaveCount(1);
  await expect(trigger).toBeVisible();
  await trigger.click();
  const options = editor.locator("[data-mail-label-option]");
  await expect(options).toHaveCount(3);
  await expect(options.first()).toBeVisible();
  return { editor, options };
}

test("未确认的已有标签选择留在原对象，切换会话不串线", async ({ page }) => {
  await mockFormalMail(page); await mockTwoConversations(page); const store = await mockLabelStore(page);
  await page.goto("/mail?c=3901");
  const original = await openCurrentLabelChooser(page, "3901");
  const originalOption = original.editor.locator('[data-mail-label-option="manual_review"]');
  await expect(originalOption).toContainText("待人工核对");
  await originalOption.click();
  const originalConfirm = original.editor.locator("[data-mail-label-confirm]");
  await expect(originalConfirm).toHaveText("确认添加");
  await expect(originalConfirm.locator("..")).toContainText("待人工核对");
  await page.locator('[data-mail-correspondent="other@example.com"]').click();
  await page.locator('[data-mail-thread-row="3902"]').click();
  const other = await openCurrentLabelChooser(page, "3902");
  await expect(other.editor.locator("[data-mail-label-confirm]")).toHaveCount(0);
  await expect(other.editor.locator('[data-mail-label-option="manual_review"]')).toHaveAttribute("aria-pressed", "false");
  await page.locator('[data-mail-correspondent="amy@example.com"]').click();
  await page.locator('[data-mail-thread-row="3901"]').click();
  const restored = await openCurrentLabelChooser(page, "3901");
  const restoredConfirm = restored.editor.locator("[data-mail-label-confirm]");
  await expect(restoredConfirm).toHaveText("确认添加");
  await expect(restoredConfirm.locator("..")).toContainText("待人工核对");
  await expect(restored.editor.locator('[data-mail-label-option="manual_review"]')).toHaveAttribute("aria-pressed", "false");
  await expect(restored.editor.locator('[data-mail-saved-label="manual_review"]')).toHaveCount(0);
  expect(store.posts).toHaveLength(0);
});

test("打开与浏览会话不隐式打标；选中另一对方明确切换标签对象且不产生任务", async ({ page }) => {
  await mockFormalMail(page); const store = await mockLabelStore(page); const sessions = sessionPostsOf(page);
  await mockTwoConversations(page);
  await page.goto("/mail?c=3901");
  await expect(page.locator("[data-mail-label-editor]")).toHaveAttribute("data-mail-label-object", "3901");
  expect(store.posts).toHaveLength(0); expect(sessions).toEqual([]);
  await page.locator('[data-mail-correspondent="other@example.com"]').click();
  await expect(page.locator("[data-mail-label-editor]")).toHaveAttribute("data-mail-label-object", "3902");
  await openLabelPicker(page);
  await expect(page.locator("[data-mail-label-search]")).toBeEnabled();
  expect(store.posts).toHaveLength(0); expect(sessions).toEqual([]);
});

test("延迟标签读取不能把前一会话标签快照带到新对象", async ({ page }) => {
  await mockFormalMail(page); await mockTwoConversations(page);
  let release: (() => void) | undefined;
  const held = new Promise<void>(resolve => { release = resolve; });
  let firstHeld = false;
  await page.route("**/api/queries/mail.labels**", async route => {
    const conversationId = new URL(route.request().url()).searchParams.get("conversation_id") || "";
    if (conversationId === "3901" && !firstHeld) { firstHeld = true; await held; }
    const labelId = conversationId === "3901" ? "previous" : "current";
    const peerEmail = conversationId === "3901" ? FORMAL_CONVERSATION.peer_email : ANOTHER_CONVERSATION.peer_email;
    return route.fulfill({ json: { mailbox: FORMAL_BOX.mailbox, labels: [{ id: labelId, name: labelId === "previous" ? "旧对象标签" : "当前对象标签", count: 1 }], assignments: [{ peer_email: peerEmail, label_ids: [labelId] }], selected_label_ids: [labelId], version: 1 } });
  });
  await page.goto("/mail?c=3901");
  await expect(page.getByText("正在读取此邮箱标签…", { exact: true })).toBeVisible();
  await page.locator('[data-mail-correspondent="other@example.com"]').click();
  await page.locator('[data-mail-thread-row="3902"]').click();
  await expect(page.locator("[data-mail-saved-label]")).toContainText("当前对象标签");
  release?.();
  await expect(page.locator("[data-mail-label-editor]")).toHaveAttribute("data-mail-label-object", "3902");
  await expect(page.locator('[data-mail-saved-label="previous"]')).toHaveCount(0);
  await expect(page.locator('[data-mail-saved-label="current"]')).toBeVisible();
});

test("保存中切换对象，旧标签确认回执不覆盖新会话", async ({ page }) => {
  await mockFormalMail(page); await mockTwoConversations(page); await mockLabelStore(page);
  let release: (() => void) | undefined;
  const held = new Promise<void>(resolve => { release = resolve; });
  let posted = false;
  await page.route("**/api/actions/mail.label", async route => {
    posted = true; const body = route.request().postDataJSON(); await held;
    const peerEmail = body.conversation_id === ANOTHER_CONVERSATION.conversation_id ? ANOTHER_CONVERSATION.peer_email : FORMAL_CONVERSATION.peer_email;
    return route.fulfill({ json: { ok: true, mailbox: FORMAL_BOX.mailbox, conversation_id: body.conversation_id, labels: [{ id: "private_quote", name: "报价待确认", count: 1 }], assignments: [{ peer_email: peerEmail, label_ids: ["private_quote"] }], label_ids: ["private_quote"], version: 1 } });
  });
  await page.goto("/mail?c=3901"); await openLabelPicker(page); await selectExistingLabel(page, "private_quote");
  await page.locator("[data-mail-label-confirm]").click();
  await expect.poll(() => posted).toBe(true);
  await expect(page.locator("[data-mail-label-confirm]")).toHaveText("保存中…");
  await page.locator('[data-mail-correspondent="other@example.com"]').click();
  await page.locator('[data-mail-thread-row="3902"]').click();
  release?.();
  await expect(page.locator("[data-mail-label-editor]")).toHaveAttribute("data-mail-label-object", "3902");
  await expect(page.locator("[data-mail-saved-label]")).toHaveCount(0);
  await expect(page.locator("[data-mail-label-notice]")).toHaveCount(0);
  await page.locator('[data-mail-correspondent="amy@example.com"]').click();
  await page.locator('[data-mail-thread-row="3901"]').click();
  await openLabelPicker(page);
  await expect(page.locator("[data-mail-label-confirm]")).toContainText("确认添加");
});

test.describe("触控与减弱动效", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
  test("手机标签确认与返回可达，控件保留焦点与触控尺寸，无横向越界", async ({ page }) => {
    await mockFormalMail(page); await mockLabelStore(page);
    await page.goto("/mail?c=3901&m=m2");
    await expect(page.locator("[data-mail-side]")).toBeVisible();
    await expect(page.locator("[data-mi-topbar] [data-mi-back]")).toBeVisible();
    await openLabelPicker(page);
    await page.locator("[data-mail-label-search]").fill("待跟进");
    await selectExistingLabel(page, "follow_up");
    const optionHeight = await page.locator('[data-mail-label-option="follow_up"]').evaluate(element => element.getBoundingClientRect().height);
    const buttonHeight = await page.locator("[data-mail-label-confirm]").evaluate(element => element.getBoundingClientRect().height);
    expect(optionHeight).toBeGreaterThanOrEqual(44); expect(buttonHeight).toBeGreaterThanOrEqual(44);
    await page.locator("[data-mail-label-confirm]").click();
    await expect(page.locator("[data-mail-saved-label]")).toContainText("待跟进");
    const bounds = await page.locator("[data-mail-page]").evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth }));
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.width);
    await page.locator("[data-mi-search]").focus();
    await page.keyboard.press("Shift+Tab");
    await expect(page.locator("[data-mi-back]")).toBeFocused();
    const focus = await page.locator("[data-mi-back]").evaluate(element => ({ style: getComputedStyle(element).outlineStyle, width: getComputedStyle(element).outlineWidth }));
    expect(focus.style).not.toBe("none"); expect(parseFloat(focus.width)).toBeGreaterThan(0);
    await page.locator("[data-mi-back]").press("Enter");
    await expect(page).not.toHaveURL(/\/mail/);
  });
});
