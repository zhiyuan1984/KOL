import { getConn, nowIso, tx } from "../db.js";
import { nid } from "../ids.js";
import type { Json } from "../types.js";

/** Result memory: Codex-processed task rows for display. Not cover copy. */
export const TODAY_TASKS_ARTIFACT = "today_tasks";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function extractDisplayTasks(raw: unknown): unknown[] {
  const row = asRecord(raw);
  if (!row) return Array.isArray(raw) ? raw : [];
  if (Array.isArray(row.display_tasks)) return row.display_tasks;
  if (Array.isArray(row.today_tasks)) return row.today_tasks;
  if (row.type === TODAY_TASKS_ARTIFACT && Array.isArray(row.items)) return row.items;
  return [];
}

export function normalizeDisplayTask(value: unknown, index: number): Json | null {
  const row = asRecord(value);
  if (!row) return null;
  const title = String(row.title || row.label || "").trim();
  if (!title) return null;
  const workItemId = String(row.work_item_id || row.id || "").trim();
  return {
    work_item_id: workItemId || null,
    title,
    why: String(row.why || row.summary || row.body || "").trim(),
    rank: Number(row.rank || index + 1) || index + 1,
    bucket: row.bucket ? String(row.bucket) : null,
    verb: row.verb ? String(row.verb) : row.action ? String(row.action) : null,
    label: row.label ? String(row.label) : null,
    object_id: row.object_id ? String(row.object_id) : null,
    object_type: String(row.object_type || row.kind || "").trim() || null,
    person_id: row.person_id ? String(row.person_id) : null,
  };
}

export function validateTodayDisplayTasks(value: unknown): { ok: true; tasks: Json[] } | { ok: false; reason: string; tasks: null } {
  const list = extractDisplayTasks(value);
  if (!Array.isArray(list)) return { ok: false, reason: "display_tasks must be an array", tasks: null };
  const tasks = list.map((item, index) => normalizeDisplayTask(item, index)).filter(Boolean) as Json[];
  if (!tasks.length) return { ok: false, reason: "display_tasks empty", tasks: null };
  return { ok: true, tasks };
}

function ensurePointerTable(): void {
  getConn().exec(
    `CREATE TABLE IF NOT EXISTS employee_today_tasks (
       owner_user_id TEXT PRIMARY KEY,
       artifact_id TEXT NOT NULL,
       work_item_id TEXT NOT NULL,
       updated_at TEXT NOT NULL
     )`,
  );
}

export function loadLatestTodayTasks(owner: string): { artifact_id: string | null; tasks: Json[] } {
  ensurePointerTable();
  const pointer = getConn().prepare(
    "SELECT artifact_id FROM employee_today_tasks WHERE owner_user_id=?",
  ).get(owner) as { artifact_id: string } | undefined;
  if (!pointer) return { artifact_id: null, tasks: [] };
  const row = getConn().prepare(
    "SELECT payload FROM task_artifacts WHERE id=? AND artifact_type=?",
  ).get(pointer.artifact_id, TODAY_TASKS_ARTIFACT) as { payload: string } | undefined;
  if (!row) return { artifact_id: pointer.artifact_id, tasks: [] };
  try {
    const parsed = JSON.parse(row.payload);
    const checked = validateTodayDisplayTasks(parsed);
    return { artifact_id: pointer.artifact_id, tasks: checked.ok ? checked.tasks : [] };
  } catch {
    return { artifact_id: pointer.artifact_id, tasks: [] };
  }
}

export function writeTodayTasksArtifact(input: {
  owner: string;
  workItemId: string;
  runId: string | null;
  raw: unknown;
}): { ok: true; artifact_id: string; tasks: Json[] } | { ok: false; reason: string; kept_artifact_id: string | null } {
  const checked = validateTodayDisplayTasks(input.raw);
  const previous = loadLatestTodayTasks(input.owner);
  if (!checked.ok) {
    return { ok: false, reason: checked.reason, kept_artifact_id: previous.artifact_id };
  }
  ensurePointerTable();
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
      TODAY_TASKS_ARTIFACT,
      null,
      1,
      JSON.stringify({ type: TODAY_TASKS_ARTIFACT, display_tasks: checked.tasks }),
      now,
    );
    db.prepare(
      `INSERT INTO employee_today_tasks (owner_user_id, artifact_id, work_item_id, updated_at)
       VALUES (?,?,?,?)
       ON CONFLICT(owner_user_id) DO UPDATE SET
         artifact_id=excluded.artifact_id,
         work_item_id=excluded.work_item_id,
         updated_at=excluded.updated_at`,
    ).run(input.owner, artifactId, input.workItemId, now);
  });
  return { ok: true, artifact_id: artifactId, tasks: checked.tasks };
}
