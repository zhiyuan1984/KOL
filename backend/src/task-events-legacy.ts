import { isConnectionClosedError, isForeignKeyError, nowIso, tx, type DatabaseConnection } from "./db.js";
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
async function taskEventTarget(db: DatabaseConnection, workItemId: string, runId: string | null): Promise<Awaited<boolean>> {
  const item = (await db.query("SELECT id FROM tickets WHERE id=$1",[workItemId])).rows[0] as { id: string } | undefined;
  if (!item) return false;
  if (!runId) return true;
  const run = (await db.query("SELECT id FROM task_runs WHERE id=$1 AND work_item_id=$2",[runId,workItemId])).rows[0] as
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

async function taskEventCount(db: DatabaseConnection, workItemId: string): Promise<Awaited<number>> {
  const row = (await db.query("SELECT COUNT(*) AS n FROM task_events WHERE work_item_id=$1",[workItemId])).rows[0] as
    | { n: number }
    | undefined;
  return Number(row?.n || 0);
}

/** Append one task event into a caller-owned transaction. */
export async function appendTaskEventInConn(
  db: DatabaseConnection,
  workItemId: string,
  runId: string | null,
  eventType: string,
  label: string,
  status: string,
  safeSummary?: string,
): Promise<Awaited<Row | null>> {
  if (!(await taskEventTarget(db, workItemId, runId))) return null;
  const eventClass = taskEventClass(eventType);
  if (eventClass !== "lifecycle" && (await taskEventCount(db, workItemId)) >= taskEventLimit()) return null;
  const current = (await db.query("SELECT COALESCE(MAX(sequence),0) AS sequence FROM task_events WHERE work_item_id=$1",[workItemId])).rows[0] as { sequence: number };
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
  (await db.query("INSERT INTO task_events\n     (id,work_item_id,run_id,sequence,event_type,event_class,label,status,safe_summary,time,created_at)\n     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",[row.id,row.work_item_id,row.run_id,row.sequence,row.event_type,row.event_class,row.label,row.status,row.safe_summary,row.time,row.created_at]));
  return row;
}

export async function appendTaskEvent(
  workItemId: string,
  runId: string | null,
  eventType: string,
  label: string,
  status: string,
  safeSummary?: string,
): Promise<Awaited<Row | null>> {
  try {
    return (await tx(async (db) => (await appendTaskEventInConn(db, workItemId, runId, eventType, label, status, safeSummary))));
  } catch (error) {
    // Fire-and-forget worker follow-up can land after a test reset or after the
    // parent ticket was removed. Never surface that as an unhandled FK error.
    if (isForeignKeyError(error) || isConnectionClosedError(error)) return null;
    throw error;
  }
}

/**
 * Live process row for harness trace. Lifecycle rows are intentionally never
 * eligible for upsert: corrections must be new lifecycle events, not rewrites.
 */
export async function upsertTaskEvent(
  workItemId: string,
  runId: string | null,
  itemKey: string,
  eventType: string,
  label: string,
  status: string,
  safeSummary?: string,
): Promise<Awaited<Row | null>> {
  const key = String(itemKey || "").trim().slice(0, 120);
  if (!key) return null;
  if (taskEventClass(eventType) !== "run_trace") {
    throw new Error(`task event ${eventType} is not a mutable run trace`);
  }
  try {
    return (await tx(async (db) => {
      if (!(await taskEventTarget(db, workItemId, runId))) return null;
      const summary = safeSummary?.slice(0, 1000) || null;
      const existing = (await db.query("SELECT id, sequence, time, created_at, event_class FROM task_events WHERE work_item_id=$1 AND item_key=$2",[workItemId,key])).rows[0] as { id: string; sequence: number; time: string; created_at: string; event_class?: string } | undefined;
      if (existing) {
        if (String(existing.event_class || "run_trace") !== "run_trace") {
          throw new Error("lifecycle task event cannot be updated through trace upsert");
        }
        (await db.query("UPDATE task_events SET event_type=$1, label=$2, status=$3, safe_summary=$4, run_id=COALESCE(run_id,$5) WHERE id=$6",[eventType,label.slice(0, 160),status,summary,runId,existing.id]));
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
      const current = (await db.query("SELECT COALESCE(MAX(sequence),0) AS sequence FROM task_events WHERE work_item_id=$1",[workItemId])).rows[0] as { sequence: number };
      if ((await taskEventCount(db, workItemId)) >= taskEventLimit()) return null;
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
      (await db.query("INSERT INTO task_events\n         (id,work_item_id,run_id,sequence,event_type,event_class,label,status,safe_summary,item_key,time,created_at)\n         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",[row.id,row.work_item_id,row.run_id,row.sequence,row.event_type,row.event_class,row.label,row.status,row.safe_summary,row.item_key,row.time,row.created_at]));
      return row;
    }));
  } catch (error) {
    if (isForeignKeyError(error) || isConnectionClosedError(error)) return null;
    throw error;
  }
}
