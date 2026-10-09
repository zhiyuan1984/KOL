import type { PoolClient } from "pg";
import { nid } from "../ids.js";
import { postgresPool, postgresTransaction } from "../postgres/pool.js";
import type { Json, Row } from "../types.js";
import { pgExecutionJobPublic, pgListExecutionJobs } from "../execution-jobs/postgres-store.js";
import {
  DEFAULT_EXPERT,
  SYSTEM_EXECUTE_AS,
  SYSTEM_JOBS,
  cronPublicJob,
  cronPublicJobSummary,
  cronPublicRun,
  cronSystemJob,
} from "./contracts.js";
import { nextRunAt, nextScheduledAt, type ScheduleWindow } from "./schedule.js";

const DEFAULT_RETRY = { max_attempts: 1, backoff_sec: 0 };
const DEFAULT_TAKEOVER = { after_minutes: 30, action: "needs_takeover" };

function json(value: unknown, fallback: Json = {}): Json {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Json;
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Json : fallback;
  } catch {
    return fallback;
  }
}

function normalizedRun(run: Row): Row {
  return {
    ...run,
    receipt_json: run.receipt_json == null ? null : json(run.receipt_json),
    artifact_refs: run.artifact_refs == null ? null : json(run.artifact_refs),
  };
}

function stamp(now = new Date()): string {
  return now.toISOString();
}

function scheduleOf(job: Row): Json {
  return json(job.condition_json).schedule as Json || {};
}

function nextFor(job: Row, from: Date): string | null {
  return nextScheduledAt(
    String(job.cron_expr),
    String(job.timezone || "Asia/Shanghai"),
    scheduleOf(job) as ScheduleWindow,
    from,
  )?.toISOString() || null;
}

async function jobByIdIn(client: PoolClient, id: string, lock = false): Promise<Row | undefined> {
  const result = await client.query<Row>(
    `SELECT * FROM cron_jobs WHERE id=$1 OR job_key=$1${lock ? " FOR UPDATE" : ""}`,
    [id],
  );
  return result.rows[0] as Row | undefined;
}

