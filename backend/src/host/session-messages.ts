import { getConn, isSqliteForeignKeyError, nowIso, tx, type SqliteConn } from "../db.js";
import { nid } from "../ids.js";
import type { Json, Row } from "../types.js";
import { HttpFail } from "./errors.js";
import { publishSession } from "./session-events.js";

export function sessionNotFoundFail(sid: string): HttpFail {
  return new HttpFail(404, {
    code: "session_not_found",
    message: "会话不存在或已删除，无法写入消息。",
    session_id: String(sid || ""),
  });
}

export function isSessionNotFound(error: unknown): boolean {
  if (!(error instanceof HttpFail) || error.status !== 404) return false;
  const detail = error.detail;
  if (detail && typeof detail === "object" && !Array.isArray(detail) && (detail as Json).code === "session_not_found") {
    return true;
  }
  return detail === "session not found" || error.message === "session not found";
}

/** Live session row, or fail-closed. Soft-deleted rows are treated as missing. */
export function assertSessionRowExists(sid: string, db: SqliteConn = getConn()): Row {
  const key = String(sid || "").trim();
  if (!key) throw sessionNotFoundFail(sid);
  const row = db.prepare("SELECT id, deleted_at FROM sessions WHERE id=?").get(key) as
    | { id: string; deleted_at?: string | null }
    | undefined;
  if (!row || row.deleted_at) throw sessionNotFoundFail(key);
  return row as Row;
}

/**
 * Insert a session message. Never throws raw SQLite FOREIGN KEY — missing
 * session becomes HttpFail 404 so Host request/background paths can fail closed
 * without process-crashing. Does not disable foreign_keys.
 */
export function insertSessionMessage(sid: string, role: string, kind: string, payload: Json): Json {
  const mid = nid("msg");
  const now = nowIso();
  try {
    tx((c) => {
      assertSessionRowExists(sid, c);
      c.prepare("INSERT INTO messages (id, session_id, role, kind, payload, created_at) VALUES (?,?,?,?,?,?)").run(
        mid,
        sid,
        role,
        kind,
        JSON.stringify(payload),
        now,
      );
      c.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(now, sid);
    });
  } catch (error) {
    if (error instanceof HttpFail) throw error;
    if (isSqliteForeignKeyError(error)) throw sessionNotFoundFail(sid);
    throw error;
  }
  const row = { id: mid, session_id: sid, role, kind, payload, created_at: now };
  publishSession(sid, { type: "upsert", message: row });
  return row;
}
