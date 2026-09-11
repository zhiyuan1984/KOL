export type Json = Record<string, unknown>;

export type Row = Record<string, unknown>;

export type TaskResultItem = {
  type: "task_result";
  title: string;
  summary: string;
  sections: Array<{ title: string; body: string; items?: string[] }>;
  metrics?: Json;
  recommended_actions?: string[];
};

export type Intent = {
  type: string;
  skill: string | null;
  handle: string | null;
  amount_usd: number | null;
  tracking: string | null;
  carrier: string | null;
  eta: string | null;
  needs_worker: boolean;
  raw: string;
  collaboration_id: string | null;
  extras: Json;
};

export type WorkerResult = {
  worker_id: string;
  status: string;
  skill: string;
  profile_id?: string;
  contract_log: Json[];
  items: Json[];
  box_path?: string | null;
  killed_reason?: string | null;
  extra?: Json;
  thread_id?: string | null;
  turn_id?: string | null;
};

export type SessionStatus = "listening" | "running" | "waiting_approval";

export type StageTransitionInput = {
  collaboration_id: string;
  from_stage: string;
  to_stage: string;
  reason_code: string;
  evidence: Json;
  recommender: string;
  approver: string;
  occurred_at: string;
  data_version_before: number;
  data_version_after: number;
  capability_profile: string;
  advancement_mode: string;
};
