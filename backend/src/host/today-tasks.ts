import { getConn, nowIso, tx } from "../db.js";
import { nid } from "../ids.js";
import { TASK_RESULT_MEMORY, type TodayTaskResultRow, type TodayTaskResults } from "./memory-kinds.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function parseTodayTaskResults(raw: unknown): TodayTaskResults | null {
  const root = asRecord(raw);
  if (!root) return null;
  const list = Array.isArray(root.items)
    ? root.items
    : Array.isArray(root.display_tasks)
      ? root.display_tasks
      : Array.isArray(root.todo_layout)
        ? root.todo_layout
        : null;
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
    });
  }
  if (!items.length) return null;
  return { items, planned_at: typeof root.planned_at === "string" ? root.planned_at : undefined };
}

export function writeTodayTaskResults(input: {
  owner: string;
  workItemId: string;
  runId: string | null;
  results: TodayTaskResults;
}): { ok: true; artifact_id: string } | { ok: false; reason: string } {
  const parsed = parseTodayTaskResults(input.results);
  if (!parsed) return { ok: false, reason: "Codex did not produce display task rows" };
  const now = nowIso();
  const artifactId = nid("art");
  tx((db) => {
    db.prepare(
      `INSERT INTO task_artifacts
       (id,work_item_id,run_id,artifact_type,message_id,version,payload,created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).run(
      artifactId,
      input.workItemId,
      input.runId,
      "today_tasks",
      null,
      1,
      JSON.stringify({ memory_kind: TASK_RESULT_MEMORY, items: parsed.items, planned_at: now }),
      now,
    );
    try {
      db.exec("ALTER TABLE employee_today_briefs ADD COLUMN result_artifact_id TEXT");
    } catch {
      /* column may already exist */
    }
    db.prepare(
      `UPDATE employee_today_briefs
          SET result_artifact_id=?, updated_at=?
        WHERE owner_user_id=?`,
    ).run(artifactId, now, input.owner);
  });
  return { ok: true, artifact_id: artifactId };
}

export function loadTodayTaskResults(owner: string): TodayTaskResults | null {
  const pointer = getConn().prepare(
    "SELECT result_artifact_id FROM employee_today_briefs WHERE owner_user_id=?",
  ).get(owner) as { result_artifact_id?: string } | undefined;
  if (!pointer?.result_artifact_id) return null;
  const row = getConn().prepare("SELECT payload FROM task_artifacts WHERE id=?").get(pointer.result_artifact_id) as
    | { payload: string }
    | undefined;
  if (!row) return null;
  try {
    return parseTodayTaskResults(JSON.parse(row.payload));
  } catch {
    return null;
  }
}
