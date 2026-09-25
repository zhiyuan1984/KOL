import { expect, test, type Page } from "@playwright/test";

type PrepareReply = {
  status: "ready" | "needs_context" | "needs_template" | "needs_fields" | "blocked";
  skill_id: "email_compose";
  message?: string;
  context: Record<string, string>;
  template?: { knowledge_id: string; published_version: number; title: string; source: "knowledge" };
  editor?: { from: string; to: string[]; subject: string; body: string };
  missing_fields: string[];
  candidates: Array<{ knowledge_id: string; title: string; published_version: number }>;
  context_version?: string;
};

const READY: PrepareReply = {
  status: "ready",
  skill_id: "email_compose",
  message: "已准备邮件草稿，可继续编辑。",
  context: {
    collaboration_id: "col_xiaomei",
    stage_code: "FOLLOW_UP",
    stage_source: "collaboration",
    brand: "LiTime",
  },
  template: {
    knowledge_id: "kb_followup_v2",
    published_version: 7,
    title: "阶段跟进",
    source: "knowledge",
  },
  editor: {
    from: "brand@litime.example",
    to: ["creator@example.com"],
    subject: "LiTime collaboration follow-up",
    body: "Hello Creator,\n\nThis is the prepared body.",
  },
  missing_fields: [],
  candidates: [],
  context_version: "context-v7",
};

async function chooseMailSkill(page: Page): Promise<void> {
  const input = page.locator("[data-home] [data-composer-input]");
  await input.fill("/");
  const option = page.locator("[data-skill-picker] [data-skill-option='email_compose']");
  await expect(option).toBeVisible();
  await option.click();
}

async function stubPrepare(page: Page, reply: PrepareReply, delay = 0): Promise<Array<Record<string, unknown>>> {
  const requests: Array<Record<string, unknown>> = [];
  await page.route("**/api/email-compose/prepare", async (route) => {
    requests.push(route.request().postDataJSON() as Record<string, unknown>);
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    await route.fulfill({ json: reply });
  });
  return requests;
}

test.beforeEach(async ({ page, request }) => {
  await request.post("/api/demo/reset", { data: { workbench: true } });
  await page.goto("/");
});

test("choosing email compose prepares immediately and unknown context never supplies a default stage", async ({ page }) => {
  const requests = await stubPrepare(page, {
    status: "needs_context",
    skill_id: "email_compose",
    message: "请选择红人或补充收件信息。",
    context: {},
    missing_fields: ["collaboration_id"],
    candidates: [],
  });

  await chooseMailSkill(page);
  await expect(page.locator("[data-mail-compose-status='editing']")).toBeVisible();
  await expect(page.locator("[data-mail-compose-message]")).toContainText("请选择红人");
  await expect(page.locator("[data-mail-compose-missing]")).toContainText("合作对象");
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toMatchObject({ skill_id: "email_compose", object_refs: [] });
  expect(requests[0]).not.toHaveProperty("stage_code");
  expect(JSON.stringify(requests[0])).not.toContain("INITIAL_CONTACT");
});

test("template candidates stay deterministic until the employee chooses one, then prepare that exact knowledge id", async ({ page }) => {
  const requests: Array<Record<string, unknown>> = [];
  await page.route("**/api/email-compose/prepare", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    requests.push(body);
    if (body.knowledge_id === "kb_b") {
      await route.fulfill({ json: { ...READY, template: { ...READY.template!, knowledge_id: "kb_b", title: "跟进模板 B" } } });
      return;
    }
    await route.fulfill({
      json: {
        status: "needs_template",
        skill_id: "email_compose",
        message: "有多个同等适用的模板，请选择其一。",
        context: { collaboration_id: "col_xiaomei", stage_code: "FOLLOW_UP", brand: "LiTime" },
        missing_fields: [],
        candidates: [
          { knowledge_id: "kb_a", title: "跟进模板 A", published_version: 3 },
          { knowledge_id: "kb_b", title: "跟进模板 B", published_version: 5 },
        ],
        context_version: "ctx-candidate",
      },
    });
  });

  await chooseMailSkill(page);
  await expect(page.locator("[data-mail-compose-status='editing']")).toBeVisible();
  await expect(page.locator("[data-mail-compose-message]")).toContainText("多个同等适用的模板");
  await expect(page.locator("[data-mail-compose-subject] input")).toHaveValue("");
  await expect(page.locator("[data-home] [data-composer-input]")).toHaveValue("");
  await page.locator("[data-mail-compose-candidate='kb_b']").click();
  await expect(page.locator("[data-mail-template-source]")).toContainText("跟进模板 B");
  await expect(page.locator("[data-home] [data-composer-input]")).toHaveValue(READY.editor!.body);
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1]).toMatchObject({ skill_id: "email_compose", knowledge_id: "kb_b" });
});

