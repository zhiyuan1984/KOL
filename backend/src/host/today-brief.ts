import { getConn, nowIso, tx } from "../db.js";
import { nid } from "../ids.js";
import type { Json } from "../types.js";
import { persistTodayDisplayFromBrief } from "./persist-today-display.js";
import { briefPointerTable, loadLatestTodayBrief, planTaskType, type PlanScope } from "./today-plan-context.js";
import { PLANNING_TASK_TYPES } from "./planning-types.js";

export { briefPointerTable, planTaskType };
export type { PlanScope };

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

export type TodayPlanHydratePack = {
  now_counts?: { unfinished?: number; discovery_anomalies?: number; failed_runs?: number };
  source_cursor?: Json;
  delta?: { added?: unknown[]; removed?: unknown[]; unchanged?: unknown[] };
};

function sectionHasCopy(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.some((item) => {
    const row = asRecord(item);
    if (!row) return typeof item === "string" && Boolean(item.trim());
    return Boolean(String(row.title || row.body || "").trim() || (Array.isArray(row.items) && row.items.length));
  });
}

function hasDisplayTasks(brief: Record<string, unknown>): boolean {
  const list = Array.isArray(brief.display_tasks)
    ? brief.display_tasks
    : Array.isArray(brief.todo_layout)
      ? brief.todo_layout
      : [];
  return list.some((item) => {
    const row = asRecord(item);
    return Boolean(String(row?.work_item_id || row?.id || "").trim());
  });
}

/** Host may fill mechanical fields only. Lead/sections/primary copy must come from Codex. */
export function hydrateTodayBrief(raw: unknown, pack?: TodayPlanHydratePack | null): Json | null {
  const brief = asRecord(raw);
  if (!brief) return null;
  const next: Record<string, unknown> = { ...brief };
  delete next.type;
  const lead = typeof next.lead === "string" ? next.lead.trim() : "";
  if (!lead && !sectionHasCopy(next.sections)) return null;
  const counts = pack?.now_counts || {};
  if (!asRecord(next.stats)) {
    next.stats = {
      unfinished: Number(counts.unfinished || 0),
      discovery_anomalies: Number(counts.discovery_anomalies || 0),
      failed_runs: Number(counts.failed_runs || 0),
    };
  }
  if (!Array.isArray(next.todo_layout)) next.todo_layout = [];
  if (!Array.isArray(next.analysis_hints)) next.analysis_hints = [];
  if (!asRecord(next.source_cursor)) {
    next.source_cursor = pack?.source_cursor || {
      cursor_from: null,
      cursor_to: "",
      added: [],
      removed: [],
      unchanged: [],
    };
  }
  if (typeof next.increment_summary !== "string") {
    const added = Array.isArray(pack?.delta?.added) ? pack!.delta!.added!.length : 0;
    const removed = Array.isArray(pack?.delta?.removed) ? pack!.delta!.removed!.length : 0;
    next.increment_summary = `added ${added} / removed ${removed}`;
  }
  return next as Json;
}

