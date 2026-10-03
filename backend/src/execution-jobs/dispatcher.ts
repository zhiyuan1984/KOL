import { executeClaimedCronJob } from "../cron/worker.js";
import { executeClaimedPlanningJob } from "../host/today-plan-run.js";
import {
  claimExecutionJobById,
  claimNextExecutionJob,
  failExecutionJob,
  type ClaimedExecutionJob,
} from "./store.js";

export type ExecutionDispatchResult = {
  execution_job_id: string;
  job_type: string;
  handled: boolean;
  outcome: "processed" | "duplicate" | "failed";
  target_id?: string | null;
};

/**
 * One handler registry for every durable execution job. Queue transports only
 * carry an execution_job_id; this dispatcher keeps the database claim and the
 * terminal receipt authoritative across SQLite and BullMQ consumers.
 */
export async function dispatchClaimedExecutionJob(claimed: ClaimedExecutionJob): Promise<ExecutionDispatchResult> {
  const id = String(claimed.id);
  const jobType = String(claimed.job_type);
  try {
    if (jobType === "cron.run") {
      const runId = await executeClaimedCronJob(claimed);
      return { execution_job_id: id, job_type: jobType, handled: true, outcome: "processed", target_id: runId };
    }
    if (jobType === "work_plan.run" || jobType === "today_analyze.run") {
      const workItemId = await executeClaimedPlanningJob(claimed);
      return { execution_job_id: id, job_type: jobType, handled: true, outcome: "processed", target_id: workItemId };
    }
    failExecutionJob(id, {
      code: "unsupported_job_type",
      summary: `No durable execution handler registered for ${jobType}`,
    });
    return { execution_job_id: id, job_type: jobType, handled: false, outcome: "failed", target_id: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "execution handler failed");
    failExecutionJob(id, { code: "execution_handler_error", summary: message });
    console.error("[execution-dispatcher] handler failed", { executionJobId: id, jobType, error });
    return { execution_job_id: id, job_type: jobType, handled: true, outcome: "failed", target_id: null };
  }
}

export async function processNextExecutionJob(workerId = "execution-worker"): Promise<ExecutionDispatchResult | null> {
  const claimed = claimNextExecutionJob(workerId);
  if (!claimed) return null;
  return dispatchClaimedExecutionJob(claimed);
}

/**
 * Broker consumers may redeliver the same message. The authoritative claim
 * transitions queued/retrying -> running, so a second delivery is harmless.
 */
export async function processExecutionJobById(executionJobId: string, workerId = "execution-worker"): Promise<ExecutionDispatchResult | null> {
  const claimed = claimExecutionJobById(executionJobId, workerId);
  if (!claimed) return null;
  return dispatchClaimedExecutionJob(claimed);
}
