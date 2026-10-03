import { isSqliteClosedError, isSqliteForeignKeyError, nowIso, tx, type SqliteConn } from "./db.js";
import { nid } from "./ids.js";
import type { Row } from "./types.js";

/**
 * `task_events` has two deliberately different durability contracts:
 * lifecycle facts are append-only evidence, while harness/run trace rows may
 * be updated in place by their stable `item_key`.
 */
export type TaskEventClass = "lifecycle" | "run_trace" | "legacy";

export function taskEventClass(eventType: string): TaskEventClass {
  // The retired legacy endpoint wrote these codes without an acceptance
  // command. Keep historical rows readable, but never treat them as modern
  // lifecycle evidence.
  if (eventType === "task.completed" || eventType === "task.failed") return "legacy";
  if (eventType.startsWith("task.")) return "lifecycle";
  return "run_trace";
}

/** Shared guard: the ticket (and run, when given) must still exist. */
function taskEventTarget(db: SqliteConn, workItemId: string, runId: string | null): boolean {
  const item = db.prepare("SELECT id FROM tickets WHERE id=?").get(workItemId) as { id: string } | undefined;
  if (!item) return false;
  if (!runId) return true;
  const run = db.prepare("SELECT id FROM task_runs WHERE id=? AND work_item_id=?").get(runId, workItemId) as
    | { id: string }
    | undefined;
  return Boolean(run);
}

/**
 * Hard ceiling on one ticket's trace history. Lifecycle facts deliberately do
 * not consume this drop-on-overflow path: a formal command must never lose its
 * immutable evidence because a noisy trace has already reached the cap.
 */
function taskEventLimit(): number {
  const n = Number(process.env.TASK_EVENT_MAX_PER_WORK_ITEM || "5000");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5000;
}

function taskEventCount(db: SqliteConn, workItemId: string): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM task_events WHERE work_item_id=?").get(workItemId) as
    | { n: number }
    | undefined;
  return Number(row?.n || 0);
}

/** Append one task event into a caller-owned transaction. */
export function appendTaskEventInConn(
  db: SqliteConn,
  workItemId: string,
  runId: string | null,
  eventType: string,
  label: string,
  status: string,
  safeSummary?: string,
): Row | null {
  if (!taskEventTarget(db, workItemId, runId)) return null;
  const eventClass = taskEventClass(eventType);
  if (eventClass !== "lifecycle" && taskEventCount(db, workItemId) >= taskEventLimit()) return null;
  const current = db.prepare(
    "SELECT COALESCE(MAX(sequence),0) AS sequence FROM task_events WHERE work_item_id=?",
  ).get(workItemId) as { sequence: number };
  const time = nowIso();
  const row = {
    id: nid("tev"),
    work_item_id: workItemId,
    run_id: runId,
    sequence: Number(current.sequence) + 1,
    event_type: eventType,
    event_class: eventClass,
    label: label.slice(0, 160),
    status,
    safe_summary: safeSummary?.slice(0, 1000) || null,
    time,
    created_at: time,
  };
  db.prepare(
    `INSERT INTO task_events
     (id,work_item_id,run_id,sequence,event_type,event_class,label,status,safe_summary,time,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    row.id, row.work_item_id, row.run_id, row.sequence, row.event_type, row.event_class,
    row.label, row.status, row.safe_summary, row.time, row.created_at,
  );
  return row;
}

export function appendTaskEvent(
  workItemId: string,
  runId: string | null,
  eventType: string,
  label: string,
  status: string,
  safeSummary?: string,
): Row | null {
  try {
    return tx((db) => appendTaskEventInConn(db, workItemId, runId, eventType, label, status, safeSummary));
  } catch (error) {
    // Fire-and-forget worker follow-up can land after a test reset or after the
    // parent ticket was removed. Never surface that as an unhandled FK error.
    if (isSqliteForeignKeyError(error) || isSqliteClosedError(error)) return null;
    throw error;
  }
}

/**
 * Live process row for harness trace. Lifecycle rows are intentionally never
 * eligible for upsert: corrections must be new lifecycle events, not rewrites.
 */
export function upsertTaskEvent(
  workItemId: string,
  runId: string | null,
  itemKey: string,
  eventType: string,
  label: string,
  status: string,
  safeSummary?: string,
): Row | null {
  const key = String(itemKey || "").trim().slice(0, 120);
  if (!key) return null;
  if (taskEventClass(eventType) !== "run_trace") {
    throw new Error(`task event ${eventType} is not a mutable run trace`);
  }
  try {
    return tx((db) => {
      if (!taskEventTarget(db, workItemId, runId)) return null;
      const summary = safeSummary?.slice(0, 1000) || null;
      const existing = db.prepare(
        "SELECT id, sequence, time, created_at, event_class FROM task_events WHERE work_item_id=? AND item_key=?",
      ).get(workItemId, key) as { id: string; sequence: number; time: string; created_at: string; event_class?: string } | undefined;
      if (existing) {
        if (String(existing.event_class || "run_trace") !== "run_trace") {
          throw new Error("lifecycle task event cannot be updated through trace upsert");
        }
        db.prepare(
          "UPDATE task_events SET event_type=?, label=?, status=?, safe_summary=?, run_id=COALESCE(run_id,?) WHERE id=?",
        ).run(eventType, label.slice(0, 160), status, summary, runId, existing.id);
        return {
          id: existing.id,
          work_item_id: workItemId,
          run_id: runId,
          sequence: existing.sequence,
          event_type: eventType,
          event_class: "run_trace",
          label: label.slice(0, 160),
          status,
          safe_summary: summary,
          item_key: key,
          time: existing.time,
          created_at: existing.created_at,
        };
      }
      const current = db.prepare(
        "SELECT COALESCE(MAX(sequence),0) AS sequence FROM task_events WHERE work_item_id=?",
      ).get(workItemId) as { sequence: number };
      if (taskEventCount(db, workItemId) >= taskEventLimit()) return null;
      const time = nowIso();
      const row = {
        id: nid("tev"),
        work_item_id: workItemId,
        run_id: runId,
        sequence: Number(current.sequence) + 1,
        event_type: eventType,
        event_class: "run_trace" as const,
        label: label.slice(0, 160),
        status,
        safe_summary: summary,
        item_key: key,
        time,
        created_at: time,
      };
      db.prepare(
        `INSERT INTO task_events
         (id,work_item_id,run_id,sequence,event_type,event_class,label,status,safe_summary,item_key,time,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        row.id, row.work_item_id, row.run_id, row.sequence, row.event_type, row.event_class,
        row.label, row.status, row.safe_summary, row.item_key, row.time, row.created_at,
      );
      return row;
    });
  } catch (error) {
    if (isSqliteForeignKeyError(error) || isSqliteClosedError(error)) return null;
    throw error;
  }
}
