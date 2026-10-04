import { runBullMqExecutionWorker } from "../queue/execution-worker.js";

/**
 * Production worker: PostgreSQL remains the authority and BullMQ transports
 * only durable execution-job identifiers. SQLite is retained only by isolated
 * unit fixtures and is never a supported worker runtime.
 */
export async function runExecutionWorker(options: { worker_id?: string; poll_ms?: number } = {}): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim() || "";
  if (!/^postgres(?:ql)?:\/\//i.test(databaseUrl)) throw new Error("worker:execution requires a PostgreSQL DATABASE_URL");
  await runBullMqExecutionWorker({ workerId: options.worker_id });
}