export function validateTodayBrief(value: unknown): TodayBriefValidation {
  const brief = asRecord(value);
  if (!brief) return { ok: false, reason: "today_brief must be an object", brief: null };
  const lead = typeof brief.lead === "string" ? brief.lead.trim() : "";
  if (!lead && !sectionHasCopy(brief.sections)) {
    return { ok: false, reason: "Codex did not produce lead or sections", brief: null };
  }
  if (brief.sections != null && !Array.isArray(brief.sections)) {
    return { ok: false, reason: "missing sections", brief: null };
  }
  if (!hasDisplayTasks(brief)) {
    return { ok: false, reason: "Codex did not produce display_tasks", brief: null };
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

export function upsertTodayBriefPointer(owner: string, artifactId: string, workItemId: string, scope: PlanScope = "today"): void {
  const now = nowIso();
  const table = briefPointerTable(scope);
  tx((db) => {
    db.prepare(
      `INSERT INTO ${table} (owner_user_id, artifact_id, work_item_id, updated_at)
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
  scope?: PlanScope;
}): { ok: true; artifact_id: string; brief: Json } | { ok: false; reason: string; kept_artifact_id: string | null } {
  const scope = input.scope ?? "today";
  const checked = validateTodayBrief(input.brief);
  if (!checked.ok) {
    const previous = loadLatestTodayBrief(input.owner, scope);
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
  upsertTodayBriefPointer(input.owner, artifactId, input.workItemId, scope);
  const display = persistTodayDisplayFromBrief({
    owner: input.owner,
    workItemId: input.workItemId,
    runId: input.runId,
    brief: checked.brief,
    scope,
  });
  if (!display.ok) {
    const previous = loadLatestTodayBrief(input.owner, scope);
    return { ok: false, reason: display.reason, kept_artifact_id: previous.artifact_id };
  }
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

/**
 * A planning turn is bounded by the worker timeout (HOST_WORKER_TIMEOUT /
 * CODEX_TURN_TIMEOUT), so a plan that has not been touched for this long can
 * never finish. Without the watchdog a Host restart mid-turn left the work item
 * and its run 'running' forever: every later 新工作任务 entry attached to that
 * dead run, and the 思考过程 card then polled a plan that could never complete —
 * frozen rows, identical timestamps, forever.
 */
export const PLAN_WATCHDOG_MS = 15 * 60 * 1_000;

const PLANNING_OPEN_STATUSES = ["pending", "queued", "running", "in_progress", "starting"] as const;

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(",");
}

/**
 * Fail planning work items that are still open with nothing left to run them.
 * Called at boot, where nothing can be running yet, and by `runningTodayPlan`
 * for rows past the watchdog. Returns the ids it failed.
 */
export function failStuckPlans(reason: string, olderThanMs?: number, ownerUserId?: string): string[] {
  const cutoff = olderThanMs == null ? null : new Date(Date.now() - olderThanMs).toISOString();
  const rows = getConn().prepare(
    `SELECT id, updated_at, created_at FROM work_items
      WHERE task_type IN (${placeholders(PLANNING_TASK_TYPES.length)})
        AND status IN (${placeholders(PLANNING_OPEN_STATUSES.length)})
        ${ownerUserId ? "AND owner_user_id=?" : ""}`,
  ).all(
    ...PLANNING_TASK_TYPES,
    ...PLANNING_OPEN_STATUSES,
    ...(ownerUserId ? [ownerUserId] : []),
  ) as { id: string; updated_at?: string | null; created_at?: string | null }[];
  const failed: string[] = [];
  for (const row of rows) {
    if (cutoff && String(row.updated_at || row.created_at || "") >= cutoff) continue;
    const run = getConn().prepare(
      "SELECT id FROM task_runs WHERE work_item_id=? ORDER BY created_at DESC LIMIT 1",
    ).get(row.id) as { id: string } | undefined;
    markTodayPlanFailed(String(row.id), run?.id || null, reason);
    failed.push(String(row.id));
  }
  return failed;
}

export function runningTodayPlan(owner: string, scope: PlanScope = "today"): {
  work_item_id: string;
  session_id: string | null;
  run_id: string | null;
  status: string;
} | null {
  const row = getConn().prepare(
    `SELECT w.id AS work_item_id, w.session_id, w.status, r.id AS run_id,
            COALESCE(r.created_at, w.updated_at) AS touched_at
       FROM work_items w
       LEFT JOIN task_runs r ON r.work_item_id = w.id
      WHERE w.owner_user_id=? AND w.task_type=?
        AND w.status IN ('pending','queued','running','in_progress','starting')
      ORDER BY w.updated_at DESC, r.created_at DESC
      LIMIT 1`,
  ).get(owner, planTaskType(scope)) as {
    work_item_id: string;
    session_id: string | null;
    status: string;
    run_id: string | null;
    touched_at: string | null;
  } | undefined;
  if (!row) return null;
  // A run this old cannot still be alive: do not let it capture every later
  // entry, fail it so the next GET settles and the pane can start a fresh plan.
  const touched = Date.parse(String(row.touched_at || ""));
  if (Number.isFinite(touched) && Date.now() - touched > PLAN_WATCHDOG_MS) {
    failStuckPlans("规划运行已中断", PLAN_WATCHDOG_MS, owner);
    return null;
  }
  return row;
}
