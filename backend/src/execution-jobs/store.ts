import { postgresDb, pgSerialTransaction, type PgRepository } from "../postgres/access.js";
import { nid } from "../ids.js";
import type { Json, Row } from "../types.js";
import type { ClaimedExecutionJob, ExecutionJobInput, ExecutionJobStatus, ExecutionRiskLevel } from "./contracts.js";
export type { ClaimedExecutionJob, ExecutionJobInput, ExecutionJobStatus, ExecutionRiskLevel } from "./contracts.js";
function parseJson(value: unknown, fallback: Json = {}): Json {
  if (value && typeof value === "object" && !Array.isArray(value))
    return value as Json;
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Json : fallback;
  }
  catch {
    return fallback;
  }
}

function isoAfter(now: Date, durationMs: number): string {
  return new Date(now.getTime() + durationMs).toISOString();
}
function retryDelayMs(attempt: number): number {
  return Math.min(60000, 1000 * 2 ** Math.min(6, Math.max(0, attempt - 1)));
}
async function insertDispatchOutbox(db: PgRepository, job: Row, input: {
  eventType: string;
  idempotencyKey: string;
  payload: Json;
  availableAt: string;
  now: string;
}): Promise<void> {
  (await db.execute(`INSERT INTO execution_outbox
     (id,job_id,event_type,aggregate_type,aggregate_id,payload_json,idempotency_key,status,attempts,available_at,published_at,last_error,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT DO NOTHING`, nid("obx"), String(job.id), input.eventType, "execution_job", String(job.id), JSON.stringify(input.payload), input.idempotencyKey, "pending", 0, input.availableAt, null, null, input.now, input.now));
}
function uniqueError(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error
    ? String((error as {
      code?: unknown;
    }).code || "")
    : "";
  const message = error instanceof Error ? error.message : String(error || "");
  return code === "23505" || /UNIQUE constraint failed|SQLITE_CONSTRAINT_UNIQUE/i.test(message);
}
export async function executionJobById(id: string, db: PgRepository = postgresDb()): Promise<Row | undefined> {
  return (await db.one("SELECT * FROM execution_jobs WHERE id=$1", id)) as Row | undefined;
}
export async function executionJobByIdempotencyKey(key: string, db: PgRepository = postgresDb()): Promise<Row | undefined> {
  return (await db.one("SELECT * FROM execution_jobs WHERE idempotency_key=$1", key)) as Row | undefined;
}
/**
 * Writes a durable job and its dispatch fact in the same database transaction.
 * Callers that already own a transaction pass its connection; otherwise this
 * function intentionally remains a single SQL operation sequence inside the
 * PostgreSQL serializable repository transaction; it never claims cross-service XA semantics.
 */
