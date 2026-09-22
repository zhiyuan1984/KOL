import { DEMO_USER } from "../config.js";
import { getConn } from "../db.js";
import { taskDefinition } from "../tasks/registry.js";
import type { Json, Row } from "../types.js";
import { authDisabled, isAdmin, scopedUser } from "../auth.js";
import { followReleaseTimer, isClosedWorkItem, isOpenWorkItem, isPlanningWorkItem, isTodayWorkItem } from "./home-board.js";
import { HttpFail } from "./errors.js";
import {
  briefPointerTable,
  planTaskType,
  PLANNING_TASK_TYPES,
  type PlanScope,
  type ScopeConfig,
} from "./planning-types.js";
import { threadsByCollaborationIds } from "../starrykol/mail-sync.js";

export {
  briefPointerTable,
  PLANNING_TASK_TYPES,
  PLANNING_TASK_TYPES_SET,
  PLAN_SCOPES,
  planTaskType,
  SCOPE_TABLE,
  type PlanScope,
  type ScopeConfig,
} from "./planning-types.js";

export function ownerId(): string {
  const user = scopedUser();
  if (user?.id) return user.id;
  if (authDisabled() || isAdmin()) return DEMO_USER.id;
  throw new HttpFail(401, "Unauthorized");
}

export const PLANNING_FORBIDDEN_TOOL = /follow|send|confirm[_-]?stage/i;
export const PLANNING_MAX_ADDED = 40;

export type SourceKind =
  | "formal_task"
  | "discovery_batch"
  | "failed_run"
  | "follow_plan"
  | "correspondence"
  | "follow_timer"
  | "anomaly";

export type SourceObjectType = "person" | "batch" | "task" | "run";

export type SourceItem = {
  id: string;
  kind: SourceKind;
  title: string;
  status: string;
  object_type: SourceObjectType;
  person_id: string | null;
  work_item_id?: string | null;
  request_id?: string | null;
  run_id?: string | null;
  platform?: string | null;
  updated_at?: string | null;
  reason?: string | null;
  p0: boolean;
};

export type SourceCursor = {
  cursor_from: string | null;
  cursor_to: string;
  added: string[];
  removed: string[];
  unchanged: string[];
};

export type TodayPlanPack = {
  history: {
    unfinished_tasks: SourceItem[];
    previous_brief: Json | null;
    source_cursor: SourceCursor | null;
  };
  delta: {
    added: SourceItem[];
    removed: SourceItem[];
    unchanged: SourceItem[];
  };
  now_counts: {
    unfinished: number;
    discovery_anomalies: number;
    failed_runs: number;
    follow_plans: number;
    correspondence: number;
    follow_timers: number;
    anomalies: number;
  };
  source_cursor: SourceCursor;
  catalog: SourceItem[];
};

export function planningHarnessMount(skill = "today_plan"): {
  tools: string[];
  skills: string[];
  forbidden: string[];
} {
  const definition = taskDefinition(skill);
  const tools = (definition?.mcp || []).filter((tool) => !PLANNING_FORBIDDEN_TOOL.test(tool));
  return {
    tools,
    skills: [skill],
    forbidden: ["follow", "send", "confirm-stage"],
  };
}

