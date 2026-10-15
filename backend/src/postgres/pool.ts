import { AsyncLocalStorage } from "node:async_hooks";
import { Pool, types, type PoolClient, type QueryResultRow } from "pg";
import { drainBackgroundWork } from "../background-work.js";

// Preserve large integers; normalize safe flags so PostgreSQL 0 is never truthy.
types.setTypeParser(20, (value: string) => {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : value;
});
let pool: Pool | null = null;
let poolUrl: string | null = null;
// pg-pool removes clients from its internal array before client.end completes.
// Its end() Promise therefore is not the physical socket-close barrier.
const physicalClients = new WeakMap<Pool, Set<PoolClient>>();
const closingHooks = new Set<() => void>();
/** Stop timer producers synchronously; their running work remains drainable. */
export function onPostgresPoolClosing(hook: () => void): () => void {
  closingHooks.add(hook);
  return () => closingHooks.delete(hook);
}
export function requiredPostgresUrl(): string {
  const value = String(process.env.DATABASE_URL || "").trim();
  if (!value) throw new Error("DATABASE_URL is required; PostgreSQL is the only supported authority store");
  if (!/^postgres(?:ql)?:\/\//i.test(value)) throw new Error("DATABASE_URL must use a PostgreSQL connection URL");
  return value;
}
export function postgresPool(): Pool {
  const connectionString = requiredPostgresUrl();
  if (pool && poolUrl === connectionString) return pool;
  if (pool) throw new Error("DATABASE_URL changed while the PostgreSQL pool is active; await closePostgresPool() before selecting another database");
  poolUrl = connectionString;
  pool = new Pool({
    connectionString,
    max: Math.max(2, Math.min(20, Number(process.env.POSTGRES_POOL_MAX || 10))),
    idleTimeoutMillis: Math.max(1_000, Number(process.env.POSTGRES_POOL_IDLE_MS || 30_000)),
    connectionTimeoutMillis: Math.max(1_000, Number(process.env.POSTGRES_CONNECT_TIMEOUT_MS || 10_000)),
  });
  const connected = new Set<PoolClient>();
  physicalClients.set(pool, connected);
  pool.on("connect", (client) => connected.add(client));
  pool.on("remove", (client) => connected.delete(client));
  pool.on("error", (error) => console.error("[postgres-pool] unexpected idle client error", error));
  return pool;
}
export function isSerializationFailure(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code || "") : "";
  return code === "40001" || /could not serialize access/i.test(error instanceof Error ? error.message : String(error || ""));
}
type Isolation = "READ COMMITTED" | "REPEATABLE READ" | "SERIALIZABLE";
type TransactionRoot = { active: boolean; aborting: boolean; isolation: Isolation; savepoint: number; retryFailure?: unknown };
type TransactionFrame = { client: PoolClient; root: TransactionRoot; children: Promise<void> };
const transactionContext = new AsyncLocalStorage<TransactionFrame>();
export function currentTransactionClient(): PoolClient | undefined {
  const frame = transactionContext.getStore();
  return frame?.root.active ? frame.client : undefined;
}
export function postgresConnection(): Pool | PoolClient { return currentTransactionClient() || postgresPool(); }
const ranks: Record<Isolation, number> = { "READ COMMITTED": 0, "REPEATABLE READ": 1, "SERIALIZABLE": 2 };
const retryableTransactionError = (error: unknown): boolean => isSerializationFailure(error) || Boolean(error && typeof error === "object" && "code" in error && error.code === "40P01");
const TX_RETRY_DELAYS_MS = [120, 300, 800];
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Nested scopes share the caller's physical client and snapshot. Sibling scopes
 * queue on their parent frame; descendants have a separate queue, so reentrant
 * nesting cannot deadlock and parallel siblings cannot invalidate savepoints.
 */
