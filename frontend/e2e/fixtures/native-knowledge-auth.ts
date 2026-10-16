import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { request, type APIRequestContext, type Browser, type BrowserContext, type FullConfig } from "@playwright/test";
import { knowledgeReviewDefinition } from "../../../shared/review";
import { nativeKnowledgePrincipal, nativeKnowledgeReviewer, prepareNativeKnowledgeAdmin } from "./native-knowledge-admin";

export const nativeKnowledgeAuth = {
  company: "company:amperetime",
  storageState: () => process.env.E2E_AUTH_STATE
    || path.join(process.env.PLAYWRIGHT_OUTPUT_DIR || os.tmpdir(), "native-knowledge-auth", "sriphy.json"),
  reviewerStorageState: () => process.env.E2E_REVIEWER_AUTH_STATE
    || path.join(process.env.PLAYWRIGHT_OUTPUT_DIR || os.tmpdir(), "native-knowledge-auth", "reviewer.json"),
  template: {
    creationKey: "native-knowledge-publication-template-v2",
    name: "Native knowledge publication review v2",
    reviewerId: nativeKnowledgeReviewer.id,
  },
} as const;

type Template = {
  id: string;
  version: number;
  publishedVersion?: number | null;
  definition?: {
    name?: string;
    subjectType?: string;
    nodes?: Array<{ type?: string; assignee?: { kind?: string; userIds?: string[] } }>;
  };
};

function responseError(status: number, text: string, action: string): Error {
  return new Error(`Native knowledge ${action} failed: ${status} ${text}`);
}

async function jsonOk<T>(response: Awaited<ReturnType<APIRequestContext["get"]>>, action: string): Promise<T> {
  if (!response.ok()) throw responseError(response.status(), await response.text(), action);
  return response.json() as Promise<T>;
}

async function login(context: APIRequestContext, username: string, password: string, action: string): Promise<void> {
  await jsonOk<{ ok: boolean }>(await context.post("/api/auth/login", { data: { username, password } }), action);
}

async function assertNativeIdentity(
  context: APIRequestContext,
  principal: typeof nativeKnowledgePrincipal | typeof nativeKnowledgeReviewer,
  requireAdministrator: boolean,
): Promise<void> {
  const status = await jsonOk<{
    authenticated: boolean;
    account: { id: string; username: string } | null;
    permissions: { admin?: boolean; demo?: boolean; skills?: string[] };
  }>(await context.get("/api/auth/status"), `${principal.id} authenticated status`);
  if (!status.authenticated || status.account?.id !== principal.id || status.account.username !== principal.username) {
    throw new Error(`Native knowledge login did not establish ${principal.id}`);
  }
  if (status.permissions.demo || (requireAdministrator && (!status.permissions.admin || !status.permissions.skills?.includes(nativeKnowledgePrincipal.skillId)))) {
    throw new Error(`Native knowledge ${principal.id} is not using the required normal account authority`);
  }
  if (!requireAdministrator && status.permissions.admin) {
    throw new Error("Native knowledge reviewer must remain a non-admin independent user");
  }
  const companies = await jsonOk<Array<{ id: string }>>(
    await context.get("/api/approvals/v2/companies"),
    `${principal.id} organization company listing`,
  );
  if (!companies.some((company) => company.id === nativeKnowledgeAuth.company)) {
    throw new Error(`Native knowledge ${principal.id} is not an active member of ${nativeKnowledgeAuth.company}`);
  }
}

function isPublishedV2Template(template: Template): boolean {
  const reviewer = template.definition?.nodes?.find((node) => node.type === "review");
  return Boolean(
    template.publishedVersion
    && template.definition?.name === nativeKnowledgeAuth.template.name
    && template.definition.subjectType === "knowledge_publication"
    && reviewer?.assignee?.kind === "named"
    && reviewer.assignee.userIds?.length === 1
    && reviewer.assignee.userIds[0] === nativeKnowledgeReviewer.id,
  );
}

/** Creates a browser context from the reviewer’s independently authenticated normal-login state. */
export async function reviewerContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ storageState: nativeKnowledgeAuth.reviewerStorageState() });
}

/**
 * Establish an authenticated browser state using the product's normal login
 * endpoint. The isolated principal and organization/Agent facts are prepared
 * before login; template publication happens only via prepare + confirmed
 * command, so confirmation evidence and lifecycle versions remain native.
 */
export default async function nativeKnowledgeGlobalSetup(config: FullConfig): Promise<void> {
  await prepareNativeKnowledgeAdmin();
  const baseURL = String(config.projects[0]?.use?.baseURL || process.env.E2E_BASE || "http://127.0.0.1:8949");
  const statePath = nativeKnowledgeAuth.storageState();
  const reviewerStatePath = nativeKnowledgeAuth.reviewerStorageState();
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.mkdir(path.dirname(reviewerStatePath), { recursive: true });

  const context = await request.newContext({ baseURL });
  const reviewer = await request.newContext({ baseURL });
  try {
    // The first native login runs the product's organization bootstrap. Link
    // both pre-existing registry people after it exists, then issue fresh
    // normal logins so each session authority snapshot is re-derived from PG.
    await login(context, nativeKnowledgePrincipal.username, nativeKnowledgePrincipal.password, "requester initial login");
    await prepareNativeKnowledgeAdmin();
    await login(context, nativeKnowledgePrincipal.username, nativeKnowledgePrincipal.password, "requester post-organization login");
    await login(reviewer, nativeKnowledgeReviewer.username, nativeKnowledgeReviewer.password, "reviewer post-organization login");
    await assertNativeIdentity(context, nativeKnowledgePrincipal, true);
    await assertNativeIdentity(reviewer, nativeKnowledgeReviewer, false);

    const headers = { "X-Review-Company": nativeKnowledgeAuth.company };
    const templates = await jsonOk<Template[]>(
      await context.get("/api/admin/approval-types/v2/templates", { headers }),
      "template catalog",
    );
    const v2 = templates.find((template) => template.definition?.name === nativeKnowledgeAuth.template.name);
    if (v2 && !isPublishedV2Template(v2)) {
      throw new Error("Existing v2 template is not the required published independent-reviewer template; published history must not be rewritten");
    }
    if (!v2) {
      const definition = knowledgeReviewDefinition();
      definition.name = nativeKnowledgeAuth.template.name;
      const reviewer = definition.nodes.find((node) => node.type === "review");
      if (!reviewer) throw new Error("Knowledge publication template requires a native review node");
      reviewer.assignee = { kind: "named", userIds: [nativeKnowledgeReviewer.id] };
      const created = await jsonOk<{ id: string; version: number }>(
        await context.post("/api/admin/approval-types/v2/templates", {
          headers,
          data: { definition, creationKey: nativeKnowledgeAuth.template.creationKey },
        }),
        "template draft creation",
      );
      const command = { action: "publish" as const, templateId: created.id, expectedVersion: created.version };
      const prepared = await jsonOk<{ confirmationId: string }>(
        await context.post("/api/approvals/v2/prepare", { headers, data: command }),
        "template publication confirmation preparation",
      );
      await jsonOk(
        await context.post("/api/approvals/v2/commands", {
          headers,
          data: { command, confirmationId: prepared.confirmationId, idempotencyKey: randomUUID() },
        }),
        "template publication confirmation submission",
      );
    }

    await context.storageState({ path: statePath });
    await reviewer.storageState({ path: reviewerStatePath });
  } finally {
    await context.dispose();
    await reviewer.dispose();
  }
}
