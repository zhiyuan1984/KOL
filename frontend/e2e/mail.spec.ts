import { expect, test, type Page, type Route } from "@playwright/test";
import { stubHomeFollowing } from "./kol-surface-stub";

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

  // 页头一行：邮箱地址只出现在切换器里，meta 只留同步时间与未读。
  await expect(page.locator("[data-mail-box-current]")).toContainText("larry.zhao@amperetime.com");
  await expect(page.locator("[data-mail-box]")).toContainText("同步");
  await expect(page.locator("[data-mail-box]")).toContainText("未读");
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
  await page.locator("[data-mail-search]").fill("zzzz-没有这封邮件");
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
  await expect(page.locator("[data-mail-summary-card]")).toContainText("摘要生成中…点「收取」后可再试。");
  await expect(page.locator("[data-mail-translation]")).toContainText("暂无中文译稿。");
  await page.locator("[data-mail-sync]").click();
  await expect(page.locator("[data-mail-error]")).toContainText("暂时无法收取");
  await expect(page.locator("[data-mail-error]")).toContainText("没有创建会话");
  expect(sessionPosts).toEqual([]);
});

test("未建档会话的快速分析只提示，不入队", async ({ page }) => {
  await mockMailMissing(page);
  let enqueued = 0;
  await page.route("**/api/home/kol-analyze/enqueue", async (route) => {
    enqueued += 1;
    await route.fulfill({ status: 201, json: { creates_session: false } });
  });
  await page.goto("/mail?box=larry.zhao@amperetime.com&c=u-9");
  await page.locator("[data-mail-analyze]").click();
  await expect(page.locator("[data-mail-notice]")).toContainText("未建档，无法入队分析。");
  await expect(page).toHaveURL(/\/mail\?/);
  expect(enqueued).toBe(0);
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

function pathOf(route: Route): string {
  return new URL(route.request().url()).pathname;
}

async function mockFormalMail(page: Page, person: Record<string, unknown> = PERSON_DIGEST) {
  await page.route("**/api/mail/box**", async (route) => {
    await route.fulfill({ json: FORMAL_BOX });
  });
  // Query-safe: the list URL gains ?box= as soon as a mailbox is switched.
  await page.route("**/api/mail/conversations**", async (route) => {
    if (/^\/api\/mail\/conversations\/[^/]+$/.test(pathOf(route))) return route.fallback();
    await route.fulfill({
      json: {
        entry: "memory",
        creates_session: false,
        mailbox: "larry.zhao@amperetime.com",
        conversations: [FORMAL_CONVERSATION],
      },
    });
  });
  await page.route("**/api/mail/conversations/**", async (route) => {
    await route.fulfill({ json: FORMAL_THREAD });
  });
  await page.route("**/api/mail/person**", async (route) => {
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

test("POST /api/mail/sync uses SyncReceipt and does not create sessions", async ({ page }) => {
  const sessionPosts = sessionPostsOf(page);
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
  await page.goto("/mail");
  await page.locator("[data-mail-sync]").click();
  await expect(page.locator("[data-mail-notice]")).toContainText("已在后台开始收取");
  expect(sessionPosts).toEqual([]);
});

test("回复 prefills the on-page composer; 快速分析 enqueues on click without a session", async ({ page }) => {
  await mockFormalMail(page);
  const fromText: string[] = [];
  const sessionPosts = sessionPostsOf(page);
  await page.route("**/api/home/kol-analyze/enqueue", async (route) => {
    await route.fulfill({
      status: 201,
      json: { work_item_id: "tsk_1", creates_session: false, people: ["KOL_X"], task_type: "kol_analyze" },
    });
  });
  page.on("request", (request) => {
    if (request.url().includes("/api/tasks/from-text")) fromText.push(request.url());
  });

  // 回复 stays on /mail and only fills the 提问框 in place.
  await page.goto("/mail?c=3901");
  await page.locator("[data-mail-reply]").click();
  await expect(page).toHaveURL(/\/mail\?/);
  await expect(page.locator("[data-composer-draft-chip='mailbox']")).toContainText("larry.zhao@amperetime.com");
  await expect(page.locator("[data-composer-draft-chip='conversation_id']")).toContainText("3901");
  await expect(page.locator("[data-composer-draft-chip='peer']")).toContainText("Amy");
  await expect(page.locator("[data-composer-draft-chip='subject']")).toContainText("Re: LiTime collab");
  await expect(page.locator("textarea")).toHaveValue(/回复：Re: LiTime collab/);
  expect(fromText).toEqual([]);

  // 共享 stash 已在本页消费后清掉：接着去首页，Home 的提问框不会被这封回复预填。
  await page.goto("/");
  await expect(page.locator("[data-composer-input]")).not.toHaveValue(/回复：Re: LiTime collab/);
  await page.goBack();
  await expect(page.locator("[data-mail-reply]")).toBeVisible();

  // 快速分析 is the action itself: the click enqueues, with no send and no session.
  const enqueue = page.waitForRequest((request) => request.url().includes("/api/home/kol-analyze/enqueue"));
  await page.locator("[data-mail-analyze]").click();
  const body = JSON.parse((await enqueue).postData() || "{}");
  // analyzePeopleOf sends the record uid and its handle, exactly like the old page.
  expect(body).toMatchObject({ title: "分析已选", kol_uids: ["KOL_X", "小美妆日记"] });
  expect(String(body.prompt)).toContain("分析已选：KOL_X");
  await expect(page.locator("[data-mail-notice]")).toContainText("已入队");
  await expect(page).toHaveURL(/\/mail\?/);
  expect(fromText).toEqual([]);
  expect(sessionPosts).toEqual([]);
});

test("邮件任务 chip fills the提问框 from the compose catalog", async ({ page }) => {
  await mockFormalMail(page);
  const letters = Array.from({ length: 8 }).map((_, index) => ({
    stage: `STAGE_${index}`,
    chip: `任务 ${index}`,
    prompt: `写第 ${index} 封合作邮件`,
    template_id: `template_${index}`,
    kind: "letter",
  }));
  await page.route("**/api/mail/compose-catalog**", async (route) => {
    await route.fulfill({
      json: { entry: "memory", creates_session: false, creates_turn: false, calls_model: false, letters },
    });
  });
  const sessionPosts = sessionPostsOf(page);
  await page.goto("/mail?c=3901");

  // 先显示前 6 个 + 更多。
  await expect(page.locator("[data-mail-task-chip]")).toHaveCount(6);
  await page.locator("[data-mail-task-more]").click();
  await expect(page.locator("[data-mail-task-chip]")).toHaveCount(8);

  await page.locator('[data-mail-task-chip="STAGE_0"]').click();
  await expect(page.locator("textarea")).toHaveValue("写第 0 封合作邮件");
  await expect(page.locator('[data-skill-chip="email_compose"]')).toContainText("任务 0");
  expect(sessionPosts).toEqual([]);
});

test("a dead compose catalog renders no chips and no crash", async ({ page }) => {
  await mockFormalMail(page);
  await page.route("**/api/mail/compose-catalog**", async (route) => {
    await route.fulfill({ status: 500, json: { detail: "boom" } });
  });
  await page.goto("/mail?c=3901");
  await expect(page.locator("[data-mail-state='ok']")).toBeVisible();
  await expect(page.locator("[data-mail-task-chip]")).toHaveCount(0);
  await expect(page.locator("[data-mail-page]")).not.toContainText("无法读取");
});

test("composer submit opens the run session and never the home page", async ({ page }) => {
  await mockFormalMail(page);
  await page.route("**/api/tasks/from-text", async (route) => {
    await route.fulfill({
      json: { task: { id: "tsk_9", title: "写合作邮件", task_type: "email_compose" }, needs_clarification: false },
    });
  });
  await page.route("**/api/tasks/tsk_9/run", async (route) => {
    await route.fulfill({ json: { task: { id: "tsk_9" }, session_id: "ses_9" } });
  });
  await page.goto("/mail?c=3901");
  await page.locator("textarea").fill("写合作邮件");
  await page.locator("[data-send]").click();
  await expect(page).toHaveURL(/\/s\/ses_9/);
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

test("clicking L1/L2 only expands; clicking a mail selects it", async ({ page }) => {
  await mockFormalMail(page);
  await page.goto("/mail");
  // 树默认收起：打开页面不展开、不选中，也不进入任何会话。
  await expect(page.locator("[data-mail-thread-row='3901']")).toHaveCount(0);
  await expect(page.locator("[data-mail-timeline-item]")).toHaveCount(0);

  await page.locator('[data-mail-correspondent="amy@example.com"]').click();
  await expect(page.locator('[data-mail-thread-row="3901"]')).toBeVisible();
  await page.locator('[data-mail-thread-row="3901"]').click();
  await expect(page.locator("[data-mail-timeline-item]")).toHaveCount(2);
  // 只展开：没有任何邮件被选中，右栏仍是会话级别。
  await expect(page.locator("[data-mail-timeline-item][data-mail-selected='true']")).toHaveCount(0);
  await expect(page.locator("[data-mail-thread-row='3901']")).toHaveAttribute("data-mail-mail-count", "2");

  await page.locator("[data-mail-timeline-item]").first().click();
  await expect(page).toHaveURL(/[?&]m=/);
  await expect(page.locator("[data-mail-timeline-item][data-mail-selected='true']")).toHaveCount(1);
  await expect(page.locator("[data-mail-fold='original'] .mail-fold-body")).toBeVisible();
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
  await expect(page.locator("[data-mail-digest-tag]")).toContainText("AI 生成");
  await expect(page.locator("[data-mail-digest-tag]")).toContainText("codex");

  // 逐个可折叠。
  await page.locator("[data-mail-fold-head='translation']").click();
  await expect(page.locator("[data-mail-fold-head='translation']")).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("[data-mail-translation]")).toBeHidden();
  await page.locator("[data-mail-fold-head='translation']").click();
  await expect(page.locator("[data-mail-translation]")).toBeVisible();

  await page.locator("[data-mail-fold-head='original']").click();
  await expect(page.locator("[data-mail-fold-head='original']")).toHaveAttribute("aria-expanded", "false");
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
  await page.route("**/api/mail/box**", (route) => route.fulfill({ json: TWO_BOXES }));
  await page.route("**/api/mail/conversations**", (route) => route.fulfill({ json: { conversations: [] } }));
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
  await page.route("**/api/mail/box**", (route) => route.fulfill({
    json: {
      ...FORMAL_BOX,
      mailbox: "larry.zhao@amperetime.com",
      bindings: [{ mailbox: "eu@litime.com", label: "欧洲邮箱", unread: 3, bound: true, synced_at: FORMAL_BOX.synced_at, error: null }],
    },
  }));
  await page.route("**/api/mail/conversations**", (route) => route.fulfill({ json: { conversations: [] } }));
  await page.route("**/api/home/board**", (route) => route.fulfill({ json: BOARD }));
  await page.goto("/mail");

  await expect(page.locator("[data-mail-box-current]")).toContainText("larry.zhao@amperetime.com");
  await expect(page.locator("[data-mail-box-current]")).not.toContainText("选择邮箱");
  await expect(page.locator("[data-mail-box-current]")).not.toContainText("eu@litime.com");
});

test("three-column workbench geometry and selected state", async ({ page }) => {
  await mockFormalMail(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/mail?c=3901");
  await expect(page.locator("[data-mail-timeline-item]")).toHaveCount(2);
  await page.locator("[data-mail-timeline-item]").first().click();

  const list = await page.locator("[data-mail-list]").boundingBox();
  const interact = await page.locator("[data-mail-interact]").boundingBox();
  const side = await page.locator("[data-mail-side]").boundingBox();
  expect(list?.width).toBeGreaterThanOrEqual(260);
  expect(list?.width).toBeLessThanOrEqual(345);
  expect(interact?.width).toBeGreaterThan(0);
  expect(side?.width).toBeGreaterThanOrEqual(320);

  const selected = page.locator("[data-mail-timeline-item][data-mail-selected='true']");
  await expect(selected).toHaveCount(1);
  const border = await selected.evaluate((el) => getComputedStyle(el).borderLeftWidth);
  expect(border).toBe("3px");
});

test("≤1100px 单栏用页级面板切换，选邮件自动进详情", async ({ page }) => {
  await mockFormalMail(page);
  await page.setViewportSize({ width: 900, height: 800 });
  await page.goto("/mail?c=3901");
  await expect(page.locator("[data-mail-timeline-item]")).toHaveCount(2);

  const switcher = page.locator("[data-mail-panes]");
  await expect(switcher).toBeVisible();
  await expect(switcher.locator("[data-mail-pane]")).toHaveCount(3);
  await expect(page.locator("[data-mail-pane='list']")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-mail-list]")).toBeVisible();
  await expect(page.locator("[data-mail-interact]")).toBeHidden();
  await expect(page.locator("[data-mail-side]")).toBeHidden();

  await page.locator("[data-mail-pane='interact']").click();
  await expect(page.locator("[data-mail-interact]")).toBeVisible();
  await expect(page.locator("[data-mail-list]")).toBeHidden();
  await expect(page.locator("[data-mail-pane='interact']")).toHaveAttribute("aria-pressed", "true");

  // 选一封邮件 → 自动切到详情：正文与折叠面板都够得着（三栏时不应重复渲染）。
  await page.locator("[data-mail-pane='list']").click();
  await page.locator("[data-mail-timeline-item]").nth(1).click();
  await expect(page.locator("[data-mail-pane='detail']")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-mail-list]")).toBeHidden();
  await expect(page.locator("[data-mail-side]")).toBeVisible();
  await expect(page.locator("[data-mail-content]")).toBeVisible();
  await expect(page.locator("[data-mail-content]")).toHaveCount(1);
  await expect(page.locator("[data-mail-mobiletabs]")).toBeAttached();
  await expect(page.locator("[data-mail-fold='original']")).toBeVisible();

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
  // 仍然可以手动切回列表，说明深链只是初始面板，不是锁死。
  await page.locator("[data-mail-pane='list']").click();
  await expect(page.locator("[data-mail-list]")).toBeVisible();
  await expect(page.locator("[data-mail-side]")).toBeHidden();
});

test("停止 intake 只停本页等待，并说明任务仍会落在服务器", async ({ page }) => {
  await mockFormalMail(page);
  const gate: { release?: () => void } = {};
  const held = new Promise<void>((resolve) => { gate.release = resolve; });
  const runPosts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/api\/tasks\/[^/]+\/run$/.test(new URL(request.url()).pathname)) {
      runPosts.push(new URL(request.url()).pathname);
    }
  });
  await page.route("**/api/tasks/from-text", async (route) => {
    await held;
    await route.fulfill({
      json: { task: { id: "tsk_stop", title: "写合作邮件", task_type: "email_compose" }, needs_clarification: false },
    });
  });
  await page.goto("/mail?c=3901");
  await page.locator("textarea").fill("写合作邮件");
  await page.locator("[data-send]").click();
  await expect(page.locator("[data-stop-run]")).toBeVisible();

  await page.locator("[data-stop-run]").click();
  // 停止只撤本页的等待状态，文案不再暗示「已取消」。
  await expect(page.locator("[data-stop-run]")).toHaveCount(0);
  await expect(page.locator("[data-mail-notice]")).toContainText("已停止本页等待");
  await expect(page.locator("[data-mail-notice]")).toContainText("服务器仍会继续处理");

  // 已经发出的响应回来：保留结果、说明去向、不擅自跳转、不补发 run。
  gate.release?.();
  await expect(page.locator("[data-mail-notice]")).toContainText("已在服务器创建");
  await expect(page.locator("[data-mail-notice]")).toContainText("写合作邮件");
  await expect(page).toHaveURL(/\/mail\?/);
  expect(runPosts).toEqual([]);
});

test("mail negotiation workbench: mailbox to conversation to mail, summary stays", async ({ page }) => {
  await page.route("**/api/mail/box**", (route) => route.fulfill({ json: TWO_BOXES }));
  await page.route("**/api/mail/conversations**", (route) => {
    if (/^\/api\/mail\/conversations\/[^/]+$/.test(pathOf(route))) return route.fallback();
    return route.fulfill({ json: { conversations: [FORMAL_CONVERSATION] } });
  });
  await page.route("**/api/mail/conversations/**", (route) => route.fulfill({ json: FORMAL_THREAD }));
  await page.route("**/api/mail/person**", (route) => route.fulfill({ json: PERSON_DIGEST }));
  await page.route("**/api/home/board**", (route) => route.fulfill({ json: BOARD }));
  await page.goto("/mail");

  // 1) 切邮箱
  await page.locator("[data-mail-box-current]").click();
  await page.locator('[data-mail-box-option="larry.zhao@amperetime.com"]').click();
  await expect(page).toHaveURL(/box=larry\.zhao%40amperetime\.com/);

  // 2) 展开 L1/L2 看时间线
  await page.locator('[data-mail-correspondent="amy@example.com"]').click();
  await page.locator('[data-mail-thread-row="3901"]').click();
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

test("保留的 data-mail-* 契约全部渲染", async ({ page }) => {
  await mockFormalMail(page);
  await page.goto("/mail?c=3901");
  const required = [
    "[data-mail-page]",
    "[data-mail-panes]",
    "[data-mail-pane='list']",
    "[data-mail-pane='interact']",
    "[data-mail-pane='detail']",
    "[data-mail-source='api']",
    "[data-mail-list]",
    "[data-mail-entry='list-mailbox-mail']",
    "[data-mail-search]",
    "[data-mail-filter-unbound]",
    "[data-mail-list-tabs]",
    "[data-mail-correspondent]",
    "[data-mail-thread-count]",
    "[data-mail-thread-row]",
    "[data-mail-match-state]",
    "[data-mail-mail-count]",
    "[data-mail-timeline]",
    "[data-mail-timeline-item]",
    "[data-mail-selected]",
    "[data-mail-time]",
    "[data-mail-read-state]",
    "[data-mail-interact]",
    "[data-mail-task-chip]",
    "[data-mail-side]",
    "[data-mail-thread]",
    "[data-mail-mobiletabs]",
    "[data-mail-fold='summary']",
    "[data-mail-fold='translation']",
    "[data-mail-fold='original']",
    "[data-mail-summary-card]",
    "[data-mail-summary-body]",
    "[data-mail-digest]",
    "[data-digest-label]",
    "[data-digest-body]",
    "[data-summary-source='codex_memory']",
    "[data-mail-digest-tag]",
    "[data-mail-translation]",
    "[data-mail-translation-for]",
    "[data-mail-content]",
    "[data-mail-content-id]",
    "[data-mail-body]",
    "[data-mail-thread-actions]",
    "[data-mail-reply]",
    "[data-mail-analyze]",
    "[data-mail-draft-reply]",
    "[data-mail-sync]",
    "[data-mail-box]",
    "[data-mail-box-current]",
  ];
  for (const selector of required) {
    await expect(page.locator(selector).first(), selector).toBeAttached();
  }
  // 星标是独立按钮：命中区不小于 24×24（WCAG 2.2 SC 2.5.8）。
  const star = await page.locator("[data-mail-star]").boundingBox();
  expect(star?.width).toBeGreaterThanOrEqual(24);
  expect(star?.height).toBeGreaterThanOrEqual(24);
  await page.locator("[data-mail-box-current]").click();
  await expect(page.locator("[data-mail-box-option]")).toHaveCount(1);
});

test("首屏骨架保留三栏形状", async ({ page }) => {
  await mockFormalMail(page);
  await page.route("**/api/mail/box**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    await route.fulfill({ json: FORMAL_BOX });
  });
  await page.goto("/mail?c=3901");
  const skeleton = page.locator(".mail-pane-skeleton");
  await expect(skeleton).toBeVisible();
  await expect(page.locator("[data-mail-state='loading']")).toHaveCount(1);
  await expect(skeleton.locator(".mail-list")).toHaveCount(1);
  await expect(skeleton.locator(".mail-interact")).toHaveCount(1);
  await expect(skeleton.locator(".mail-detail")).toHaveCount(1);
});

test("a long person digest is clamped with an expand toggle", async ({ page }) => {
  const longDigest = "去信寒暄跟进，尚未落到报价、档期或明确兴趣。".repeat(12);
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
