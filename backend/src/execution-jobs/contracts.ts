import type { Json, Row } from "../types.js";

export type ExecutionJobStatus = "queued" | "running" | "retrying" | "succeeded" | "failed" | "cancelled" | "uncertain";
export type ExecutionRiskLevel = "low" | "medium" | "high" | "critical";

export type ExecutionJobInput = {
  job_type: string;
  tenant_ref: string;
  actor_ref: string;
  idempotency_key: string;
  object_ref?: Json;
  ticket_id?: string | null;
  run_id?: string | null;
  trigger_event_id?: string | null;
  rule_id?: string | null;
  rule_version?: string | null;
  risk_level?: ExecutionRiskLevel;
  scope_snapshot?: Json;
  priority_class?: string;
  max_attempts?: number;
  next_attempt_at?: string | null;
  payload?: Json;
  outbox?: {
    event_type: string;
    aggregate_type: string;
    aggregate_id: string;
    payload?: Json;
    idempotency_key?: string;
  };
};

export type ClaimedExecutionJob = Row & { lease_until: string; worker_id: string };
