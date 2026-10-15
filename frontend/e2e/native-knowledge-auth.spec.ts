import { expect, test } from "@playwright/test";
import { nativeKnowledgeAuth } from "./fixtures/native-knowledge-auth";
import { nativeKnowledgePrincipal } from "./fixtures/native-knowledge-admin";

test("native login exposes the authenticated knowledge catalog and published template", async ({ page }) => {
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
    expect.objectContaining({ definition: expect.objectContaining({ subjectType: "knowledge_publication" }), publishedVersion: expect.any(Number) }),
  ]));
});

test("anonymous caller is denied the native knowledge catalog", async ({ baseURL }) => {
  const response = await fetch(`${baseURL}/api/admin/knowledge/workspace-v1`, {
    headers: { "X-Review-Company": nativeKnowledgeAuth.company },
  });
  expect(response.status).toBe(401);
});
