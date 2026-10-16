import { expect, test } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  await request.post("/api/demo/reset", { data: { workbench: true } });
  await request.post("/api/me/persona", { data: { persona: "sriphy" } });
});

function followingEnvelope(kols: Array<Record<string, unknown>>) {
  return {
    entry: "memory",
    kind: "memory",
    creates_session: false,
    calls_model: false,
    index: "我的跟进",
    authority: "kol_follow_index+verified_starry_binding",
    completeness: "complete",
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
    kols,
  };
}

test("我的红人正常显示 following 返回的已验证 Starry 历史记录", async ({ page }) => {
  const sessionPosts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname.startsWith("/api/sessions")) {
      sessionPosts.push(new URL(request.url()).pathname);
    }
  });

  // board remains available to other Home surfaces, but it cannot authorize a
  // follow-list row or supplement this list.
  await page.route("**/api/home/board*", (route) => route.fulfill({
    json: {
      kols: [{
        id: "col_other_owner",
        kol_uid: "kol_other_owner",
        handle: "OtherOwnerOnly",
        display_name: "Other Owner Creator",
        platform: "YouTube",
        brand: "LT",
        stage_code: "INITIAL_CONTACT",
        stage_label: "初步接触",
        days_in_stage: 3,
        status: "active",
        owner_name: "其他负责人",
      }],
      workbench: {},
    },
  }));
  await page.route("**/api/home/following", (route) => route.fulfill({
    json: followingEnvelope([{
      id: "col_larry_starry",
      kol_uid: "kol_larry_starry",
      handle: "LarryFollowed",
      display_name: "Larry Followed Creator",
      platform: "YouTube",
      brand: "LT",
      stage_code: "INITIAL_CONTACT",
      stage_label: "初步接触",
      days_in_stage: 3,
      status: "active",
      source_kind: "starry_binding",
    }]),
  }));

  await page.goto("/");
  await page.locator('[data-home-mode="lifecycle"]').click();

  await expect(page.locator('[data-home-pane="lifecycle"]')).toBeVisible();
  // 总数只在中栏概览里；右栏工具行不重复一次计数。
  await expect(page.locator("[data-followed-overview-count]")).toHaveText("目前跟进了 1 位");
  await expect(page.locator("[data-followed-selected-count]")).toHaveCount(0);
  const list = page.locator("[data-followed-kol-list]");
  await expect(list).toBeVisible();
  await expect(list.locator('[data-followed-kol="LarryFollowed"]')).toBeVisible();
  await expect(list).toContainText("@LarryFollowed");
  await expect(list.locator('[data-followed-kol="OtherOwnerOnly"]')).toHaveCount(0);
  expect(sessionPosts).toEqual([]);
});

test("following 明确成功为空时绝不混入 board 的其他负责人记录", async ({ page }) => {
  await page.route("**/api/home/board*", (route) => route.fulfill({
    json: {
      kols: [{
        id: "col_other_owner",
        kol_uid: "kol_other_owner",
        handle: "OtherOwnerOnly",
        display_name: "Other Owner Creator",
        platform: "YouTube",
        stage_code: "INITIAL_CONTACT",
        stage_label: "初步接触",
        status: "active",
        owner_name: "其他负责人",
      }],
      workbench: {},
    },
  }));
  await page.route("**/api/home/following", (route) => route.fulfill({ json: followingEnvelope([]) }));

  await page.goto("/");
  await page.locator('[data-home-mode="lifecycle"]').click();

  await expect(page.locator('[data-follow-empty="mailbox"]')).toBeVisible();
  await expect(page.locator('[data-followed-kol="OtherOwnerOnly"]')).toHaveCount(0);
  await expect(page.locator("[data-followed-overview-count]")).toHaveText("目前跟进了 0 位");
});

// A board response arriving after the authoritative following read must not
// replace its binding or turn a verified mailbox empty state into generic empty.
test("迟到 board 不覆盖 following 已核对的空名单和邮箱范围", async ({ page }) => {
  let releaseBoard!: () => void;
  const boardGate = new Promise<void>((resolve) => { releaseBoard = resolve; });
  await page.route("**/api/home/board*", async (route) => {
    await boardGate;
    await route.fulfill({ json: {
      kols: [{ id: "col_other_owner", handle: "OtherOwnerOnly", owner_name: "其他负责人" }],
      workbench: {},
      follow_scope: null,
    } });
  });
  await page.route("**/api/home/following", (route) => route.fulfill({ json: followingEnvelope([]) }));
  await page.goto("/");
  await page.locator('[data-home-mode="lifecycle"]').click();
  const lateBoardResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/home/board");
  try {
    await expect(page.locator('[data-follow-empty="mailbox"]')).toBeVisible();
  } finally {
    releaseBoard();
  }
  // Observe the actual late read rather than sleeping for a guessed duration.
  await (await lateBoardResponse).finished();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  await expect(page.locator('[data-follow-empty="mailbox"]')).toBeVisible();
  await expect(page.locator('[data-follow-empty="mailbox"]')).toContainText("larry.zhao@amperetime.com");
  await expect(page.locator('[data-followed-kol="OtherOwnerOnly"]')).toHaveCount(0);
  await expect(page.locator("[data-followed-overview-count]")).toHaveText("目前跟进了 0 位");
});
