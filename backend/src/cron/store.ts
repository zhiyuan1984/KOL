/** Native PostgreSQL scheduling repository. No embedded engine or synchronous store. */
export {
  pgEnsureSystemCronJobs as ensureSystemCronJobs,
  pgCronJobById as jobById,
  pgCronJobById as jobByKey,
  pgListCronJobs as listJobs,
  pgListCronRuns as listRuns,
  pgCronRunById as runById,
} from "./postgres-store.js";
export {
  cronPublicJob as publicJob,
  cronPublicJobSummary as publicJobSummary,
  cronPublicRun as publicRun,
  cronSystemJob as isSystemJob,
} from "./contracts.js";
import { nid } from "../ids.js";
import { isCronHandlerKey } from "./handlers.js";
export function newJobId(): string { return nid("cron"); }
export function newRunId(): string { return nid("crun"); }
export function assertRegisteredHandler(handlerKey: string): void {
  if (!isCronHandlerKey(handlerKey)) throw new Error(`unknown handler_key: ${handlerKey}`);
}
