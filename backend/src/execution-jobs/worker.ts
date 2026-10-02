import { processNextCronExecutionJob } from "../cron/worker.js";
import { databaseEngine } from "../db.js";
import { runBullMqExecutionWorker } from "../queue/execution-worker.js";
import { recoverExpiredExecutionJobs } from "./store.js";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * SQLite transition worker. It deliberately runs one claim loop per process;
 * horizontal consumers require the planned PostgreSQL + broker migration.
 */
export async function runExecutionWorker(options: { worker_id?: string; poll_ms?: number } = {}): Promise<void> {
  if (databaseEngine() === "postgres") {
    await runBullMqExecutionWorker({ workerId: options.worker_id });
    return;
  }
  const workerId = options.worker_id || process.env.EXECUTION_WORKER_ID || `worker-${process.pid}`;
  const pollMs = Math.max(100, Number(options.poll_ms || process.env.EXECUTION_WORKER_POLL_MS || 1_000));
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  console.log(`[execution-worker] started ${workerId} (sqlite single-worker transition)`);
  while (!stopping) {
    const recovered = recoverExpiredExecutionJobs();
    if (recovered.requeued || recovered.uncertain) {
      console.warn(`[execution-worker] recovered requeued=${recovered.requeued} uncertain=${recovered.uncertain}`);
    }
    const runId = await processNextCronExecutionJob(workerId);
    if (runId) {
      console.log(`[execution-worker] completed cron run ${runId}`);
      continue;
    }
    await wait(pollMs);
  }
  console.log(`[execution-worker] stopped ${workerId}`);
}
