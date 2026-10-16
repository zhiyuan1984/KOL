import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";
import { nativeKnowledgeAuth, reviewerContext } from "./fixtures/native-knowledge-auth";
import { nativeKnowledgePrincipal, nativeKnowledgeReviewer } from "./fixtures/native-knowledge-admin";

type NativeTemplate = {
  id: string;
  publishedVersion?: number | null;
  definition?: {
    name?: string;
    subjectType?: string;
    nodes?: Array<{ type?: string; assignee?: { kind?: string; userIds?: string[] } }>;
  };
};

async function jsonOk<T>(response: APIResponse, message: string): Promise<T> {
  expect(response.ok(), `${message}: ${response.status()} ${await response.text()}`).toBeTruthy();
  return response.json() as Promise<T>;
}

async function v2Template(request: APIRequestContext): Promise<{ id: string; version: number }> {
  const templates = await jsonOk<NativeTemplate[]>(
    await request.get("/api/admin/approval-types/v2/templates", { headers: { "X-Review-Company": nativeKnowledgeAuth.company } }),
    "read independent-reviewer template catalog",
  );
  const template = templates.find((item) => item.definition?.name === nativeKnowledgeAuth.template.name);
  const reviewer = template?.definition?.nodes?.find((node) => node.type === "review");
  expect(template).toMatchObject({
    publishedVersion: expect.any(Number),
    definition: expect.objectContaining({ subjectType: "knowledge_publication" }),
  });
  expect(reviewer?.assignee).toEqual({ kind: "named", userIds: [nativeKnowledgeReviewer.id] });
  return { id: template!.id, version: Number(template!.publishedVersion) };
}

async function createPublicationDraft(page: Page, request: APIRequestContext): Promise<string> {
  const title = `Native independent reviewer ${randomUUID()}`;
  await page.goto("/admin/knowledge/bases/kbase_legacy");
  await expect(page.locator("[data-admin-kb-base-meta]")).toBeVisible();
  await page.locator("[data-admin-kb-create-entry]").click();
  const form = page.locator("[data-admin-kb-create]");
  await expect(form).toBeVisible();
  await form.locator("input[name='title']").fill(title);
  await form.locator("select[name='kind']").selectOption("question_template");
  await form.locator("input[name='tags']").fill("native-review:independent");
  await form.locator("[name='structured:question']").fill("请核验隔离评审人是否独立。");
  await form.locator("[name='structured:answer']").fill("请求者不得自审，指定评审人可依法确认。");
  await form.locator("textarea[name='body']").fill("原生认证基础设施的隔离知识发布评审材料。");
  await form.locator("[data-admin-kb-create-submit]").click();
  await expect(page.locator("[data-admin-receipt]")).toContainText("草稿已创建");
  const rows = await jsonOk<Array<{ id: string; title: string; status: string }>>(
    await request.get("/api/admin/knowledge"),
    "read native publication draft",
  );
  const draft = rows.find((item) => item.title === title && item.status === "draft");
  expect(draft, "native publication draft should be created through the real admin flow").toBeTruthy();
  return draft!.id;
}

// The partition configs use metadata rather than title changes so normal-login
// coverage and the disabled-auth 401 control remain distinct and traceable.
const enabledNativeAuth = { tag: "@native-knowledge-enabled-auth" };
const legacyAnonymousAuth = { tag: "@native-knowledge-legacy-anonymous" };

test("native login exposes the authenticated knowledge catalog and published template", enabledNativeAuth, async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async (company) => {
    const read = async (path: string, init?: RequestInit) => {
      const response = await fetch(path, init);
      return { status: response.status, body: await response.json().catch(() => null) };
    };
    return {
      status: await read("/api/auth/status"),
      companies: await read("/api/approvals/v2/companies"),
      catalog: await read("/api/admin/knowledge/workspace-v1", { headers: { "X-Review-Company": company } }),
      templates: await read("/api/admin/approval-types/v2/templates", { headers: { "X-Review-Company": company } }),
    };
  }, nativeKnowledgeAuth.company);

  expect(result.status.status).toBe(200);
  expect(result.status.body).toMatchObject({
    authenticated: true,
    account: { id: nativeKnowledgePrincipal.id, username: nativeKnowledgePrincipal.username },
  });
  expect(result.status.body.permissions.demo).toBeFalsy();
  expect(result.status.body.permissions.skills).toContain(nativeKnowledgePrincipal.skillId);
  expect(result.companies.status).toBe(200);
  expect(result.companies.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: nativeKnowledgeAuth.company })]));
  expect(result.catalog.status).toBe(200);
  expect(result.catalog.body).toEqual(expect.objectContaining({ bases: expect.any(Array), rows: expect.any(Array) }));
  expect(result.templates.status).toBe(200);
  expect(result.templates.body).toEqual(expect.arrayContaining([
    expect.objectContaining({
      definition: expect.objectContaining({ name: nativeKnowledgeAuth.template.name, subjectType: "knowledge_publication" }),
      publishedVersion: expect.any(Number),
    }),
  ]));
});

