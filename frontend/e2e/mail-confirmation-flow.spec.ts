import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

test.skip(process.env.E2E_MODE === "real", "This suite submits only to the isolated stub mail adapter, never live SMTP.");

// This is the deterministic published snapshot inserted by the native bootstrap
// fixture. It is intentionally reused instead of calling the retired direct
// approval endpoint. It is the sole cited applicable template in this fixture;
// multi-candidate explicit selection is covered in mail-compose-flow.spec.ts.
const SEEDED_TEMPLATE_ID = "kb_mail_kol";

async function preparedSession(request: APIRequestContext): Promise<string> {
  const reset = await request.post("/api/demo/reset", { data: { workbench: true } });
  expect(reset.ok()).toBeTruthy();
  // Citation is persona-scoped and idempotent. The template itself is a native
  // published fixture; the test must not bypass the formal approval/publish
  // workflow merely to manufacture a selectable mail source.
  const cited = await request.post(`/api/knowledge/${SEEDED_TEMPLATE_ID}/cite`);
  expect(cited.ok(), await cited.text()).toBeTruthy();
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
  // 当前已发布模板的展示标题是稳定的“邮件模板”；来源与发布版本才是可核验事实。
  await expect(page.locator("[data-mail-template-source]")).toHaveText("邮件模板");
  await expect(page.getByText("来源：知识库", { exact: true })).toBeVisible();
  await expect(page.locator("[data-mail-template-version]")).toContainText("发布版 v");
  await expect(input).toHaveValue(/We would love to send a LiTime Mini 12V/);
  await page.locator("[data-mail-compose-subject] input").fill("Employee reviewed partnership subject");
  await input.fill("Hello Xiaomei,\n\nThis exact edited body is the reviewed test draft.\n\nRegards, Test Operator");
  await page.locator("[data-send]").click();
  const card = page.locator('[data-kind="email-card"]').last();
  await expect(card).toBeVisible();
  await expect(card.locator("[data-draft-body]")).toHaveValue(/This exact edited body is the reviewed test draft/);
  await expect(card.locator("[data-draft-template-source]")).toContainText("第 1 版");
  await expect(page.locator('[data-session-stream-pane] [data-kind="me"]').last()).toContainText("This exact edited body is the reviewed test draft.");
  // 邮件草稿在结果工作台展开；必须可见、在视口中且发送按钮不被输入框盖住。
  const send = card.locator('[data-email-action="send"]');
  await expect(card).toBeInViewport();
  await expect(send).toBeInViewport();
  await expect.poll(() => send.evaluate((element) => {
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
    if (req.method() === "POST" && /\/api\/actions\/mail\.send$/.test(new URL(req.url()).pathname)) sendRequests.push(req.postDataJSON());
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
  const replay = await request.post("/api/actions/mail.send", { data: sendRequests[0] });
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
  const rejected = page.waitForResponse((res) => res.request().method() === "POST" && res.url().endsWith("/api/actions/mail.send"));
  await confirm.locator("[data-admin-confirm-ok]").click();
  expect((await rejected).status()).toBe(409);
  await expect(confirm.getByRole("alert")).toBeVisible();
  const view = await request.get(`/api/queries/mail.draft-actions?draft_id=${did}`).then((r) => r.json());
  expect(view.action.state).not.toBe("completed");
  expect(view.snapshot.body).toBe("A new unconfirmed body from another tab.");
});
