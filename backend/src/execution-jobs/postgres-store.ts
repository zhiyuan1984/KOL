import type { PoolClient } from "pg";
import { nid } from "../ids.js";
import { postgresPool, postgresTransaction } from "../postgres/pool.js";
import type { Json, Row } from "../types.js";
import type { ClaimedExecutionJob, ExecutionJobInput, ExecutionJobStatus } from "./contracts.js";

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

function retryDelayMs(attempt: number): number {
  return Math.min(60_000, 1_000 * 2 ** Math.min(6, Math.max(0, attempt - 1)));
}

function normalizedLeaseMs(value: unknown): number {
  return Math.max(1_000, Math.min(10 * 60_000, Number(value || 60_000)));
}

function normalizedJob(row: Row): Row {
  return {
    ...row,
    attempts: Number(row.attempts || 0),
    max_attempts: Number(row.max_attempts || 1),
  };
}

async function jobByIdIn(client: PoolClient, id: string, lock = false): Promise<Row | undefined> {
  const suffix = lock ? " FOR UPDATE" : "";
  const result = await client.query<Row>(`SELECT * FROM execution_jobs WHERE id=$1${suffix}`, [id]);
  return result.rows[0] ? normalizedJob(result.rows[0] as Row) : undefined;
}

async function insertDispatchOutbox(
  client: PoolClient,
  job: Row,
  input: { eventType: string; idempotencyKey: string; payload: Json; availableAt: string; now: string },
): Promise<void> {
  await client.query(
    `INSERT INTO execution_outbox
     (id,job_id,event_type,aggregate_type,aggregate_id,payload_json,idempotency_key,status,attempts,available_at,published_at,last_error,created_at,updated_at,publisher_id,publisher_lease_until)
     VALUES ($1,$2,$3,'execution_job',$2,$4,$5,'pending',0,$6,NULL,NULL,$7,$7,NULL,NULL)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [nid("obx"), String(job.id), input.eventType, JSON.stringify(input.payload), input.idempotencyKey, input.availableAt, input.now],
  );
}

export async function pgExecutionJobById(id: string): Promise<Row | undefined> {
  const result = await postgresPool().query<Row>("SELECT * FROM execution_jobs WHERE id=$1", [id]);
  return result.rows[0] ? normalizedJob(result.rows[0] as Row) : undefined;
}

export async function pgListExecutionJobs(filters: { status?: string; limit?: number } = {}): Promise<Row[]> {
  const limit = Math.min(Math.max(1, Math.floor(filters.limit || 50)), 200);
  if (filters.status) {
    return (await postgresPool().query<Row>(
      "SELECT * FROM execution_jobs WHERE status=$1 ORDER BY created_at DESC,id DESC LIMIT $2",
      [filters.status, limit],
    )).rows.map((row) => normalizedJob(row as Row));
  }
  return (await postgresPool().query<Row>(
    "SELECT * FROM execution_jobs ORDER BY created_at DESC,id DESC LIMIT $1",
    [limit],
  )).rows.map((row) => normalizedJob(row as Row));
}

/** Public projection belongs with the PostgreSQL repository so scheduling
 * operations never import the retired SQLite-shaped execution store. */
export function pgExecutionJobPublic(job: Row): Json {
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

/** Persist the authority job and its Outbox dispatch in the same PostgreSQL transaction. */
export async function pgEnqueueExecutionJob(input: ExecutionJobInput, options: { now?: Date; deduplicate_active?: boolean; client?: PoolClient } = {}): Promise<{ job: Row; created: boolean }> {
  const now = options.now || new Date();
  const stamp = now.toISOString();
  const enqueue = async (client: PoolClient) => {
    if (options.deduplicate_active) {
      const object = JSON.stringify(input.object_ref || {});
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [JSON.stringify([input.tenant_ref, input.actor_ref, input.job_type, object])]);
      const active = await client.query<Row>(
        `SELECT * FROM execution_jobs WHERE tenant_ref=$1 AND actor_ref=$2 AND job_type=$3
           AND object_ref_json::jsonb=$4::jsonb AND status IN ('queued','running','retrying') LIMIT 1`,
        [input.tenant_ref, input.actor_ref, input.job_type, object],
      );
      if (active.rows[0]) return { job: normalizedJob(active.rows[0]), created: false };
    }
    const id = nid("job");
    const risk = input.risk_level || "low";
    const maxAttempts = Math.max(1, Math.min(20, Math.floor(Number(input.max_attempts || 1))));
    const inserted = await client.query<Row>(
      `INSERT INTO execution_jobs
       (id,job_type,tenant_ref,actor_ref,object_ref_json,ticket_id,run_id,trigger_event_id,rule_id,rule_version,
        risk_level,idempotency_key,scope_snapshot_json,priority_class,status,attempts,max_attempts,lease_until,lease_owner,
        next_attempt_at,payload_json,receipt_json,error_code,error_summary,created_at,started_at,terminal_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'queued',0,$15,NULL,NULL,$16,$17,NULL,NULL,NULL,$18,NULL,NULL,$18)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING *`,
      [
        id, input.job_type, input.tenant_ref, input.actor_ref, JSON.stringify(input.object_ref || {}), input.ticket_id || null,
        input.run_id || null, input.trigger_event_id || null, input.rule_id || null, input.rule_version || null,
        risk, input.idempotency_key, JSON.stringify(input.scope_snapshot || {}), input.priority_class || "normal", maxAttempts,
        input.next_attempt_at || stamp, JSON.stringify(input.payload || {}), stamp,
      ],
    );
    if (!inserted.rows[0]) {
      const replay = await client.query<Row>("SELECT * FROM execution_jobs WHERE idempotency_key=$1", [input.idempotency_key]);
      if (!replay.rows[0]) throw new Error("execution job idempotency replay could not be loaded");
      return { job: normalizedJob(replay.rows[0] as Row), created: false };
    }
    const job = normalizedJob(inserted.rows[0] as Row);
    const outbox = input.outbox || {
      event_type: "execution_job.queued",
      aggregate_type: "execution_job",
      aggregate_id: id,
      payload: { job_type: input.job_type, tenant_ref: input.tenant_ref },
    };
    await client.query(
      `INSERT INTO execution_outbox
       (id,job_id,event_type,aggregate_type,aggregate_id,payload_json,idempotency_key,status,attempts,available_at,published_at,last_error,created_at,updated_at,publisher_id,publisher_lease_until)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',0,$8,NULL,NULL,$9,$9,NULL,NULL)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        nid("obx"), id, outbox.event_type, outbox.aggregate_type, outbox.aggregate_id,
        JSON.stringify(outbox.payload || {}), outbox.idempotency_key || `execution-job:${input.idempotency_key}:queued`, input.next_attempt_at || stamp, stamp,
      ],
    );
    return { job, created: true };
  };
  return options.client ? enqueue(options.client)
    : postgresTransaction(enqueue, { isolation: options.deduplicate_active ? "READ COMMITTED" : "SERIALIZABLE" });
}

