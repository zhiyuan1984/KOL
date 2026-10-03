import { HttpFail } from "../host/errors.js";
import type { AppUser } from "../auth.js";
import type { Row } from "../types.js";
import { cronHandler } from "./handlers.js";
import {
  pgCronJobById,
  pgCronRunById,
  pgEnqueueManualCronRun,
  pgEnsureSystemCronJobs,
  pgFinishCronRun,
  pgStartCronRun,
  pgTickCronDue,
} from "./postgres-store.js";
import {
  runtimeClaimExecutionJobById,
  runtimeClaimNextExecutionJob,
  runtimeCompleteExecutionJob,
  runtimeExecutionJobPayload,
  runtimeFailExecutionJob,
} from "../execution-jobs/runtime-store.js";
import type { ClaimedExecutionJob } from "../execution-jobs/store.js";

const TERMINAL = new Set(["succeeded", "failed", "skipped", "needs_takeover"]);

function receipt(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

/**
 * Runs an already-started durable Cron run. State transitions and receipts are
 * PostgreSQL native; individual legacy business handlers are migrated in a
 * separate bounded pass so no handler silently changes its business effects.
 */
export async function executeCronRun(runId: string, viewer?: AppUser, nowMs = Date.now()): Promise<Row> {
  const run = await pgCronRunById(runId);
  if (!run) throw new HttpFail(404, "cron run not found");
  const job = await pgCronJobById(String(run.job_id));
  if (!job) throw new HttpFail(404, "cron job not found");
  const finished = new Date(nowMs);
  const handler = cronHandler(String(job.handler_key));
  if (!handler) {
    const terminal = await pgFinishCronRun({
      run_id: runId,
      status: "failed",
      error_code: "unknown_handler",
      error_summary: `未注册 handler: ${job.handler_key}`,
      receipt: { created_session: false, handler_key: String(job.handler_key) },
      now: finished,
    });
    if (!terminal) throw new HttpFail(404, "cron run not found");
    return terminal;
  }
  try {
    const result = await handler({ job, run, actor: String(job.execute_as || "system"), viewer, nowMs });
    const status = TERMINAL.has(result.status) ? result.status : "failed";
    const terminal = await pgFinishCronRun({
      run_id: runId,
      status,
      error_code: result.error_code || null,
      error_summary: result.error_summary || null,
      receipt: result.receipt || {},
      artifact_refs: result.artifact_refs || null,
      session_id: result.session_id || null,
      now: finished,
    });
    if (!terminal) throw new HttpFail(404, "cron run not found");
    return terminal;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "handler failed");
    const terminal = await pgFinishCronRun({
      run_id: runId,
      status: "failed",
      error_code: "handler_error",
      error_summary: message,
      receipt: { created_session: false, handler_key: String(job.handler_key) },
      now: finished,
    });
    if (!terminal) throw new HttpFail(404, "cron run not found");
    return terminal;
  }
}

/** Execute a durable Cron job already claimed by the common execution dispatcher. */
export async function executeClaimedCronJob(claimed: ClaimedExecutionJob, viewer?: AppUser, nowMs = Date.now()): Promise<string> {
  const payload = runtimeExecutionJobPayload(claimed);
  const runId = String(payload.cron_run_id || "");
  if (!runId) {
    await runtimeFailExecutionJob(String(claimed.id), { code: "invalid_payload", summary: "cron.run missing cron_run_id" });
    throw new HttpFail(500, "invalid cron execution job payload");
  }
  const started = await pgStartCronRun(runId, new Date(nowMs));
  if (!started.run) {
    await runtimeFailExecutionJob(String(claimed.id), { code: "cron_run_missing", summary: `cron run missing: ${runId}` });
    throw new HttpFail(404, "cron run not found");
  }
  if (!started.started) {
    const status = String(started.run.status);
    if (["succeeded", "failed", "skipped", "needs_takeover"].includes(status)) {
      await runtimeCompleteExecutionJob(String(claimed.id), { cron_run_id: runId, cron_status: status, duplicate: true }, new Date(nowMs));
      return runId;
    }
    await runtimeFailExecutionJob(String(claimed.id), { code: "cron_run_not_queued", summary: `cron run is ${status}` });
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
      receipt: receipt(terminal.receipt_json),
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

/** Broker consumers receive a durable execution-job ID, never a local queue payload. */
export async function processCronExecutionJobById(executionJobId: string, workerId = "cron-worker", viewer?: AppUser, nowMs = Date.now()): Promise<string | null> {
  const claimed = await runtimeClaimExecutionJobById(executionJobId, workerId, { now: new Date(nowMs) });
  if (!claimed) return null;
  return executeClaimedCronJob(claimed, viewer, nowMs);
}

export async function enqueueManualRun(jobId: string, scheduledFor?: string): Promise<{ run_id: string; duplicate: boolean }> {
  await pgEnsureSystemCronJobs();
  try {
    return await pgEnqueueManualCronRun(jobId, scheduledFor);
  } catch (error) {
    if (error instanceof Error && error.message === "cron job not found") throw new HttpFail(404, "cron job not found");
    throw error;
  }
}

/** Enqueue due runs durably. Only a separate BullMQ worker may execute them. */
export async function tickCronDue(now = new Date(), _viewer?: AppUser): Promise<{ claimed: string[]; stale: boolean }> {
  return pgTickCronDue(now);
}

export async function runCronJobNow(jobId: string, _viewer?: AppUser, scheduledFor?: string): Promise<{ run_id: string }> {
  const enqueued = await enqueueManualRun(jobId, scheduledFor);
  return { run_id: enqueued.run_id };
}
