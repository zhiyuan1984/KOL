import { executeClaimedCronJob } from "../cron/worker.js";
import { pgExecutionJobById } from "./postgres-store.js";
import {
  type ClaimedExecutionJob,
} from "./contracts.js";
import {
  runtimeClaimExecutionJobById,
  runtimeClaimNextExecutionJob,
  runtimeCompleteExecutionJob,
  runtimeFailExecutionJob,
  runtimeQuarantineExecutionJob,
  runtimeRenewExecutionJobLease,
} from "./runtime-store.js";

export type ExecutionDispatchResult = {
  execution_job_id: string;
  job_type: string;
  handled: boolean;
  outcome: "processed" | "duplicate" | "failed" | "needs_takeover";
  target_id?: string | null;
};

/**
 * One handler registry for every durable execution job. Queue transports only
 * carry an execution_job_id; this dispatcher keeps the PostgreSQL-native
 * claim and terminal receipt authoritative across BullMQ consumers.
 */
async function dispatchClaimedExecutionJobInner(claimed: ClaimedExecutionJob): Promise<ExecutionDispatchResult> {
  const id = String(claimed.id);
  const jobType = String(claimed.job_type);
  try {
    if (jobType === "mail.sync") {
      if (process.env.KOL_RUNTIME_MODE === "postgres-only") {
        await runtimeQuarantineExecutionJob(id, { code: "needs_takeover", summary: "Mail index adapter is not available in PostgreSQL-only mode" });
        return { execution_job_id: id, job_type: jobType, handled: false, outcome: "needs_takeover" };
      }
      const { executeMailSyncJob } = await import("../mail/sync-job.js");
      const checkpoint = async () => {
        const current = await pgExecutionJobById(id);
        if (current?.status !== "running" || current.lease_owner !== claimed.worker_id) throw new Error("execution_job_claim_lost_or_cancelled");
      };
      const receipt = await executeMailSyncJob(claimed, checkpoint);
      await checkpoint();
      const completed = await runtimeCompleteExecutionJob(id, receipt, new Date(), claimed.worker_id);
      return { execution_job_id: id, job_type: jobType, handled: true, outcome: completed ? "processed" : "duplicate" };
    }
    if (jobType === "cron.run") {
      const runId = await executeClaimedCronJob(claimed);
      return { execution_job_id: id, job_type: jobType, handled: true, outcome: "processed", target_id: runId };
    }
    if (jobType === "work_plan.run" || jobType === "today_analyze.run") {
      await runtimeQuarantineExecutionJob(id, {
        code: "needs_takeover",
        summary: `${jobType} depends on retired planning/task-run storage and is disabled in PostgreSQL-only runtime`,
      });
      return { execution_job_id: id, job_type: jobType, handled: false, outcome: "needs_takeover", target_id: String(claimed.ticket_id || "") || null };
    }
    await runtimeFailExecutionJob(id, {
      code: "unsupported_job_type",
      summary: `No durable execution handler registered for ${jobType}`,
    });
    return { execution_job_id: id, job_type: jobType, handled: false, outcome: "failed", target_id: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "execution handler failed");
    await runtimeFailExecutionJob(id, { code: "execution_handler_error", summary: message }, { expected_worker: claimed.worker_id });
    console.error("[execution-dispatcher] handler failed", { executionJobId: id, jobType, error });
    return { execution_job_id: id, job_type: jobType, handled: true, outcome: "failed", target_id: null };
  }
}

export type ExecutionDispatchOptions = { lease_ms?: number; renew_ms?: number };

/** Keep a job's database claim alive while an external handler is still
 * executing. Renewal is ownership-scoped so a stale worker cannot resurrect a
 * claim later owned by another consumer. */
export async function dispatchClaimedExecutionJob(
  claimed: ClaimedExecutionJob,
  options: ExecutionDispatchOptions = {},
): Promise<ExecutionDispatchResult> {
  const leaseMs = Math.max(1_000, Number(options.lease_ms || 60_000));
  const renewMs = Math.max(500, Math.min(leaseMs - 100, Number(options.renew_ms || Math.floor(leaseMs / 3))));
  const timer = setInterval(() => {
    void runtimeRenewExecutionJobLease(String(claimed.id), String(claimed.worker_id), { lease_ms: leaseMs })
      .then((renewed) => {
        if (!renewed) {
        console.warn("[execution-dispatcher] lease renewal skipped", { executionJobId: claimed.id, workerId: claimed.worker_id });
        }
      })
      .catch((error) => {
        console.error("[execution-dispatcher] lease renewal failed", { executionJobId: claimed.id, workerId: claimed.worker_id, error });
      });
  }, renewMs);
  timer.unref();
  try {
    return await dispatchClaimedExecutionJobInner(claimed);
  } finally {
    clearInterval(timer);
  }
}

export async function processNextExecutionJob(
  workerId = "execution-worker",
  options: ExecutionDispatchOptions = {},
): Promise<ExecutionDispatchResult | null> {
  const claimed = await runtimeClaimNextExecutionJob(workerId, { lease_ms: options.lease_ms });
  if (!claimed) return null;
  return dispatchClaimedExecutionJob(claimed, options);
}

/**
 * Broker consumers may redeliver the same message. The authoritative claim
 * transitions queued/retrying -> running, so a second delivery is harmless.
 */
export async function processExecutionJobById(
  executionJobId: string,
  workerId = "execution-worker",
  options: ExecutionDispatchOptions = {},
): Promise<ExecutionDispatchResult | null> {
  const claimed = await runtimeClaimExecutionJobById(executionJobId, workerId, { lease_ms: options.lease_ms });
  if (!claimed) return null;
  return dispatchClaimedExecutionJob(claimed, options);
}
