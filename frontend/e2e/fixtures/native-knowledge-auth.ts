import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { request, type FullConfig } from "@playwright/test";
import { knowledgeReviewDefinition } from "../../../shared/review";
import { nativeKnowledgePrincipal, prepareNativeKnowledgeAdmin } from "./native-knowledge-admin";

export const nativeKnowledgeAuth = {
  company: "company:amperetime",
  storageState: () => process.env.E2E_AUTH_STATE
    || path.join(process.env.PLAYWRIGHT_OUTPUT_DIR || os.tmpdir(), "native-knowledge-auth", "sriphy.json"),
} as const;

type Template = {
  id: string;
  version: number;
  publishedVersion?: number | null;
  definition?: { subjectType?: string };
};

function responseError(status: number, text: string, action: string): Error {
  return new Error(`Native knowledge ${action} failed: ${status} ${text}`);
}

async function jsonOk<T>(response: Awaited<ReturnType<ReturnType<typeof request.newContext>["get"]>>, action: string): Promise<T> {
  if (!response.ok()) throw responseError(response.status(), await response.text(), action);
  return response.json() as Promise<T>;
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
  await fs.mkdir(path.dirname(statePath), { recursive: true });

  const context = await request.newContext({ baseURL });
  try {
    const login = async (action: string) => jsonOk<{ ok: boolean }>(await context.post("/api/auth/login", {
      data: { username: nativeKnowledgePrincipal.username, password: nativeKnowledgePrincipal.password },
    }), action);
    // The first native login runs the product's organization bootstrap. Link
    // the registry person only after it exists, then issue a fresh normal
    // login so the session's authority snapshot is re-derived from PG.
    await login("initial login");
    await prepareNativeKnowledgeAdmin();
    await login("post-organization login");

    const status = await jsonOk<{
      authenticated: boolean;
      account: { id: string; username: string } | null;
      permissions: { admin?: boolean; demo?: boolean; skills?: string[] };
    }>(await context.get("/api/auth/status"), "authenticated status");
    if (!status.authenticated || status.account?.id !== nativeKnowledgePrincipal.id || status.account.username !== nativeKnowledgePrincipal.username) {
      throw new Error("Native knowledge login did not establish the expected principal");
    }
    if (status.permissions.demo || !status.permissions.admin || !status.permissions.skills?.includes(nativeKnowledgePrincipal.skillId)) {
      throw new Error("Native knowledge principal is not a real administrator with derived Agent skill eligibility");
    }

    const headers = { "X-Review-Company": nativeKnowledgeAuth.company };
    const companies = await jsonOk<Array<{ id: string }>>(
      await context.get("/api/approvals/v2/companies"),
      "organization company listing",
    );
    if (!companies.some((company) => company.id === nativeKnowledgeAuth.company)) {
      throw new Error(`Native knowledge principal is not an active member of ${nativeKnowledgeAuth.company}`);
    }

    const templates = await jsonOk<Template[]>(
      await context.get("/api/admin/approval-types/v2/templates", { headers }),
      "template catalog",
    );
    if (!templates.some((template) => template.definition?.subjectType === "knowledge_publication" && template.publishedVersion)) {
      const definition = knowledgeReviewDefinition();
      const reviewer = definition.nodes.find((node) => node.type === "review");
      if (!reviewer) throw new Error("Knowledge publication template requires a native review node");
      reviewer.assignee = { kind: "named", userIds: [nativeKnowledgePrincipal.id] };
      const created = await jsonOk<{ id: string; version: number }>(
        await context.post("/api/admin/approval-types/v2/templates", {
          headers,
          data: { definition, creationKey: "native-knowledge-publication-template-v1" },
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
  } finally {
    await context.dispose();
  }
}
