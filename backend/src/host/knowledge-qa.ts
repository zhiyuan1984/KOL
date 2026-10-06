import { authDisabled, requireAdmin } from "../auth.js";
import { audit, getConn } from "../db.js";
import { nid } from "../ids.js";
import type { Json, Row } from "../types.js";
import type { QaRewriteDiagnostic, QaScope } from "../../../shared/knowledge-qa.js";
import { object, QaContractRejected, readScope, type QaDocument } from "../knowledge/qa-contract.js";
import { rewriteQa } from "../knowledge/qa-rewriter.js";
import { maintainQaContext, readMaintenanceInput } from "../knowledge/qa-context.js";
import { assertQaBudget, captureQaUsage } from "../knowledge/qa-governance.js";
import { HttpFail } from "./errors.js";
import { knowledgeActorId } from "./knowledge.js";
import { postgresTransaction } from "../postgres/pool.js";
import { adminDocument } from "../knowledge-publication/service.js";

/** AsyncLocalStorage roles are a request snapshot, so check the account again after awaits. */
export function revalidateQaAdmin(): void {
  const user = requireAdmin();
  if (authDisabled()) return;
  const current = getConn().prepare("SELECT roles,active FROM users WHERE id=?").get(user.id) as Row | undefined;
  let roles: unknown = [];
  try { roles = JSON.parse(String(current?.roles || "[]")); } catch { /* deny malformed roles */ }
  if (!current || !current.active || !Array.isArray(roles) || !roles.includes("admin")) throw new HttpFail(403, "管理员权限已失效");
}
export function assertQaDocumentsUnchanged(docs: Row[]): void {
  for (const doc of docs) {
    const current = getConn().prepare("SELECT * FROM knowledge_documents WHERE id=?").get(doc.id) as Row | undefined;
    if (!current || current.status !== doc.status || current.updated_at !== doc.updated_at || current.artifacts !== doc.artifacts) {
      throw new HttpFail(409, { code: "knowledge_document_changed", message: "资料已变更，请重新查询" });
    }
  }
}
export async function authorizeQaDocuments(actor: string, tenant: string | undefined, documents: Array<{ id: string }>): Promise<void> {
  await postgresTransaction(async (db) => {
    for (const doc of documents) await adminDocument(db, actor, tenant, doc.id);
  });
}
export async function prepareAdminQaQuery(query: string, scope: QaScope, documents: QaDocument[], context: unknown, actor: string, tenant?: string): Promise<QaRewriteDiagnostic> {
  revalidateQaAdmin();
  assertQaBudget(actor);
  const requestId = nid("kqa");
  await authorizeQaDocuments(actor, tenant, documents);
  revalidateQaAdmin();
  assertQaBudget(actor);
  const started = Date.now();
  const outcome = await rewriteQa({ query, scope, documents, context });
  captureQaUsage(actor, "knowledge_rewrite", requestId, outcome.call);
  if (outcome.reason_code) audit(actor, outcome.diagnostic.status === "rejected" ? "knowledge.rewrite_rejected" : "knowledge.rewrite_unavailable", {
    request_id: requestId, base_id: scope.base_id, doc_ids: documents.map((d) => d.id), reason_code: outcome.reason_code,
    elapsed_ms: Date.now() - started, validation_version: "qa-host.v1",
  });
  revalidateQaAdmin();
  assertQaBudget(actor);
  return { ...outcome.diagnostic, request_id: requestId };
}

/** Ephemeral metadata only: no backend QA session, no employee-side entry. */
export async function maintainAdminQaContext(value: unknown, tenant?: string): Promise<Json> {
  revalidateQaAdmin();
  const actor = knowledgeActorId();
  const requestId = nid("kqa");
  try {
    const scope = readScope(object(value).scope);
    const base = getConn().prepare("SELECT * FROM knowledge_bases WHERE id=?").get(scope.base_id) as Row | undefined;
    if (!base || base.status !== "active" || base.kind !== "unstructured") throw new HttpFail(409, { code: "knowledge_scope_unavailable", message: "知识库范围不可用" });
    const ids = scope.doc_ids || [];
    if (scope.include_pending && ids.length !== 1) throw new HttpFail(400, { code: "knowledge_pending_scope", message: "审批试算只允许单份资料" });
    const conditions = ["base_id=?", scope.include_pending ? "status IN ('pending_review','published')" : "status='published'"];
    const args: unknown[] = [scope.base_id];
    if (ids.length) { conditions.push(`id IN (${ids.map(() => "?").join(",")})`); args.push(...ids); }
    const docs = getConn().prepare(`SELECT * FROM knowledge_documents WHERE ${conditions.join(" AND ")}`).all(...args) as Row[];
    if (!docs.length) throw new HttpFail(409, { code: "knowledge_scope_unavailable", message: "本次范围没有可用资料" });
    const documents = docs.map((d) => ({ id: String(d.id), title: String(d.title), filename: String(d.filename) }));
    await authorizeQaDocuments(actor, tenant, documents);
    const input = readMaintenanceInput(value, documents);
    assertQaBudget(actor);
    const outcome = await maintainQaContext(input);
    captureQaUsage(actor, "knowledge_qa_context", requestId, outcome.call);
    revalidateQaAdmin();
    await authorizeQaDocuments(actor, tenant, documents);
    assertQaDocumentsUnchanged(docs);
    const currentBase = getConn().prepare("SELECT status FROM knowledge_bases WHERE id=?").get(scope.base_id) as Row | undefined;
    if (currentBase?.status !== "active") throw new HttpFail(409, { code: "knowledge_scope_unavailable", message: "知识库已归档" });
    assertQaBudget(actor);
    if (outcome.reason_code) audit(actor, "knowledge.qa_context_unavailable", {
      request_id: requestId, base_id: scope.base_id, reason_code: outcome.reason_code, summary_truncated: outcome.result.summary_truncated,
    });
    return { ...outcome.result };
  } catch (error) {
    if (error instanceof QaContractRejected) {
      audit(actor, "knowledge.qa_context_rejected", { request_id: requestId, reason_code: error.code });
      throw new HttpFail(400, { code: error.code, message: "问答上下文不合法或超出限制" });
    }
    throw error;
  }
}