async function insertCronDispatch(client: PoolClient, job: Row, run: Row, now: string): Promise<void> {
  const jobId = nid("job");
  const idempotencyKey = `cron-run:${String(run.id)}`;
  const inserted = await client.query<Row>(
    `INSERT INTO execution_jobs
     (id,job_type,tenant_ref,actor_ref,object_ref_json,ticket_id,run_id,trigger_event_id,rule_id,rule_version,
      risk_level,idempotency_key,scope_snapshot_json,priority_class,status,attempts,max_attempts,lease_until,lease_owner,
      next_attempt_at,payload_json,receipt_json,error_code,error_summary,created_at,started_at,terminal_at,updated_at)
     VALUES ($1,'cron.run','company:amperetime',$2,$3,NULL,NULL,NULL,$4,$5,
             'low',$6,$7,'normal','queued',0,1,NULL,NULL,$8,$9,NULL,NULL,NULL,$8,NULL,NULL,$8)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING *`,
    [
      jobId,
      String(job.execute_as || SYSTEM_EXECUTE_AS),
      JSON.stringify({ type: "cron_job", id: String(job.id) }),
      String(job.job_key),
      String(job.published_rev || 1),
      idempotencyKey,
      JSON.stringify({ scope: json(job.scope_json), condition: json(job.condition_json) }),
      now,
      JSON.stringify({ cron_run_id: String(run.id), cron_job_id: String(job.id) }),
    ],
  );
  const execution = inserted.rows[0] as Row | undefined;
  if (!execution) return;
  await client.query(
    `INSERT INTO execution_outbox
     (id,job_id,event_type,aggregate_type,aggregate_id,payload_json,idempotency_key,status,attempts,available_at,published_at,last_error,created_at,updated_at,publisher_id,publisher_lease_until)
     VALUES ($1,$2,'cron.run_queued','cron_run',$3,$4,$5,'pending',0,$6,NULL,NULL,$6,$6,NULL,NULL)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [
      nid("obx"),
      String(execution.id),
      String(run.id),
      JSON.stringify({ cron_job_id: String(job.id), trigger: String(run.trigger), scheduled_for: String(run.scheduled_for) }),
      `execution-job:${idempotencyKey}:queued`,
      now,
    ],
  );
}

export async function pgEnsureSystemCronJobs(from = new Date()): Promise<void> {
  const now = stamp();
  await postgresTransaction(async (client) => {
    for (const job of SYSTEM_JOBS) {
      const next = job.status === "published" ? nextRunAt(job.cron_expr, "Asia/Shanghai", from).toISOString() : null;
      await client.query(
        `INSERT INTO cron_jobs
         (id,job_key,title,owner_account_id,execute_as,capability_expert_id,handler_key,scope_json,condition_json,
          cron_expr,timezone,status,retry_policy_json,takeover_policy_json,published_rev,next_run_at,last_run_at,last_terminal_status,created_at,updated_at)
         VALUES ($1,$2,$3,NULL,$4,$5,$6,$7,$8,$9,'Asia/Shanghai',$10,$11,$12,1,$13,NULL,NULL,$14,$14)
         ON CONFLICT (id) DO NOTHING`,
        [job.id, job.job_key, job.title, SYSTEM_EXECUTE_AS, DEFAULT_EXPERT, job.handler_key,
          JSON.stringify(job.scope), JSON.stringify(job.condition), job.cron_expr, job.status,
          JSON.stringify(DEFAULT_RETRY), JSON.stringify(DEFAULT_TAKEOVER), next, now],
      );
    }
    // 既有库回填：discovery-search 的旧条件（含 enabled:false / not_enabled_no_live_crawler
    // 门禁）原地升级为 system_template 结构；已配置的模板一律保留，状态列不动。
    const discoverySeed = SYSTEM_JOBS.find((seed) => seed.job_key === "discovery-search");
    if (discoverySeed) {
      await client.query(
        `UPDATE cron_jobs
            SET condition_json = jsonb_build_object('system_template',
                  COALESCE(condition_json->'system_template', $2::jsonb)),
                updated_at = $3
           WHERE id = $1
             AND (NOT (condition_json ? 'system_template')
                  OR condition_json ? 'enabled'
                  OR condition_json ? 'reason')`,
        [discoverySeed.id, JSON.stringify((discoverySeed.condition as { system_template: unknown }).system_template), now],
      );
    }
  });
}

export async function pgCronJobById(id: string): Promise<Row | undefined> {
  const result = await postgresPool().query<Row>("SELECT * FROM cron_jobs WHERE id=$1 OR job_key=$1", [id]);
  return result.rows[0] as Row | undefined;
}

export async function pgListCronJobs(): Promise<Row[]> {
  const result = await postgresPool().query<Row>(
    `SELECT job.*,
       (SELECT run.status FROM cron_runs run WHERE run.job_id=job.id AND run.status IN ('queued','running') ORDER BY run.created_at DESC LIMIT 1) AS active_run_status
     FROM cron_jobs job ORDER BY title`,
  );
  return result.rows as Row[];
}

export async function pgListCronRuns(jobId: string, limit = 50): Promise<Row[]> {
  const bounded = Math.min(Math.max(1, Math.floor(limit)), 200);
  const result = await postgresPool().query<Row>(
    "SELECT * FROM cron_runs WHERE job_id=$1 ORDER BY created_at DESC LIMIT $2",
    [jobId, bounded],
  );
  return result.rows.map((row) => normalizedRun(row as Row));
}

export async function pgCronRunById(id: string): Promise<Row | undefined> {
  const result = await postgresPool().query<Row>("SELECT * FROM cron_runs WHERE id=$1", [id]);
  return result.rows[0] ? normalizedRun(result.rows[0] as Row) : undefined;
}

export async function pgCreateCronJob(input: {
  id: string;
  job_key: string;
  title: string;
  owner_account_id: string | null;
  execute_as: string;
  capability_expert_id: string;
  handler_key: string;
  scope: Json;
  condition: Json;
  cron_expr: string;
  timezone: string;
  status: string;
  retry_policy: Json;
  takeover_policy: Json;
  next_run_at: string | null;
}): Promise<Row> {
  const now = stamp();
  const result = await postgresPool().query<Row>(
    `INSERT INTO cron_jobs
     (id,job_key,title,owner_account_id,execute_as,capability_expert_id,handler_key,scope_json,condition_json,
      cron_expr,timezone,status,retry_policy_json,takeover_policy_json,published_rev,next_run_at,last_run_at,last_terminal_status,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,1,$15,NULL,NULL,$16,$16)
     RETURNING *`,
    [input.id, input.job_key, input.title, input.owner_account_id, input.execute_as, input.capability_expert_id,
      input.handler_key, JSON.stringify(input.scope), JSON.stringify(input.condition), input.cron_expr, input.timezone,
      input.status, JSON.stringify(input.retry_policy), JSON.stringify(input.takeover_policy), input.next_run_at, now],
  );
  return result.rows[0] as Row;
}

export async function pgUpdateCronJob(id: string, input: {
  title: string;
  scope: Json;
  condition: Json;
  cron_expr: string;
  timezone: string;
  status: string;
  published_rev: number;
  next_run_at: string | null;
}): Promise<Row | undefined> {
  const result = await postgresPool().query<Row>(
    `UPDATE cron_jobs
        SET title=$1,scope_json=$2,condition_json=$3,cron_expr=$4,timezone=$5,status=$6,published_rev=$7,next_run_at=$8,updated_at=$9
      WHERE id=$10
      RETURNING *`,
    [input.title, JSON.stringify(input.scope), JSON.stringify(input.condition), input.cron_expr, input.timezone,
      input.status, input.published_rev, input.next_run_at, stamp(), id],
  );
  return result.rows[0] as Row | undefined;
}

export async function pgEnqueueManualCronRun(jobId: string, scheduledFor?: string): Promise<{ run_id: string; duplicate: boolean }> {
  return postgresTransaction(async (client) => {
    const job = await jobByIdIn(client, jobId, true);
    if (!job) throw new Error("cron job not found");
    const runId = nid("crun");
    const now = stamp();
    const slot = scheduledFor || `${now}#${runId}`;
    const inserted = await client.query<Row>(
      `INSERT INTO cron_runs
       (id,job_id,trigger,status,scheduled_for,started_at,finished_at,error_code,error_summary,receipt_json,artifact_refs,session_id,created_at)
       VALUES ($1,$2,'manual','queued',$3,NULL,NULL,NULL,NULL,NULL,NULL,NULL,$4)
       ON CONFLICT (job_id,scheduled_for) DO NOTHING
       RETURNING *`,
      [runId, String(job.id), slot, now],
    );
    const run = inserted.rows[0] as Row | undefined;
    if (!run) {
      const existing = await client.query<Row>("SELECT id FROM cron_runs WHERE job_id=$1 AND scheduled_for=$2", [job.id, slot]);
      return { run_id: String(existing.rows[0]?.id || runId), duplicate: true };
    }
    await insertCronDispatch(client, job, run, now);
    return { run_id: runId, duplicate: false };
  }, { isolation: "SERIALIZABLE" });
}