function claimed(row: Row): ClaimedExecutionJob {
  return {
    ...normalizedJob(row),
    lease_until: String(row.lease_until),
    worker_id: String(row.lease_owner),
  };
}

export async function pgClaimExecutionJobById(
  id: string,
  workerId: string,
  options: { lease_ms?: number; now?: Date } = {},
): Promise<ClaimedExecutionJob | null> {
  const now = options.now || new Date();
  const stamp = now.toISOString();
  const leaseUntil = isoAfter(now, normalizedLeaseMs(options.lease_ms));
  const result = await postgresPool().query<Row>(
    `UPDATE execution_jobs
     SET status='running',attempts=attempts+1,lease_until=$1,lease_owner=$2,
         started_at=COALESCE(started_at,$3),updated_at=$3
     WHERE id=$4 AND status IN ('queued','retrying') AND (next_attempt_at IS NULL OR next_attempt_at<=$3)
     RETURNING *`,
    [leaseUntil, workerId, stamp, id],
  );
  return result.rows[0] ? claimed(result.rows[0] as Row) : null;
}

export async function pgClaimNextExecutionJob(
  workerId: string,
  options: { job_types?: string[]; lease_ms?: number; now?: Date } = {},
): Promise<ClaimedExecutionJob | null> {
  const now = options.now || new Date();
  const stamp = now.toISOString();
  const leaseUntil = isoAfter(now, normalizedLeaseMs(options.lease_ms));
  const params: unknown[] = [stamp];
  let types = "";
  if (options.job_types?.length) {
    const placeholders = options.job_types.map((type) => {
      params.push(type);
      return `$${params.length}`;
    });
    types = ` AND job_type IN (${placeholders.join(",")})`;
  }
  params.push(leaseUntil, workerId);
  const leaseUntilIndex = params.length - 1;
  const workerIndex = params.length;
  const result = await postgresPool().query<Row>(
    `WITH candidate AS (
       SELECT id FROM execution_jobs
       WHERE status IN ('queued','retrying') AND (next_attempt_at IS NULL OR next_attempt_at<=$1)${types}
       ORDER BY CASE priority_class WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,created_at,id
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     UPDATE execution_jobs job
     SET status='running',attempts=job.attempts+1,lease_until=$${leaseUntilIndex},lease_owner=$${workerIndex},
         started_at=COALESCE(job.started_at,$1),updated_at=$1
     FROM candidate
     WHERE job.id=candidate.id
     RETURNING job.*`,
    params,
  );
  return result.rows[0] ? claimed(result.rows[0] as Row) : null;
}