export async function enqueueExecutionJob(input: ExecutionJobInput, options: {
  db?: PgRepository;
  now?: Date;
} = {}): Promise<{
  job: Row;
  created: boolean;
}> {
  if (!options.db) {
    return (await pgSerialTransaction(async (db) => (await enqueueExecutionJob(input, { ...options, db }))));
  }
  const db = options.db;
  const existing = (await executionJobByIdempotencyKey(input.idempotency_key, db));
  if (existing)
    return { job: existing, created: false };
  const now = options.now || new Date();
  const createdAt = now.toISOString();
  const id = nid("job");
  const risk = input.risk_level || "low";
  const maxAttempts = Math.max(1, Math.min(20, Math.floor(Number(input.max_attempts || 1))));
  try {
    (await db.execute(`INSERT INTO execution_jobs
       (id,job_type,tenant_ref,actor_ref,object_ref_json,ticket_id,run_id,trigger_event_id,rule_id,rule_version,
        risk_level,idempotency_key,scope_snapshot_json,priority_class,status,attempts,max_attempts,lease_until,
        next_attempt_at,payload_json,receipt_json,error_code,error_summary,created_at,started_at,terminal_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)`, id, input.job_type, input.tenant_ref, input.actor_ref, JSON.stringify(input.object_ref || {}), input.ticket_id || null, input.run_id || null, input.trigger_event_id || null, input.rule_id || null, input.rule_version || null, risk, input.idempotency_key, JSON.stringify(input.scope_snapshot || {}), input.priority_class || "normal", "queued", 0, maxAttempts, null, input.next_attempt_at || createdAt, JSON.stringify(input.payload || {}), null, null, null, createdAt, null, null, createdAt));
  }
  catch (error) {
    if (!uniqueError(error))
      throw error;
    const raced = (await executionJobByIdempotencyKey(input.idempotency_key, db));
    if (!raced)
      throw error;
    return { job: raced, created: false };
  }
  const outbox = input.outbox || {
    event_type: "execution_job.queued",
    aggregate_type: "execution_job",
    aggregate_id: id,
    payload: { job_type: input.job_type, tenant_ref: input.tenant_ref },
  };
  (await db.execute(`INSERT INTO execution_outbox
     (id,job_id,event_type,aggregate_type,aggregate_id,payload_json,idempotency_key,status,attempts,available_at,published_at,last_error,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT DO NOTHING`, nid("obx"), id, outbox.event_type, outbox.aggregate_type, outbox.aggregate_id, JSON.stringify(outbox.payload || {}), outbox.idempotency_key || `execution-job:${input.idempotency_key}:queued`, "pending", 0, createdAt, null, null, createdAt, createdAt));
  return { job: (await executionJobById(id, db))!, created: true };
}
async function claimRow(row: Row, workerId: string, leaseMs: number, now: Date, db: PgRepository): Promise<ClaimedExecutionJob | null> {
  const leaseUntil = isoAfter(now, leaseMs);
  const changed = (await db.execute(`UPDATE execution_jobs
        SET status='running', attempts=attempts+1, lease_until=$1, lease_owner=$2, started_at=COALESCE(started_at,$3), updated_at=$4
      WHERE id=$5 AND status IN ('queued','retrying') AND (next_attempt_at IS NULL OR next_attempt_at<=$6)`, leaseUntil, workerId, now.toISOString(), now.toISOString(), row.id, now.toISOString()));
  if (!changed.changes)
    return null;
  const claimed = (await executionJobById(String(row.id), db));
  return claimed ? { ...claimed, lease_until: leaseUntil, worker_id: workerId } : null;
}
export async function claimExecutionJobById(id: string, workerId: string, options: {
  lease_ms?: number;
  now?: Date;
} = {}): Promise<ClaimedExecutionJob | null> {
  const now = options.now || new Date();
  const leaseMs = Math.max(1000, Number(options.lease_ms || 60000));
  return (await pgSerialTransaction(async (db) => {
    const row = (await executionJobById(id, db));
    return row ? (await claimRow(row, workerId, leaseMs, now, db)) : null;
  }));
}
export async function claimNextExecutionJob(workerId: string, options: {
  job_types?: string[];
  lease_ms?: number;
  now?: Date;
} = {}): Promise<ClaimedExecutionJob | null> {
  const now = options.now || new Date();
  const leaseMs = Math.max(1000, Number(options.lease_ms || 60000));
  return (await pgSerialTransaction(async (db) => {
    const values: unknown[] = [now.toISOString()];
    let typeSql = "";
    if (options.job_types?.length) {
      const placeholders = options.job_types.map((type) => {
        values.push(type);
        return `$${values.length}`;
  });
      typeSql = ` AND job_type IN (${placeholders.join(",")})`;
    }
    const row = (await db.one(`SELECT * FROM execution_jobs
        WHERE status IN ('queued','retrying') AND (next_attempt_at IS NULL OR next_attempt_at<=$1)${typeSql}
        ORDER BY CASE priority_class WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, created_at, id LIMIT 1`, ...values)) as Row | undefined;
    return row ? (await claimRow(row, workerId, leaseMs, now, db)) : null;
  }));
}
/** Renew only the lease held by this worker. A stale or replaced worker must
 * never extend another consumer's claim. */
