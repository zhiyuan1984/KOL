import { expect, test } from "@playwright/test";

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
  bindings: [
    { mailbox: "larry.zhao@amperetime.com", label: "美国邮箱", owner_name: "赵良玉", unread: 2, bound: true, synced_at: "2026-09-18T01:00:00.000Z", error: null },
    { mailbox: "eu@litime.com", label: "欧洲邮箱", owner_name: "李四", unread: 0, bound: true, synced_at: "2026-09-18T01:00:00.000Z", error: null },
  ],
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
  digest_text: "对方已确认档期，等待报价单。",
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
      body_text: "Hi Larry,\n\n我们很想和 LiTime 合作，请发报价单。\n\nBest,\nAmy",
      letter_summary: "对方明确表达合作意愿，请求报价单。",
      summary_source: "codex_memory",
      translation_zh: "你好 Larry，\n\n我们很想和 LiTime 合作，请发报价单。\n\n此致，\nAmy",
      translation_source: "codex_memory",
      receipt_status: "",
      effective: true,
      memory_source: "codex_memory",
      memory_generated_at: "2026-09-18T01:00:00.000Z",
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
      body_text: "Hi Amy,\n\nThanks for reaching out. We'd love to collaborate.\n\nBest,\nLarry",
      letter_summary: "去信致谢并表达合作意愿。",
      summary_source: "codex_memory",
      translation_zh: "你好 Amy，\n\n感谢联系。我们很希望能合作。\n\n此致，\nLarry",
      translation_source: "codex_memory",
      receipt_status: "",
      effective: true,
      memory_source: "codex_memory",
      memory_generated_at: "2026-09-18T01:00:00.000Z",
    },
  ],
  digest_text: "对方已确认档期，等待报价单。",
  digest_source: "codex_memory",
};

const PERSON_DIGEST = {
  entry: "memory",
  creates_session: false,
  mailbox: "larry.zhao@amperetime.com",
  peer_email: "amy@example.com",
  digest_text: "与 Amy 的往来集中在 LiTime 合作邀约，对方已确认档期并请求报价单。",
  digest_source: "codex_memory",
  digest_generated_at: "2026-09-18T01:00:00.000Z",
};

async function mockMail(page: import("@playwright/test").Page) {
  await page.route("**/api/mail/box**", (route) => route.fulfill({ json: FORMAL_BOX }));
  await page.route("**/api/mail/conversations", (route) => {
    if (/\/conversations\/[^/?]+/.test(route.request().url())) return route.fallback();
    route.fulfill({ json: { entry: "memory", creates_session: false, mailbox: "larry.zhao@amperetime.com", conversations: [FORMAL_CONVERSATION] } });
  });
  await page.route("**/api/mail/conversations/*", (route) => route.fulfill({ json: FORMAL_THREAD }));
  await page.route("**/api/mail/person**", (route) => route.fulfill({ json: PERSON_DIGEST }));
  await page.route("**/api/home/board**", (route) => route.fulfill({ json: { kols: [], follow_scope: { bound: true, mailbox_email: "larry.zhao@amperetime.com", owner_name: "赵良玉", status: "connected" } } }));
}

test("screenshot 1440x900 conversation view", async ({ page }) => {
  await mockMail(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/mail?c=3901");
  await expect(page.locator("[data-mail-thread-row='3901']")).toBeVisible();
  await page.locator("[data-mail-thread-row='3901']").click();
  await expect(page.locator("[data-mail-timeline-item]")).toHaveCount(2);
  await page.screenshot({ path: "test-results/mail-1440x900-conversation.png", fullPage: false });
});

test("screenshot 1440x900 message view", async ({ page }) => {
  await mockMail(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/mail?c=3901&m=m2");
  await expect(page.locator("[data-mail-thread-row='3901']")).toBeVisible();
  await page.locator("[data-mail-thread-row='3901']").click();
  await expect(page.locator("[data-mail-content]")).toBeVisible();
  await page.screenshot({ path: "test-results/mail-1440x900-message.png", fullPage: false });
});

test("screenshot 1280x800 conversation view", async ({ page }) => {
  await mockMail(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/mail?c=3901");
  await expect(page.locator("[data-mail-thread-row='3901']")).toBeVisible();
  await page.locator("[data-mail-thread-row='3901']").click();
  await expect(page.locator("[data-mail-timeline-item]")).toHaveCount(2);
  await page.screenshot({ path: "test-results/mail-1280x800-conversation.png", fullPage: false });
});

test("screenshot 1280x800 person view", async ({ page }) => {
  await mockMail(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/mail?p=amy@example.com");
  await expect(page.locator("[data-mail-correspondent='amy@example.com']")).toBeVisible();
  await page.screenshot({ path: "test-results/mail-1280x800-person.png", fullPage: false });
});
