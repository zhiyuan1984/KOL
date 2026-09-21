import { expect, test, type Page } from "@playwright/test";

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
  await page.route("**/api/mail/**", async (route) => {
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
}

test("sidebar 通讯 sits under 定时任务 and /mail uses board fallback", async ({ page }) => {
  const sessionPosts: string[] = [];
  await mockMailMissing(page);
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/api\/(sessions|tasks\/from-text)/.test(request.url())) {
      sessionPosts.push(request.url());
    }
  });
  await page.goto("/");
  const today = page.locator('nav[aria-label="今日"]');
  await expect(today.locator('[data-nav="cron"]')).toBeVisible();
  await expect(today.locator('[data-nav="mail"]')).toBeVisible();
  await expect(today.locator('[data-nav="mail"]')).toHaveAttribute("href", "/mail");
  const cronBox = await today.locator('[data-nav="cron"]').boundingBox();
  const mailBox = await today.locator('[data-nav="mail"]').boundingBox();
  expect(cronBox && mailBox && mailBox.y > cronBox.y).toBeTruthy();
  await expect(today.locator('[data-nav="mail"] .nav-badge')).toHaveCount(0);
  await today.locator('[data-nav="mail"]').click();
  await expect(page).toHaveURL(/\/mail/);
  await expect(page.locator("[data-mail-page]")).toBeVisible();
  await expect(page.locator("[data-mail-page]")).toHaveAttribute("data-mail-source", "fallback");
  await expect(page.locator("[data-mail-box]")).toContainText("larry.zhao@amperetime.com");
  await expect(page.locator("[data-mail-box]")).toContainText("钟槿年");
  await expect(page.locator('[data-mail-thread-row="3901"]')).toContainText("Amy");
  await expect(page.locator('[data-mail-thread-row="3901"]')).toContainText("想和贵品牌");
  await expect(page.locator('[data-mail-thread-row="u-9"]')).toHaveAttribute("data-mail-match-state", "unbound");
  await expect(page.locator('[data-mail-thread-row="u-9"] [data-mail-unbound-chip]')).toHaveText("未建档");
  await expect(page.locator("[data-mail-page]")).not.toContainText("下一步");
  await expect(page.locator("[data-mail-page]")).not.toContainText("历史邮件往来摘要");
  expect(sessionPosts).toEqual([]);
});

test("opening a fallback thread and 收取 404 do not create sessions", async ({ page }) => {
  const sessionPosts: string[] = [];
  await mockMailMissing(page);
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/api\/(sessions|tasks\/from-text)/.test(request.url())) {
      sessionPosts.push(request.url());
    }
  });
  await page.goto("/mail?box=larry.zhao@amperetime.com&c=3901");
  await expect(page.locator("[data-mail-thread]")).toContainText("Re: LiTime collab");
  await expect(page.locator("[data-mail-body]")).toHaveCount(1);
  await expect(page.locator("[data-mail-body]")).not.toHaveAttribute("open", /.*/);
  await page.locator("[data-mail-sync]").click();
  await expect(page.locator("[data-mail-error]")).toContainText("暂时无法收取");
  await expect(page.locator("[data-mail-error]")).toContainText("没有创建会话");
  expect(sessionPosts).toEqual([]);
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
  last_receipt: "",
  digest_source: "codex_memory",
  digest_text: "对方已确认档期",
  // The real GET /api/mail/conversations LEFT JOINs collaborations and returns these.
  kol_uid: "KOL_X",
  handle: "小美妆日记",
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
      snippet: "想和贵品牌合作",
      body_text: "Hello\n想和贵品牌litime合作",
      letter_summary: "想和贵品牌合作",
      summary_source: "body_analysis",
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
      translation_zh: "感谢联系。",
      receipt_status: "",
      effective: true,
    },
  ],
  digest_text: "对方已确认档期",
  digest_source: "codex_memory",
};

