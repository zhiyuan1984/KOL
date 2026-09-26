import { Hono } from "hono";
import { authDisabled, isAdmin, requireSkill, scopedUser } from "../auth.js";
import { DEMO_USER } from "../config.js";
import { audit, getConn, isSqliteClosedError, isSqliteForeignKeyError, nowIso, tx, type SqliteConn } from "../db.js";
import { HttpFail } from "../host/errors.js";
import { nid } from "../ids.js";
import type { Json, Row } from "../types.js";
import { recognizeTaskIntent } from "../tasks/recognize.js";
import { resolveTaskIntent } from "../tasks/resolver.js";
import { taskDefinition, taskDefinitions } from "../tasks/registry.js";
import { buildHomeBoard, historySummary, decorateTaskFromCollab, isInsightWorkItem, isOpenWorkItem, OPEN_WORK_ITEM_SQL, displayStatusOf, normalizePriority, TASK_RISK_LEVELS, taskDefinitionIndex, todayDateStr, type TaskDefinitionIndex } from "../host/home-board.js";
import { cachedPoll, pollEpoch } from "../host/response-cache.js";
import { formatMissingFields, missingFieldsMessage } from "../labels.js";
import { agentSubmissionAllowed, kolAgentManifest } from "../contract-scope.js";
import { FROM_TEXT_FORBIDDEN_TASK_TYPES } from "../gateway/discovery-harness.js";
import { applyKolAnalyzeAction, KOL_ANALYZE_TASK_TYPE } from "../host/kol-memory.js";
import { extractTaskFieldUpdates, type TaskFieldUpdates } from "../tasks/openai-intent.js";
import { parseTaskFieldUpdatesFallback } from "../tasks/task-field-updates.js";
import { parseTaskRecommendationCandidate } from "../host/task-recommendations.js";

export const tasks = new Hono();

const STATUSES = new Set(["needs_clarification", "pending", "running", "waiting", "completed", "failed", "cancelled"]);
const EDITABLE_STATUSES = new Set([...STATUSES, "in_progress", "queued", "starting"]);
const PRIORITIES = new Set(["important_urgent", "important", "urgent", "normal", "low", "high", "medium"]);

const TASK_FIELD_LABELS: Record<string, string> = {
  title: "标题",
  content: "内容",
  status: "状态",
  priority: "优先级",
  risk_level: "风险等级",
  start_date: "开始日期",
  due_at: "结束日期",
};

function ownerId(): string {
  const user = scopedUser();
  if (user) return user.id;
  if (authDisabled()) return DEMO_USER.id;
  throw new HttpFail(401, "authentication required");
}

function parseJson(value: unknown): unknown {
  try {
    return JSON.parse(String(value || "{}"));
  } catch {
    return {};
  }
}

function taskInput(body: Json): Json {
  return {
    ...(body.input && typeof body.input === "object" ? body.input as Json : {}),
    ...(body.attachments ? { attachments: body.attachments } : {}),
    ...(body.model_tier ? { model_tier: body.model_tier } : {}),
    ...(body.collaboration_id ? { collaboration_id: body.collaboration_id } : {}),
    ...(body.knowledge_id ? { knowledge_id: body.knowledge_id } : {}),
    ...(body.compose_input && typeof body.compose_input === "object" && !Array.isArray(body.compose_input)
      ? { compose_input: body.compose_input }
      : {}),
    ...((body.prompt || body.text) ? { prompt: String(body.prompt || body.text) } : {}),
  };
}

function resolutionIssueFields(resolution: ReturnType<typeof resolveTaskIntent>): string[] {
  return [...new Set([
    ...resolution.missing_fields,
    ...Object.keys(resolution.invalid_fields || {}),
  ])];
}

function publicWorkItem(row: Row, collab?: Row | null, definitions?: TaskDefinitionIndex): Json {
  const definition = definitions ? definitions.get(String(row.task_type)) : taskDefinition(String(row.task_type));
  let project: string | null = collab?.display_name ? String(collab.display_name) : null;
  if (!project && row.project_id && !collab) {
    // Single-item paths only. List endpoints must pass the batched collab.
    const hit = getConn().prepare("SELECT display_name FROM collaborations WHERE id=?").get(row.project_id) as
      | { display_name?: string }
      | undefined;
    project = hit?.display_name || null;
  }
  const discoveryRun = String(row.task_type) === "discovery_crawl"
    ? getConn().prepare(
      "SELECT id FROM discovery_runs WHERE work_item_id=? AND kind='home' ORDER BY created_at DESC LIMIT 1",
    ).get(row.id) as { id?: string } | undefined
    : undefined;
  return {
    ...row,
    description: definition?.description || "",
    suggested_actions: definition?.actions || [],
    project,
    priority: normalizePriority(row.priority) || "normal",
    risk_level: TASK_RISK_LEVELS.includes(String(row.risk_level || "none") as (typeof TASK_RISK_LEVELS)[number])
      ? String(row.risk_level || "none")
      : "none",
    content: String(row.content || ""),
    start_date: row.start_date || null,
    ...displayStatusOf(row),
    input: parseJson(row.input),
    entities: parseJson(row.entities),
    ...(discoveryRun?.id ? { discovery_run_id: discoveryRun.id } : {}),
  };
}

function lastEventsByWorkItem(ids: string[]): Map<string, Row> {
  const map = new Map<string, Row>();
  if (!ids.length) return map;
  const placeholders = ids.map(() => "?").join(",");
  const rows = getConn().prepare(
    `SELECT te.* FROM task_events te
     INNER JOIN (
       SELECT work_item_id, MAX(sequence) AS sequence
       FROM task_events WHERE work_item_id IN (${placeholders})
       GROUP BY work_item_id
     ) last ON last.work_item_id = te.work_item_id AND last.sequence = te.sequence`,
  ).all(...ids) as Row[];
  for (const row of rows) map.set(String(row.work_item_id), row);
  return map;
}

