import { audit, getConn, nowIso, txImmediate, type SqliteConn } from "../db.js";
import { HttpFail } from "../host/errors.js";
import type { Row } from "../types.js";
import type { AppUser } from "../auth.js";
import { cronHandler } from "./handlers.js";
import { nextScheduledAt, type ScheduleWindow } from "./schedule.js";
import {
  enqueueExecutionJob,
  type ClaimedExecutionJob,
} from "../execution-jobs/store.js";
import {
  runtimeClaimExecutionJobById,
  runtimeClaimNextExecutionJob,
  runtimeCompleteExecutionJob,
  runtimeExecutionJobPayload,
  runtimeFailExecutionJob,
} from "../execution-jobs/runtime-store.js";
import {
  ensureSystemCronJobs,
  jobById,
  newRunId,
  runById,
} from "./store.js";

const TERMINAL = new Set(["succeeded", "failed", "skipped", "needs_takeover"]);

function nextFor(job: Row, from: Date): string | null {
  const condition = JSON.parse(String(job.condition_json || "{}")) as { schedule?: ScheduleWindow };
  return nextScheduledAt(String(job.cron_expr), String(job.timezone || "Asia/Shanghai"), condition.schedule || {}, from)?.toISOString() || null;
}

function isUniqueError(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code || "")
    : "";
  const message = error instanceof Error ? error.message : String(error || "");
  return code === "23505" || /UNIQUE constraint failed|SQLITE_CONSTRAINT_UNIQUE/i.test(message);
}

function parseTakeover(job: Row): number {
  try {
    const policy = JSON.parse(String(job.takeover_policy_json || "{}")) as { after_minutes?: number };
    const minutes = Number(policy.after_minutes);
    return Number.isFinite(minutes) && minutes > 0 ? minutes : 30;
  } catch {
    return 30;
  }
}

function markStaleRunning(db: SqliteConn, now: Date): void {
  const nowIsoStr = now.toISOString();
  const running = db.prepare("SELECT * FROM cron_runs WHERE status='running'").all() as Row[];
  for (const run of running) {
    const job = db.prepare("SELECT * FROM cron_jobs WHERE id=?").get(run.job_id) as Row | undefined;
    if (!job) continue;
    const started = Date.parse(String(run.started_at || run.created_at || ""));
    if (!Number.isFinite(started)) continue;
    if (now.getTime() - started < parseTakeover(job) * 60_000) continue;
    db.prepare(
      `UPDATE cron_runs
          SET status='needs_takeover', finished_at=?, error_code='stale_run',
              error_summary='运行超时，等待接管', receipt_json=?
        WHERE id=? AND status='running'`,
    ).run(
      nowIsoStr,
      JSON.stringify({ handler_key: job.handler_key, side_effect: "none", created_session: false, reason: "stale_run" }),
      run.id,
    );
    db.prepare(
      "UPDATE cron_jobs SET last_terminal_status='needs_takeover', last_run_at=?, updated_at=? WHERE id=?",
    ).run(nowIsoStr, nowIsoStr, job.id);
  }
}