async function mockFormalMail(page: Page) {
  await page.route("**/api/mail/box", async (route) => {
    await route.fulfill({ json: FORMAL_BOX });
  });
  await page.route("**/api/mail/conversations", async (route) => {
    if (/\/conversations\/[^/?]+/.test(route.request().url())) return route.fallback();
    await route.fulfill({
      json: {
        entry: "memory",
        creates_session: false,
        mailbox: "larry.zhao@amperetime.com",
        conversations: [FORMAL_CONVERSATION],
      },
    });
  });
  await page.route("**/api/mail/conversations/*", async (route) => {
    await route.fulfill({ json: FORMAL_THREAD });
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
  await expect(page.locator("[data-mail-digest] [data-digest-body]")).toContainText("对方已确认档期");
});

test("POST /api/mail/sync uses SyncReceipt and does not create sessions", async ({ page }) => {
  const sessionPosts: string[] = [];
  await mockFormalMail(page);
  await page.route("**/api/mail/sync", async (route) => {
    await route.fulfill({
      json: {
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
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/api\/(sessions|tasks\/from-text)/.test(request.url())) {
      sessionPosts.push(request.url());
    }
  });
  await page.goto("/mail");
  await page.locator("[data-mail-sync]").click();
  await expect(page.locator("[data-mail-notice]")).toContainText("已在后台开始收取");
  expect(sessionPosts).toEqual([]);
});

test("回复 only stashes composer chips; 分析 prefills enqueue", async ({ page }) => {
  const fromText: string[] = [];
  await mockMailMissing(page);
  await page.route("**/api/home/kol-analyze/enqueue", async (route) => {
    await route.fulfill({
      status: 201,
      json: { work_item_id: "tsk_1", creates_session: false, people: ["KOL_X"], task_type: "kol_analyze" },
    });
  });
  page.on("request", (request) => {
    if (request.url().includes("/api/tasks/from-text")) fromText.push(request.url());
  });
  await page.goto("/mail?c=3901");
  await page.locator("[data-mail-reply]").click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("[data-composer-draft-chip='mailbox']")).toContainText("larry.zhao@amperetime.com");
  await expect(page.locator("[data-composer-draft-chip='conversation_id']")).toContainText("3901");
  await expect(page.locator("[data-composer-draft-chip='peer']")).toContainText("Amy");
  await expect(page.locator("[data-composer-draft-chip='subject']")).toContainText("Re: LiTime collab");
  await expect(page.locator("textarea")).toHaveValue(/回复：Re: LiTime collab/);
  expect(fromText).toEqual([]);

  await page.goto("/mail?c=3901");
  await page.locator("[data-mail-analyze]").click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("textarea")).toHaveValue(/分析已选：KOL_X/);
  await page.locator("[data-send]").click();
  await expect(page.locator("[data-analyze-enqueue]")).toContainText("已入队");
  expect(fromText).toEqual([]);
});

test("unbound mailbox guides to Starry settings", async ({ page }) => {
  await page.route("**/api/mail/**", async (route) => {
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

test("expanding a conversation reveals its mail timeline in the list column", async ({ page }) => {
  await mockFormalMail(page);
  await page.goto("/mail?c=3901");
  await expect(page.locator("[data-mail-timeline-item]")).toHaveCount(0);

  await page.locator('[data-mail-thread-row="3901"]').click();
  await expect(page.locator("[data-mail-timeline-item]")).toHaveCount(2);
  await expect(page.locator("[data-mail-timeline-item]").first()).toHaveAttribute("data-mail-selected", "true");
});

test("selecting another mail switches only the content and translation columns", async ({ page }) => {
  await mockFormalMail(page);
  await page.goto("/mail?c=3901");
  await expect(page.locator('[data-mail-thread-row="3901"]')).toBeVisible();
  await page.locator('[data-mail-thread-row="3901"]').click();
  await expect(page.locator("[data-mail-timeline-item]")).toHaveCount(2);

  await expect(page.locator("[data-mail-content]")).toHaveCount(1);
  const summaryBefore = await page.locator("[data-mail-summary-body]").innerText();
  const firstId = await page.locator("[data-mail-content]").getAttribute("data-mail-content-id");

  await page.locator("[data-mail-timeline-item]").nth(1).click();
  await expect(page.locator("[data-mail-content]")).not.toHaveAttribute("data-mail-content-id", firstId || "");
  await expect(page.locator("[data-mail-content]")).toHaveCount(1);
  await expect(page.locator("[data-mail-summary-body]")).toHaveText(summaryBefore);
});

test("the assistant column titles the summary as conversation-level", async ({ page }) => {
  await mockFormalMail(page);
  await page.goto("/mail?c=3901");
  await expect(page.locator('[data-mail-thread-row="3901"]')).toBeVisible();
  await page.locator('[data-mail-thread-row="3901"]').click();

  await expect(page.locator("[data-mail-summary-card]")).toContainText("会话摘要");
  await expect(page.locator("[data-mail-summary-card]")).not.toContainText("中文摘要");
  const summaryBefore = await page.locator("[data-mail-summary-body]").innerText();

  await page.locator("[data-mail-timeline-item]").nth(1).click();
  await expect(page.locator("[data-mail-summary-card]")).toContainText("会话摘要");
  await expect(page.locator("[data-mail-summary-body]")).toHaveText(summaryBefore);
});

const TWO_BOXES = {
  ...FORMAL_BOX,
  bindings: [
    { mailbox: "larry.zhao@amperetime.com", label: "美国邮箱", owner_name: "赵良玉", unread: 12, bound: true, synced_at: FORMAL_BOX.synced_at, error: null },
    { mailbox: "eu@litime.com", label: "欧洲邮箱", owner_name: "李四", unread: 3, bound: true, synced_at: FORMAL_BOX.synced_at, error: null },
  ],
};

test("the mailbox switcher shows only the current mailbox until opened", async ({ page }) => {
  await page.route("**/api/mail/box**", (route) => route.fulfill({ json: TWO_BOXES }));
  await page.route("**/api/mail/conversations**", (route) => route.fulfill({ json: { conversations: [] } }));
  await page.route("**/api/home/board**", (route) => route.fulfill({ json: BOARD }));
  await page.goto("/mail");

  await expect(page.locator("[data-mail-box-current]")).toContainText("larry.zhao@amperetime.com");
  await expect(page.locator("[data-mail-box-option]")).toHaveCount(0);

  await page.locator("[data-mail-box-current]").click();
  await expect(page.locator("[data-mail-box-option]")).toHaveCount(2);
  await expect(page.locator('[data-mail-box-option="eu@litime.com"]')).toContainText("欧洲邮箱");
});
