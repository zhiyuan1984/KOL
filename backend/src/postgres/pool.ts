import { Pool, type PoolClient, type QueryResultRow } from "pg";

let pool: Pool | null = null;
let poolUrl: string | null = null;

export function requiredPostgresUrl(): string {
  const value = String(process.env.DATABASE_URL || "").trim();
  if (!value) {
    throw new Error("DATABASE_URL is required; PostgreSQL is the only supported authority store");
  }
  if (!/^postgres(?:ql)?:\/\//i.test(value)) {
    throw new Error("DATABASE_URL must use a PostgreSQL connection URL");
  }
  return value;
}

/**
 * Native asynchronous PostgreSQL access. New task/scheduling repositories must
 * use this pool rather than the retired SQLite-shaped synchronous bridge.
 */
export function postgresPool(): Pool {
  const connectionString = requiredPostgresUrl();
  if (pool && poolUrl === connectionString) return pool;
  if (pool) {
    void pool.end();
    pool = null;
  }
  poolUrl = connectionString;
  pool = new Pool({
    connectionString,
    max: Math.max(2, Math.min(20, Number(process.env.POSTGRES_POOL_MAX || 10))),
    idleTimeoutMillis: Math.max(1_000, Number(process.env.POSTGRES_POOL_IDLE_MS || 30_000)),
    connectionTimeoutMillis: Math.max(1_000, Number(process.env.POSTGRES_CONNECT_TIMEOUT_MS || 10_000)),
  });
  pool.on("error", (error) => {
    console.error("[postgres-pool] unexpected idle client error", error);
  });
  return pool;
}

/** True when PostgreSQL aborted the transaction as a serialization failure (SQLSTATE 40001).
 * Such transactions applied nothing, so retrying is always safe. */
export function isSerializationFailure(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code || "")
    : "";
  return code === "40001"
    || /could not serialize access/i.test(error instanceof Error ? error.message : String(error || ""));
}

const TX_RETRY_DELAYS_MS = [120, 300, 800];

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function postgresTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
  options: { isolation?: "READ COMMITTED" | "REPEATABLE READ" | "SERIALIZABLE"; maxRetries?: number } = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  let attempt = 0;
  for (;;) {
    const client = await postgresPool().connect();
    try {
      await client.query(`BEGIN ISOLATION LEVEL ${options.isolation || "READ COMMITTED"}`);
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original database or domain error.
      }
      // Serialization failures are transient by design: the aborted transaction
      // applied nothing, so a bounded retry is the documented recovery.
      if (isSerializationFailure(error) && attempt < maxRetries) {
        const delay = TX_RETRY_DELAYS_MS[Math.min(attempt, TX_RETRY_DELAYS_MS.length - 1)];
        attempt += 1;
        await sleep(delay);
        continue;
      }
      throw error;
    } finally {
      client.release();
    }
  }
}

export async function postgresQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<T[]> {
  return (await postgresPool().query<T>(text, [...values])).rows;
}

export async function closePostgresPool(): Promise<void> {
  if (!pool) return;
  const current = pool;
  pool = null;
  poolUrl = null;
  await current.end();
}