test("requester cannot self-approve while the independently logged-in reviewer approves", enabledNativeAuth, async ({ page, browser }) => {
  const requester = page.request;
  const template = await v2Template(requester);
  const headers = { "X-Review-Company": nativeKnowledgeAuth.company };
  const entryId = await createPublicationDraft(page, requester);
  const submit = {
    templateId: template.id,
    templateVersion: template.version,
    values: {},
    releaseNote: "Native independent reviewer acceptance",
  };
  const prepared = await jsonOk<{ confirmationId: string }>(
    await requester.post(`/api/admin/knowledge/entries/${entryId}/publication-v2/prepare`, { headers, data: submit }),
    "prepare real knowledge-publication submission",
  );
  const submitted = await jsonOk<{ instanceId: string; status: string }>(
    await requester.post(`/api/admin/knowledge/entries/${entryId}/publication-v2/submit`, {
      headers,
      data: { command: submit, confirmationId: prepared.confirmationId, idempotencyKey: randomUUID() },
    }),
    "confirm real knowledge-publication submission",
  );
  expect(submitted.status).toBe("submitted");
  const requesterInstance = await jsonOk<{ id: string; version: number; status: string; allowedActions: string[] }>(
    await requester.get(`/api/approvals/v2/instances/${submitted.instanceId}`, { headers }),
    "read requester review instance",
  );
  expect(requesterInstance.status).toBe("reviewing");
  expect(requesterInstance.allowedActions).not.toContain("approve");

  const selfDecision = { action: "approve" as const, instanceId: requesterInstance.id, expectedVersion: requesterInstance.version, reason: "requester must not self-approve" };
  const selfPrepared = await requester.post("/api/approvals/v2/prepare", { headers, data: selfDecision });
  expect(selfPrepared.status(), `requester self-review must be denied: ${await selfPrepared.text()}`).toBe(403);

  const context = await reviewerContext(browser);
  try {
    const reviewer = context.request;
    const reviewerStatus = await jsonOk<{ authenticated: boolean; account: { id: string; username: string } | null }>(
      await reviewer.get("/api/auth/status"),
      "read reviewer authenticated status",
    );
    expect(reviewerStatus).toMatchObject({
      authenticated: true,
      account: { id: nativeKnowledgeReviewer.id, username: nativeKnowledgeReviewer.username },
    });
    const reviewerInstance = await jsonOk<{ id: string; version: number; status: string; allowedActions: string[] }>(
      await reviewer.get(`/api/approvals/v2/instances/${submitted.instanceId}`, { headers }),
      "read reviewer review instance",
    );
    expect(reviewerInstance.status).toBe("reviewing");
    expect(reviewerInstance.allowedActions).toContain("approve");
    const decision = { action: "approve" as const, instanceId: reviewerInstance.id, expectedVersion: reviewerInstance.version, reason: "independent reviewer checked the isolated knowledge-publication workflow" };
    const decisionPrepared = await jsonOk<{ confirmationId: string }>(
      await reviewer.post("/api/approvals/v2/prepare", { headers, data: decision }),
      "prepare independent reviewer decision",
    );
    const receipt = await jsonOk<{ action: string; resourceId: string }>(
      await reviewer.post("/api/approvals/v2/commands", {
        headers,
        data: { command: decision, confirmationId: decisionPrepared.confirmationId, idempotencyKey: randomUUID() },
      }),
      "confirm independent reviewer decision",
    );
    expect(receipt).toMatchObject({ action: "approve", resourceId: submitted.instanceId });
    await expect.poll(async () => {
      const final = await jsonOk<{ status: string }>(
        await reviewer.get(`/api/approvals/v2/instances/${submitted.instanceId}`, { headers }),
        "read final reviewer decision",
      );
      return final.status;
    }).toBe("approved");
  } finally {
    await context.close();
  }
});

test("anonymous caller is denied the native knowledge catalog", legacyAnonymousAuth, async ({ baseURL }) => {
  const response = await fetch(`${baseURL}/api/admin/knowledge/workspace-v1`, {
    headers: { "X-Review-Company": nativeKnowledgeAuth.company },
  });
  expect(response.status).toBe(401);
});
