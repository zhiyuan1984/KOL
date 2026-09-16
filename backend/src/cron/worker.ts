import { audit, getConn, nowIso, txImmediate, type SqliteConn } from "../db.js";
import { HttpFail } from "../host/errors.js";
import type { Json, Row } from "../types.js";
import type { AppUser } from "../auth.js";
import { cronHandler } from "./handlers.js";
import { nextRunAt } from "./schedule.js";
import {
  ensureSystemCronJobs,
  jobById,
  newRunId,
  runById,
} from "./store.js";

const TERMINAL = new Set(["succeeded", "failed", "skipped", "needs_takeover"]);

function isUniqueError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT_UNIQUE/i.test(message);
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
  const claimed: string[] = [];
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
        const next = nextRunAt(String(job.cron_expr), String(job.timezone || "Asia/Shanghai"), new Date(scheduledFor)).toISOString();
        db.prepare("UPDATE cron_jobs SET next_run_at=?, updated_at=? WHERE id=?").run(next, created, job.id);
        continue;
      }
      throw error;
    }
    const flip = db.prepare(
      "UPDATE cron_runs SET status='running', started_at=? WHERE id=? AND status='queued'",
    ).run(created, runId);
    const next = nextRunAt(String(job.cron_expr), String(job.timezone || "Asia/Shanghai"), new Date(scheduledFor)).toISOString();
    db.prepare("UPDATE cron_jobs SET next_run_at=?, updated_at=? WHERE id=?").run(next, created, job.id);
    if (flip.changes) claimed.push(runId);
  }
  const leftover = db.prepare("SELECT id FROM cron_runs WHERE status='queued' ORDER BY created_at").all() as Array<{ id: string }>;
  for (const row of leftover) {
    const flip = db.prepare(
      "UPDATE cron_runs SET status='running', started_at=? WHERE id=? AND status='queued'",
    ).run(now.toISOString(), row.id);
    if (flip.changes) claimed.push(row.id);
  }
  return claimed;
}

export function executeCronRun(runId: string, viewer?: AppUser, nowMs = Date.now()): Row {
  const db = getConn();
  const run = runById(runId, db);
  if (!run) throw new HttpFail(404, "cron run not found");
  const job = jobById(String(run.job_id), db);
  if (!job) throw new HttpFail(404, "cron job not found");
  if (run.session_id) {
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
    const result = handler({
      job,
      run,
      actor: String(job.execute_as || "system"),
      viewer,
      nowMs,
    });
    const status = TERMINAL.has(result.status) ? result.status : "failed";
    db.prepare(
      `UPDATE cron_runs
          SET status=?, finished_at=?, error_code=?, error_summary=?, receipt_json=?, artifact_refs=?, session_id=NULL
        WHERE id=?`,
    ).run(
      status,
      finished,
      result.error_code || null,
      result.error_summary || null,
      JSON.stringify(result.receipt || {}),
      result.artifact_refs ? JSON.stringify(result.artifact_refs) : null,
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
      created_session: false,
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
    db.prepare(
      "UPDATE cron_runs SET status='running', started_at=? WHERE id=? AND status='queued'",
    ).run(nowIso(), runId);
    return { run_id: runId, duplicate: false };
  });
}

/** Claim due published jobs and leftover queued runs, then execute. Not an HTTP timer. */
export function tickCronDue(now = new Date(), viewer?: AppUser): { claimed: string[]; stale: boolean } {
  ensureSystemCronJobs(getConn(), now);
  const claimed = txImmediate((db) => {
    markStaleRunning(db, now);
    return enqueueDueJobs(db, now);
  });
  for (const runId of claimed) {
    executeCronRun(runId, viewer, now.getTime());
  }
  return { claimed, stale: false };
}

export function runCronJobNow(jobId: string, viewer?: AppUser, scheduledFor?: string): { run_id: string } {
  const enqueued = enqueueManualRun(jobId, scheduledFor);
  if (!enqueued.duplicate) {
    executeCronRun(enqueued.run_id, viewer);
  }
  return { run_id: enqueued.run_id };
}

export function uniqueEnqueueConstraintName(): string {
  return "cron_runs.job_id, cron_runs.scheduled_for";
}
