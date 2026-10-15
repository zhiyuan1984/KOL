import type { PoolClient } from "pg";
import { nid } from "./ids.js";
import { postgresTransaction } from "./postgres/pool.js";
import type { Row } from "./types.js";

/** Immutable lifecycle facts and mutable run-trace rows are stored directly in
 * PostgreSQL. Every writer locks the parent ticket, so per-ticket sequence
 * allocation is serial and cannot race under concurrent workers. */
export type TaskEventClass = "lifecycle" | "run_trace" | "legacy";

export function taskEventClass(eventType: string): TaskEventClass {
  if (eventType === "task.completed" || eventType === "task.failed") return "legacy";
  if (eventType.startsWith("task.")) return "lifecycle";
  return "run_trace";
}

function taskEventLimit(): number {
  const n = Number(process.env.TASK_EVENT_MAX_PER_WORK_ITEM || "5000");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5000;
}

function isForeignKey(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "23503");
}

async function lockTarget(client: PoolClient, workItemId: string, runId: string | null): Promise<boolean> {
  const ticket = await client.query<{ id: string }>("SELECT id FROM tickets WHERE id=$1 FOR UPDATE", [workItemId]);
  if (!ticket.rows[0]) return false;
  if (!runId) return true;
  const run = await client.query<{ id: string }>("SELECT id FROM task_runs WHERE id=$1 AND work_item_id=$2", [runId, workItemId]);
  return Boolean(run.rows[0]);
}

async function nextSequence(client: PoolClient, workItemId: string): Promise<number> {
  const current = await client.query<{ sequence: number | string }>(
    "SELECT COALESCE(MAX(sequence),0) AS sequence FROM task_events WHERE work_item_id=$1",
    [workItemId],
  );
  return Number(current.rows[0]?.sequence || 0) + 1;
}

async function traceCount(client: PoolClient, workItemId: string): Promise<number> {
  const count = await client.query<{ n: number | string }>("SELECT COUNT(*) AS n FROM task_events WHERE work_item_id=$1", [workItemId]);
  return Number(count.rows[0]?.n || 0);
}

/** Append a task event into the caller-owned native transaction. */
export async function appendTaskEventIn(
  client: PoolClient,
  workItemId: string,
  runId: string | null,
  eventType: string,
  label: string,
  status: string,
  safeSummary?: string,
): Promise<Row | null> {
  if (!(await lockTarget(client, workItemId, runId))) return null;
  const eventClass = taskEventClass(eventType);
  if (eventClass !== "lifecycle" && await traceCount(client, workItemId) >= taskEventLimit()) return null;
  const now = new Date().toISOString();
  const row: Row = {
    id: nid("tev"), work_item_id: workItemId, run_id: runId,
    sequence: await nextSequence(client, workItemId), event_type: eventType, event_class: eventClass,
    label: label.slice(0, 160), status, safe_summary: safeSummary?.slice(0, 1000) || null, time: now, created_at: now,
  };
  await client.query(
    `INSERT INTO task_events
     (id,work_item_id,run_id,sequence,event_type,event_class,label,status,safe_summary,time,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
    [row.id, row.work_item_id, row.run_id, row.sequence, row.event_type, row.event_class, row.label, row.status, row.safe_summary, now],
  );
  return row;
}

/** Independent append with the same tenant-safe target/run guard. */
export async function appendTaskEvent(
  workItemId: string,
  runId: string | null,
  eventType: string,
  label: string,
  status: string,
  safeSummary?: string,
): Promise<Row | null> {
  try {
    return postgresTransaction(async (client) => (await appendTaskEventIn(client, workItemId, runId, eventType, label, status, safeSummary)));
  } catch (error) {
    // Follow-up traces may arrive after a task is deliberately removed. This is
    // an expected no-op, never an unhandled PostgreSQL FK exception.
    if (isForeignKey(error)) return null;
    throw error;
  }
}

/** Upsert only live run-trace evidence. Lifecycle rows are immutable and never
 * pass through this code path. The parent ticket row lock serializes the
 * check/update/insert sequence and keeps item_key idempotent across workers. */
export async function upsertTaskEvent(
  workItemId: string,
  runId: string | null,
  itemKey: string,
  eventType: string,
  label: string,
  status: string,
  safeSummary?: string,
): Promise<Row | null> {
  const key = String(itemKey || "").trim().slice(0, 120);
  if (!key) return null;
  if (taskEventClass(eventType) !== "run_trace") throw new Error(`task event ${eventType} is not a mutable run trace`);
  try {
    return postgresTransaction(async (client) => {
      if (!(await lockTarget(client, workItemId, runId))) return null;
      const summary = safeSummary?.slice(0, 1000) || null;
      const found = await client.query<Row>(
        "SELECT id,sequence,time,created_at,event_class FROM task_events WHERE work_item_id=$1 AND item_key=$2 FOR UPDATE",
        [workItemId, key],
      );
      const existing = found.rows[0];
      if (existing) {
        if (String(existing.event_class || "run_trace") !== "run_trace") throw new Error("lifecycle task event cannot be updated through trace upsert");
        await client.query(
          "UPDATE task_events SET event_type=$1,label=$2,status=$3,safe_summary=$4,run_id=COALESCE(run_id,$5) WHERE id=$6",
          [eventType, label.slice(0, 160), status, summary, runId, existing.id],
        );
        return { ...existing, work_item_id: workItemId, run_id: runId || existing.run_id || null, event_type: eventType, event_class: "run_trace", label: label.slice(0, 160), status, safe_summary: summary, item_key: key } as Row;
      }
      if (await traceCount(client, workItemId) >= taskEventLimit()) return null;
      const now = new Date().toISOString();
      const row: Row = { id: nid("tev"), work_item_id: workItemId, run_id: runId, sequence: await nextSequence(client, workItemId), event_type: eventType, event_class: "run_trace", label: label.slice(0, 160), status, safe_summary: summary, item_key: key, time: now, created_at: now };
      await client.query(
        `INSERT INTO task_events
         (id,work_item_id,run_id,sequence,event_type,event_class,label,status,safe_summary,item_key,time,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)`,
        [row.id, row.work_item_id, row.run_id, row.sequence, row.event_type, row.event_class, row.label, row.status, row.safe_summary, row.item_key, now],
      );
      return row;
    });
  } catch (error) {
    if (isForeignKey(error)) return null;
    throw error;
  }
}