/**
 * Tail of each work item's event log, newest `max` per item, back in
 * ascending sequence order. The list endpoints only ever read the last event
 * (`history_summary`, `failedTaskReason`, `lastSafeSummary`), so reading every
 * event of every work item — 190k rows on the production box — is pure CPU and
 * memory: it is what turned `GET /api/tasks` into a 130MB response.
 * A presentation budget, not a business rule: no stage, send or approval
 * decision reads the tail — only list summaries do.
 */
export const MAX_LIST_HISTORY_EVENTS = 5;

function eventsByWorkItem(ids: string[], max = MAX_LIST_HISTORY_EVENTS): Map<string, Row[]> {
  const map = new Map<string, Row[]>();
  if (!ids.length) return map;
  const stmt = getConn().prepare(
    "SELECT * FROM task_events WHERE work_item_id=? ORDER BY sequence DESC LIMIT ?",
  );
  for (const id of ids) {
    const rows = (stmt.all(id, max) as Row[]).reverse();
    if (rows.length) map.set(id, rows);
  }
  return map;
}

function collabsByIds(ids: string[]): Map<string, Row> {
  const map = new Map<string, Row>();
  if (!ids.length) return map;
  const placeholders = ids.map(() => "?").join(",");
  const rows = getConn().prepare(`SELECT * FROM collaborations WHERE id IN (${placeholders})`).all(...ids) as Row[];
  for (const row of rows) map.set(String(row.id), row);
  return map;
}

function eventView(event: Row): Json {
  return {
    id: event.id,
    type: event.event_type,
    label: event.label,
    status: event.status,
    summary: event.safe_summary,
    safe_summary: event.safe_summary,
    time: event.time,
    created_at: event.time,
  };
}

function parseLimit(raw: string | undefined, fallback = 50): number {
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) throw new HttpFail(400, "invalid limit");
  return Math.min(200, Math.floor(n));
}

function ownedWorkItem(id: string): Row {
  const row = getConn().prepare("SELECT * FROM work_items WHERE id=?").get(id) as Row | undefined;
  if (!row) throw new HttpFail(404, "task not found");
  if (!isAdmin() && String(row.owner_user_id) !== ownerId()) throw new HttpFail(404, "task not found");
  return row;
}

function dateInput(value: unknown, field: string): string {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(raw)) throw new HttpFail(400, `invalid ${field}`);
  return raw;
}

/** Shared structured field update for PATCH and the Codex /edit endpoint. */
function applyTaskUpdate(item: Row, patch: Json, note?: string): { task: Json; applied: string[] } {
  const sets: string[] = [];
  const values: unknown[] = [];
  const applied: string[] = [];
  const push = (field: string, value: unknown) => {
    sets.push(`${field}=?`);
    values.push(value);
    applied.push(field);
  };
  if (patch.title !== undefined) {
    const title = String(patch.title || "").trim().slice(0, 200);
    if (!title) throw new HttpFail(400, "invalid title");
    push("title", title);
  }
  if (patch.content !== undefined) push("content", String(patch.content || "").slice(0, 2000));
  if (patch.status !== undefined) {
    const status = String(patch.status || "");
    if (!EDITABLE_STATUSES.has(status)) throw new HttpFail(400, "invalid status");
    push("status", status);
  }
  if (patch.priority !== undefined) {
    const priority = normalizePriority(patch.priority);
    if (!priority) throw new HttpFail(400, "invalid priority");
    push("priority", priority);
  }
  if (patch.risk_level !== undefined) {
    const risk = String(patch.risk_level || "");
    if (!(TASK_RISK_LEVELS as readonly string[]).includes(risk)) throw new HttpFail(400, "invalid risk_level");
    push("risk_level", risk);
  }
  for (const field of ["start_date", "due_at"] as const) {
    if (patch[field] === undefined) continue;
    if (patch[field] === null) {
      push(field, null);
      continue;
    }
    const raw = dateInput(patch[field], field);
    push(field, field === "start_date" ? raw.slice(0, 10) : raw.slice(0, 40));
  }
  if (!applied.length) return { task: publicWorkItem(item), applied };
  const now = nowIso();
  tx((db) => {
    db.prepare(`UPDATE work_items SET ${sets.join(",")},updated_at=?,data_version=data_version+1 WHERE id=?`)
      .run(...values, now, item.id);
  });
  const names = applied.map((field) => TASK_FIELD_LABELS[field] || field).join("、");
  appendTaskEvent(
    String(item.id),
    null,
    "task.updated",
    "更新任务",
    String(patch.status || item.status),
    note ? `${note}：${names}` : `已更新：${names}`,
  );
  audit(ownerId(), "task.updated", { work_item_id: item.id, fields: applied });
  return { task: publicWorkItem(ownedWorkItem(String(item.id))), applied };
}

