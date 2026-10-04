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

export async function postgresTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
  options: { isolation?: "READ COMMITTED" | "REPEATABLE READ" | "SERIALIZABLE" } = {},
): Promise<T> {
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
    throw error;
  } finally {
    client.release();
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