export async function pgRenewExecutionJobLease(
  id: string,
  workerId: string,
  options: { lease_ms?: number; now?: Date } = {},
): Promise<boolean> {
  const now = options.now || new Date();
  const result = await postgresPool().query(
    `UPDATE execution_jobs SET lease_until=$1,updated_at=$2
     WHERE id=$3 AND status='running' AND lease_owner=$4`,
    [isoAfter(now, normalizedLeaseMs(options.lease_ms)), now.toISOString(), id, workerId],
  );
  return Number(result.rowCount || 0) > 0;
}

export async function pgCompleteExecutionJob(id: string, receipt: Json = {}, now = new Date(), expectedWorker?: string): Promise<Row | undefined> {
  const stamp = now.toISOString();
  const result = await postgresPool().query<Row>(
    `UPDATE execution_jobs
     SET status='succeeded',lease_until=NULL,lease_owner=NULL,receipt_json=$1,error_code=NULL,error_summary=NULL,
         terminal_at=$2,updated_at=$2
     WHERE id=$3 AND status='running' AND ($4::text IS NULL OR lease_owner=$4)
     RETURNING *`,
    [JSON.stringify(receipt), stamp, id, expectedWorker || null],
  );
  return result.rows[0] as Row | undefined;
}

export async function pgFailExecutionJob(
  id: string,
  error: { code: string; summary: string },
  options: { retry_at?: string | null; now?: Date; expected_worker?: string; not_dispatched?: boolean } = {},
): Promise<Row | undefined> {
  const now = options.now || new Date();
  const stamp = now.toISOString();
  return postgresTransaction(async (client) => {
    const current = await jobByIdIn(client, id, true);
    if (!current || String(current.status) !== "running") return current;
    if (options.expected_worker && current.lease_owner !== options.expected_worker) return current;
    const highRisk = ["high", "critical"].includes(String(current.risk_level));
    // A proven pre-dispatch rejection is terminal, even with attempts left.
    // An ordinary high-risk failure remains uncertain and cannot auto-replay.
    const canRetry = !options.not_dispatched && !highRisk && Number(current.attempts || 0) < Number(current.max_attempts || 1);
    const retryAt = canRetry ? (options.retry_at || isoAfter(now, retryDelayMs(Number(current.attempts || 0)))) : null;
    const status: ExecutionJobStatus = options.not_dispatched ? "failed" : highRisk ? "uncertain" : canRetry ? "retrying" : "failed";
    const updated = await client.query<Row>(
      `UPDATE execution_jobs
       SET status=$1,lease_until=NULL,lease_owner=NULL,next_attempt_at=$2,error_code=$3,error_summary=$4,
           terminal_at=CASE WHEN $1 IN ('failed','uncertain') THEN $5 ELSE terminal_at END,updated_at=$5
       WHERE id=$6
       RETURNING *`,
      [status, retryAt, error.code, error.summary.slice(0, 1000), stamp, id],
    );
    const job = updated.rows[0] as Row | undefined;
    if (job && canRetry && retryAt) {
      await insertDispatchOutbox(client, job, {
        eventType: "execution_job.retry_scheduled",
        idempotencyKey: `execution-job:${id}:retry:${Number(job.attempts || 0)}`,
        payload: { reason: error.code, attempt: Number(job.attempts || 0), retry_at: retryAt },
        availableAt: retryAt,
        now: stamp,
      });
    }
    return job;
  });
}

/** Quarantines a claimed job whose handler is intentionally unavailable in the
 * PostgreSQL-only runtime. Unlike ordinary failures it must never retry into a
 * legacy side-effect path. */
