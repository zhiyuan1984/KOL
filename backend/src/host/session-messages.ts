import type { PoolClient } from "pg";
import { nowIso } from "../db.js";
import { postgresPool, postgresTransaction } from "../postgres/pool.js";
import { nid } from "../ids.js";
import type { Json, Row } from "../types.js";
import { HttpFail } from "./errors.js";
import { publishSession } from "./session-events.js";
import { isPostgresForeignKeyError } from "./postgres-errors.js";

export function sessionNotFoundFail(sid: string): HttpFail {
  return new HttpFail(404, { code: "session_not_found", message: "会话不存在或已删除，无法写入消息。", session_id: String(sid || "") });
}
export function isSessionNotFound(error: unknown): boolean {
  if (!(error instanceof HttpFail) || error.status !== 404) return false;
  const detail = error.detail;
  if (detail && typeof detail === "object" && !Array.isArray(detail) && (detail as Json).code === "session_not_found") return true;
  return detail === "session not found" || error.message === "session not found";
}
/** Lock the live parent in a caller-owned transaction, making delete/write serial. */
export async function assertSessionRowExists(sid: string, db: Pick<PoolClient, "query"> = postgresPool()): Promise<Row> {
  const key = String(sid || "").trim();
  if (!key) throw sessionNotFoundFail(sid);
  const row = (await db.query("SELECT id, deleted_at FROM sessions WHERE id=$1 FOR UPDATE", [key])).rows[0];
  if (!row || row.deleted_at) throw sessionNotFoundFail(key);
  return row as Row;
}
/** Message and session timestamp commit together; no event is emitted before commit. */
export async function insertSessionMessage(sid: string, role: string, kind: string, payload: Json): Promise<Json> {
  const mid = nid("msg"), now = nowIso();
  try {
    await postgresTransaction(async (client) => {
      await assertSessionRowExists(sid, client);
      await client.query("INSERT INTO messages (id,session_id,role,kind,payload,created_at) VALUES ($1,$2,$3,$4,$5,$6)", [mid,sid,role,kind,JSON.stringify(payload),now]);
      await client.query("UPDATE sessions SET updated_at=$1 WHERE id=$2", [now,sid]);
    });
  } catch (error) {
    if (isPostgresForeignKeyError(error)) throw sessionNotFoundFail(sid);
    throw error;
  }
  const row = { id: mid, session_id: sid, role, kind, payload, created_at: now };
  publishSession(sid, { type: "upsert", message: row });
  return row;
}
