import { closePostgresPool, postgresConnection, requiredPostgresUrl } from "../postgres/pool.js";
import { pgEnsureSystemCronJobs, pgTickCronDue, type CronMissedRunPolicy } from "./postgres-store.js";
import { cronTickPollMs, runCronTickLoop } from "./tick-loop.js";
import type { Json } from "../types.js";

export function cronMissedRunPolicy(value: unknown): CronMissedRunPolicy {
  if (value !== "replay" && value !== "coalesce") {
    throw new Error("CRON_MISSED_RUN_POLICY must explicitly be replay or coalesce");
  }
  return value;
}

function safeErrorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error
    ? String(error.code).slice(0, 80) : "cron_tick_error";
}

export async function pgCronTickHeartbeat(workerId: string, status: "running" | "stopped", details: Json, startedAt?: string): Promise<void> {
  const now = new Date().toISOString();
  await postgresConnection().query(
    `INSERT INTO execution_worker_heartbeats
       (worker_id,worker_kind,status,details_json,started_at,heartbeat_at,stopped_at)
     VALUES ($1,'cron-tick',$2,$3,$4,$5,$6)
     ON CONFLICT (worker_id) DO UPDATE SET
       worker_kind='cron-tick',status=EXCLUDED.status,details_json=EXCLUDED.details_json,
       started_at=CASE WHEN $7 THEN EXCLUDED.started_at ELSE execution_worker_heartbeats.started_at END,
       heartbeat_at=EXCLUDED.heartbeat_at,stopped_at=EXCLUDED.stopped_at`,
    [workerId, status, JSON.stringify(details), startedAt || now, now, status === "stopped" ? now : null, Boolean(startedAt)],
  );
}

export async function runCronTickWorker(options: {
  worker_id?: string;
  poll_ms?: number;
  missed_run_policy?: CronMissedRunPolicy;
  signal?: AbortSignal;
} = {}): Promise<void> {
  // Do not silently decide whether historical windows should be replayed.
  const policy = cronMissedRunPolicy(options.missed_run_policy || process.env.CRON_MISSED_RUN_POLICY);
  requiredPostgresUrl();
  const workerId = options.worker_id || process.env.CRON_TICK_WORKER_ID || `cron-tick-${process.pid}`;
  const pollMs = cronTickPollMs(options.poll_ms ?? process.env.CRON_TICK_POLL_MS);
  const controller = new AbortController();
  const stop = () => controller.abort();
  const externalStop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  options.signal?.addEventListener("abort", externalStop, { once: true });
  if (options.signal?.aborted) controller.abort();
  let registered = false;
  let details: Json = { poll_ms: pollMs, missed_run_policy: policy, enqueue_only: true, last_success_at: null };
  try {
    const schema = await postgresConnection().query<{ ready: boolean }>(
      `SELECT to_regclass('public.cron_jobs') IS NOT NULL
         AND to_regclass('public.cron_runs') IS NOT NULL
         AND to_regclass('public.execution_jobs') IS NOT NULL
         AND to_regclass('public.execution_outbox') IS NOT NULL
         AND to_regclass('public.execution_worker_heartbeats') IS NOT NULL AS ready`,
    );
    if (!schema.rows[0]?.ready) throw new Error("Cron/Execution PostgreSQL schema missing; apply migrations before starting Cron Tick");
    if (controller.signal.aborted) return;
    await pgEnsureSystemCronJobs();
    await pgCronTickHeartbeat(workerId, "running", details, new Date().toISOString());
    registered = true;
    console.log(`[cron-tick] started ${workerId}; enqueue-only; policy=${policy}; poll_ms=${pollMs}`);
    await runCronTickLoop({
      signal: controller.signal,
      poll_ms: pollMs,
      tick: () => pgTickCronDue(new Date(), { missed_run_policy: policy, ensure_system_jobs: false }),
      heartbeat: async (result) => {
        details = { poll_ms: pollMs, missed_run_policy: policy, enqueue_only: true,
          last_success_at: new Date().toISOString(), last_claimed_count: result.claimed.length,
          stale_runs_observed: result.stale, last_error_code: null };
        await pgCronTickHeartbeat(workerId, "running", details);
        if (result.claimed.length) console.log(`[cron-tick] durably enqueued ${result.claimed.length} run(s)`);
      },
      on_error: (error) => {
        details = { ...details, last_error_code: safeErrorCode(error) };
        console.error("[cron-tick] tick failed", { code: safeErrorCode(error) });
      },
    });
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    options.signal?.removeEventListener("abort", externalStop);
    try {
      if (registered) await pgCronTickHeartbeat(workerId, "stopped", details);
    } finally {
      await closePostgresPool();
    }
    console.log(`[cron-tick] stopped ${workerId}`);
  }
}
