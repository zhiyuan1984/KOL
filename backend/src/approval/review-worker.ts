import type { ClaimedExecutionJob } from "../execution-jobs/contracts.js";
import { executePostgresReviewTimeout } from "./review-postgres-worker.js";

/** PostgreSQL-only timeout execution.  No SQLite fallback may process frozen policies. */
export async function executeReviewTimeout(job: ClaimedExecutionJob) {
  return (await executePostgresReviewTimeout(job)).instanceId;
}