function takeoverMinutes(job: Row): number {
  const value = Number(json(job.takeover_policy_json).after_minutes);
  return Number.isFinite(value) && value > 0 ? value : 30;
}

export async function pgTickCronDue(now = new Date()): Promise<{ claimed: string[]; stale: boolean }> {
  await pgEnsureSystemCronJobs(now);
  const current = stamp(now);
  return postgresTransaction(async (client) => {
    const staleRuns = await client.query<Row>(
      `SELECT run.*, job.takeover_policy_json, job.handler_key, job.id AS cron_job_id
       FROM cron_runs run JOIN cron_jobs job ON job.id=run.job_id
       WHERE run.status='running'
       FOR UPDATE SKIP LOCKED`,
    );
    for (const run of staleRuns.rows as Row[]) {
      const startedAt = Date.parse(String(run.started_at || run.created_at || ""));
      if (!Number.isFinite(startedAt) || now.getTime() - startedAt < takeoverMinutes(run) * 60_000) continue;
      await client.query(
        `UPDATE cron_runs SET status='needs_takeover',finished_at=$1,error_code='stale_run',
          error_summary='运行超时，等待接管',receipt_json=$2 WHERE id=$3 AND status='running'`,
        [current, JSON.stringify({ handler_key: run.handler_key, side_effect: "none", created_session: false, reason: "stale_run" }), run.id],
      );
      await client.query(
        "UPDATE cron_jobs SET last_terminal_status='needs_takeover',last_run_at=$1,updated_at=$1 WHERE id=$2",
        [current, run.cron_job_id],
      );
    }
    const due = await client.query<Row>(
      `SELECT * FROM cron_jobs WHERE status='published' AND next_run_at IS NOT NULL AND next_run_at<=$1
       ORDER BY next_run_at FOR UPDATE SKIP LOCKED`,
      [current],
    );
    const claimed: string[] = [];
    for (const job of due.rows as Row[]) {
      const scheduledFor = new Date(job.next_run_at as string | Date).toISOString();
      const runId = nid("crun");
      const inserted = await client.query<Row>(
        `INSERT INTO cron_runs
         (id,job_id,trigger,status,scheduled_for,started_at,finished_at,error_code,error_summary,receipt_json,artifact_refs,session_id,created_at)
         VALUES ($1,$2,'schedule','queued',$3,NULL,NULL,NULL,NULL,NULL,NULL,NULL,$4)
         ON CONFLICT (job_id,scheduled_for) DO NOTHING RETURNING *`,
        [runId, String(job.id), scheduledFor, current],
      );
      const run = inserted.rows[0] as Row | undefined;
      const next = nextFor(job, new Date(scheduledFor));
      await client.query("UPDATE cron_jobs SET next_run_at=$1,updated_at=$2 WHERE id=$3", [next, current, job.id]);
      if (!run) continue;
      await insertCronDispatch(client, job, run, current);
      claimed.push(String(run.id));
    }
    return { claimed, stale: staleRuns.rows.length > 0 };
  }, { isolation: "SERIALIZABLE" });
}