function parseJson(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parseArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function sourceCursorFromBrief(brief: Json | null): SourceCursor | null {
  const raw = brief?.source_cursor;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const cursor = raw as Record<string, unknown>;
  return {
    cursor_from: cursor.cursor_from == null ? null : String(cursor.cursor_from),
    cursor_to: String(cursor.cursor_to || ""),
    added: Array.isArray(cursor.added) ? cursor.added.map(String) : [],
    removed: Array.isArray(cursor.removed) ? cursor.removed.map(String) : [],
    unchanged: Array.isArray(cursor.unchanged) ? cursor.unchanged.map(String) : [],
  };
}

function catalogIds(items: SourceItem[]): string[] {
  return items.map((item) => item.id);
}

function cursorTo(ids: string[]): string {
  return `src:${ids.slice().sort().join(",")}`;
}

function kindRank(kind: SourceKind): number {
  if (kind === "formal_task" || kind === "discovery_batch" || kind === "failed_run") return 0;
  return 1;
}

export function trimAdded(items: SourceItem[], cap = PLANNING_MAX_ADDED): SourceItem[] {
  return [...items]
    .sort((a, b) => kindRank(a.kind) - kindRank(b.kind) || String(b.updated_at || "").localeCompare(String(a.updated_at || "")))
    .slice(0, cap);
}

function collectFormalTasks(owner: string): SourceItem[] {
  const rows = getConn().prepare(
    "SELECT * FROM work_items WHERE owner_user_id=? ORDER BY updated_at DESC",
  ).all(owner) as Row[];
  return rows.filter((row) => {
    if (isPlanningWorkItem(row)) return false;
    if (!isOpenWorkItem(row)) return false;
    const source = String(row.source || "manual");
    if ((source === "ai" || source === "discovery") && !row.promoted_at) return false;
    return !isClosedWorkItem(row);
  }).map((row) => ({
    id: `task:${row.id}`,
    kind: "formal_task" as const,
    title: String(row.title || ""),
    status: String(row.status || ""),
    object_type: row.collaboration_id ? "person" as const : "task" as const,
    person_id: row.collaboration_id ? String(row.collaboration_id) : null,
    work_item_id: String(row.id),
    updated_at: row.updated_at ? String(row.updated_at) : null,
    reason: String(row.status || "") === "failed" ? "执行失败" : "未了结正式任务",
    p0: true,
  }));
}

function collectFailedRuns(owner: string): SourceItem[] {
  const planningPlaceholders = PLANNING_TASK_TYPES.map(() => "?").join(",");
  const rows = getConn().prepare(
    `SELECT r.*, w.title AS work_title, w.collaboration_id, w.task_type
       FROM task_runs r
       JOIN work_items w ON w.id = r.work_item_id
      WHERE w.owner_user_id=? AND r.status='failed'
        AND w.task_type NOT IN (${planningPlaceholders})
      ORDER BY r.created_at DESC`,
  ).all(owner, ...PLANNING_TASK_TYPES) as Row[];
  return rows.map((row) => ({
    id: `run:${row.id}`,
    kind: "failed_run" as const,
    title: String(row.work_title || "失败运行"),
    status: "failed",
    object_type: row.collaboration_id ? "person" as const : "run" as const,
    person_id: row.collaboration_id ? String(row.collaboration_id) : null,
    work_item_id: String(row.work_item_id),
    run_id: String(row.id),
    updated_at: row.completed_at ? String(row.completed_at) : String(row.created_at || ""),
    reason: "运行失败",
    p0: true,
  }));
}

function collectDiscoveryAnomalies(owner: string): SourceItem[] {
  const requests = getConn().prepare(
    "SELECT * FROM discovery_requests WHERE owner_user_id=? ORDER BY updated_at DESC",
  ).all(owner) as Row[];
  const out: SourceItem[] = [];
  for (const request of requests) {
    const latest = request.latest_run_id
      ? getConn().prepare("SELECT * FROM discovery_runs WHERE id=?").get(request.latest_run_id) as Row | undefined
      : getConn().prepare(
          "SELECT * FROM discovery_runs WHERE request_id=? ORDER BY created_at DESC LIMIT 1",
        ).get(request.id) as Row | undefined;
    if (!latest) continue;
    const status = String(latest.status || request.status || "");
    const candidateCount = Number(latest.candidate_count || 0);
    const failed = status === "failed";
    const emptyOpen = (status === "succeeded" || status === "open") && candidateCount === 0;
    if (!failed && !emptyOpen) continue;
    const platforms = parseArray(request.platforms).map(String);
    const platform = String(latest.platform || platforms[0] || "");
    out.push({
      id: `discovery:${request.id}`,
      kind: "discovery_batch",
      title: String(request.keywords || platform || "发现批次"),
      status: failed ? "failed" : "empty",
      object_type: "batch",
      person_id: null,
      request_id: String(request.id),
      run_id: String(latest.id),
      platform,
      updated_at: String(latest.updated_at || request.updated_at || ""),
      reason: failed ? "采集失败" : "批次已开但结果为空",
      p0: true,
    });
  }
  return out;
}

function collectCorrespondence(owner: string): SourceItem[] {
  const rows = getConn().prepare(
    `SELECT * FROM work_items
      WHERE owner_user_id=? AND task_type IN ('email_compose','reply_analysis','email_conversation_read')
      ORDER BY updated_at DESC`,
  ).all(owner) as Row[];
  return rows.filter((row) => isOpenWorkItem(row) && !isPlanningWorkItem(row)).map((row) => ({
    id: `mail:${row.id}`,
    kind: "correspondence" as const,
    title: String(row.title || ""),
    status: String(row.status || ""),
    object_type: row.collaboration_id ? "person" as const : "task" as const,
    person_id: row.collaboration_id ? String(row.collaboration_id) : null,
    work_item_id: String(row.id),
    updated_at: row.updated_at ? String(row.updated_at) : null,
    reason: "往来待办",
    p0: false,
  }));
}

function collectFollowPlans(owner: string): SourceItem[] {
  const rows = getConn().prepare(
    `SELECT * FROM work_items
      WHERE owner_user_id=? AND (
        task_type IN ('creator_outreach','email_compose')
        OR title LIKE '%跟进%'
      )
      ORDER BY updated_at DESC`,
  ).all(owner) as Row[];
  return rows.filter((row) => isOpenWorkItem(row) && !isPlanningWorkItem(row) && row.collaboration_id).map((row) => ({
    id: `follow:${row.id}`,
    kind: "follow_plan" as const,
    title: String(row.title || ""),
    status: String(row.status || ""),
    object_type: "person" as const,
    person_id: String(row.collaboration_id),
    work_item_id: String(row.id),
    updated_at: row.updated_at ? String(row.updated_at) : null,
    reason: "跟进计划",
    p0: false,
  }));
}

function collectFollowTimersAndAnomalies(): { timers: SourceItem[]; anomalies: SourceItem[] } {
  const collabs = getConn().prepare(
    "SELECT * FROM collaborations WHERE kol_uid IS NOT NULL AND trim(kol_uid) != ''",
  ).all() as Row[];
  const ids = collabs.map((row) => String(row.id));
  const mailByCollab = threadsByCollaborationIds(ids);
  const timers: SourceItem[] = [];
  const anomalies: SourceItem[] = [];
  for (const row of collabs) {
    const stage = String(row.stage_code || "");
    const exception = Boolean(row.overdue) || /REJECTED|LOST|DISPUTE|EXCEPTION/i.test(stage);
    if (exception) {
      anomalies.push({
        id: `anomaly:${row.id}`,
        kind: "anomaly",
        title: String(row.display_name || row.handle || row.id),
        status: stage || "anomaly",
        object_type: "person",
        person_id: String(row.id),
        updated_at: null,
        reason: "异常/逾期对象",
        p0: false,
      });
    }
    const threads = mailByCollab.get(String(row.id)) || [];
    const lastAt = threads.find((thread) => thread.last_at)?.last_at || threads[0]?.last_at || null;
    const timer = followReleaseTimer(lastAt ? String(lastAt) : null);
    if (timer.days_since_interaction != null && timer.days_since_interaction >= 14) {
      timers.push({
        id: `timer:${row.id}`,
        kind: "follow_timer",
        title: String(row.display_name || row.handle || row.id),
        status: "release_due",
        object_type: "person",
        person_id: String(row.id),
        updated_at: timer.last_interaction_at,
        reason: "14 日无互动",
        p0: false,
      });
    }
  }
  return { timers, anomalies };
}

function filterTodoCatalog(catalog: SourceItem[]): SourceItem[] {
  const formalIds = catalog
    .filter((item) => item.kind === "formal_task" && item.work_item_id)
    .map((item) => String(item.work_item_id));
  if (!formalIds.length) return catalog.filter((item) => item.kind !== "formal_task");
  const placeholders = formalIds.map(() => "?").join(",");
  const rows = getConn().prepare(
    `SELECT * FROM work_items WHERE id IN (${placeholders})`,
  ).all(...formalIds) as Row[];
  const todayIds = new Set(rows.filter((row) => isTodayWorkItem(row)).map((row) => String(row.id)));
  return catalog.filter((item) => item.kind !== "formal_task" || !todayIds.has(String(item.work_item_id)));
}

const CATALOG_FILTERS: Record<PlanScope, (catalog: SourceItem[]) => SourceItem[]> = {
  today: (catalog) => catalog,
  todo: filterTodoCatalog,
};

export function collectSourceCatalog(owner = ownerId(), scope: PlanScope = "today"): SourceItem[] {
  const formal = collectFormalTasks(owner);
  const discovery = collectDiscoveryAnomalies(owner);
  const failed = collectFailedRuns(owner);
  const correspondence = collectCorrespondence(owner);
  const followPlans = collectFollowPlans(owner);
  const extra = collectFollowTimersAndAnomalies();
  const seen = new Set<string>();
  const out: SourceItem[] = [];
  for (const item of [...formal, ...discovery, ...failed, ...followPlans, ...correspondence, ...extra.timers, ...extra.anomalies]) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return CATALOG_FILTERS[scope](out);
}

export function diffCatalog(current: SourceItem[], previous: SourceCursor | null): {
  added: SourceItem[];
  removed: SourceItem[];
  unchanged: SourceItem[];
  cursor: SourceCursor;
} {
  const currentIds = catalogIds(current);
  const previousIds = new Set(previous ? [...previous.added, ...previous.unchanged] : []);
  const first = !previous || !previous.cursor_to;
  const added = first ? [...current] : current.filter((item) => !previousIds.has(item.id));
  const removed = first
    ? []
    : [...previousIds].filter((id) => !currentIds.includes(id)).map((id) => ({
      id,
      kind: "formal_task" as const,
      title: id,
      status: "removed",
      object_type: "task" as const,
      person_id: null,
      p0: true,
    }));
  const unchanged = first ? [] : current.filter((item) => previousIds.has(item.id));
  const trimmedAdded = trimAdded(added);
  return {
    added: trimmedAdded,
    removed,
    unchanged,
    cursor: {
      cursor_from: first ? null : previous.cursor_to,
      cursor_to: cursorTo(currentIds),
      added: catalogIds(trimmedAdded),
      removed: removed.map((item) => item.id),
      unchanged: catalogIds(unchanged),
    },
  };
}

export function loadLatestTodayBrief(owner = ownerId(), scope: PlanScope = "today"): { brief: Json | null; artifact_id: string | null; work_item_id: string | null } {
  const pointer = getConn().prepare(
    `SELECT artifact_id, work_item_id FROM ${briefPointerTable(scope)} WHERE owner_user_id=?`,
  ).get(owner) as { artifact_id: string; work_item_id: string } | undefined;
  if (pointer) {
    const row = getConn().prepare("SELECT payload FROM task_artifacts WHERE id=?").get(pointer.artifact_id) as
      | { payload: string }
      | undefined;
    if (row) {
      const payload = parseJson(row.payload);
      return { brief: payload, artifact_id: pointer.artifact_id, work_item_id: pointer.work_item_id };
    }
  }
  const latest = getConn().prepare(
    `SELECT a.id, a.payload, a.work_item_id
       FROM task_artifacts a
       JOIN work_items w ON w.id = a.work_item_id
      WHERE w.owner_user_id=? AND a.artifact_type='today_brief' AND w.task_type=?
      ORDER BY a.created_at DESC LIMIT 1`,
  ).get(owner, planTaskType(scope)) as { id: string; payload: string; work_item_id: string } | undefined;
  if (!latest) return { brief: null, artifact_id: null, work_item_id: null };
  return { brief: parseJson(latest.payload), artifact_id: latest.id, work_item_id: latest.work_item_id };
}

export function packTodayPlanContext(owner = ownerId(), scope: PlanScope = "today"): TodayPlanPack {
  const latest = loadLatestTodayBrief(owner, scope);
  const previousCursor = sourceCursorFromBrief(latest.brief);
  const catalog = collectSourceCatalog(owner, scope);
  const diff = diffCatalog(catalog, previousCursor);
  const unfinished = catalog.filter((item) => item.kind === "formal_task");
  const discovery = catalog.filter((item) => item.kind === "discovery_batch");
  const failed = catalog.filter((item) => item.kind === "failed_run");
  return {
    history: {
      unfinished_tasks: unfinished,
      previous_brief: latest.brief,
      source_cursor: previousCursor,
    },
    delta: {
      added: diff.added,
      removed: diff.removed,
      unchanged: diff.unchanged,
    },
    now_counts: {
      unfinished: unfinished.length,
      discovery_anomalies: discovery.length,
      failed_runs: failed.length,
      follow_plans: catalog.filter((item) => item.kind === "follow_plan").length,
      correspondence: catalog.filter((item) => item.kind === "correspondence").length,
      follow_timers: catalog.filter((item) => item.kind === "follow_timer").length,
      anomalies: catalog.filter((item) => item.kind === "anomaly").length,
    },
    source_cursor: diff.cursor,
    catalog,
  };
}

export function planningRunInput(pack: TodayPlanPack, extra: Json = {}, scope: PlanScope = "today"): Json {
  const taskType = planTaskType(scope);
  const mount = planningHarnessMount(taskType);
  return {
    mode: taskType,
    expert_id: "expert:kol",
    skip_user_memory: true,
    [`${taskType}_context`]: pack,
    history: pack.history,
    delta: pack.delta,
    now_counts: pack.now_counts,
    planning_harness: mount,
    ...extra,
  };
}
