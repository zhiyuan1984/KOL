import { expect, test } from "@playwright/test";

/** Explicit isolated-fixture opt-in only; never point this write test at production. */
test.skip(process.env.E2E_MAIL_LABEL_LIVE !== "1", "真实标签写入仅在明确的隔离 PG 夹具环境启用");

test("隔离真实 PG：浏览器确认标签、刷新持久化、导航过滤及确认移除，零 Agent 任务", async ({ page, baseURL }) => {
  const target = new URL(baseURL || "");
  expect(["127.0.0.1", "localhost"]).toContain(target.hostname);
  expect(process.env.E2E_MODE || "stub").toBe("stub");
  const mailbox = "mail-label-live@example.test";
  const conversationId = "mail-label-live-a";
  const labelName = `真实PG验收-${Date.now()}`;
  const taskPosts: string[] = [];
  page.on("request", request => {
    if (request.method() === "POST" && /\/api\/(?:sessions|tasks\/from-text|tasks\/[^/]+\/run|collaborations\/[^/]+\/session)/.test(request.url())) taskPosts.push(request.url());
  });
  const sessionCount = async () => {
    const response = await page.request.get("/api/sessions"); expect(response.ok()).toBe(true);
    const data = await response.json(); return Array.isArray(data) ? data.length : Array.isArray(data.sessions) ? data.sessions.length : Number(data.total || 0);
  };
  const before = await sessionCount();
  await page.goto(`/mail?${new URLSearchParams({ box: mailbox, c: conversationId })}`);
  await expect(page.locator("[data-mail-page]")).toHaveAttribute("data-mail-source", "api");
  await expect(page.locator("[data-mail-label-editor]")).toHaveAttribute("data-mail-label-object", conversationId);
  await expect(page.locator("[data-mail-label-input]")).toBeEnabled();
  await page.locator("[data-mail-label-input]").fill(labelName);
  const saved = page.waitForResponse(response => new URL(response.url()).pathname === "/api/actions/mail.label" && response.request().method() === "POST");
  await page.locator("[data-mail-label-add]").click();
  const response = await saved; expect(response.status()).toBe(200);
  const receipt = await response.json();
  expect(receipt).toMatchObject({ entry: "command", ok: true, mailbox, conversation_id: conversationId, creates_session: false, creates_turn: false, calls_model: false });
  await expect(page.locator("[data-mail-saved-label]").filter({ hasText: labelName })).toBeVisible();
  await page.reload();
  await expect(page.locator("[data-mail-saved-label]").filter({ hasText: labelName })).toBeVisible();
  const labelFilter = page.locator("[data-mail-label-filter]").filter({ hasText: labelName });
  await labelFilter.click();
  await expect(page.locator("[data-mail-correspondent]")).toHaveCount(1);
  await expect(page.locator("[data-mail-correspondent]")).toContainText("live-a@example.test");
  await page.getByRole("button", { name: `移除标签 ${labelName}`, exact: true }).click();
  const removed = page.waitForResponse(response => new URL(response.url()).pathname === "/api/actions/mail.label" && response.request().method() === "POST");
  await page.getByRole("button", { name: "确认移除", exact: true }).click();
  expect((await removed).status()).toBe(200);
  await expect(page.locator("[data-mail-empty-list]")).toHaveText("没有匹配的会话。");
  await page.locator("[data-mail-clear-label-filter]").click();
  await expect(page.locator("[data-mail-correspondent]")).toHaveCount(2);
  await page.reload();
  await expect(page.locator("[data-mail-label-input]")).toBeEnabled();
  await expect(page.locator("[data-mail-saved-label]").filter({ hasText: labelName })).toHaveCount(0);
  expect(await sessionCount()).toBe(before); expect(taskPosts).toEqual([]);
});
