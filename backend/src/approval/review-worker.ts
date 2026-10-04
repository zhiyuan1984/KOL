import { txImmediate } from "../db.js";
import {
  completeExecutionJob,
  type ClaimedExecutionJob,
} from "../execution-jobs/store.js";
import { reviewContextForActor } from "./review-access.js";
import { ReviewService } from "./review-service.js";

/** No model or external messaging. Executes only the frozen, explicitly published timeout policy. */
export function executeReviewTimeout(job: ClaimedExecutionJob) {
  return txImmediate((db) => {
    const current = db
      .prepare(
        "SELECT id FROM execution_jobs WHERE id=? AND status='running' AND lease_owner=? AND lease_until>?",
      )
      .get(job.id, job.worker_id, new Date().toISOString());
    if (!current) throw new Error("超时作业租约已失效");
    const payload = JSON.parse(String(job.payload_json));
    const context = reviewContextForActor(
      db,
      String(job.actor_ref),
      String(job.tenant_ref),
    );
    const receipt = new ReviewService(db, context).timeout(
      String(payload.instanceId),
      String(payload.taskId),
      String(payload.dueAt),
    );
    completeExecutionJob(String(job.id), receipt, new Date(), db);
    return String(payload.instanceId);
  });
}
