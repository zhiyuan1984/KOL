import { randomUUID } from "node:crypto";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { Client, Pool } from "pg";
import { processExecutionJobById } from "../execution-jobs/dispatcher.js";
import { runtimeRecoverExpiredExecutionJobs } from "../execution-jobs/runtime-store.js";
import { EXECUTION_QUEUE, ensureExecutionInfrastructure } from "./outbox-publisher.js";

function required(name: string, value: string | undefined): string {
  if (!value?.trim()) throw new Error(`${name} is required for PostgreSQL/BullMQ execution`);
  return value;
}

async function heartbeat(client: Client, input: { id: string; status: "running" | "stopped"; details?: Record<string, unknown> }): Promise<void> {
  const now = new Date().toISOString();
  await client.query(
    `INSERT INTO execution_worker_heartbeats
     (worker_id,worker_kind,status,details_json,started_at,heartbeat_at,stopped_at)
     VALUES ($1,'bullmq',$2,$3,$4,$4,CASE WHEN $2='stopped' THEN $4 ELSE NULL END)
     ON CONFLICT (worker_id) DO UPDATE SET
       status=EXCLUDED.status, details_json=EXCLUDED.details_json, heartbeat_at=EXCLUDED.heartbeat_at,
       stopped_at=CASE WHEN EXCLUDED.status='stopped' THEN EXCLUDED.heartbeat_at ELSE NULL END`,
    [input.id, input.status, JSON.stringify(input.details || {}), now],
  );
}

export async function runBullMqExecutionWorker(options: { workerId?: string; concurrency?: number } = {}): Promise<void> {
  const databaseUrl = required("DATABASE_URL", process.env.DATABASE_URL);
  const redisUrl = required("REDIS_URL", process.env.REDIS_URL);
  const workerId = options.workerId || process.env.EXECUTION_WORKER_ID || `execution-${randomUUID()}`;
  const concurrency = Math.max(1, Math.min(32, Number(options.concurrency || process.env.EXECUTION_WORKER_CONCURRENCY || 4)));
  const leaseMs = Math.max(5_000, Number(process.env.EXECUTION_LEASE_MS || 60_000));
  const pool = new Pool({ connectionString: databaseUrl, max: 3 });
  const client = await pool.connect();
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  await ensureExecutionInfrastructure(client);
  await heartbeat(client, { id: workerId, status: "running", details: { concurrency, queue: EXECUTION_QUEUE } });

  const worker = new Worker(
    EXECUTION_QUEUE,
    async (bullJob) => {
      const executionJobId = String(bullJob.data.execution_job_id || "");
      if (!executionJobId) throw new Error("BullMQ message is missing execution_job_id");
      const result = await processExecutionJobById(executionJobId, workerId, { lease_ms: leaseMs });
      return result || { execution_job_id: executionJobId, outcome: "duplicate" };
    },
    { connection: redis, concurrency },
  );

  let stopping = false;
  const stop = () => { stopping = true; };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const tick = setInterval(() => {
    void heartbeat(client, { id: workerId, status: "running", details: { concurrency, queue: EXECUTION_QUEUE } }).catch((error) => {
      console.error("[execution-worker] heartbeat failed", error);
    });
    void runtimeRecoverExpiredExecutionJobs().then((recovered) => {
      if (recovered.requeued || recovered.uncertain) console.warn(`[execution-worker] recovered requeued=${recovered.requeued} uncertain=${recovered.uncertain}`);
    }).catch((error) => {
      console.error("[execution-worker] lease recovery failed", error);
    });
  }, Math.max(5_000, Number(process.env.EXECUTION_HEARTBEAT_MS || 15_000)));
  tick.unref();
  console.log(`[execution-worker] started ${workerId} (postgres + BullMQ, concurrency=${concurrency}, lease_ms=${leaseMs})`);
  try {
    while (!stopping) await new Promise((resolve) => setTimeout(resolve, 200));
  } finally {
    clearInterval(tick);
    await worker.close();
    await heartbeat(client, { id: workerId, status: "stopped", details: { concurrency, queue: EXECUTION_QUEUE } });
    redis.disconnect();
    client.release();
    await pool.end();
    console.log(`[execution-worker] stopped ${workerId}`);
  }
}
