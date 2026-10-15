import { runBullMqExecutionWorker } from "../queue/execution-worker.js";

/**
 * Production worker: PostgreSQL remains the authority and BullMQ transports
 * only durable execution-job identifiers. Storage fixtures use isolated
 * PostgreSQL; no SQLite runtime or storage fallback is supported.
 */
export async function runExecutionWorker(options: { worker_id?: string; poll_ms?: number } = {}): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim() || "";
  if (!/^postgres(?:ql)?:\/\//i.test(databaseUrl)) throw new Error("worker:execution requires a PostgreSQL DATABASE_URL");
  await runBullMqExecutionWorker({ workerId: options.worker_id });
}
