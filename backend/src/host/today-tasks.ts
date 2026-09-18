import { getConn, nowIso, tx } from "../db.js";
import { nid } from "../ids.js";
import { TASK_RESULT_MEMORY, type TodayTaskResultRow, type TodayTaskResults } from "./memory-kinds.js";
import { listMemories } from "./employee-memory.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function ensureResultArtifactColumn(): void {
  try {
    getConn().exec("ALTER TABLE employee_today_briefs ADD COLUMN result_artifact_id TEXT");
  } catch {
    /* column may already exist */
  }
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
      icon: row?.icon ? String(row.icon).trim().slice(0, 8) || undefined : undefined,
      group: row?.group ? String(row.group).trim().slice(0, 24) || undefined : undefined,
    });
  }
  if (!items.length) return null;
  return { items, planned_at: typeof root.planned_at === "string" ? root.planned_at : undefined };
}

function itemsFromDisplayMemory(owner: string): TodayTaskResults | null {
  const rows = listMemories({ owner, memory_kind: "task_display", limit: 200 });
  const items: TodayTaskResultRow[] = [];
  for (const [index, row] of rows.entries()) {
    const payload = asRecord(row.payload) || {};
    const workItemId = String(payload.work_item_id || payload.id || row.item_key || "").trim();
    if (!workItemId) continue;
    items.push({
      work_item_id: workItemId,
      rank: Number(payload.rank || index + 1),
      title: payload.title ? String(payload.title) : undefined,
      why: payload.why ? String(payload.why) : undefined,
      next_action: payload.next_action ? String(payload.next_action) : undefined,
      verb: payload.verb || payload.action ? String(payload.verb || payload.action) : undefined,
      label: payload.label ? String(payload.label) : undefined,
      bucket: payload.bucket ? String(payload.bucket) : undefined,
    });
  }
  if (!items.length) return null;
  items.sort((a, b) => a.rank - b.rank);
  return { items };
}

export function writeTodayTaskResults(input: {
  owner: string;
  workItemId: string;
  runId: string | null;
  results: TodayTaskResults | unknown;
}): { ok: true; artifact_id: string } | { ok: false; reason: string } {
  const parsed = parseTodayTaskResults(input.results);
  if (!parsed) return { ok: false, reason: "Codex did not produce display task rows" };
  const now = nowIso();
  const artifactId = nid("art");
  ensureResultArtifactColumn();
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
    db.prepare(
      `UPDATE employee_today_briefs
          SET result_artifact_id=?, updated_at=?
        WHERE owner_user_id=?`,
    ).run(artifactId, now, input.owner);
  });
  return { ok: true, artifact_id: artifactId };
}

const DISPLAY_CLOSED = new Set(["completed", "done", "cancelled"]);

/** TECH-BE-06: source rows closed/dismissed/deleted must drop out of display memory at read time. */
function dropClosedItems(results: TodayTaskResults | null): TodayTaskResults | null {
  if (!results?.items.length) return results;
  const ids = results.items.map((item) => item.work_item_id);
  const placeholders = ids.map(() => "?").join(",");
  const rows = getConn().prepare(
    `SELECT id, status, dismissed_at FROM work_items WHERE id IN (${placeholders})`,
  ).all(...ids) as Array<{ id: string; status?: unknown; dismissed_at?: unknown }>;
  const hostById = new Map(rows.map((row) => [String(row.id), row]));
  const items = results.items.filter((item) => {
    const host = hostById.get(item.work_item_id);
    if (!host) return false;
    return !DISPLAY_CLOSED.has(String(host.status || "")) && !host.dismissed_at;
  });
  if (!items.length) return null;
  return { ...results, items };
}

export function loadTodayTaskResults(owner: string): TodayTaskResults | null {
  ensureResultArtifactColumn();
  let pointer: { result_artifact_id?: string } | undefined;
  try {
    pointer = getConn().prepare(
      "SELECT result_artifact_id FROM employee_today_briefs WHERE owner_user_id=?",
    ).get(owner) as { result_artifact_id?: string } | undefined;
  } catch {
    return dropClosedItems(itemsFromDisplayMemory(owner));
  }
  if (pointer?.result_artifact_id) {
    const row = getConn().prepare("SELECT payload FROM task_artifacts WHERE id=?").get(pointer.result_artifact_id) as
      | { payload: string }
      | undefined;
    if (row) {
      try {
        const parsed = parseTodayTaskResults(JSON.parse(row.payload));
        if (parsed?.items.length) return dropClosedItems(parsed);
      } catch {
        /* fall through to display memory */
      }
    }
  }
  return dropClosedItems(itemsFromDisplayMemory(owner));
}