export async function renewExecutionJobLease(id: string, workerId: string, options: {
  lease_ms?: number;
  now?: Date;
} = {}): Promise<boolean> {
  const now = options.now || new Date();
  const leaseUntil = isoAfter(now, Math.max(1000, Number(options.lease_ms || 60000)));
  return (await pgSerialTransaction(async (db) => (await db.execute(`UPDATE execution_jobs SET lease_until=$1,updated_at=$2
      WHERE id=$3 AND status='running' AND lease_owner=$4`, leaseUntil, now.toISOString(), id, workerId)).changes > 0));
}
/** Mark the local worker handoff as published after durable PostgreSQL claim processing. */
export async function publishExecutionOutboxForJob(jobId: string, _publisher: string, now = new Date()): Promise<number> {
  const stamp = now.toISOString();
  return (await pgSerialTransaction(async (db) => (await db.execute(`UPDATE execution_outbox SET status='published',attempts=attempts+1,published_at=$1,updated_at=$2,last_error=NULL
      WHERE job_id=$3 AND status='pending' AND available_at<=$4`, stamp, stamp, jobId, stamp)).changes));
}
export async function completeExecutionJob(id: string, receipt: Json = {}, now = new Date(), transactionDb?: PgRepository): Promise<Row | undefined> {
  const stamp = now.toISOString();
  const finish = async (db: PgRepository) => {
    (await db.execute(`UPDATE execution_jobs SET status='succeeded',lease_until=NULL,lease_owner=NULL,receipt_json=$1,error_code=NULL,error_summary=NULL,
       terminal_at=$2,updated_at=$3 WHERE id=$4 AND status='running'`, JSON.stringify(receipt), stamp, stamp, id));
  };
  if (transactionDb)
    (await finish(transactionDb));
  else
    (await pgSerialTransaction(finish));
  return (await executionJobById(id, transactionDb));
}
export async function failExecutionJob(id: string, error: {
  code: string;
  summary: string;
}, options: {
  retry_at?: string | null;
  now?: Date;
} = {}): Promise<Row | undefined> {
  const now = options.now || new Date();
  const stamp = now.toISOString();
  (await pgSerialTransaction(async (db) => {
    const current = (await executionJobById(id, db));
    if (!current || String(current.status) !== "running")
      return;
    const highRisk = ["high", "critical"].includes(String(current.risk_level));
    const canRetry = !highRisk && Number(current.attempts || 0) < Number(current.max_attempts || 1);
    const retryAt = canRetry
      ? (options.retry_at || isoAfter(now, retryDelayMs(Number(current.attempts || 0))))
      : null;
    const status: ExecutionJobStatus = highRisk ? "uncertain" : canRetry ? "retrying" : "failed";
    (await db.execute(`UPDATE execution_jobs SET status=$1,lease_until=NULL,lease_owner=NULL,next_attempt_at=$2,error_code=$3,error_summary=$4,
       terminal_at=CASE WHEN $5 IN ('failed','uncertain') THEN $6 ELSE terminal_at END,updated_at=$7 WHERE id=$8`, status, retryAt, error.code, error.summary.slice(0, 1000), status, stamp, stamp, id));
    if (canRetry && retryAt) {
      (await insertDispatchOutbox(db, current, {
        eventType: "execution_job.retry_scheduled",
        idempotencyKey: `execution-job:${id}:retry:${Number(current.attempts || 0)}`,
        payload: { reason: error.code, attempt: Number(current.attempts || 0), retry_at: retryAt },
        availableAt: retryAt,
        now: stamp,
      }));
    }
  }));
  return (await executionJobById(id));
}
/**
 * A human-requested recovery never reuses a broker message. It changes only a
 * failed low-risk job back to queued and records a fresh Outbox dispatch fact
 * in the same PostgreSQL transaction. Uncertain/high-risk outcomes deliberately
 * remain outside this endpoint: they need an explicit investigation/takeover.
 */