/** Shared guard: the work item (and run, when given) must still exist. */
function taskEventTarget(db: SqliteConn, workItemId: string, runId: string | null): boolean {
  const item = db.prepare("SELECT id FROM work_items WHERE id=?").get(workItemId) as
    | { id: string }
    | undefined;
  if (!item) return false;
  if (!runId) return true;
  const run = db.prepare("SELECT id FROM task_runs WHERE id=? AND work_item_id=?").get(runId, workItemId) as
    | { id: string }
    | undefined;
  return Boolean(run);
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
    return tx((db) => {
      if (!taskEventTarget(db, workItemId, runId)) return null;
      const current = db.prepare(
        "SELECT COALESCE(MAX(sequence),0) AS sequence FROM task_events WHERE work_item_id=?",
      ).get(workItemId) as { sequence: number };
      const row = {
        id: nid("tev"),
        work_item_id: workItemId,
        run_id: runId,
        sequence: Number(current.sequence) + 1,
        event_type: eventType,
        label: label.slice(0, 160),
        status,
        safe_summary: safeSummary?.slice(0, 1000) || null,
        time: nowIso(),
        created_at: nowIso(),
      };
      db.prepare(
        `INSERT INTO task_events
         (id,work_item_id,run_id,sequence,event_type,label,status,safe_summary,time,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      ).run(row.id, row.work_item_id, row.run_id, row.sequence, row.event_type, row.label, row.status,
        row.safe_summary, row.time, row.created_at);
      return row;
    });
  } catch (error) {
    // Fire-and-forget crawl/worker follow-up can land after a test reset or
    // after the parent work item was already removed. Never surface that as
    // an unhandled SQLITE_CONSTRAINT_FOREIGNKEY.
    if (isSqliteForeignKeyError(error) || isSqliteClosedError(error)) return null;
    throw error;
  }
}

/**
 * Live process row for the harness trace. The same `item_key` updates in place
 * (label / status / summary) so a streaming reasoning item stays one row instead
 * of appending one row per delta. `time` is the first write, i.e. when the step
 * started — a growing step keeps its start clock.
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
  try {
    return tx((db) => {
      if (!taskEventTarget(db, workItemId, runId)) return null;
      const summary = safeSummary?.slice(0, 1000) || null;
      const existing = db.prepare(
        "SELECT id, sequence, time, created_at FROM task_events WHERE work_item_id=? AND item_key=?",
      ).get(workItemId, key) as { id: string; sequence: number; time: string; created_at: string } | undefined;
      if (existing) {
        db.prepare(
          "UPDATE task_events SET event_type=?, label=?, status=?, safe_summary=?, run_id=COALESCE(run_id,?) WHERE id=?",
        ).run(eventType, label.slice(0, 160), status, summary, runId, existing.id);
        return {
          id: existing.id,
          work_item_id: workItemId,
          run_id: runId,
          sequence: existing.sequence,
          event_type: eventType,
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
      const row = {
        id: nid("tev"),
        work_item_id: workItemId,
        run_id: runId,
        sequence: Number(current.sequence) + 1,
        event_type: eventType,
        label: label.slice(0, 160),
        status,
        safe_summary: summary,
        item_key: key,
        time: nowIso(),
        created_at: nowIso(),
      };
      db.prepare(
        `INSERT INTO task_events
         (id,work_item_id,run_id,sequence,event_type,label,status,safe_summary,item_key,time,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(row.id, row.work_item_id, row.run_id, row.sequence, row.event_type, row.label, row.status,
        row.safe_summary, row.item_key, row.time, row.created_at);
      return row;
    });
  } catch (error) {
    if (isSqliteForeignKeyError(error) || isSqliteClosedError(error)) return null;
    throw error;
  }
}

function createWorkItem(body: Json, source: string): Json {
  if (!agentSubmissionAllowed()) {
    throw new HttpFail(409, { code: "agent_not_published", message: "KOL Agent 尚未发布，员工端暂不可提交任务", next_action: "等待管理员发布 Agent" });
  }
  const explicitType = String(body.task_type || body.definition_id || body.intent || "");
  const definition = taskDefinition(explicitType);
  if (!definition) throw new HttpFail(400, { code: "unknown_task_type", task_type: explicitType });
  requireSkill(definition.id);
  const input = taskInput(body);
  const resolution = resolveTaskIntent({
    text: String(body.text || body.title || ""),
    task_type: definition.id,
    entities: body.entities as Record<string, unknown> | undefined,
    input,
  });
  if (definition.input_schema?.length && resolution.needs_clarification) {
    throw new HttpFail(422, {
      code: "task_input_invalid",
      message: missingFieldsMessage(resolutionIssueFields(resolution), "请补齐或修正任务参数后再创建。"),
      resolution,
    });
  }
  const status = resolution.needs_clarification ? "needs_clarification" : String(body.status || "pending");
  if (!STATUSES.has(status)) throw new HttpFail(400, "invalid status");
  const rawPriority = body.priority == null || body.priority === "" ? "normal" : String(body.priority);
  if (!PRIORITIES.has(rawPriority)) throw new HttpFail(400, "invalid priority");
  const priority = normalizePriority(rawPriority) || "normal";
  const content = String(body.content || "").slice(0, 2000);
  const startDate = body.start_date == null || body.start_date === ""
    ? todayDateStr()
    : dateInput(body.start_date, "start_date").slice(0, 10);
  const dueAt = body.due_at == null || body.due_at === "" ? todayDateStr() : String(body.due_at).slice(0, 40);
  const riskLevel = body.risk_level == null || body.risk_level === "" ? "none" : String(body.risk_level);
  if (!(TASK_RISK_LEVELS as readonly string[]).includes(riskLevel)) throw new HttpFail(400, "invalid risk_level");
  const now = nowIso();
  const id = nid("tsk");
  const owner = ownerId();
  tx((db) => {
    db.prepare(
      `INSERT INTO work_items
       (id,owner_user_id,task_type,title,source,status,priority,skill,profile,project_id,
        collaboration_id,session_id,due_at,start_date,content,risk_level,input,entities,data_version,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id, owner, definition.id, String(body.title || definition.title).slice(0, 200), source,
      status, priority, definition.id, definition.profile, body.project_id || null,
      body.collaboration_id || input.collaboration_id || null, body.session_id || null, dueAt,
      startDate, content, riskLevel,
      JSON.stringify(input), JSON.stringify(resolution.entities), 1, now, now,
    );
  });
  appendTaskEvent(id, null, "task.created", definition.title, status,
    resolution.missing_fields.length ? `缺少：${formatMissingFields(resolution.missing_fields)}` : "任务已创建");
  audit(owner, "task.created", { work_item_id: id, task_type: definition.id, source });
  return {
    ...publicWorkItem(ownedWorkItem(id)),
    resolution,
  };
}

tasks.get("/task-definitions", (c) => {
  const user = scopedUser();
  const granted = authDisabled() || isAdmin(user)
    ? new Set(taskDefinitions().map((definition) => definition.id))
    : new Set(
        (getConn().prepare("SELECT skill_id FROM user_skill_grants WHERE user_id=?").all(user?.id || "") as Row[])
          .map((row) => String(row.skill_id)),
      );
  return c.json(taskDefinitions().map(({ path: _path, ...definition }) => ({
    ...definition,
    skill: definition.id,
    skill_id: definition.id,
    granted: granted.has(definition.id),
  })));
});

tasks.get("/agent-manifest", (c) => {
  const manifest = kolAgentManifest();
  const employeeViews = (manifest.employee_views || {}) as Record<string, unknown>;
  return c.json({
    id: manifest.id,
    version: manifest.version,
    status: manifest.status,
    publish_gate: manifest.publish_gate,
    entries: Array.isArray(employeeViews.entries) ? employeeViews.entries : [],
    teams: Array.isArray(employeeViews.teams) ? employeeViews.teams : [],
  });
});

/**
 * Cheap "did anything the list reads change" fingerprint. MAX(rowid) is O(1)
 * on the implicit rowid index; MAX(updated_at) rides the new
 * work_items(owner_user_id, updated_at) index. Any write that moves it drops
 * the cached projection immediately instead of waiting out the TTL.
 */
function tasksEpoch(): string {
  const row = getConn().prepare(
    `SELECT (SELECT MAX(rowid) FROM task_events) AS events,
            (SELECT MAX(updated_at) FROM work_items) AS work_items,
            (SELECT COUNT(*) FROM work_items) AS work_item_count,
            (SELECT COUNT(*) FROM collaborations) AS collaborations`,
  ).get() as { events: number | null; work_items: string | null; work_item_count: number; collaborations: number };
  return pollEpoch([row.events, row.work_items, row.work_item_count, row.collaborations]);
}

tasks.get("/tasks", (c) => {
  const view = String(c.req.query("view") || "");
  const openView = view === "open" || view === "todo";
  const clauses: string[] = [];
  const values: unknown[] = [];
  const scoped = !isAdmin() || c.req.query("scope") !== "all";
  const owner = scoped ? ownerId() : "all";
  if (scoped) {
    clauses.push("owner_user_id=?");
    values.push(owner);
  }
  for (const key of ["status", "priority", "source", "profile"] as const) {
    const value = c.req.query(key);
    if (value) {
      clauses.push(`${key}=?`);
      values.push(key === "priority" ? normalizePriority(value) || value : value);
    }
  }
  if (openView) clauses.push(OPEN_WORK_ITEM_SQL);
  const sort = c.req.query("sort") || "updated_desc";
  const order: Record<string, string> = {
    updated_desc: "updated_at DESC",
    updated_asc: "updated_at ASC",
    due_asc: "due_at IS NULL, due_at ASC",
    priority_desc: "CASE priority WHEN 'important_urgent' THEN 5 WHEN 'important' THEN 4 WHEN 'high' THEN 4 WHEN 'urgent' THEN 3 WHEN 'normal' THEN 2 WHEN 'medium' THEN 2 ELSE 1 END DESC, updated_at DESC",
  };
  if (!order[sort]) throw new HttpFail(400, "invalid sort");
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = openView ? parseLimit(c.req.query("limit")) : 0;
  // This endpoint is polled every few seconds by every open tab, so an
  // unchanged data window is served from the 4s in-process cache.
  const cacheKey = `tasks:${owner}:${view}:${sort}:${limit}:${c.req.query("status") || ""}:${c.req.query("priority") || ""}:${c.req.query("source") || ""}:${c.req.query("profile") || ""}`;
  const payload = cachedPoll(cacheKey, tasksEpoch(), () => {
    const definitions = taskDefinitionIndex();
    const total = openView
      ? Number((getConn().prepare(`SELECT COUNT(*) AS c FROM work_items ${where}`).get(...values) as { c: number }).c || 0)
      : 0;
    const rows = getConn().prepare(
      openView
        ? `SELECT * FROM work_items ${where} ORDER BY ${order[sort]} LIMIT ?`
        : `SELECT * FROM work_items ${where} ORDER BY ${order[sort]}`,
    ).all(...(openView ? [...values, limit] : values)) as Row[];
    const ids = rows.map((row) => String(row.id));
    const lastByTask = openView ? lastEventsByWorkItem(ids) : new Map<string, Row>();
    const eventsByTask = openView ? new Map<string, Row[]>() : eventsByWorkItem(ids);
    const collabIds = [...new Set(rows.map((row) => String(row.collaboration_id || row.project_id || "")).filter(Boolean))];
    const collabById = collabsByIds(collabIds);
    const list = rows.map((row) => {
      const collab = collabById.get(String(row.collaboration_id || row.project_id || ""));
      const events = openView
        ? (lastByTask.get(String(row.id)) ? [eventView(lastByTask.get(String(row.id))!)] : [])
        : (eventsByTask.get(String(row.id)) || []).map(eventView);
      return decorateTaskFromCollab({
        ...publicWorkItem(row, collab, definitions),
        ...(openView ? {} : { history: events }),
        history_summary: historySummary(events),
      }, collab);
    });
    if (!openView) return list;
    return {
      view: view === "todo" ? "todo" : "open",
      tasks: list.filter((task) => isOpenWorkItem(task)),
      total,
      limit,
      creates_session: false,
      entry: "memory",
    };
  });
  return c.json(payload);
});

tasks.post("/tasks", async (c) => {
  const body = await c.req.json() as Json;
  return c.json(createWorkItem(body, String(body.source || "manual")), 201);
});

tasks.patch("/tasks/:id", async (c) => {
  const item = ownedWorkItem(c.req.param("id"));
  const body = await c.req.json().catch(() => ({})) as Json;
  const { task, applied } = applyTaskUpdate(item, body);
  if (!applied.length) throw new HttpFail(400, "no updatable fields");
  return c.json(task);
});

tasks.post("/tasks/:id/edit", async (c) => {
  const item = ownedWorkItem(c.req.param("id"));
  const body = await c.req.json().catch(() => ({})) as Json;
  const text = String(body.text || "").trim();
  if (!text) throw new HttpFail(400, "text required");
  let updates: TaskFieldUpdates = {};
  let source: "llm" | "fallback" = "fallback";
  try {
    updates = await extractTaskFieldUpdates(text);
    source = "llm";
  } catch {
    updates = parseTaskFieldUpdatesFallback(text);
  }
  const patch: Json = {};
  for (const field of Object.keys(TASK_FIELD_LABELS)) {
    const value = updates[field as keyof TaskFieldUpdates];
    if (value === undefined || value === null || String(value).trim() === "") continue;
    patch[field] = value;
  }
  if (!Object.keys(patch).length) {
    return c.json({ code: "edit_not_recognized", message: "没有识别出要修改的字段" }, 422);
  }
  const { task, applied } = applyTaskUpdate(item, patch, `根据「${text.slice(0, 80)}」更新`);
  if (!applied.length) {
    return c.json({ code: "edit_not_recognized", message: "没有识别出要修改的字段" }, 422);
  }
  return c.json({ task, applied_fields: applied, source });
});

function normDedupe(value: unknown): string {
  return String(value || "").replace(/^@/, "").trim().toLowerCase();
}

/** FE `todoDedupe` semantics — same identity must not create a second formal WorkItem. */
function findDuplicateTodoRow(owner: string, suggestion: {
  id?: string;
  title?: string;
  handle?: string;
  intent?: string;
  collaboration_id?: string | null;
}): Row | undefined {
  const rows = getConn().prepare(
    "SELECT * FROM work_items WHERE owner_user_id=? AND dismissed_at IS NULL ORDER BY updated_at DESC",
  ).all(owner) as Row[];
  const recId = normDedupe(suggestion.id);
  const title = normDedupe(suggestion.title);
  const handle = normDedupe(suggestion.handle) || normDedupe(suggestion.collaboration_id);
  const intent = normDedupe(suggestion.intent);
  const key = [intent, handle, title].join("|");
  return rows.find((row) => {
    if (["completed", "done", "cancelled"].includes(String(row.status || ""))) return false;
    const source = String(row.source || "manual");
    if ((source === "ai" || source === "discovery") && !row.promoted_at) return false;
    const entities = parseJson(row.entities) as Record<string, unknown>;
    const fromRec = recId.startsWith("rec-ai-") ? recId.slice("rec-ai-".length) : recId;
    if (recId && (normDedupe(row.id) === recId || normDedupe(row.id) === fromRec || normDedupe(entities.recommendation_id) === recId)) return true;
    const rowKey = [
      normDedupe(row.skill || row.task_type),
      normDedupe(entities.handle) || normDedupe(row.collaboration_id),
      normDedupe(row.title),
    ].join("|");
    if (title && rowKey === key) return true;
    if (!title || normDedupe(row.title) !== title) return false;
    const rowHandle = normDedupe(entities.handle) || normDedupe(row.collaboration_id);
    if (handle && rowHandle) return handle === rowHandle;
    if (handle !== rowHandle) return false;
    const rowIntent = normDedupe(row.skill || row.task_type);
    if (intent && rowIntent) return intent === rowIntent;
    return true;
  });
}

tasks.post("/tasks/adopt-recommendation", async (c) => {
  const raw = await c.req.json() as Json;
  const requested = parseTaskRecommendationCandidate(raw);
  const owner = ownerId();
  const board = buildHomeBoard({ restoreOfficialStages: false }) as Record<string, unknown>;
  const workbench = board.workbench && typeof board.workbench === "object" ? board.workbench as Record<string, unknown> : {};
  const recommendations = Array.isArray(workbench.recommendations) ? workbench.recommendations as Record<string, unknown>[] : [];
  const requestedId = requested.recommendation_id || (requested.work_item_id ? `rec-ai-${requested.work_item_id}` : "");
  const current = recommendations.find((item) => item.id === requestedId && item.candidate === true);
  if (!current) throw new HttpFail(409, "recommendation is no longer available; refresh the task list");
  // Candidate content is a server projection. Ignore client edits to title, intent,
  // entities, and prompt so a proposal cannot be turned into a different task.
  const candidate = parseTaskRecommendationCandidate({
    ...current,
    recommendation_id: String(current.id),
    status: "candidate",
  });
  const workItemId = candidate.work_item_id || "";
  const recId = candidate.recommendation_id || "";
  const fromInsight = recId.startsWith("rec-ai-") ? recId.slice("rec-ai-".length) : "";
  const existingId = workItemId || fromInsight;
  if (existingId) {
    try {
      const item = ownedWorkItem(existingId);
      if (item.promoted_at) {
        return c.json({ ...publicWorkItem(item), candidate: false, reused: true, created: false });
      }
      if (!isInsightWorkItem(item)) {
        throw new HttpFail(409, "only an active recommendation candidate can be adopted");
      }
      if (["completed", "cancelled"].includes(String(item.status))) {
        throw new HttpFail(409, `task cannot adopt from ${item.status}`);
      }
      const now = nowIso();
      const nextTitle = candidate.title;
      tx((db) => {
        db.prepare(
          "UPDATE work_items SET promoted_at=COALESCE(promoted_at,?),dismissed_at=NULL,title=CASE WHEN ?!='' THEN ? ELSE title END,updated_at=?,data_version=data_version+1 WHERE id=?",
        ).run(now, nextTitle, nextTitle, now, item.id);
      });
      if (!item.promoted_at) {
        appendTaskEvent(String(item.id), null, "task.promoted", "转为我的待办", String(item.status), "已从今天推荐转入待办");
        audit(owner, "task.adopted", { work_item_id: item.id, recommendation_id: recId || null });
      }
      return c.json({ ...publicWorkItem(ownedWorkItem(String(item.id))), candidate: false, reused: Boolean(item.promoted_at), created: false });
    } catch (error) {
      if (!(error instanceof HttpFail) || error.status !== 404) throw error;
    }
  }
  const identity = {
    id: recId,
    title: candidate.title,
    handle: candidate.handle || "",
    intent: candidate.intent || "",
    collaboration_id: candidate.collaboration_id || null,
  };
  const duplicate = findDuplicateTodoRow(owner, identity);
  if (duplicate) {
    return c.json({ ...publicWorkItem(duplicate), candidate: false, reused: true, created: false });
  }
  const intent = candidate.intent || "creator_daily_tasks";
  const created = createWorkItem({
    prompt: candidate.prompt || candidate.title,
    task_type: intent,
    title: candidate.title,
    description: candidate.reason,
    source: "manual",
    intent,
    collaboration_id: candidate.collaboration_id,
    entities: {
      handle: candidate.handle,
      recommendation_id: recId || undefined,
    },
  }, "manual");
  const now = nowIso();
  tx((db) => {
    db.prepare(
      "UPDATE work_items SET promoted_at=COALESCE(promoted_at,?),dismissed_at=NULL,updated_at=? WHERE id=?",
    ).run(now, now, created.id);
  });
  appendTaskEvent(String(created.id), null, "task.adopted", "采纳为待办", String(created.status), "今天推荐已写入正式待办");
  audit(owner, "task.adopted", { work_item_id: created.id, recommendation_id: recId || null });
  return c.json({ ...publicWorkItem(ownedWorkItem(String(created.id))), candidate: false, reused: false, created: true }, 201);
});

tasks.post("/tasks/recognize", async (c) => {
  const body = await c.req.json() as Json;
  const text = String(body.text || "").trim();
  if (!text) throw new HttpFail(400, "text required");
  const resolution = await recognizeTaskIntent({
    text,
    task_type: (body.task_type || body.intent) as string | undefined,
    entities: body.entities as Record<string, unknown> | undefined,
    input: taskInput(body),
  });
  return c.json({
    resolution,
    source: resolution.source,
    task_type: resolution.task_type,
    confidence: resolution.confidence,
    clarification_kind: resolution.clarification_kind,
    needs_clarification: !resolution.task_type || resolution.confidence < 0.75 || resolution.needs_clarification,
    message: resolution.error,
  });
});

tasks.post("/tasks/from-text", async (c) => {
  const body = await c.req.json() as Json;
  const text = String(body.text || "").trim();
  if (!text) throw new HttpFail(400, "text required");
  const requestedType = String(body.task_type || body.intent || "").trim();
  if (FROM_TEXT_FORBIDDEN_TASK_TYPES.has(requestedType)) {
    throw new HttpFail(400, {
      code: "from_text_forbidden",
      message: "发现计划与采集不能从 from-text 发起。",
      task_type: requestedType,
    });
  }
  const lockedType = requestedType && taskDefinition(requestedType) ? requestedType : undefined;
  const resolution = await recognizeTaskIntent({
    text,
    task_type: lockedType,
    entities: body.entities as Record<string, unknown> | undefined,
    input: taskInput(body),
  });
  const kind = resolution.clarification_kind;
  if (!resolution.task_type || resolution.confidence < 0.75 || kind === "direction") {
    return c.json({
      resolution,
      task: null,
      tasks: [],
      resolved_tasks: [],
      needs_clarification: true,
      clarification_kind: "direction",
      clarification: resolution.error
        || "请选择最符合你意图的任务，不会自动执行。",
      message: resolution.error,
      candidates: resolution.alternatives.map((candidate) => ({
        id: candidate.task_type,
        task_type: candidate.task_type,
        title: candidate.title,
      })),
    });
  }
  if (FROM_TEXT_FORBIDDEN_TASK_TYPES.has(String(resolution.task_type || ""))) {
    throw new HttpFail(400, {
      code: "from_text_forbidden",
      message: "发现计划与采集不能从 from-text 发起。",
      task_type: resolution.task_type,
    });
  }
  // Discovery is a dedicated async workspace, not a generic work-item run.
  // Return a user-selectable handoff so the user can review/fill the registered
  // discovery brief before the existing crawl command starts.
  if (resolution.task_type === "creator_discovery") {
    const definition = taskDefinition("creator_discovery");
    return c.json({
      resolution,
      task: null,
      tasks: [],
      resolved_tasks: [],
      needs_clarification: true,
      clarification_kind: "direction",
      clarification: "已识别为红人发现。打开 AI发现后检查并补齐条件，再提交异步采集。",
      candidates: [{ id: "creator_discovery", task_type: "creator_discovery", title: definition?.title || "红人发现" }],
      handoff: { kind: "workspace", pane: "discovery", task_type: "creator_discovery" },
    });
  }
  const declaredDefinition = taskDefinition(String(resolution.task_type || ""));
  if (body.source === "schedule" && declaredDefinition?.side_effects === "write") {
    throw new HttpFail(409, { code: "schedule_requires_presence", message: "此技能不可无人在场自动执行" });
  }
  if (declaredDefinition?.input_schema?.length && resolution.needs_clarification) {
    const issueFields = [...new Set([
      ...resolution.missing_fields,
      ...Object.keys(resolution.invalid_fields || {}),
    ])];
    return c.json({
      resolution,
      task: null,
      tasks: [],
      resolved_tasks: [],
      needs_clarification: true,
      clarification_kind: "missing_fields",
      clarification: missingFieldsMessage(issueFields, "请在参数卡中补齐或修正后再提交。"),
    });
  }
  const created = createWorkItem({
    ...body,
    text,
    title: body.title,
    task_type: resolution.task_type,
    entities: resolution.entities,
  }, String(body.source || "text"));
  return c.json({
    resolution,
    task: created,
    tasks: [created],
    resolved_tasks: [created],
    needs_clarification: resolution.needs_clarification,
    clarification_kind: kind,
    clarification: resolution.missing_fields.length
      ? missingFieldsMessage(resolution.missing_fields, "可使用输入框补充后再执行。")
      : undefined,
  }, 201);
});

tasks.get("/tasks/by-session/:sid", (c) => {
  const row = getConn().prepare(
    "SELECT * FROM work_items WHERE session_id=? ORDER BY updated_at DESC LIMIT 1",
  ).get(c.req.param("sid")) as Row | undefined;
  if (!row) throw new HttpFail(404, "task not found");
  return c.json(publicWorkItem(ownedWorkItem(String(row.id))));
});

tasks.get("/tasks/:id", (c) => {
  const row = ownedWorkItem(c.req.param("id"));
  const runs = getConn().prepare("SELECT * FROM task_runs WHERE work_item_id=? ORDER BY created_at").all(row.id) as Row[];
  const artifacts = getConn().prepare(
    "SELECT * FROM task_artifacts WHERE work_item_id=? ORDER BY created_at",
  ).all(row.id) as Row[];
  return c.json({
    ...publicWorkItem(row),
    runs: runs.map((run) => ({ ...run, input: parseJson(run.input), entities: parseJson(run.entities), error: parseJson(run.error) })),
    artifacts: artifacts.map((artifact) => ({ ...artifact, payload: parseJson(artifact.payload) })),
  });
});

tasks.get("/tasks/:id/events", (c) => {
  const row = ownedWorkItem(c.req.param("id"));
  const after = Math.max(0, Number(c.req.query("after") || 0));
  const events = getConn().prepare(
    "SELECT * FROM task_events WHERE work_item_id=? AND sequence>? ORDER BY sequence",
  ).all(row.id, after) as Row[];
  return c.json(events.map((event) => ({
    ...event,
    type: event.event_type,
    title: event.label,
    summary: event.safe_summary,
    created_at: event.time,
  })));
});

tasks.post("/tasks/:id/run", async (c) => {
  const item = ownedWorkItem(c.req.param("id"));
  if (["running", "completed", "cancelled"].includes(String(item.status))) {
    throw new HttpFail(409, `task cannot run from ${item.status}`);
  }
  const definition = taskDefinition(String(item.task_type));
  if (!definition) throw new HttpFail(409, "task definition no longer exists");
  requireSkill(definition.id);
  const body = await c.req.json().catch(() => ({})) as Json;
  const storedInput = parseJson(item.input) as Json;
  const runInput = {
    ...storedInput,
    ...((body.input as Json) || {}),
    ...(body.compose_input && typeof body.compose_input === "object" && !Array.isArray(body.compose_input)
      ? { compose_input: body.compose_input }
      : {}),
  };
  const runText = String(body.text || storedInput.prompt || item.title);
  const resolution = resolveTaskIntent({
    text: runText,
    task_type: definition.id,
    entities: { ...(parseJson(item.entities) as Json), ...((body.entities as Json) || {}) },
    input: runInput,
  });
  if (resolution.needs_clarification) {
    getConn().prepare("UPDATE work_items SET status='needs_clarification',updated_at=? WHERE id=?")
      .run(nowIso(), item.id);
    appendTaskEvent(String(item.id), null, "task.clarification", "还需要补充信息", "needs_clarification",
      resolution.missing_fields.length
        ? `缺少：${formatMissingFields(resolution.missing_fields)}`
        : missingFieldsMessage(resolutionIssueFields(resolution), "参数值无效"));
    return c.json({ needs_clarification: true, resolution }, 422);
  }
  const now = nowIso();
  const sid = String(item.session_id || nid("ses"));
  const runId = nid("run");
  tx((db) => {
    if (!item.session_id) {
      db.prepare(
        "INSERT INTO sessions (id,title,created_at,updated_at,kind,disabled,owner_user_id) VALUES (?,?,?,?,?,?,?)",
      ).run(sid, item.title, now, now, "task", 0, item.owner_user_id);
    }
    db.prepare(
      `INSERT INTO task_runs
       (id,work_item_id,session_id,status,input,entities,created_at)
       VALUES (?,?,?,?,?,?,?)`,
    ).run(runId, item.id, sid, "pending", JSON.stringify(runInput), JSON.stringify(resolution.entities), now);
    db.prepare("UPDATE work_items SET session_id=?,input=?,status='pending',updated_at=?,data_version=data_version+1 WHERE id=?")
      .run(sid, JSON.stringify(runInput), now, item.id);
  });
  appendTaskEvent(String(item.id), runId, "run.pending", "任务已加入队列", "pending", "等待会话开始执行");
  audit(ownerId(), "task.run.created", { work_item_id: item.id, run_id: runId, session_id: sid });
  const pendingMessage = {
    ...runInput,
    act: "ask",
    text: runText,
    intent: definition.id,
    work_item_id: item.id,
    task_type: definition.id,
    run_id: runId,
    collaboration_id: item.collaboration_id,
    entities: resolution.entities,
  };
  const taskRow = publicWorkItem(ownedWorkItem(String(item.id)));
  const runRow = getConn().prepare("SELECT * FROM task_runs WHERE id=?").get(runId);
  return c.json({
    work_item_id: item.id,
    run_id: runId,
    session_id: sid,
    status: "pending",
    task: taskRow,
    run: runRow,
    pending: pendingMessage,
    pending_message: pendingMessage,
  }, 202);
});

tasks.post("/tasks/:id/acknowledge", async (c) => {
  const item = ownedWorkItem(c.req.param("id"));
  if (["completed", "cancelled"].includes(String(item.status))) {
    throw new HttpFail(409, `task cannot acknowledge from ${item.status}`);
  }
  const now = nowIso();
  const status = String(item.status || "");
  const nextStatus = status === "pending" || status === "queued" ? "in_progress" : status;
  tx((db) => {
    db.prepare(
      `UPDATE work_items
       SET last_acted_at=?,
           acknowledged_at=COALESCE(acknowledged_at,?),
           status=?,
           updated_at=?,
           data_version=data_version+1
       WHERE id=?`,
    ).run(now, now, nextStatus, now, item.id);
  });
  appendTaskEvent(
    String(item.id),
    null,
    "task.acknowledged",
    "处理今日任务",
    nextStatus,
    "已记录打开/处理，未创建会话",
  );
  audit(ownerId(), "task.acknowledged", { work_item_id: item.id, creates_session: false });
  return c.json({
    ...publicWorkItem(ownedWorkItem(String(item.id))),
    entry: "command",
    creates_session: false,
  });
});

tasks.post("/tasks/:id/promote", async (c) => {
  const item = ownedWorkItem(c.req.param("id"));
  if (["completed", "cancelled"].includes(String(item.status))) {
    throw new HttpFail(409, `task cannot promote from ${item.status}`);
  }
  const now = nowIso();
  tx((db) => {
    db.prepare(
      "UPDATE work_items SET promoted_at=COALESCE(promoted_at,?),dismissed_at=NULL,updated_at=?,data_version=data_version+1 WHERE id=?",
    ).run(now, now, item.id);
  });
  if (!item.promoted_at) {
    appendTaskEvent(String(item.id), null, "task.promoted", "转为我的待办", String(item.status), "已从今日任务转入待办");
    audit(ownerId(), "task.promoted", { work_item_id: item.id });
  }
  return c.json(publicWorkItem(ownedWorkItem(String(item.id))));
});

tasks.post("/tasks/:id/dismiss", async (c) => {
  const item = ownedWorkItem(c.req.param("id"));
  if (["completed", "cancelled"].includes(String(item.status))) {
    throw new HttpFail(409, `task cannot dismiss from ${item.status}`);
  }
  const now = nowIso();
  tx((db) => {
    db.prepare(
      "UPDATE work_items SET dismissed_at=COALESCE(dismissed_at,?),updated_at=?,data_version=data_version+1 WHERE id=?",
    ).run(now, now, item.id);
  });
  if (!item.dismissed_at) {
    appendTaskEvent(String(item.id), null, "task.dismissed", "忽略建议", String(item.status), "已从今日任务中移除");
    audit(ownerId(), "task.dismissed", { work_item_id: item.id });
  }
  return c.json(publicWorkItem(ownedWorkItem(String(item.id))));
});

tasks.post("/tasks/:id/actions", async (c) => {
  const item = ownedWorkItem(c.req.param("id"));
  const body = await c.req.json().catch(() => ({})) as Json;
  if (String(item.task_type) !== KOL_ANALYZE_TASK_TYPE) {
    throw new HttpFail(409, {
      code: "actions_not_supported",
      message: "generic actions are only enforced for kol_analyze",
    });
  }
  const result = applyKolAnalyzeAction({
    workItemId: String(item.id),
    verb: body.verb ? String(body.verb) : undefined,
    action: body.action ? String(body.action) : body.verb ? String(body.verb) : undefined,
    artifact: (body.artifact && typeof body.artifact === "object" ? body.artifact : body) as Json,
  });
  return c.json({
    entry: "command",
    kind: "command",
    creates_session: false,
    calls_model: false,
    ...result,
  });
});

tasks.post("/tasks/:id/complete", async (c) => {
  const item = ownedWorkItem(c.req.param("id"));
  const body = await c.req.json().catch(() => ({})) as Json;
  const status = String(body.status || "completed");
  if (!["completed", "failed", "cancelled"].includes(status)) throw new HttpFail(400, "invalid terminal status");
  const now = nowIso();
  tx((db) => {
    db.prepare(
      "UPDATE work_items SET status=?,completed_at=?,updated_at=?,data_version=data_version+1 WHERE id=?",
    ).run(status, now, now, item.id);
    if (body.run_id) {
      db.prepare("UPDATE task_runs SET status=?,error=?,completed_at=? WHERE id=? AND work_item_id=?")
        .run(status, body.error ? JSON.stringify(body.error) : null, now, body.run_id, item.id);
    }
  });
  appendTaskEvent(String(item.id), body.run_id ? String(body.run_id) : null, `task.${status}`, status, status,
    String(body.safe_summary || status));
  audit(ownerId(), `task.${status}`, { work_item_id: item.id, run_id: body.run_id || null });
  return c.json(publicWorkItem(ownedWorkItem(String(item.id))));
});
