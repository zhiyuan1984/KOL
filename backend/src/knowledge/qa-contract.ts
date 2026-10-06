import { QA_CONTEXT_VERSION, QA_LAST_ANSWER_LIMIT, QA_SUMMARY_LIMIT, qaScopeKey, type QaContext, type QaScope, type QaTurn } from "../../../shared/knowledge-qa.js";

export const QA_CONTEXT_BYTES = 128 * 1024;
export const QA_MAX_ITEMS = 256;
export const QA_MAX_ENTITY_LENGTH = 256;
export type QaDocument = { id: string; title: string; filename?: string };
export class QaContractRejected extends Error {
  constructor(public code: string) { super(code); this.name = "QaContractRejected"; }
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new QaContractRejected("invalid_object");
  return value as Record<string, unknown>;
}
export function text(value: unknown, max: number): string {
  if (typeof value !== "string") throw new QaContractRejected("invalid_string");
  if (value.length > max) throw new QaContractRejected("context_limit_exceeded");
  return value;
}
export function stringList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > QA_MAX_ITEMS) throw new QaContractRejected("invalid_entity_list");
  return value.map((v) => {
    const s = text(v, QA_MAX_ENTITY_LENGTH);
    if (!s.trim() || s !== s.trim()) throw new QaContractRejected("invalid_entity");
    return s;
  });
}
export function assertSize(value: unknown): void {
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > QA_CONTEXT_BYTES) throw new QaContractRejected("context_limit_exceeded");
}
export function readScope(value: unknown): QaScope {
  const s = object(value);
  const base_id = text(s.base_id, 256);
  if (!base_id || (s.include_pending !== undefined && typeof s.include_pending !== "boolean")) throw new QaContractRejected("invalid_scope");
  const doc_ids = s.doc_ids === undefined ? undefined : stringList(s.doc_ids);
  return { base_id, ...(doc_ids ? { doc_ids } : {}), include_pending: Boolean(s.include_pending) };
}
export function readTurn(value: unknown, answerLimit: number, docs: QaDocument[]): QaTurn {
  const t = object(value);
  if (!Array.isArray(t.citations) || t.citations.length > QA_MAX_ITEMS) throw new QaContractRejected("invalid_citations");
  const citations = t.citations.map((raw) => {
    const c = object(raw);
    const name = text(c.document, 1024);
    const id = c.document_id == null ? null : text(c.document_id, 256);
    const doc = id ? docs.find((d) => d.id === id) : docs.find((d) => d.title === name || d.filename === name);
    if (!doc) throw new QaContractRejected("context_citation_out_of_scope");
    if (c.page !== null && (typeof c.page !== "number" || !Number.isInteger(c.page) || c.page < 1)) throw new QaContractRejected("invalid_citation_page");
    // Only server-known names are allowed as entity provenance.
    return { document: doc.title, document_id: doc.id, title: doc.title, page: c.page as number | null };
  });
  return { query: text(t.query, 16000), answer: text(t.answer, answerLimit), entities: stringList(t.entities), citations };
}
export function readQaContext(value: unknown, scope: QaScope, docs: QaDocument[]): QaContext {
  if (value === undefined || value === null) return { version: QA_CONTEXT_VERSION, scope, last_turn: null, history_summary: "" };
  assertSize(value);
  const c = object(value);
  if (c.version !== QA_CONTEXT_VERSION) throw new QaContractRejected("unknown_context_version");
  const declared = readScope(c.scope);
  if (qaScopeKey(declared) !== qaScopeKey(scope)) throw new QaContractRejected("context_scope_mismatch");
  return {
    version: QA_CONTEXT_VERSION, scope,
    last_turn: c.last_turn === null ? null : readTurn(c.last_turn, QA_LAST_ANSWER_LIMIT, docs),
    history_summary: text(c.history_summary, QA_SUMMARY_LIMIT),
  };
}
export function hasEntitySource(entity: string, context: QaContext): boolean {
  return Boolean(context.last_turn?.entities.includes(entity)
    || context.last_turn?.citations.some((c) => c.document.includes(entity))
    || context.history_summary.includes(entity));
}
