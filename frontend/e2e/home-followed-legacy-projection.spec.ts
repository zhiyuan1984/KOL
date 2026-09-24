import { expect, test } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  await request.post("/api/demo/reset", { data: { workbench: true } });
  await request.post("/api/me/persona", { data: { persona: "sriphy" } });
});

test("我的红人 automatically shows Larry's legacy mailbox-scoped follow records", async ({ page }) => {
  const sessionPosts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname.startsWith("/api/sessions")) {
      sessionPosts.push(new URL(request.url()).pathname);
    }
  });

  // This is the still-supported pre-B.active shape: the board has already
  // scoped the collaboration to Larry's bound mailbox, while the follow index
  // has not been backfilled yet.
  await page.route("**/api/home/board*", (route) => route.fulfill({
    json: {
      kols: [{
        id: "col_larry_existing",
        kol_uid: "kol_larry_existing",
        handle: "LarryFollowed",
        display_name: "Larry Followed Creator",
        platform: "YouTube",
        brand: "LT",
        stage_code: "INITIAL_CONTACT",
        stage_label: "初步接触",
        days_in_stage: 3,
      }],
      follow_scope: {
        required: true,
        bound: true,
        mailbox_email: "larry.zhao@amperetime.com",
        mailbox_id: "mbx_larry",
        owner_name: "赵良玉",
        status: "connected",
        has_token: false,
        updated_at: null,
      },
      workbench: {},
    },
  }));
  await page.route("**/api/home/following", (route) => route.fulfill({
    json: {
      entry: "memory",
      kind: "memory",
      creates_session: false,
      calls_model: false,
      index: "我的跟进",
      kols: [],
      authority: "kol_follow_index",
    },
  }));

  await page.goto("/");
  await page.locator('[data-home-mode="lifecycle"]').click();

  await expect(page.locator('[data-home-pane="lifecycle"]')).toBeVisible();
  await expect(page.locator("[data-followed-selected-count]")).toHaveText("在跟 1 位");
  const list = page.locator("[data-followed-kol-list]");
  await expect(list).toBeVisible();
  await expect(list.locator('[data-followed-kol="LarryFollowed"]')).toBeVisible();
  await expect(list).toContainText("@LarryFollowed");
  expect(sessionPosts).toEqual([]);
});
