import { getConn, nowIso, tx } from "../db.js";
import { nid } from "../ids.js";
import type { Json } from "../types.js";
import { loadLatestTodayBrief } from "./today-plan-context.js";

export const BANNED_PRIMARY_COPY = /处理|待补阶段/;
export const BATCH_FORBIDDEN_VERBS = new Set(["follow"]);
export const BATCH_ALLOWED_VERBS = new Set(["retry_crawl", "open_batch", "analyze"]);

export type TodayBriefValidation =
  | { ok: true; brief: Json }
  | { ok: false; reason: string; brief: null };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function objectTypeOf(value: unknown): string {
  const row = asRecord(value);
  return String(row?.object_type || row?.kind || "").toLowerCase();
}

function personIdOf(value: unknown): string {
  const row = asRecord(value);
  return String(row?.person_id || row?.collaboration_id || "").trim();
}

function isBatchObject(value: unknown): boolean {
  const type = objectTypeOf(value);
  if (type === "batch" || type === "discovery_batch" || type === "discovery") return true;
  return type !== "person" && !personIdOf(value) && /batch|discovery/.test(JSON.stringify(value || {}));
}

function collectActions(brief: Record<string, unknown>): Record<string, unknown>[] {
  const actions: Record<string, unknown>[] = [];
  if (asRecord(brief.primary)) actions.push(brief.primary as Record<string, unknown>);
  for (const key of ["suggestions", "recommended_actions", "actions"]) {
    const list = brief[key];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (typeof item === "string") actions.push({ verb: item, label: item });
      else if (asRecord(item)) actions.push(item as Record<string, unknown>);
    }
  }
  if (Array.isArray(brief.sections)) {
    for (const section of brief.sections) {
      const row = asRecord(section);
      if (!row) continue;
      const nested = row.actions || row.items;
      if (!Array.isArray(nested)) continue;
      for (const item of nested) {
        if (asRecord(item) && (item as Record<string, unknown>).verb) {
          actions.push(item as Record<string, unknown>);
        }
      }
    }
  }
  return actions;
}

export function validateTodayBrief(value: unknown): TodayBriefValidation {
  const brief = asRecord(value);
  if (!brief) return { ok: false, reason: "today_brief must be an object", brief: null };
  if (!Array.isArray(brief.sections)) {
    return { ok: false, reason: "missing sections", brief: null };
  }
  for (const field of ["lead", "stats", "primary", "todo_layout", "analysis_hints", "source_cursor", "increment_summary"]) {
    if (!(field in brief)) return { ok: false, reason: `missing ${field}`, brief: null };
  }
  const primary = asRecord(brief.primary) || {};
  const primaryVerb = String(primary.verb || primary.action || "").trim().toLowerCase();
  const primaryLabel = String(primary.label || primary.title || brief.lead || "");
  if (BANNED_PRIMARY_COPY.test(primaryLabel) || BANNED_PRIMARY_COPY.test(primaryVerb)) {
    return { ok: false, reason: "banned primary copy", brief: null };
  }
  if (isBatchObject(primary) && BATCH_FORBIDDEN_VERBS.has(primaryVerb)) {
    return { ok: false, reason: "follow is forbidden on discovery batch", brief: null };
  }
  for (const action of collectActions(brief)) {
    const verb = String(action.verb || action.action || "").trim().toLowerCase();
    if (!verb) continue;
    if (isBatchObject(action) && BATCH_FORBIDDEN_VERBS.has(verb)) {
      return { ok: false, reason: "follow is forbidden on discovery batch", brief: null };
    }
    if (isBatchObject(action) && verb && !BATCH_ALLOWED_VERBS.has(verb) && BATCH_FORBIDDEN_VERBS.has(verb)) {
      return { ok: false, reason: `batch verb not allowed: ${verb}`, brief: null };
    }
  }
  return { ok: true, brief };
}

export function upsertTodayBriefPointer(owner: string, artifactId: string, workItemId: string): void {
  const now = nowIso();
  tx((db) => {
    db.prepare(
      `INSERT INTO employee_today_briefs (owner_user_id, artifact_id, work_item_id, updated_at)
       VALUES (?,?,?,?)
       ON CONFLICT(owner_user_id) DO UPDATE SET
         artifact_id=excluded.artifact_id,
         work_item_id=excluded.work_item_id,
         updated_at=excluded.updated_at`,
    ).run(owner, artifactId, workItemId, now);
  });
}

export function writeTodayBriefArtifact(input: {
  owner: string;
  workItemId: string;
  runId: string | null;
  brief: unknown;
}): { ok: true; artifact_id: string; brief: Json } | { ok: false; reason: string; kept_artifact_id: string | null } {
  const checked = validateTodayBrief(input.brief);
  if (!checked.ok) {
    const previous = loadLatestTodayBrief(input.owner);
    return { ok: false, reason: checked.reason, kept_artifact_id: previous.artifact_id };
  }
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
      "today_brief",
      null,
      1,
      JSON.stringify(checked.brief),
      now,
    );
  });
  upsertTodayBriefPointer(input.owner, artifactId, input.workItemId);
  return { ok: true, artifact_id: artifactId, brief: checked.brief };
}

export function markTodayPlanFailed(workItemId: string, runId: string | null, reason: string): void {
  const now = nowIso();
  tx((db) => {
    db.prepare(
      "UPDATE work_items SET status='failed', updated_at=?, data_version=data_version+1 WHERE id=?",
    ).run(now, workItemId);
    if (runId) {
      db.prepare(
        "UPDATE task_runs SET status='failed', error=?, completed_at=? WHERE id=?",
      ).run(JSON.stringify({ message: reason }), now, runId);
    }
  });
}

export function markTodayPlanCompleted(workItemId: string, runId: string | null): void {
  const now = nowIso();
  tx((db) => {
    db.prepare(
      "UPDATE work_items SET status='completed', completed_at=?, updated_at=?, data_version=data_version+1 WHERE id=?",
    ).run(now, now, workItemId);
    if (runId) {
      db.prepare(
        "UPDATE task_runs SET status='completed', completed_at=? WHERE id=?",
      ).run(now, runId);
    }
  });
}

export function runningTodayPlan(owner: string): {
  work_item_id: string;
  session_id: string | null;
  run_id: string | null;
  status: string;
} | null {
  const row = getConn().prepare(
    `SELECT w.id AS work_item_id, w.session_id, w.status, r.id AS run_id
       FROM work_items w
       LEFT JOIN task_runs r ON r.work_item_id = w.id
      WHERE w.owner_user_id=? AND w.task_type='today_plan'
        AND w.status IN ('pending','queued','running','in_progress','starting')
      ORDER BY w.updated_at DESC, r.created_at DESC
      LIMIT 1`,
  ).get(owner) as {
    work_item_id: string;
    session_id: string | null;
    status: string;
    run_id: string | null;
  } | undefined;
  return row || null;
}
