import { databaseEngine } from "../db.js";
import { runBullMqExecutionWorker } from "../queue/execution-worker.js";

/**
 * Production worker: PostgreSQL remains the authority and BullMQ transports
 * only durable execution-job identifiers. SQLite is retained only by isolated
 * unit fixtures and is never a supported worker runtime.
 */
export async function runExecutionWorker(options: { worker_id?: string; poll_ms?: number } = {}): Promise<void> {
  if (databaseEngine() !== "postgres") throw new Error("worker:execution requires DATABASE_URL and PostgreSQL");
  await runBullMqExecutionWorker({ workerId: options.worker_id });
}