export async function retryFailedExecutionJob(id: string, options: {
  actor_ref?: string;
  now?: Date;
} = {}): Promise<{
  job: Row | undefined;
  retried: boolean;
  reason?: "not_found" | "not_failed" | "risk_requires_takeover";
}> {
  const now = options.now || new Date();
  const stamp = now.toISOString();
  return (await pgSerialTransaction(async (db) => {
    const current = (await executionJobById(id, db));
    if (!current)
      return { job: undefined, retried: false, reason: "not_found" as const };
    if (String(current.status) !== "failed")
      return { job: current, retried: false, reason: "not_failed" as const };
    if (String(current.risk_level) !== "low")
      return { job: current, retried: false, reason: "risk_requires_takeover" as const };
    const changed = (await db.execute(`UPDATE execution_jobs
          SET status='queued',lease_until=NULL,lease_owner=NULL,next_attempt_at=$1,error_code=NULL,error_summary=NULL,
              terminal_at=NULL,max_attempts=CASE WHEN max_attempts<=attempts THEN attempts+1 ELSE max_attempts END,
              updated_at=$2
        WHERE id=$3 AND status='failed' AND risk_level='low'`, stamp, stamp, id));
    const job = (await executionJobById(id, db));
    if (!changed.changes || !job)
      return { job, retried: false, reason: "not_failed" as const };
    const attempt = Number(job.attempts || 0);
    (await insertDispatchOutbox(db, job, {
      eventType: "execution_job.retry_requested",
      idempotencyKey: `execution-job:${id}:manual-retry:${attempt}`,
      payload: { actor_ref: options.actor_ref, attempt, risk_level: job.risk_level },
      availableAt: stamp,
      now: stamp,
    }));
    return { job, retried: true };
  }));
}
export async function recoverExpiredExecutionJobs(now = new Date()): Promise<{
  requeued: number;
  uncertain: number;
}> {
  const stamp = now.toISOString();
  return (await pgSerialTransaction(async (db) => {
    const rows = (await db.many("SELECT * FROM execution_jobs WHERE status='running' AND lease_until IS NOT NULL AND lease_until<$1", stamp)) as Row[];
    let requeued = 0;
    let uncertain = 0;
    for (const row of rows) {
      const highRisk = ["high", "critical"].includes(String(row.risk_level));
      const retriable = !highRisk && Number(row.attempts || 0) < Number(row.max_attempts || 1);
      if (retriable) {
        (await db.execute(`UPDATE execution_jobs SET status='retrying',lease_until=NULL,lease_owner=NULL,next_attempt_at=$1,error_code='lease_expired',
           error_summary='Worker lease expired before a terminal receipt',updated_at=$2 WHERE id=$3 AND status='running'`, stamp, stamp, row.id));
        (await insertDispatchOutbox(db, row, {
          eventType: "execution_job.lease_recovered",
          idempotencyKey: `execution-job:${row.id}:lease-recovery:${Number(row.attempts || 0)}`,
          payload: { reason: "lease_expired", attempt: Number(row.attempts || 0) },
          availableAt: stamp,
          now: stamp,
        }));
        requeued += 1;
      }
      else {
        (await db.execute(`UPDATE execution_jobs SET status='uncertain',lease_until=NULL,lease_owner=NULL,error_code='lease_expired',
           error_summary='Worker lease expired; manual outcome confirmation required',terminal_at=$1,updated_at=$2 WHERE id=$3 AND status='running'`, stamp, stamp, row.id));
        uncertain += 1;
      }
    }
    return { requeued, uncertain };
  }));
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
    lease_owner: job.lease_owner || null,
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
export async function listExecutionJobs(filters: {
  status?: string;
  limit?: number;
} = {}, db: PgRepository = postgresDb()): Promise<Row[]> {
  const limit = Math.min(Math.max(1, Math.floor(filters.limit || 50)), 200);
  if (filters.status) {
    return (await db.many("SELECT * FROM execution_jobs WHERE status=$1 ORDER BY created_at DESC,id DESC LIMIT $2", filters.status, limit)) as Row[];
  }
  return (await db.many("SELECT * FROM execution_jobs ORDER BY created_at DESC,id DESC LIMIT $1", limit)) as Row[];
}
