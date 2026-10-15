import { nid } from "../ids.js";
import { postgresQuery, postgresTransaction } from "../postgres/pool.js";
import type { Json, Row } from "../types.js";
import type { TodayTaskResultRow, TodayTaskResults } from "./memory-kinds.js";
import { briefPointerTable, type PlanScope } from "./today-plan-context.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function parseTodayTaskResults(raw: unknown): TodayTaskResults | null {
  const root = asRecord(raw);
  if (!root) return null;
  const list = Array.isArray(root.items) ? root.items
    : Array.isArray(root.display_tasks) ? root.display_tasks
      : Array.isArray(root.todo_layout) ? root.todo_layout : null;
  if (!list) return null;
  const items: TodayTaskResultRow[] = [];
  for (const [index, entry] of list.entries()) {
    const row = asRecord(entry);
    const workItemId = String(row?.work_item_id || row?.id || "").trim();
    if (!workItemId) continue;
    items.push({
      work_item_id: workItemId,
      rank: Number(row?.rank || index + 1),
      title: row?.title ? String(row.title) : undefined,
      why: row?.why ? String(row.why) : undefined,
      next_action: row?.next_action ? String(row.next_action) : undefined,
      verb: row?.verb || row?.action ? String(row.verb || row.action) : undefined,
      label: row?.label ? String(row.label) : undefined,
      bucket: row?.bucket ? String(row.bucket) : undefined,
      icon: row?.icon ? String(row.icon).trim().slice(0, 8) || undefined : undefined,
      group: row?.group ? String(row.group).trim().slice(0, 24) || undefined : undefined,
      view: row?.view === "today" || row?.view === "todo" ? row.view : undefined,
    });
  }
  return list.length > 0 && !items.length ? null : { items, planned_at: typeof root.planned_at === "string" ? root.planned_at : undefined };
}

export async function writeTodayTaskResults(input: {
  owner: string;
  workItemId: string;
  runId: string | null;
  results: TodayTaskResults | unknown;
  scope?: PlanScope;
}): Promise<{ ok: true; artifact_id: string } | { ok: false; reason: string }> {
  const parsed = parseTodayTaskResults(input.results);
  if (!parsed) return { ok: false, reason: "规划结果缺少有效的任务展示列表" };
  const scope = input.scope ?? "today";
  const table = briefPointerTable(scope);
  const artifactId = nid("art");
  const now = new Date().toISOString();
  return postgresTransaction(async (client) => {
    await client.query(
      `INSERT INTO task_artifacts
       (id,work_item_id,run_id,artifact_type,message_id,version,payload,created_at)
       VALUES ($1,$2,$3,$4,NULL,1,$5,$6)`,
      [artifactId, input.workItemId, input.runId, scope === "todo" ? "todo_tasks" : "today_tasks", JSON.stringify({ items: parsed.items, planned_at: now }), now],
    );
    const pointer = await client.query(
      `UPDATE ${table} SET result_artifact_id=$1,updated_at=$2 WHERE owner_user_id=$3`,
      [artifactId, now, input.owner],
    );
    if (!pointer.rowCount) throw new Error("today brief pointer missing while writing task results");
    return { ok: true as const, artifact_id: artifactId };
  });
}

const DISPLAY_CLOSED = new Set(["completed", "done", "cancelled"]);

/** Recheck source tickets on every read so completed/dismissed facts cannot leak through an old artifact. */
export async function loadTodayTaskResults(owner: string, scope: PlanScope = "today"): Promise<TodayTaskResults | null> {
  const table = briefPointerTable(scope);
  const pointer = (await postgresQuery<Row>(
    `SELECT p.result_artifact_id,a.payload FROM ${table} p
       LEFT JOIN task_artifacts a ON a.id=p.result_artifact_id WHERE p.owner_user_id=$1`,
    [owner],
  ))[0];
  if (!pointer?.payload) return null;
  let parsed: TodayTaskResults | null;
  try { parsed = parseTodayTaskResults(typeof pointer.payload === "string" ? JSON.parse(pointer.payload) : pointer.payload); }
  catch { return null; }
  if (!parsed) return null;
  if (!parsed.items.length) return parsed;
  const ids = parsed.items.map((item) => item.work_item_id);
  const tickets = await postgresQuery<Row>("SELECT id,status,dismissed_at,owner_user_id FROM tickets WHERE id=ANY($1::text[]) AND owner_user_id=$2", [ids, owner]);
  const byId = new Map(tickets.map((row) => [String(row.id), row]));
  const items = parsed.items.filter((item) => {
    const ticket = byId.get(item.work_item_id);
    return ticket && !DISPLAY_CLOSED.has(String(ticket.status || "")) && !ticket.dismissed_at;
  });
  return { ...parsed, items };
}
