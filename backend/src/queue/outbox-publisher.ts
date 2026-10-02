import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { Client, Pool } from "pg";

export const EXECUTION_QUEUE = "lingong-execution-v1";

type OutboxRow = {
  id: string;
  job_id: string;
  event_type: string;
  payload_json: string;
  attempts: number;
};

function required(name: string, value: string | undefined): string {
  if (!value?.trim()) throw new Error(`${name} is required for PostgreSQL/BullMQ execution`);
  return value;
}

export function postgresExecutionConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim() && process.env.REDIS_URL?.trim());
}

export async function ensureExecutionInfrastructure(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS execution_worker_heartbeats (
      worker_id TEXT PRIMARY KEY,
      worker_kind TEXT NOT NULL,
      status TEXT NOT NULL,
      details_json TEXT NOT NULL DEFAULT '{}',
      started_at TEXT NOT NULL,
      heartbeat_at TEXT NOT NULL,
      stopped_at TEXT
    );
    CREATE INDEX IF NOT EXISTS execution_worker_heartbeats_status
      ON execution_worker_heartbeats(status, heartbeat_at DESC);
  `);
}

async function claimOutboxRows(client: Client, limit: number): Promise<OutboxRow[]> {
  await client.query("BEGIN");
  try {
    const claimed = await client.query<OutboxRow>(`
      WITH due AS (
        SELECT id FROM execution_outbox
        WHERE status IN ('pending','retrying') AND available_at <= $1
        ORDER BY available_at, created_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT $2
      )
      UPDATE execution_outbox outbox
      SET status='publishing', attempts=attempts+1, updated_at=$1, last_error=NULL
      FROM due
      WHERE outbox.id=due.id
      RETURNING outbox.id, outbox.job_id, outbox.event_type, outbox.payload_json, outbox.attempts
    `, [new Date().toISOString(), limit]);
    await client.query("COMMIT");
    return claimed.rows;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export class PostgresOutboxPublisher {
  private readonly pool: Pool;
  private readonly redis: Redis;
  private readonly queue: Queue;

  constructor(options: { databaseUrl?: string; redisUrl?: string } = {}) {
    const databaseUrl = required("DATABASE_URL", options.databaseUrl || process.env.DATABASE_URL);
    const redisUrl = required("REDIS_URL", options.redisUrl || process.env.REDIS_URL);
    this.pool = new Pool({ connectionString: databaseUrl, max: 4 });
    this.redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue(EXECUTION_QUEUE, { connection: this.redis });
  }

  async initialize(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await ensureExecutionInfrastructure(client);
    } finally {
      client.release();
    }
  }

  async drainOnce(limit = 50): Promise<number> {
    const client = await this.pool.connect();
    try {
      const rows = await claimOutboxRows(client, Math.max(1, Math.min(500, limit)));
      for (const row of rows) {
        try {
          await this.queue.add(
            row.event_type,
            { execution_job_id: row.job_id, outbox_id: row.id },
            {
              // BullMQ reserves ':' as an internal key separator.
              jobId: `outbox-${row.id}`,
              attempts: 1,
              removeOnComplete: { age: 86_400, count: 10_000 },
              removeOnFail: { age: 7 * 86_400, count: 20_000 },
            },
          );
          await client.query(
            `UPDATE execution_outbox
             SET status='published', published_at=$1, updated_at=$1, last_error=NULL
             WHERE id=$2 AND status='publishing'`,
            [new Date().toISOString(), row.id],
          );
        } catch (error) {
          const message = error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000);
          await client.query(
            `UPDATE execution_outbox
             SET status='retrying', available_at=$1, updated_at=$2, last_error=$3
             WHERE id=$4 AND status='publishing'`,
            [new Date(Date.now() + Math.min(60_000, 1_000 * Math.max(1, Number(row.attempts || 1)))).toISOString(), new Date().toISOString(), message, row.id],
          );
        }
      }
      return rows.length;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.queue.close();
    this.redis.disconnect();
    await this.pool.end();
  }
}

export async function runOutboxPublisher(options: { pollMs?: number; publisherId?: string } = {}): Promise<void> {
  const pollMs = Math.max(100, Number(options.pollMs || process.env.OUTBOX_POLL_MS || 500));
  const publisherId = options.publisherId || process.env.OUTBOX_PUBLISHER_ID || `outbox-${randomUUID()}`;
  const publisher = new PostgresOutboxPublisher();
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  await publisher.initialize();
  console.log(`[outbox-publisher] started ${publisherId}`);
  try {
    while (!stopping) {
      const published = await publisher.drainOnce();
      if (!published) await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  } finally {
    await publisher.close();
    console.log(`[outbox-publisher] stopped ${publisherId}`);
  }
}