async function nestedTransaction<T>(parent: TransactionFrame, fn: (client: PoolClient) => T | Promise<T>, isolation?: Isolation): Promise<T> {
  if (isolation && ranks[isolation] > ranks[parent.root.isolation]) throw new Error("A nested transaction cannot strengthen isolation; set isolation on the outer transaction");
  const previous = parent.children;
  let release!: () => void;
  parent.children = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  const frame: TransactionFrame = { client: parent.client, root: parent.root, children: Promise.resolve() };
  const name = `native_sp_${++parent.root.savepoint}`;
  try {
    if (!parent.root.active || parent.root.aborting) throw new Error("The parent PostgreSQL transaction has ended or is aborting");
    await frame.client.query(`SAVEPOINT ${name}`);
    try {
      const result = await transactionContext.run(frame, () => fn(frame.client));
      await frame.children;
      if (frame.root.retryFailure) throw frame.root.retryFailure;
      await frame.client.query(`RELEASE SAVEPOINT ${name}`);
      return result;
    } catch (error) {
      await frame.children;
      if (retryableTransactionError(error)) frame.root.retryFailure = error;
      try { await frame.client.query(`ROLLBACK TO SAVEPOINT ${name}`); await frame.client.query(`RELEASE SAVEPOINT ${name}`); } catch { /* Preserve the original error. */ }
      throw error;
    }
  } finally { release(); }
}

/** SQL-only callback: a serialization retry re-runs the whole database unit. */
export async function postgresTransaction<T>(
  fn: (client: PoolClient) => T | Promise<T>,
  options: { isolation?: Isolation; maxRetries?: number } = {},
): Promise<T> {
  if (options.isolation && !Object.prototype.hasOwnProperty.call(ranks, options.isolation)) throw new Error("Invalid PostgreSQL transaction isolation");
  const existing = transactionContext.getStore();
  if (existing?.root.active) return nestedTransaction(existing, fn, options.isolation);
  const isolation = options.isolation || "SERIALIZABLE";
  const maxRetries = Number.isFinite(options.maxRetries) ? Math.max(0, Math.trunc(options.maxRetries!)) : 3;
  let attempt = 0;
  for (;;) {
    const client = await postgresPool().connect();
    const root: TransactionRoot = { active: true, aborting: false, isolation, savepoint: 0 };
    const frame: TransactionFrame = { client, root, children: Promise.resolve() };
    let failure: unknown;
    try {
      await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
      const result = await transactionContext.run(frame, () => fn(client));
      await frame.children;
      if (root.retryFailure) throw root.retryFailure;
      const committed = await client.query("COMMIT");
      if (committed.command !== "COMMIT") throw new Error("PostgreSQL transaction was rolled back rather than committed");
      return result;
    } catch (error) {
      failure = error;
      root.aborting = true;
      await frame.children;
      try { await client.query("ROLLBACK"); } catch { /* Never replace the database/domain error. */ }
    } finally {
      root.active = false;
      client.release();
    }
    // Do not retry connection failures or ambiguous commit outcomes.
    if (!retryableTransactionError(failure) || attempt >= maxRetries) throw failure;
    const delay = TX_RETRY_DELAYS_MS[Math.min(attempt, TX_RETRY_DELAYS_MS.length - 1)]!;
    attempt += 1;
    await sleep(delay);
  }
}
export async function postgresQuery<T extends QueryResultRow = QueryResultRow>(text: string, values: readonly unknown[] = []): Promise<T[]> {
  return (await (currentTransactionClient() || postgresPool()).query<T>(text, [...values])).rows;
}
export async function closePostgresPool(): Promise<void> {
  if (currentTransactionClient()) throw new Error("Cannot close the PostgreSQL pool from an active business transaction");
  for (const hook of closingHooks) hook();
  await drainBackgroundWork();
  if (!pool) return;
  const current = pool;
  pool = null;
  poolUrl = null;
  await current.end();
  const connected = physicalClients.get(current);
  if (connected?.size) {
    await new Promise<void>((resolve) => {
      const removed = () => {
        if (connected.size) return;
        current.off("remove", removed);
        resolve();
      };
      current.on("remove", removed);
      removed();
    });
  }
  physicalClients.delete(current);
}
