import { pgSerialTransaction } from "../postgres/access.js";
import { completeExecutionJob, type ClaimedExecutionJob, } from "../execution-jobs/store.js";
import { reviewContextForActor } from "./review-access.js";
import { ReviewService } from "./review-service.js";
import { executePostgresReviewTimeout } from "./review-postgres-worker.js";
/** No model or external messaging. Executes only the frozen, explicitly published timeout policy. */
export async function executeReviewTimeout(job: ClaimedExecutionJob) {
  if (process.env.DATABASE_URL)
    return (await executePostgresReviewTimeout(job)).instanceId;
  return (await pgSerialTransaction(async (db) => {
    const current = (await db.one("SELECT id FROM execution_jobs WHERE id=$1 AND status='running' AND lease_owner=$2 AND lease_until>$3", job.id, job.worker_id, new Date().toISOString()));
    if (!current)
      throw new Error("超时作业租约已失效");
    const payload = JSON.parse(String(job.payload_json));
    const context = (await reviewContextForActor(db, String(job.actor_ref), String(job.tenant_ref)));
    const receipt = (await new ReviewService(db, context).timeout(String(payload.instanceId), String(payload.taskId), String(payload.dueAt)));
    (await completeExecutionJob(String(job.id), receipt, new Date(), db));
    return String(payload.instanceId);
  }));
}
