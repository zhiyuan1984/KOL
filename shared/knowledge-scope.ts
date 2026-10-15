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
export type ScopeJobStatus = 'queued' | 'running' | 'retrying' | 'succeeded' | 'failed' | 'uncertain' | 'cancelled';
export type ScopeJobProgress = {
  /** Completed extraction batches, not a worker heartbeat or page count. */
  done: number;
  /** `null` means the backend has not yet determined a real batch total. */
  total: number | null;
  unit: 'batches';
  /** Updated only after a batch completes; never substituted with read/heartbeat time. */
  last_progress_at?: string;
};
export type ScopeHandoff = {
  /** A backend-authorized automatic extraction intent and its durable queue handoff. */
  status: 'pending' | 'queued' | 'failed' | 'none';
  requested_at?: string;
  error?: string;
};
export type ScopeDetail = {
  document_id: string; revision: number; explanation: string; state: 'empty' | 'candidate' | 'checked' | 'published';
  scope: KnowledgeScope | null; fingerprint: string;
  job: {
    id: string; status: ScopeJobStatus; error_summary?: string; attempts?: number; max_attempts?: number;
    started_at?: string; terminal_at?: string; progress: ScopeJobProgress;
  } | null;
  handoff: ScopeHandoff;
  actions: { edit: boolean; generate: boolean; check: boolean }; frozen: boolean;
};
export type KnowledgeManifest = {
  fingerprint: string;
  bases: { id: string; name: string; documents: { id: string; title: string; scope: KnowledgeScope | null; version: number }[] }[];
};
