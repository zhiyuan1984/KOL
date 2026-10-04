import { expect, test } from "@playwright/test";

test("home discovery submits to the lead agent without calling the retired crawler entry", async ({ page }) => {
  const oldPosts: string[] = [];
  page.on("request", request => {
    if (request.method() === "POST" && /\/api\/home\/discovery\/run$|\/start-crawl$/.test(new URL(request.url()).pathname)) oldPosts.push(request.url());
  });
  await page.goto("/?tab=discovery");
  await expect(page.locator("[data-discovery-search-card]")).toBeVisible();
  await page.locator("[data-home] [data-ai-prompt-submit]").click();
  await expect(page).toHaveURL(/\/s\/[^/]+$/);
  await expect(page.locator("[data-expert-identity='expert:crawler']")).toBeVisible();
  expect(oldPosts).toEqual([]);
});

test("shows exact pending scope, confirms once, and restores the receipt after reload", async ({ page, request }) => {
  const created = await request.post("/api/sessions", { data: { title: "Runtime confirmation UI" } });
  expect(created.ok()).toBeTruthy();
  const session = await created.json();
  const id = String(session.id || session.session_id || session.session?.id);
  let confirmations = 0;
  let state = "pending";
  await page.route("**/api/queries/runtime.actions?*", (route) => route.fulfill({ json: { actions: [{
    id: "action_ui_test", skill_id: "crawler_collect", operation: "start_crawl", arguments: { platforms: ["youtube"], keywords: "camping" },
    state, risk: "L3", confirmation_version: "reviewed-snapshot", blocked_reason: null,
    receipt: state === "succeeded" ? { task_id: "task_ui_test" } : null,
  }] } }));
  await page.route("**/api/actions/runtime.confirm", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ action_id: "action_ui_test", confirmation_version: "reviewed-snapshot" });
    confirmations += 1;
    state = "succeeded";
    await route.fulfill({ status: 202, json: { job: { id: "job_ui_test" } } });
  });
  await page.goto(`/s/${id}`);
  const actions = page.locator("[data-runtime-actions]");
  await expect(actions).toContainText("待确认");
  await expect(actions).toContainText("camping");
  expect(confirmations).toBe(0);
  await actions.getByRole("button", { name: "确认执行以上内容" }).click();
  await expect(actions).toContainText("已取得回执");
  expect(confirmations).toBe(1);
  await page.reload();
  await expect(page.locator("[data-runtime-actions]")).toContainText("已取得回执");
  await expect(page.getByRole("button", { name: "确认执行以上内容" })).toHaveCount(0);
  expect(confirmations).toBe(1);
});
