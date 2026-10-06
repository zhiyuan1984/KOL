/** Ephemeral admin QA context; never an authorization or factual-evidence token. */
export const QA_CONTEXT_VERSION = "knowledge-qa-context.v1" as const;
export const QA_LAST_ANSWER_LIMIT = 2000;
export const QA_SUMMARY_LIMIT = 1500;
export const QA_COMPRESSION_TURNS = 8;
export const QA_TURN_WINDOW = 8;

export type QaScope = { base_id: string; doc_ids?: string[]; include_pending?: boolean };
export type QaCitation = {
  document: string;
  page: number | null;
  document_id?: string | null;
  title?: string;
  engine_doc_id?: string;
};
export type QaTurn = { query: string; answer: string; entities: string[]; citations: QaCitation[] };
export type QaContext = {
  version: typeof QA_CONTEXT_VERSION;
  scope: QaScope;
  last_turn: QaTurn | null;
  history_summary: string;
};
export type QaRewriteProposal = { rewritten: string; resolved_entities: string[]; rewrote: boolean; reason: string };
export type QaRewriteDiagnostic = {
  request_id?: string;
  status: "applied" | "unchanged" | "rejected" | "unavailable";
  original_query: string;
  effective_query: string;
  resolved_entities: string[];
  reason: string;
};
export type QaMaintenanceInput = {
  scope: QaScope;
  turn: QaTurn;
  effective_query?: string;
  history_summary: string;
  compress?: boolean;
};
export type QaMaintenanceResult = {
  entities: string[];
  history_summary: string;
  status: "ready" | "degraded";
  compressed: boolean;
  summary_truncated: boolean;
  reason?: string;
};

export function qaScopeKey(scope: QaScope): string {
  return JSON.stringify([scope.base_id, [...new Set(scope.doc_ids || [])].sort(), Boolean(scope.include_pending)]);
}
