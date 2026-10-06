export type ScopeEvidence = { id: string; document_id: string; original_pages: number[]; text: string };
export type KnowledgeScope = {
  schema_version: 1;
  summary: string;
  entities: { name: string; evidence_ids: string[] }[];
  topics: { label: string; evidence_ids: string[] }[];
  question_types: string[];
  limitations: string[];
  unverified_notes: string[];
  evidence: ScopeEvidence[];
  coverage: { status: 'complete' | 'partial'; unreadable_pages: number[]; catalog_completeness: 'unknown' };
};
export type ScopeDetail = {
  document_id: string; revision: number; explanation: string; state: 'empty' | 'candidate' | 'checked' | 'published';
  scope: KnowledgeScope | null; fingerprint: string; job: { id: string; status: string; error_summary?: string } | null;
  actions: { edit: boolean; generate: boolean; check: boolean }; frozen: boolean;
};
export type KnowledgeManifest = {
  fingerprint: string;
  bases: { id: string; name: string; documents: { id: string; title: string; scope: KnowledgeScope | null; version: number }[] }[];
};