export async function pgStartCronRun(runId: string, now = new Date()): Promise<{ run: Row | undefined; started: boolean }> {
  const result = await postgresPool().query<Row>(
    `UPDATE cron_runs SET status='running',started_at=COALESCE(started_at,$1)
      WHERE id=$2 AND status='queued' RETURNING *`,
    [stamp(now), runId],
  );
  if (result.rows[0]) return { run: normalizedRun(result.rows[0] as Row), started: true };
  return { run: await pgCronRunById(runId), started: false };
}

export async function pgFinishCronRun(input: {
  run_id: string;
  status: string;
  error_code?: string | null;
  error_summary?: string | null;
  receipt?: Json;
  artifact_refs?: Json | null;
  session_id?: string | null;
  now?: Date;
}): Promise<Row | undefined> {
  const now = stamp(input.now);
  return postgresTransaction(async (client) => {
    const runResult = await client.query<Row>(
      `UPDATE cron_runs SET status=$1,finished_at=$2,error_code=$3,error_summary=$4,receipt_json=$5,artifact_refs=$6,session_id=$7
       WHERE id=$8 RETURNING *`,
      [input.status, now, input.error_code || null, input.error_summary || null, JSON.stringify(input.receipt || {}),
        input.artifact_refs ? JSON.stringify(input.artifact_refs) : null, input.session_id || null, input.run_id],
    );
    const rawRun = runResult.rows[0] as Row | undefined;
    const run = rawRun ? normalizedRun(rawRun) : undefined;
    if (!run) return undefined;
    await client.query(
      "UPDATE cron_jobs SET last_run_at=$1,last_terminal_status=$2,updated_at=$1 WHERE id=$3",
      [now, input.status, run.job_id],
    );
    return run;
  });
}

