import { getConn, txImmediate, type SqliteConn } from "../db.js";
import { nid } from "../ids.js";
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

function parseJson(value: unknown, fallback: Json = {}): Json {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Json;
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Json : fallback;
  } catch {
    return fallback;
  }
}

function isoAfter(now: Date, durationMs: number): string {
  return new Date(now.getTime() + durationMs).toISOString();
}

function uniqueError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT_UNIQUE/i.test(message);
}

export function executionJobById(id: string, db: SqliteConn = getConn()): Row | undefined {
  return db.prepare("SELECT * FROM execution_jobs WHERE id=?").get(id) as Row | undefined;
}

export function executionJobByIdempotencyKey(key: string, db: SqliteConn = getConn()): Row | undefined {
  return db.prepare("SELECT * FROM execution_jobs WHERE idempotency_key=?").get(key) as Row | undefined;
}

/**
 * Writes a durable job and its dispatch fact in the same database transaction.
 * Callers that already own a transaction pass its connection; otherwise this
 * function intentionally remains a single SQL operation sequence for the
 * SQLite transition worker and does not try to pretend it is a cross-service XA transaction.
 */
export function enqueueExecutionJob(input: ExecutionJobInput, options: { db?: SqliteConn; now?: Date } = {}): { job: Row; created: boolean } {
  if (!options.db) {
    return txImmediate((db) => enqueueExecutionJob(input, { ...options, db }));
  }
  const db = options.db;
  const existing = executionJobByIdempotencyKey(input.idempotency_key, db);
  if (existing) return { job: existing, created: false };
  const now = options.now || new Date();
  const createdAt = now.toISOString();
  const id = nid("job");
  const risk = input.risk_level || "low";
  const maxAttempts = Math.max(1, Math.min(20, Math.floor(Number(input.max_attempts || 1))));
  try {
    db.prepare(
      `INSERT INTO execution_jobs
       (id,job_type,tenant_ref,actor_ref,object_ref_json,ticket_id,run_id,trigger_event_id,rule_id,rule_version,
        risk_level,idempotency_key,scope_snapshot_json,priority_class,status,attempts,max_attempts,lease_until,
        next_attempt_at,payload_json,receipt_json,error_code,error_summary,created_at,started_at,terminal_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id,
      input.job_type,
      input.tenant_ref,
      input.actor_ref,
      JSON.stringify(input.object_ref || {}),
      input.ticket_id || null,
      input.run_id || null,
      input.trigger_event_id || null,
      input.rule_id || null,
      input.rule_version || null,
      risk,
      input.idempotency_key,
      JSON.stringify(input.scope_snapshot || {}),
      input.priority_class || "normal",
      "queued",
      0,
      maxAttempts,
      null,
      input.next_attempt_at || createdAt,
      JSON.stringify(input.payload || {}),
      null,
      null,
      null,
      createdAt,
      null,
      null,
      createdAt,
    );
  } catch (error) {
    if (!uniqueError(error)) throw error;
    const raced = executionJobByIdempotencyKey(input.idempotency_key, db);
    if (!raced) throw error;
    return { job: raced, created: false };
  }
  const outbox = input.outbox || {
    event_type: "execution_job.queued",
    aggregate_type: "execution_job",
    aggregate_id: id,
    payload: { job_type: input.job_type, tenant_ref: input.tenant_ref },
  };
  db.prepare(
    `INSERT OR IGNORE INTO execution_outbox
     (id,job_id,event_type,aggregate_type,aggregate_id,payload_json,idempotency_key,status,attempts,available_at,published_at,last_error,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    nid("obx"),
    id,
    outbox.event_type,
    outbox.aggregate_type,
    outbox.aggregate_id,
    JSON.stringify(outbox.payload || {}),
    outbox.idempotency_key || `execution-job:${input.idempotency_key}:queued`,
    "pending",
    0,
    createdAt,
    null,
    null,
    createdAt,
    createdAt,
  );
  return { job: executionJobById(id, db)!, created: true };
}

function claimRow(row: Row, workerId: string, leaseMs: number, now: Date, db: SqliteConn): ClaimedExecutionJob | null {
  const leaseUntil = isoAfter(now, leaseMs);
  const changed = db.prepare(
    `UPDATE execution_jobs
        SET status='running', attempts=attempts+1, lease_until=?, started_at=COALESCE(started_at,?), updated_at=?
      WHERE id=? AND status IN ('queued','retrying') AND (next_attempt_at IS NULL OR next_attempt_at<=?)`,
  ).run(leaseUntil, now.toISOString(), now.toISOString(), row.id, now.toISOString());
  if (!changed.changes) return null;
  const claimed = executionJobById(String(row.id), db);
  return claimed ? { ...claimed, lease_until: leaseUntil, worker_id: workerId } : null;
}

export function claimExecutionJobById(id: string, workerId: string, options: { lease_ms?: number; now?: Date } = {}): ClaimedExecutionJob | null {
  const now = options.now || new Date();
  const leaseMs = Math.max(1_000, Number(options.lease_ms || 60_000));
  return txImmediate((db) => {
    const row = executionJobById(id, db);
    return row ? claimRow(row, workerId, leaseMs, now, db) : null;
  });
}

export function claimNextExecutionJob(workerId: string, options: { job_types?: string[]; lease_ms?: number; now?: Date } = {}): ClaimedExecutionJob | null {
  const now = options.now || new Date();
  const leaseMs = Math.max(1_000, Number(options.lease_ms || 60_000));
  return txImmediate((db) => {
    const values: unknown[] = [now.toISOString()];
    let typeSql = "";
    if (options.job_types?.length) {
      typeSql = ` AND job_type IN (${options.job_types.map(() => "?").join(",")})`;
      values.push(...options.job_types);
    }
    const row = db.prepare(
      `SELECT * FROM execution_jobs
        WHERE status IN ('queued','retrying') AND (next_attempt_at IS NULL OR next_attempt_at<=?)${typeSql}
        ORDER BY CASE priority_class WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, created_at, id LIMIT 1`,
    ).get(...values) as Row | undefined;
    return row ? claimRow(row, workerId, leaseMs, now, db) : null;
  });
}

/** Mark the local worker handoff as published; the target is explicitly local in this SQLite transition. */
export function publishExecutionOutboxForJob(jobId: string, _publisher: string, now = new Date()): number {
  const stamp = now.toISOString();
  return txImmediate((db) => db.prepare(
    `UPDATE execution_outbox SET status='published',attempts=attempts+1,published_at=?,updated_at=?,last_error=NULL
      WHERE job_id=? AND status='pending' AND available_at<=?`,
  ).run(stamp, stamp, jobId, stamp).changes);
}

export function completeExecutionJob(id: string, receipt: Json = {}, now = new Date()): Row | undefined {
  const stamp = now.toISOString();
  txImmediate((db) => {
    db.prepare(
      `UPDATE execution_jobs SET status='succeeded',lease_until=NULL,receipt_json=?,error_code=NULL,error_summary=NULL,
       terminal_at=?,updated_at=? WHERE id=? AND status='running'`,
    ).run(JSON.stringify(receipt), stamp, stamp, id);
  });
  return executionJobById(id);
}

export function failExecutionJob(id: string, error: { code: string; summary: string }, options: { retry_at?: string | null; now?: Date } = {}): Row | undefined {
  const now = options.now || new Date();
  const stamp = now.toISOString();
  txImmediate((db) => {
    const current = executionJobById(id, db);
    if (!current || String(current.status) !== "running") return;
    const highRisk = ["high", "critical"].includes(String(current.risk_level));
    const canRetry = !highRisk && Number(current.attempts || 0) < Number(current.max_attempts || 1) && options.retry_at;
    const status: ExecutionJobStatus = highRisk ? "uncertain" : canRetry ? "retrying" : "failed";
    db.prepare(
      `UPDATE execution_jobs SET status=?,lease_until=NULL,next_attempt_at=?,error_code=?,error_summary=?,
       terminal_at=CASE WHEN ? IN ('failed','uncertain') THEN ? ELSE terminal_at END,updated_at=? WHERE id=?`,
    ).run(status, canRetry ? options.retry_at : null, error.code, error.summary.slice(0, 1000), status, stamp, stamp, id);
  });
  return executionJobById(id);
}

export function recoverExpiredExecutionJobs(now = new Date()): { requeued: number; uncertain: number } {
  const stamp = now.toISOString();
  return txImmediate((db) => {
    const rows = db.prepare(
      "SELECT * FROM execution_jobs WHERE status='running' AND lease_until IS NOT NULL AND lease_until<?",
    ).all(stamp) as Row[];
    let requeued = 0;
    let uncertain = 0;
    for (const row of rows) {
      const highRisk = ["high", "critical"].includes(String(row.risk_level));
      const retriable = !highRisk && Number(row.attempts || 0) < Number(row.max_attempts || 1);
      if (retriable) {
        db.prepare(
          `UPDATE execution_jobs SET status='retrying',lease_until=NULL,next_attempt_at=?,error_code='lease_expired',
           error_summary='Worker lease expired before a terminal receipt',updated_at=? WHERE id=? AND status='running'`,
        ).run(stamp, stamp, row.id);
        requeued += 1;
      } else {
        db.prepare(
          `UPDATE execution_jobs SET status='uncertain',lease_until=NULL,error_code='lease_expired',
           error_summary='Worker lease expired; manual outcome confirmation required',terminal_at=?,updated_at=? WHERE id=? AND status='running'`,
        ).run(stamp, stamp, row.id);
        uncertain += 1;
      }
    }
    return { requeued, uncertain };
  });
}

export function executionJobPayload(job: Row): Json {
  return parseJson(job.payload_json);
}

export function executionJobPublic(job: Row): Json {
  return {
    id: job.id,
    job_type: job.job_type,
    tenant_ref: job.tenant_ref,
    actor_ref: job.actor_ref,
    object_ref: parseJson(job.object_ref_json),
    ticket_id: job.ticket_id || null,
    run_id: job.run_id || null,
    trigger_event_id: job.trigger_event_id || null,
    rule_id: job.rule_id || null,
    rule_version: job.rule_version || null,
    risk_level: job.risk_level,
    idempotency_key: job.idempotency_key,
    scope_snapshot: parseJson(job.scope_snapshot_json),
    priority_class: job.priority_class,
    status: job.status,
    attempts: Number(job.attempts || 0),
    max_attempts: Number(job.max_attempts || 1),
    lease_until: job.lease_until || null,
    next_attempt_at: job.next_attempt_at || null,
    receipt: job.receipt_json ? parseJson(job.receipt_json) : null,
    error_code: job.error_code || null,
    error_summary: job.error_summary || null,
    created_at: job.created_at,
    started_at: job.started_at || null,
    terminal_at: job.terminal_at || null,
    updated_at: job.updated_at,
  };
}

export function listExecutionJobs(filters: { status?: string; limit?: number } = {}, db: SqliteConn = getConn()): Row[] {
  const limit = Math.min(Math.max(1, Math.floor(filters.limit || 50)), 200);
  if (filters.status) {
    return db.prepare("SELECT * FROM execution_jobs WHERE status=? ORDER BY created_at DESC,id DESC LIMIT ?")
      .all(filters.status, limit) as Row[];
  }
  return db.prepare("SELECT * FROM execution_jobs ORDER BY created_at DESC,id DESC LIMIT ?").all(limit) as Row[];
}
