import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

test.skip(process.env.E2E_MODE === "real", "This suite submits only to the isolated stub mail adapter, never live SMTP.");

async function preparedSession(request: APIRequestContext): Promise<string> {
  const reset = await request.post("/api/demo/reset", { data: { workbench: true } });
  expect(reset.ok()).toBeTruthy();
  const created = await request.post("/api/admin/knowledge", { data: {
    id: "e2e_confirmed_first_touch", title: "E2E 首封建联", body: "Published knowledge source",
    kind: "mail_template", skill_id: "email_compose", brand: "LT", stage_codes: ["INITIAL_CONTACT"],
    subject: "Partnership with [红人]", body_en: "Hello [红人],\n\nWe would like to explore a collaboration.",
    placeholders: ["[红人]"], status: "draft", in_market: true,
  } });
  // Demo reset preserves knowledge governance; reuse this suite's published fixture.
  if (!created.ok()) expect(await created.json()).toEqual({ detail: "knowledge id exists" });
  expect((await request.post("/api/admin/knowledge/e2e_confirmed_first_touch/approve")).ok()).toBeTruthy();
  expect((await request.post("/api/knowledge/e2e_confirmed_first_touch/cite")).ok()).toBeTruthy();
  const response = await request.post("/api/sessions", { data: { collaboration_id: "col_xiaomei" } });
  expect(response.ok(), await response.text()).toBeTruthy();
  const session = await response.json();
  return String(session.id || session.session_id || session.session?.id);
}

async function createAuthoredDraft(page: Page, sid: string): Promise<string> {
  await page.goto(`/s/${sid}`);
  const input = page.locator("[data-composer-input]");
  await input.fill("/");
  await page.locator('[data-skill-option="email_compose"]').click();
  await expect(page.locator('[data-mail-compose-status="editing"]')).toBeVisible();
  const candidate = page.locator('[data-mail-compose-candidate="e2e_confirmed_first_touch"]');
  if (await candidate.isVisible()) await candidate.click();
  await expect(input).toHaveValue(/We would like to explore a collaboration/);
  await page.locator("[data-mail-compose-subject] input").fill("Employee reviewed partnership subject");
  await input.fill("Hello Xiaomei,\n\nThis exact edited body is the reviewed test draft.\n\nRegards, Test Operator");
  await page.locator("[data-send]").click();
  const card = page.locator('[data-kind="email-card"]').last();
  await expect(card).toBeVisible();
  await expect(card.locator("[data-draft-body]")).toHaveValue(/This exact edited body is the reviewed test draft/);
  await expect(card.locator("[data-draft-template-source]")).toContainText("第 1 版");
  await expect(page.locator('[data-session-stream-pane] [data-kind="me"]').last()).toContainText("This exact edited body is the reviewed test draft.");
  await expect(page.locator('[data-session-stream-pane] [data-kind="email-card-pointer"]').last()).toBeInViewport();
  await expect.poll(() => page.locator('[data-session-stream-pane] [data-kind="email-card-pointer"]').last().evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return Boolean(hit && element.contains(hit));
  })).toBe(true);
  return String(await card.getAttribute("data-card-id"));
}

test("choose skill, edit, submit, review exact snapshot and confirm once; cancel never sends", async ({ page, request }, testInfo) => {
  const sid = await preparedSession(request);
  const sendRequests: Array<Record<string, unknown>> = [];
  page.on("request", (req) => {
    if (req.method() === "POST" && /\/api\/drafts\/[^/]+\/send$/.test(new URL(req.url()).pathname)) sendRequests.push(req.postDataJSON());
  });
  const did = await createAuthoredDraft(page, sid);
  expect(sendRequests).toHaveLength(0);
  const card = page.locator(`[data-card-id="${did}"]`);
  await page.screenshot({ path: testInfo.outputPath("authored-draft-workspace.png"), fullPage: false });
  await card.locator('[data-email-action="send"]').click();
  const confirm = page.locator('[data-admin-confirm="draft-send"]');
  await expect(confirm).toBeVisible();
  await expect(confirm.locator("[data-mail-confirm-body]")).toContainText("This exact edited body is the reviewed test draft");
  await expect(confirm.locator("[data-admin-confirm-object]")).toContainText("xiaomei.beauty@example.com");
  expect(sendRequests).toHaveLength(0);
  await page.screenshot({ path: testInfo.outputPath("exact-send-confirmation.png"), fullPage: false });
  await confirm.locator("[data-admin-confirm-cancel]").click();
  expect(sendRequests).toHaveLength(0);
  await card.locator('[data-email-action="send"]').click();
  await expect(confirm).toBeVisible();
  await confirm.locator("[data-admin-confirm-ok]").click();
  await expect(card).toHaveAttribute("data-status", "sent");
  expect(sendRequests).toHaveLength(1);
  expect(sendRequests[0].confirmation_version).toBeTruthy();
  expect(sendRequests[0].request_id).toBeTruthy();
  expect(sendRequests[0]).not.toHaveProperty("body_en");
  const replay = await request.post(`/api/drafts/${did}/send`, { data: sendRequests[0] });
  expect(replay.ok(), await replay.text()).toBeTruthy();
  expect(await replay.json()).toMatchObject({ status: "sent", replayed: true, stage_changed: false });
  const session = await request.get(`/api/sessions/${sid}`).then((r) => r.json());
  expect(JSON.stringify(session)).toContain("INITIAL_CONTACT");
});

test("editing the server draft after the dialog opened invalidates confirmation instead of sending new content", async ({ page, request }) => {
  const sid = await preparedSession(request);
  const did = await createAuthoredDraft(page, sid);
  const card = page.locator(`[data-card-id="${did}"]`);
  await card.locator('[data-email-action="send"]').click();
  const confirm = page.locator('[data-admin-confirm="draft-send"]');
  await expect(confirm).toBeVisible();
  expect((await request.patch(`/api/drafts/${did}`, { data: { body_en: "A new unconfirmed body from another tab." } })).ok()).toBeTruthy();
  const rejected = page.waitForResponse((res) => res.request().method() === "POST" && res.url().endsWith(`/api/drafts/${did}/send`));
  await confirm.locator("[data-admin-confirm-ok]").click();
  expect((await rejected).status()).toBe(409);
  await expect(confirm.getByRole("alert")).toBeVisible();
  const view = await request.get(`/api/drafts/${did}/actions`).then((r) => r.json());
  expect(view.action.state).not.toBe("completed");
  expect(view.snapshot.body).toBe("A new unconfirmed body from another tab.");
});
