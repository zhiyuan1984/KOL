import { AsyncLocalStorage } from "node:async_hooks";
import type { PoolClient, QueryResultRow } from "pg";
import { closePostgresPool, postgresPool, postgresTransaction, requiredPostgresUrl } from "./pool.js";
import type { Json, Row } from "../types.js";

const transactionContext = new AsyncLocalStorage<PoolClient>();
const resetHooks: Array<() => void> = [];

/** Native asynchronous PostgreSQL query operations. SQL is never translated. */
export interface PgRepository {
  many<T extends QueryResultRow = Row>(sql: string, ...values: unknown[]): Promise<T[]>;
  one<T extends QueryResultRow = Row>(sql: string, ...values: unknown[]): Promise<T | undefined>;
  execute(sql: string, ...values: unknown[]): Promise<{ changes: number }>;
  command(sql: string): Promise<void>;
  close(): Promise<void>;
}

function normalizeRows<T extends QueryResultRow>(rows: T[], fields: Array<{ name: string; dataTypeID: number }>): T[] {
  // Historical integer flags/counts are int8 in the authoritative baseline.
  // Do not coerce identifiers or values outside JavaScript's safe integer range.
  const integers = fields.filter((field) => field.dataTypeID === 20);
  return rows.map((source) => {
    const row = { ...source } as Record<string, unknown>;
    for (const field of integers) {
      const value = row[field.name];
      if (typeof value === "string" && /^-?\d+$/.test(value)) {
        const numeric = Number(value);
        if (Number.isSafeInteger(numeric)) row[field.name] = numeric;
      }
    }
    return row as T;
  });
}

export function postgresDb(client?: PoolClient): PgRepository {
  requiredPostgresUrl();
  const query = async (sql: string, values: unknown[]) => {
    const connection = client || transactionContext.getStore() || postgresPool();
    return connection.query(sql, values);
  };
  return {
    async many<T extends QueryResultRow = Row>(sql: string, ...values: unknown[]): Promise<T[]> {
      const result = await query(sql, values);
      return normalizeRows(result.rows, result.fields) as T[];
    },
    async one<T extends QueryResultRow = Row>(sql: string, ...values: unknown[]): Promise<T | undefined> {
      const result = await query(sql, values);
      return normalizeRows(result.rows, result.fields)[0] as T | undefined;
    },
    async execute(sql: string, ...values: unknown[]): Promise<{ changes: number }> {
      const result = await query(sql, values);
      return { changes: result.rowCount || 0 };
    },
    async command(sql: string): Promise<void> {
      await query(sql, []);
    },
    close: closePostgresPool,
  };
}

export async function pgTransaction<T>(fn: (db: PgRepository) => T | Promise<T>): Promise<T> {
  const parent = transactionContext.getStore();
  if (parent) {
    // A nested unit of work has its own rollback boundary, on the same client.
    const name = `nested_${++savepointCounter}`;
    await parent.query(`SAVEPOINT ${name}`);
    try {
      const result = await fn(postgresDb(parent));
      await parent.query(`RELEASE SAVEPOINT ${name}`);
      return result;
    } catch (error) {
      await parent.query(`ROLLBACK TO SAVEPOINT ${name}`);
      await parent.query(`RELEASE SAVEPOINT ${name}`);
      throw error;
    }
  }
  return postgresTransaction((client) => transactionContext.run(client, () => Promise.resolve(fn(postgresDb(client)))), { maxRetries: 0 });
}
let savepointCounter = 0;

/** Serializable database-only units; never use retry for an external side effect. */
export async function pgSerialTransaction<T>(fn: (db: PgRepository) => T | Promise<T>): Promise<T> {
  if (transactionContext.getStore()) return pgTransaction(fn);
  return postgresTransaction((client) => transactionContext.run(client, () => Promise.resolve(fn(postgresDb(client)))), { isolation: "SERIALIZABLE" });
}

export function onDatabaseReset(hook: () => void): void { resetHooks.push(hook); }
export async function resetDatabase(): Promise<PgRepository> {
  await closePostgresPool();
  for (const hook of resetHooks) hook();
  return postgresDb();
}
export function databaseEngine(): "postgres" { requiredPostgresUrl(); return "postgres"; }
export function nowIso(): string { return new Date().toISOString(); }
export function asRow(row: unknown): Row { return (row || {}) as Row; }
export function asRows(rows: unknown[]): Row[] { return rows as Row[]; }
export function isDatabaseForeignKeyError(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === "23503";
}
export function isDatabaseClosedError(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  return ["57P01", "57P02", "57P03", "08003", "08006"].includes(code);
}
export async function audit(actor: string, eventType: string, payload: Json): Promise<void> {
  await postgresDb().execute("INSERT INTO audit_events (ts,actor,event_type,payload) VALUES ($1,$2,$3,$4)", nowIso(), actor === "usr_sriphy" ? "sriphy" : actor, eventType, JSON.stringify(payload));
}
export const AUDIT_PAYLOAD_PREVIEW_CHARS = 8_192;
export function auditPayloadPreview(raw: string, payloadSize: number): Json {
  if (payloadSize <= raw.length) {
    try { return JSON.parse(raw || "{}") as Json; } catch { /* preserve preview */ }
  }
  return { preview: raw, truncated: true, payload_size: payloadSize };
}
export async function listAudit(eventType?: string | null, options: { limit?: number } = {}): Promise<Row[]> {
  const limit = Math.min(Math.max(1, Number(options.limit || 200)), 500);
  const rows = eventType
    ? await postgresDb().many("SELECT id,ts,actor,event_type,substr(payload,1,$1::int) AS payload_preview,length(payload) AS payload_size FROM (SELECT * FROM audit_events WHERE event_type=$2 ORDER BY id DESC LIMIT $3) recent ORDER BY id", AUDIT_PAYLOAD_PREVIEW_CHARS, eventType, limit)
    : await postgresDb().many("SELECT id,ts,actor,event_type,substr(payload,1,$1::int) AS payload_preview,length(payload) AS payload_size FROM (SELECT * FROM audit_events ORDER BY id DESC LIMIT $2) recent ORDER BY id", AUDIT_PAYLOAD_PREVIEW_CHARS, limit);
  return rows.map((row) => ({ ...row, payload: auditPayloadPreview(String(row.payload_preview || ""), Number(row.payload_size || 0)) }));
}