export async function pgQuarantineExecutionJob(
  id: string,
  error: { code: string; summary: string },
  now = new Date(),
): Promise<Row | undefined> {
  const stamp = now.toISOString();
  const result = await postgresPool().query<Row>(
    `UPDATE execution_jobs
     SET status='uncertain',lease_until=NULL,lease_owner=NULL,next_attempt_at=NULL,
         error_code=$1,error_summary=$2,terminal_at=$3,updated_at=$3
     WHERE id=$4 AND status='running'
     RETURNING *`,
    [error.code, error.summary.slice(0, 1000), stamp, id],
  );
  return result.rows[0] ? normalizedJob(result.rows[0] as Row) : undefined;
}

export async function pgRecoverExpiredExecutionJobs(now = new Date()): Promise<{ requeued: number; uncertain: number }> {
  const stamp = now.toISOString();
  return postgresTransaction(async (client) => {
    const rows = await client.query<Row>(
      `SELECT * FROM execution_jobs
       WHERE status='running' AND lease_until IS NOT NULL AND lease_until<$1
       FOR UPDATE SKIP LOCKED`,
      [stamp],
    );
    let requeued = 0;
    let uncertain = 0;
    for (const row of rows.rows as Row[]) {
      const highRisk = ["high", "critical"].includes(String(row.risk_level));
      const retryable = !highRisk && Number(row.attempts || 0) < Number(row.max_attempts || 1);
      if (retryable) {
        const updated = await client.query<Row>(
          `UPDATE execution_jobs
           SET status='retrying',lease_until=NULL,lease_owner=NULL,next_attempt_at=$1,error_code='lease_expired',
               error_summary='Worker lease expired before a terminal receipt',updated_at=$1
           WHERE id=$2 AND status='running'
           RETURNING *`,
          [stamp, row.id],
        );
        const job = updated.rows[0] as Row | undefined;
        if (job) {
          await insertDispatchOutbox(client, job, {
            eventType: "execution_job.lease_recovered",
            idempotencyKey: `execution-job:${row.id}:lease-recovery:${Number(job.attempts || 0)}`,
            payload: { reason: "lease_expired", attempt: Number(job.attempts || 0) },
            availableAt: stamp,
            now: stamp,
          });
          requeued += 1;
        }
      } else {
        const changed = await client.query(
          `UPDATE execution_jobs
           SET status='uncertain',lease_until=NULL,lease_owner=NULL,error_code='lease_expired',
               error_summary='Worker lease expired; manual outcome confirmation required',terminal_at=$1,updated_at=$1
           WHERE id=$2 AND status='running'`,
          [stamp, row.id],
        );
        uncertain += changed.rowCount || 0;
      }
    }
    return { requeued, uncertain };
  });
}

/** Explicit operator recovery for a failed low-risk job, with durable re-dispatch. */
export async function pgRetryFailedExecutionJob(
  id: string,
  options: { actor_ref?: string; now?: Date } = {},
): Promise<{ job: Row | undefined; retried: boolean; reason?: "not_found" | "not_failed" | "risk_requires_takeover" }> {
  const now = options.now || new Date();
  const stamp = now.toISOString();
  return postgresTransaction(async (client) => {
    const current = await jobByIdIn(client, id, true);
    if (!current) return { job: undefined, retried: false, reason: "not_found" as const };
    if (String(current.status) !== "failed") return { job: current, retried: false, reason: "not_failed" as const };
    if (String(current.risk_level) !== "low") return { job: current, retried: false, reason: "risk_requires_takeover" as const };
    const updated = await client.query<Row>(
      `UPDATE execution_jobs
          SET status='queued',lease_until=NULL,lease_owner=NULL,next_attempt_at=$1,error_code=NULL,error_summary=NULL,
              terminal_at=NULL,max_attempts=CASE WHEN max_attempts<=attempts THEN attempts+1 ELSE max_attempts END,
              updated_at=$1
        WHERE id=$2 AND status='failed' AND risk_level='low'
        RETURNING *`,
      [stamp, id],
    );
    const job = updated.rows[0] as Row | undefined;
    if (!job) return { job: current, retried: false, reason: "not_failed" as const };
    await insertDispatchOutbox(client, job, {
      eventType: "execution_job.retry_requested",
      idempotencyKey: `execution-job:${id}:manual-retry:${Number(job.attempts || 0)}`,
      payload: { actor_ref: options.actor_ref || null, attempt: Number(job.attempts || 0), risk_level: String(job.risk_level) },
      availableAt: stamp,
      now: stamp,
    });
    return { job, retried: true };
  });
}

export function pgExecutionJobPayload(job: Row): Json {
  return parseJson(job.payload_json);
}
