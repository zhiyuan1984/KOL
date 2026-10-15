import fs from "node:fs";
import type { Pool, PoolClient } from "pg";
import { boxDir, dataDir } from "./config.js";
import { closePostgresPool, postgresPool, postgresTransaction, requiredPostgresUrl } from "./postgres/pool.js";
import type { Json, Row } from "./types.js";

/** Native PG only. SQL must be parameterized by each repository, never translated here. */
export type DatabaseConnection = Pool | PoolClient;
const resetHooks: Array<() => void | Promise<void>> = [];
export function onConnReset(hook: () => void | Promise<void>): void { resetHooks.push(hook); }
export function databaseEngine(): "postgres" { requiredPostgresUrl(); return "postgres"; }
export function getConn(): Pool { return postgresPool(); }

/** Startup only verifies schema; DDL belongs to the versioned migration command. */
export async function connect(): Promise<Pool> {
  requiredPostgresUrl();
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.mkdirSync(boxDir(), { recursive: true });
  const db = postgresPool();
  const result = await db.query<{ initialized: boolean }>(
    "SELECT to_regclass('public.app_schema_migrations') IS NOT NULL AND to_regclass('public.users') IS NOT NULL AS initialized",
  );
  if (!result.rows[0]?.initialized) throw new Error("PostgreSQL schema is not initialized; run npm run db:apply:postgres-schema before starting the application");
  return db;
}

/** Reset closes the pool without reconnecting to an admin/production URL during test cleanup. */
export async function resetConn(): Promise<void> {
  await closePostgresPool();
  for (const hook of resetHooks) await hook();
}
export const tx = postgresTransaction;
export function isForeignKeyError(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === "23503";
}
export function isConnectionClosedError(error: unknown): boolean {
  return error instanceof Error && /Cannot use a pool after calling end|Client was closed|Connection terminated/.test(error.message);
}
export function asRow(row: unknown): Row { return { ...(row as Row) }; }
export function asRows(rows: unknown[]): Row[] { return rows.map(asRow); }
export function nowIso(): string { return new Date().toISOString(); }

/** Pass the caller's PoolClient to make the audit part of its business transaction. */
export async function audit(actor: string, eventType: string, payload: Json, client?: PoolClient): Promise<void> {
  await (client || postgresPool()).query(
    "INSERT INTO audit_events (ts,actor,event_type,payload) VALUES ($1,$2,$3,$4)",
    [nowIso(), actor === "usr_sriphy" ? "sriphy" : actor, eventType, JSON.stringify(payload)],
  );
}
export const AUDIT_PAYLOAD_PREVIEW_CHARS = 8_192;
export function auditPayloadPreview(raw: string, payloadSize: number): Json {
  const truncated = payloadSize > raw.length;
  if (!truncated) { try { return JSON.parse(raw || "{}") as Json; } catch { /* preview */ } }
  return { preview: raw, truncated: true, payload_size: payloadSize };
}
export async function listAudit(eventType?: string | null, options: { limit?: number } = {}): Promise<Row[]> {
  const limit = Math.min(Math.max(1, Number(options.limit || 200)), 500);
  const result = eventType
    ? await postgresPool().query<Row>(
      `SELECT id,ts,actor,event_type,substr(payload,1,$1) AS payload_preview,length(payload) AS payload_size
       FROM (SELECT * FROM audit_events WHERE event_type=$2 ORDER BY id DESC LIMIT $3) recent ORDER BY id`,
      [AUDIT_PAYLOAD_PREVIEW_CHARS,eventType,limit],
    )
    : await postgresPool().query<Row>(
      `SELECT id,ts,actor,event_type,substr(payload,1,$1) AS payload_preview,length(payload) AS payload_size
       FROM (SELECT * FROM audit_events ORDER BY id DESC LIMIT $2) recent ORDER BY id`,
      [AUDIT_PAYLOAD_PREVIEW_CHARS,limit],
    );
  return result.rows.map((r) => ({ ...r, payload: auditPayloadPreview(String(r.payload_preview || ""), Number(r.payload_size || 0)) }));
}
