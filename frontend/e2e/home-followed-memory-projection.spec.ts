import { expect, test } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  await request.post("/api/demo/reset", { data: { workbench: true } });
  await request.post("/api/me/persona", { data: { persona: "sriphy" } });
});

test("我的红人先读本地记忆并直接渲染互动结果", async ({ page }) => {
  const resultRequests: string[] = [];
  const sessionPosts: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "GET" && (path === "/api/home/following" || path === "/api/home/board")) {
      resultRequests.push(path);
    }
    if (request.method() === "POST" && path.startsWith("/api/sessions")) sessionPosts.push(path);
  });

  await page.route("**/api/home/following", (route) => route.fulfill({
    json: {
      entry: "memory",
      kind: "memory",
      creates_session: false,
      calls_model: false,
      index: "我的跟进",
      authority: "kol_follow_index",
      follow_scope: { required: false, bound: false, mailbox_email: "", mailbox_id: "", owner_name: "", status: "unbound", has_token: false, updated_at: null },
      kols: [{
        kol_uid: "KOL_MEMORY_FIRST",
        follow_id: "follow_memory_first",
        identity: { display: "@MemoryFirst", platform: "YouTube" },
        stage: { code: "INTERESTED", label: "已回复-有兴趣" },
        dwell: { days: 2 },
        latest_correspondence: {
          valid: true,
          summary: "I am interested. Please share the rate card and next steps.",
          at: "2026-09-24T10:00:00.000Z",
          thread_id: "thread-memory-first",
          refused: false,
        },
        clock_14d: {
          last_interaction_at: "2026-09-24T10:00:00.000Z",
          last_effective_mail_at: "2026-09-24T10:00:00.000Z",
          days_since_interaction: 1,
          days_remaining: 13,
          release_due_at: "2026-10-08T10:00:00.000Z",
          countdown: true,
          cron_eligible: true,
          release_scheduler: false,
          label: "14 日计时（只读）",
          near: false,
        },
        risk: { chips: [{ id: "interested", label: "有兴趣" }], refused: false, exception: false, high_risk: false },
        brief_priority: "interested",
        mail_threads: [{
          conversation_id: "thread-memory-first",
          subject: "Re: partnership",
          last_direction: "inbound",
          last_snippet: "I am interested. Please share the rate card and next steps.",
          last_at: "2026-09-24T10:00:00.000Z",
          unread_count: 1,
        }],
        unread_count: 1,
      }],
    },
  }));
  await page.route("**/api/home/board*", (route) => route.fulfill({ json: { kols: [], follow_scope: { required: false, bound: false } } }));

  await page.goto("/");
  await page.locator('[data-home-mode="lifecycle"]').click();

  const card = page.locator('[data-followed-kol="MemoryFirst"]');
  await expect(card).toBeVisible();
  await expect(card).toContainText("I am interested. Please share the rate card and next steps.");
  await expect(card.locator('[data-stage-code="INTERESTED"]')).toBeVisible();
  await expect(page.locator("[data-followed-journey]")).toBeVisible();
  await expect(page.locator('[data-followed-stage-quick-filter]')).toBeVisible();
  expect(resultRequests[0]).toBe("/api/home/following");
  expect(sessionPosts).toEqual([]);
});