export async function pgSchedulingAdminReadModel(limit: number, status?: string): Promise<Json> {
  const asOf = stamp();
  const staleAfterMs = Math.max(5_000, Number(process.env.EXECUTION_WORKER_STALE_MS || 45_000));
  const [jobs, statusCounts, outboxCounts, stalePublishing, workerRows, backlog, ruleRows] = await Promise.all([
    pgListExecutionJobs({ status, limit }),
    postgresPool().query<{ status: string; count: string }>("SELECT status,COUNT(*) AS count FROM execution_jobs GROUP BY status ORDER BY status"),
    postgresPool().query<{ status: string; count: string }>("SELECT status,COUNT(*) AS count FROM execution_outbox GROUP BY status ORDER BY status"),
    postgresPool().query<{ count: string; oldest_updated_at: string | null }>(
      "SELECT COUNT(*) AS count,MIN(updated_at) AS oldest_updated_at FROM execution_outbox WHERE status='publishing' AND publisher_lease_until IS NOT NULL AND publisher_lease_until<=$1", [asOf],
    ),
    postgresPool().query<Row>("SELECT worker_id,worker_kind,status,details_json,started_at,heartbeat_at,stopped_at FROM execution_worker_heartbeats ORDER BY heartbeat_at DESC LIMIT 100"),
    postgresPool().query<{ count: string; oldest_created_at: string | null }>("SELECT COUNT(*) AS count,MIN(created_at) AS oldest_created_at FROM execution_jobs WHERE status IN ('queued','retrying')"),
    postgresPool().query<Row>("SELECT id,version,rule_type,title,status,scope_json,definition_json,created_by,published_by,created_at,published_at,updated_at FROM scheduling_rules ORDER BY CASE status WHEN 'published' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,updated_at DESC LIMIT 100"),
  ]);
  const workers = workerRows.rows.map((row) => {
    const heartbeat = Date.parse(String(row.heartbeat_at));
    return {
      worker_id: row.worker_id, worker_kind: row.worker_kind, status: row.status, details: json(row.details_json),
      started_at: row.started_at, heartbeat_at: row.heartbeat_at, stopped_at: row.stopped_at || null,
      stale: row.status === "running" && (!Number.isFinite(heartbeat) || Date.now() - heartbeat > staleAfterMs),
    };
  });
  return {
    items: jobs.map(pgExecutionJobPublic),
    counts: Object.fromEntries(statusCounts.rows.map((row) => [row.status, Number(row.count)])),
    outbox: {
      ...Object.fromEntries(outboxCounts.rows.map((row) => [row.status, Number(row.count)])),
      stale_publishing_count: Number(stalePublishing.rows[0]?.count || 0),
      oldest_stale_publishing_updated_at: stalePublishing.rows[0]?.oldest_updated_at || null,
    },
    workers,
    backlog: { count: Number(backlog.rows[0]?.count || 0), oldest_created_at: backlog.rows[0]?.oldest_created_at || null },
    rules: ruleRows.rows.map((row) => ({
      id: String(row.id), version: Number(row.version), rule_type: String(row.rule_type), title: String(row.title), status: String(row.status),
      scope: json(row.scope_json), definition: json(row.definition_json), created_by: String(row.created_by),
      published_by: row.published_by || null, created_at: row.created_at, published_at: row.published_at || null, updated_at: row.updated_at,
    })),
    as_of: asOf,
    execution_mode: "postgres_redis_bullmq_multi_worker",
    source_refs: [{ type: "execution_jobs" }, { type: "execution_outbox" }, { type: "execution_worker_heartbeats" }, { type: "scheduling_rules" }],
  } as Json;
}

export function pgCronPublicJob(job: Row): Json { return cronPublicJob(job); }
export function pgCronPublicJobSummary(job: Row): Json { return cronPublicJobSummary(job); }
export function pgCronPublicRun(run: Row): Json { return cronPublicRun(run); }
export function pgCronSystemJob(job: Row): boolean { return cronSystemJob(job); }
export function pgCronSchedule(job: Row): Json { return scheduleOf(job); }