test("a ready preparation submits the explicit edited body and retains it when intake fails", async ({ page }) => {
  await stubPrepare(page, READY);
  let intake: Record<string, unknown> | null = null;
  await page.route("**/api/tasks/from-text", async (route) => {
    intake = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 503, json: { detail: "intake unavailable" } });
  });

  await chooseMailSkill(page);
  const input = page.locator("[data-home] [data-composer-input]");
  await expect(input).toHaveValue(READY.editor!.body);
  await page.locator("[data-mail-compose-subject] input").fill("Edited subject");
  await input.fill("Employee authored body");
  await page.locator("[data-home] [data-send]").click();

  await expect.poll(() => intake).not.toBeNull();
  expect(intake).toMatchObject({
    intent: "email_compose",
    knowledge_id: "kb_followup_v2",
    compose_input: {
      mode: "edited_draft",
      knowledge_version: 7,
      context_version: "context-v7",
      subject: "Edited subject",
      body: "Employee authored body",
    },
  });
  await expect(input).toHaveValue("Employee authored body");
  await expect(page.locator("[data-mail-compose-status='failed']")).toBeVisible();
  await expect(page.locator("[data-mail-compose-subject] input")).toHaveValue("Edited subject");
});

test("a delayed prepare response cannot overwrite a body edited while it was in flight", async ({ page }) => {
  await stubPrepare(page, READY, 1500);

  await chooseMailSkill(page);
  const input = page.locator("[data-home] [data-composer-input]");
  await expect(page.locator("[data-mail-compose-status='preparing']")).toBeVisible();
  await input.fill("Keep this authored body");
  await expect(page.locator("[data-mail-apply-prepared]")).toBeVisible();
  await expect(input).toHaveValue("Keep this authored body");
  await expect(page.locator("[data-mail-compose-subject] input")).toHaveValue(READY.editor!.subject);
});

test("the Chat composer prepares with its current session and forwards the edited-draft metadata", async ({ page, request }) => {
  const session = await request.post("/api/sessions", { data: { title: "mail compose flow" } });
  const { id } = await session.json() as { id: string };
  const requests = await stubPrepare(page, READY);

  await page.goto(`/s/${id}`);
  const input = page.locator("[data-composer-input]");
  await input.fill("/");
  const option = page.locator("[data-skill-picker] [data-skill-option='email_compose']");
  await expect(option).toBeVisible();
  await option.click();
  await expect(page.locator("[data-mail-compose-status='editing']")).toBeVisible();
  await expect(input).toHaveValue(READY.editor!.body);
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toMatchObject({ skill_id: "email_compose", session_id: id });
  expect(JSON.stringify(requests[0])).not.toContain("INITIAL_CONTACT");
});

test("the test suite never calls a mail draft send endpoint", async ({ page }) => {
  const sendPosts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/api\/drafts\/[^/]+\/send$/.test(new URL(request.url()).pathname)) {
      sendPosts.push(request.url());
    }
  });
  await stubPrepare(page, READY);

  await chooseMailSkill(page);
  await expect(page.locator("[data-mail-compose-status='editing']")).toBeVisible();
  expect(sendPosts).toEqual([]);
});

test("an incomplete published template still prefills an editable draft for the employee to complete", async ({ page }) => {
  await stubPrepare(page, {
    ...READY,
    status: "needs_fields",
    message: "请补齐模板中的必填字段。",
    editor: { ...READY.editor!, body: "Hello Creator, the proposed budget is [金额USD]." },
    missing_fields: ["[金额USD]"],
  });
  await chooseMailSkill(page);
  const input = page.locator("[data-home] [data-composer-input]");
  await expect(input).toHaveValue("Hello Creator, the proposed budget is [金额USD].");
  await expect(page.locator("[data-mail-compose-missing]")).toContainText("金额USD");
  await input.fill("Hello Creator, the proposed budget is USD 200.");
  await expect(input).toHaveValue("Hello Creator, the proposed budget is USD 200.");
});