function enqueueDueJobs(db: SqliteConn, now: Date): string[] {
  const queuedRunIds: string[] = [];
  const due = db.prepare(
    `SELECT * FROM cron_jobs
      WHERE status='published' AND next_run_at IS NOT NULL AND next_run_at <= ?
      ORDER BY next_run_at`,
  ).all(now.toISOString()) as Row[];
  for (const job of due) {
    const scheduledFor = String(job.next_run_at);
    const runId = newRunId();
    const created = nowIso();
    try {
      db.prepare(
        `INSERT INTO cron_runs
         (id,job_id,trigger,status,scheduled_for,started_at,finished_at,error_code,error_summary,receipt_json,artifact_refs,session_id,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(runId, job.id, "schedule", "queued", scheduledFor, null, null, null, null, null, null, null, created);
    } catch (error) {
      if (isUniqueError(error)) {
        const next = nextFor(job, new Date(scheduledFor));
        db.prepare("UPDATE cron_jobs SET next_run_at=?, updated_at=? WHERE id=?").run(next, created, job.id);
        continue;
      }
      throw error;
    }
    enqueueExecutionJob({
      job_type: "cron.run",
      tenant_ref: "company:amperetime",
      actor_ref: String(job.execute_as || "system"),
      object_ref: { type: "cron_job", id: String(job.id) },
      rule_id: String(job.job_key),
      rule_version: String(job.published_rev || 1),
      risk_level: "low",
      scope_snapshot: { scope: JSON.parse(String(job.scope_json || "{}")), condition: JSON.parse(String(job.condition_json || "{}")) },
      priority_class: "normal",
      max_attempts: 1,
      payload: { cron_run_id: runId, cron_job_id: String(job.id) },
      idempotency_key: `cron-run:${runId}`,
      outbox: {
        event_type: "cron.run_queued",
        aggregate_type: "cron_run",
        aggregate_id: runId,
        payload: { cron_job_id: String(job.id), trigger: "schedule", scheduled_for: scheduledFor },
      },
    }, { db, now });
    const next = nextFor(job, new Date(scheduledFor));
    db.prepare("UPDATE cron_jobs SET next_run_at=?, updated_at=? WHERE id=?").run(next, created, job.id);
    queuedRunIds.push(runId);
  }
  const leftover = db.prepare("SELECT id FROM cron_runs WHERE status='queued' ORDER BY created_at").all() as Array<{ id: string }>;
  for (const row of leftover) {
    const run = runById(String(row.id), db);
    if (!run) continue;
    const job = jobById(String(run.job_id), db);
    if (!job) continue;
    enqueueExecutionJob({
      job_type: "cron.run",
      tenant_ref: "company:amperetime",
      actor_ref: String(job.execute_as || "system"),
      object_ref: { type: "cron_job", id: String(job.id) },
      rule_id: String(job.job_key),
      rule_version: String(job.published_rev || 1),
      risk_level: "low",
      scope_snapshot: { scope: JSON.parse(String(job.scope_json || "{}")), condition: JSON.parse(String(job.condition_json || "{}")) },
      priority_class: "normal",
      max_attempts: 1,
      payload: { cron_run_id: String(run.id), cron_job_id: String(job.id) },
      idempotency_key: `cron-run:${run.id}`,
      outbox: {
        event_type: "cron.run_queued",
        aggregate_type: "cron_run",
        aggregate_id: String(run.id),
        payload: { cron_job_id: String(job.id), trigger: String(run.trigger), scheduled_for: String(run.scheduled_for) },
      },
    }, { db, now });
    queuedRunIds.push(String(run.id));
  }
  return [...new Set(queuedRunIds)];
}

export async function executeCronRun(runId: string, viewer?: AppUser, nowMs = Date.now()): Promise<Row> {
  const db = getConn();
  const run = runById(runId, db);
  if (!run) throw new HttpFail(404, "cron run not found");
  const job = jobById(String(run.job_id), db);
  if (!job) throw new HttpFail(404, "cron job not found");
  if (run.session_id && String(job.handler_key) !== "ai-task") {
    db.prepare("UPDATE cron_runs SET session_id=NULL WHERE id=?").run(runId);
  }
  const handler = cronHandler(String(job.handler_key));
  const finished = new Date(nowMs).toISOString();
  if (!handler) {
    db.prepare(
      `UPDATE cron_runs SET status='failed', finished_at=?, error_code='unknown_handler',
          error_summary=?, receipt_json=?, session_id=NULL WHERE id=?`,
    ).run(finished, `未注册 handler: ${job.handler_key}`, JSON.stringify({
      created_session: false,
      handler_key: job.handler_key,
    }), runId);
    db.prepare(
      "UPDATE cron_jobs SET last_run_at=?, last_terminal_status='failed', updated_at=? WHERE id=?",
    ).run(finished, finished, job.id);
    return runById(runId, db) as Row;
  }
  try {
    const result = await handler({
      job,
      run,
      actor: String(job.execute_as || "system"),
      viewer,
      nowMs,
    });
    const status = TERMINAL.has(result.status) ? result.status : "failed";
    db.prepare(
      `UPDATE cron_runs
          SET status=?, finished_at=?, error_code=?, error_summary=?, receipt_json=?, artifact_refs=?, session_id=?
        WHERE id=?`,
    ).run(
      status,
      finished,
      result.error_code || null,
      result.error_summary || null,
      JSON.stringify(result.receipt || {}),
      result.artifact_refs ? JSON.stringify(result.artifact_refs) : null,
      result.session_id || null,
      runId,
    );
    db.prepare(
      "UPDATE cron_jobs SET last_run_at=?, last_terminal_status=?, updated_at=? WHERE id=?",
    ).run(finished, status, finished, job.id);
    audit(String(job.execute_as || "system"), "cron.run.finish", {
      job_id: job.id,
      job_key: job.job_key,
      run_id: runId,
      status,
      created_session: Boolean(result.session_id),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "handler failed");
    db.prepare(
      `UPDATE cron_runs
          SET status='failed', finished_at=?, error_code='handler_error', error_summary=?,
              receipt_json=?, session_id=NULL
        WHERE id=?`,
    ).run(finished, message, JSON.stringify({ created_session: false, handler_key: job.handler_key }), runId);
    db.prepare(
      "UPDATE cron_jobs SET last_run_at=?, last_terminal_status='failed', updated_at=? WHERE id=?",
    ).run(finished, finished, job.id);
  }
  return runById(runId, db) as Row;
}

/** Execute a durable Cron job already claimed by the common execution dispatcher. */
export async function executeClaimedCronJob(claimed: ClaimedExecutionJob, viewer?: AppUser, nowMs = Date.now()): Promise<string> {
  const payload = runtimeExecutionJobPayload(claimed);
  const runId = String(payload.cron_run_id || "");
  if (!runId) {
    await runtimeFailExecutionJob(String(claimed.id), { code: "invalid_payload", summary: "cron.run missing cron_run_id" });
    throw new HttpFail(500, "invalid cron execution job payload");
  }
  const db = getConn();
  const existing = runById(runId, db);
  if (!existing) {
    await runtimeFailExecutionJob(String(claimed.id), { code: "cron_run_missing", summary: `cron run missing: ${runId}` });
    throw new HttpFail(404, "cron run not found");
  }
  const started = new Date(nowMs).toISOString();
  const changed = db.prepare(
    "UPDATE cron_runs SET status='running',started_at=COALESCE(started_at,?) WHERE id=? AND status='queued'",
  ).run(started, runId);
  if (!changed.changes) {
    const current = runById(runId, db) as Row;
    if (["succeeded", "failed", "skipped", "needs_takeover"].includes(String(current.status))) {
      await runtimeCompleteExecutionJob(String(claimed.id), { cron_run_id: runId, cron_status: current.status, duplicate: true }, new Date(nowMs));
      return runId;
    }
    await runtimeFailExecutionJob(String(claimed.id), { code: "cron_run_not_queued", summary: `cron run is ${current.status}` });
    return runId;
  }
  const terminal = await executeCronRun(runId, viewer, nowMs);
  const status = String(terminal.status);
  if (status === "failed") {
    await runtimeFailExecutionJob(String(claimed.id), {
      code: String(terminal.error_code || "cron_handler_failed"),
      summary: String(terminal.error_summary || "cron handler failed"),
    }, { now: new Date(nowMs) });
  } else {
    await runtimeCompleteExecutionJob(String(claimed.id), {
      cron_run_id: runId,
      cron_status: status,
      receipt: terminal.receipt_json ? JSON.parse(String(terminal.receipt_json)) : {},
    }, new Date(nowMs));
  }
  return runId;
}

/** Processes one queued Cron job. This is the entry used by the standalone transition worker. */
export async function processNextCronExecutionJob(workerId = "cron-worker", viewer?: AppUser, nowMs = Date.now()): Promise<string | null> {
  const claimed = await runtimeClaimNextExecutionJob(workerId, { job_types: ["cron.run"], now: new Date(nowMs) });
  if (!claimed) return null;
  return executeClaimedCronJob(claimed, viewer, nowMs);
}

/**
 * Broker consumers receive a durable execution-job ID rather than polling a
 * local queue. Claiming remains authoritative in PostgreSQL so duplicate
 * BullMQ deliveries cannot execute the same run twice.
 */
export async function processCronExecutionJobById(executionJobId: string, workerId = "cron-worker", viewer?: AppUser, nowMs = Date.now()): Promise<string | null> {
  const claimed = await runtimeClaimExecutionJobById(executionJobId, workerId, { now: new Date(nowMs) });
  if (!claimed) return null;
  return executeClaimedCronJob(claimed, viewer, nowMs);
}

export function enqueueManualRun(jobId: string, scheduledFor?: string): { run_id: string; duplicate: boolean } {
  ensureSystemCronJobs();
  const job = jobById(jobId);
  if (!job) throw new HttpFail(404, "cron job not found");
  return txImmediate((db) => {
    const runId = newRunId();
    const slot = scheduledFor || `${nowIso()}#${runId}`;
    try {
      db.prepare(
        `INSERT INTO cron_runs
         (id,job_id,trigger,status,scheduled_for,started_at,finished_at,error_code,error_summary,receipt_json,artifact_refs,session_id,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(runId, job.id, "manual", "queued", slot, null, null, null, null, null, null, null, nowIso());
    } catch (error) {
      if (isUniqueError(error)) {
        const existing = db.prepare(
          "SELECT id FROM cron_runs WHERE job_id=? AND scheduled_for=?",
        ).get(job.id, slot) as { id: string } | undefined;
        return { run_id: existing?.id || runId, duplicate: true };
      }
      throw error;
    }
    enqueueExecutionJob({
      job_type: "cron.run",
      tenant_ref: "company:amperetime",
      actor_ref: String(job.execute_as || "system"),
      object_ref: { type: "cron_job", id: String(job.id) },
      rule_id: String(job.job_key),
      rule_version: String(job.published_rev || 1),
      risk_level: "low",
      scope_snapshot: { scope: JSON.parse(String(job.scope_json || "{}")), condition: JSON.parse(String(job.condition_json || "{}")) },
      priority_class: "normal",
      max_attempts: 1,
      payload: { cron_run_id: runId, cron_job_id: String(job.id) },
      idempotency_key: `cron-run:${runId}`,
      outbox: {
        event_type: "cron.run_queued",
        aggregate_type: "cron_run",
        aggregate_id: runId,
        payload: { cron_job_id: String(job.id), trigger: "manual", scheduled_for: slot },
      },
    }, { db });
    return { run_id: runId, duplicate: false };
  });
}

/** Enqueue due runs durably. Only a separate BullMQ worker may execute them. */
export async function tickCronDue(now = new Date(), viewer?: AppUser): Promise<{ claimed: string[]; stale: boolean }> {
  ensureSystemCronJobs(getConn(), now);
  const claimed = txImmediate((db) => {
    markStaleRunning(db, now);
    return enqueueDueJobs(db, now);
  });
  return { claimed, stale: false };
}

export async function runCronJobNow(jobId: string, viewer?: AppUser, scheduledFor?: string): Promise<{ run_id: string }> {
  const enqueued = enqueueManualRun(jobId, scheduledFor);
  return { run_id: enqueued.run_id };
}
