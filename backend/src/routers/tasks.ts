import { Hono } from "hono";
import { authDisabled, isAdmin, requireSkill, scopedUser } from "../auth.js";
import { DEMO_USER, codexMode } from "../config.js";
import { audit, getConn, nowIso, tx } from "../db.js";
import { HttpFail } from "../host/errors.js";
import { nid } from "../ids.js";
import type { Json, Row } from "../types.js";
import { recognizeTaskIntent } from "../tasks/recognize.js";
import { resolveTaskIntent } from "../tasks/resolver.js";
import { taskDefinition, taskDefinitions } from "../tasks/registry.js";
import { taskExecutionView } from "../tasks/execution-view.js";
import { isSkillTemplateSnapshot } from "../tasks/skill-template.js";
import { buildTaskOperationsDashboard, taskOperationsDashboardRanges, taskOperationsPeriod, type TaskOperationsRow } from "../tasks/operations-dashboard.js";
import { effectiveSkillTemplate as skillTemplate } from "../host/skill-sop.js";
import { buildHomeBoard, historySummary, decorateTaskFromCollab, isInsightWorkItem, isOpenWorkItem, isTodoWorkItem, OPEN_WORK_ITEM_SQL, TODO_WORK_ITEM_SQL, displayStatusOf, normalizePriority, TASK_RISK_LEVELS, taskDefinitionIndex, todayDateStr, todayMembershipReasons, type TaskDefinitionIndex } from "../host/home-board.js";
import { cachedPoll, cachedPollAsync, pollEpoch } from "../host/response-cache.js";
import { postgresQuery } from "../postgres/pool.js";
import { formatMissingFields, missingFieldsMessage } from "../labels.js";
import { kolAgentManifest } from "../contract-scope.js";
import { assertRuntimeSkill, runtimeAgentForSkill } from "../runtime/execution.js";
import { isTestRuntime } from "../codex-runtime.js";
import { FROM_TEXT_FORBIDDEN_TASK_TYPES } from "../gateway/discovery-harness.js";
import { applyKolAnalyzeAction, KOL_ANALYZE_TASK_TYPE } from "../host/kol-memory.js";
import { extractTaskFieldUpdates, type TaskFieldUpdates } from "../tasks/openai-intent.js";
import { parseTaskFieldUpdatesFallback } from "../tasks/task-field-updates.js";
import { parseTaskRecommendationCandidate } from "../host/task-recommendations.js";
import { ensureTicketForWorkItem, ticketStatusFromWorkItem } from "../tickets.js";
import { appendTaskEvent, appendTaskEventInConn } from "../task-events.js";
import { ticketAllowedLifecycleActions, transitionTicketLifecyclePostgres } from "../ticket-lifecycle.js";
import { transitionTicketLifecycle } from "../ticket-lifecycle-legacy.js";
import { createFormalTicketPostgres, type FormalTicketCreateInput } from "../ticket-domain/create-ticket.js";
import { editFormalTicketPostgres, type FormalTicketEditInput } from "../ticket-domain/edit-ticket.js";
import { assignFormalTicketPostgres } from "../ticket-domain/assign-ticket.js";
import { personalTicketRawCountReport } from "../ticket-domain/reports.js";
import { ticketOrgFormBootstrap, ticketOrganizationQualityReport } from "../ticket-domain/organization.js";
import { listNativeTickets, nativeTicketById, nativeTicketTimeline } from "../ticket-domain/read-tickets.js";

export const tasks = new Hono();

const STATUSES = new Set(["needs_clarification", "pending", "running", "waiting", "completed", "failed", "cancelled"]);
const EDITABLE_STATUSES = new Set([...STATUSES, "in_progress", "queued", "starting"]);
const PRIORITIES = new Set(["important_urgent", "important", "urgent", "normal", "low", "high", "medium"]);

/**
 * `GET /api/tasks` backs the employee task centre and the sidebar poller.
 * It must never pull an unbounded external receipt through the synchronous
 * PostgreSQL bridge: a historical 33 MB task payload made the whole employee
 * surface fail before the response could be projected. Full task payloads
 * remain available only through the explicit single-task detail route.
 */
export const MAX_TASK_LIST_TEXT_CHARS = 4_096;
export const MAX_TASK_LIST_ROWS = 200;

const TASK_LIST_TICKET_COLUMNS = `
  id, owner_user_id, task_type, title, source, status, priority, skill, profile,
  project_id, collaboration_id, session_id, due_at, last_acted_at, acknowledged_at,
  promoted_at, dismissed_at, started_at, completed_at, data_version, created_at,
  updated_at, kind, channel, requester_type, requester_id, object_type, object_id,
  kind_version, start_date, risk_level,
  substr(content, 1, ?) AS content, length(content) AS content_size,
  substr(input, 1, ?) AS input, length(input) AS input_size,
  substr(entities, 1, ?) AS entities, length(entities) AS entities_size
`;

const TASK_LIST_EVENT_COLUMNS = `
  id, work_item_id, run_id, sequence, event_type, event_class,
  substr(label, 1, ?) AS label, length(label) AS label_size,
  status, substr(safe_summary, 1, ?) AS safe_summary,
  length(safe_summary) AS safe_summary_size, time, created_at
`;

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
  const input: Json = {
    ...(body.input && typeof body.input === "object" ? body.input as Json : {}),
    ...(body.agent_id ? { agent_id: String(body.agent_id) } : {}),
    ...(body.attachments ? { attachments: body.attachments } : {}),
    ...(body.model_tier ? { model_tier: body.model_tier } : {}),
    ...(body.collaboration_id ? { collaboration_id: body.collaboration_id } : {}),
    ...(body.knowledge_id ? { knowledge_id: body.knowledge_id } : {}),
    ...(body.skill_template_version ? { skill_template_version: body.skill_template_version } : {}),
    ...(body.compose_input && typeof body.compose_input === "object" && !Array.isArray(body.compose_input)
      ? { compose_input: body.compose_input }
      : {}),
    ...((body.prompt || body.text) ? { prompt: String(body.prompt || body.text) } : {}),
  };
  delete input._skill_template;
  return input;
}

function resolutionIssueFields(resolution: ReturnType<typeof resolveTaskIntent>): string[] {
  return [...new Set([
    ...resolution.missing_fields,
    ...Object.keys(resolution.invalid_fields || {}),
  ])];
}

function publicWorkItem(row: Row, collab?: Row | null, definitions?: TaskDefinitionIndex, listReads?: {
  templates: Map<string, ReturnType<typeof skillTemplate>>;
  discoveryRuns: Map<string, string>;
  projects: Map<string, Row>;
}): Json {
  const definition = definitions ? definitions.get(String(row.task_type)) : taskDefinition(String(row.task_type));
  const input = parseJson(row.input) as Json;
  const templateId = String(row.task_type);
  const fallbackTemplate = () => {
    if (!definition) return null;
    if (!listReads) return skillTemplate(definition);
    if (!listReads.templates.has(templateId)) listReads.templates.set(templateId, skillTemplate(definition));
    return listReads.templates.get(templateId)!;
  };
  const template = isSkillTemplateSnapshot(input._skill_template, templateId)
    ? input._skill_template : fallbackTemplate();
  const { _skill_template: _internalTemplate, ...publicInput } = input;
  let project: string | null = collab?.display_name ? String(collab.display_name) : null;
  if (!project && row.project_id && !collab && listReads) {
    project = String(listReads.projects.get(String(row.project_id))?.display_name || "") || null;
  } else if (!project && row.project_id && !collab) {
    // Single-item paths only. List endpoints must pass the batched collab.
    const hit = getConn().prepare("SELECT display_name FROM collaborations WHERE id=?").get(row.project_id) as
      | { display_name?: string }
      | undefined;
    project = hit?.display_name || null;
  }
  const discoveryRun = listReads
    ? { id: listReads.discoveryRuns.get(String(row.id)) }
    : String(row.task_type) === "discovery_crawl"
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
    input: publicInput,
    skill_template: template,
    entities: parseJson(row.entities),
    ...(discoveryRun?.id ? { discovery_run_id: discoveryRun.id } : {}),
    ticket_id: String(row.id),
    ticket_kind: row.kind ? String(row.kind) : null,
    ticket_channel: row.channel ? String(row.channel) : null,
    ticket_status: ticketStatusFromWorkItem(String(row.status)),
    input_truncated: Number(row.input_size || 0) > String(row.input || "").length,
    entities_truncated: Number(row.entities_size || 0) > String(row.entities || "").length,
    content_truncated: Number(row.content_size || 0) > String(row.content || "").length,
  };
}

function lastEventsByWorkItem(ids: string[]): Map<string, Row> {
  const map = new Map<string, Row>();
  if (!ids.length) return map;
  const placeholders = ids.map(() => "?").join(",");
  const rows = getConn().prepare(
    `SELECT ${TASK_LIST_EVENT_COLUMNS.replaceAll("\n", " ")}
     FROM task_events
     WHERE (work_item_id, sequence) IN (
       SELECT work_item_id, MAX(sequence)
       FROM task_events WHERE work_item_id IN (${placeholders})
       GROUP BY work_item_id
     )`,
  ).all(MAX_TASK_LIST_TEXT_CHARS, MAX_TASK_LIST_TEXT_CHARS, ...ids) as Row[];
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

async function eventsByWorkItem(ids: string[], max = MAX_LIST_HISTORY_EVENTS): Promise<Map<string, Row[]>> {
  const map = new Map<string, Row[]>();
  if (!ids.length) return map;
  const rows = await postgresQuery<Row>(
    `SELECT event.* FROM unnest($1::text[]) AS requested(id)
     CROSS JOIN LATERAL (
       SELECT ${TASK_LIST_EVENT_COLUMNS.replaceAll("?", "$2")}
       FROM task_events WHERE work_item_id=requested.id ORDER BY sequence DESC LIMIT $3
     ) AS event ORDER BY event.work_item_id, event.sequence`,
    [ids, MAX_TASK_LIST_TEXT_CHARS, max],
  );
  for (const row of rows) {
    const id = String(row.work_item_id);
    const events = map.get(id) || [];
    events.push(row);
    map.set(id, events);
  }
  return map;
}

function collabsByIds(ids: string[]): Map<string, Row> {
  const map = new Map<string, Row>();
  if (!ids.length) return map;
  const placeholders = ids.map(() => "?").join(",");
  const rows = getConn().prepare(
    `SELECT id, handle, display_name, brand, owner_name, sku, qty,
            group_brand_overlap, substr(notes, 1, ?) AS notes,
            stage_code, days_in_stage
     FROM collaborations WHERE id IN (${placeholders})`,
  ).all(MAX_TASK_LIST_TEXT_CHARS, ...ids) as Row[];
  for (const row of rows) map.set(String(row.id), row);
  return map;
}

function eventView(event: Row): Json {
  return {
    id: event.id,
    type: event.event_type,
    event_class: event.event_class || "run_trace",
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

function decodeProjectionCursor(raw: string | undefined): { updated_at: string; id: string } | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as { updated_at?: unknown; id?: unknown };
    if (!value.updated_at || !value.id) throw new Error("invalid");
    return { updated_at: String(value.updated_at), id: String(value.id) };
  } catch {
    throw new HttpFail(400, "invalid cursor");
  }
}

function encodeProjectionCursor(row: Row): string {
  return Buffer.from(JSON.stringify({ updated_at: String(row.updated_at), id: String(row.id) })).toString("base64url");
}

function requestMetadata(): { request_id: string; as_of: string; schema_version: string } {
  return { request_id: nid("req"), as_of: nowIso(), schema_version: "ticket-api.v1" };
}

function ticketMissingFields(row: Row): string[] {
  const input = parseJson(row.input) as Json;
  const reasons = input.due_reason || input.due_reason_code;
  const fields: string[] = [];
  if (!String(row.title || "").trim()) fields.push("title");
  if (!String(row.owner_user_id || "").trim()) fields.push("assignment_ref");
  if (!row.object_type && !row.collaboration_id && !row.project_id) fields.push("object_ref");
  if (!row.due_at && !reasons) fields.push("due_at_or_reason");
  if (!input.acceptance_criteria) fields.push("acceptance_criteria");
  return fields;
}

function ticketAllowedActions(row: Row): string[] {
  return ticketAllowedLifecycleActions(row);
}

function ticketSourceRefs(row: Row): Json[] {
  const refs: Json[] = [{ type: "ticket", id: String(row.id), version: Number(row.data_version || 1) }];
  if (row.collaboration_id) refs.push({ type: "collaboration", id: String(row.collaboration_id) });
  if (row.project_id && String(row.project_id) !== String(row.collaboration_id || "")) {
    refs.push({ type: "project", id: String(row.project_id) });
  }
  return refs;
}

function ticketView(row: Row, definitions?: TaskDefinitionIndex, collab?: Row | null): Json {
  const resolvedCollab = collab === undefined && (row.collaboration_id || row.project_id)
    ? (getConn().prepare("SELECT * FROM collaborations WHERE id=?").get(row.collaboration_id || row.project_id) as Row | undefined)
    : collab || undefined;
  const base = decorateTaskFromCollab(publicWorkItem(row, resolvedCollab || null, definitions), resolvedCollab);
  return {
    ...base,
    ticket_id: String(row.id),
    missing_fields: ticketMissingFields(row),
    allowed_actions: ticketAllowedActions(row),
    source_refs: ticketSourceRefs(row),
  };
}

function ownedWorkItem(id: string): Row {
  const row = getConn().prepare("SELECT * FROM tickets WHERE id=?").get(id) as Row | undefined;
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
    db.prepare(`UPDATE tickets SET ${sets.join(",")},updated_at=?,data_version=data_version+1 WHERE id=?`)
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

function createWorkItem(body: Json, source: string): Json {
  const explicitType = String(body.task_type || body.definition_id || body.intent || "");
  const definition = taskDefinition(explicitType);
  if (!definition) throw new HttpFail(400, { code: "unknown_task_type", task_type: explicitType });
  requireSkill(definition.id);
  const input = taskInput(body);
  if (!(isTestRuntime() && codexMode() === "stub" && !scopedUser() && !input.agent_id)) {
    input.agent_id = String(input.agent_id || runtimeAgentForSkill(definition.id, ownerId(), { employeeChoice: true }));
    assertRuntimeSkill({ agentId: String(input.agent_id), skillId: definition.id, userId: ownerId(), runId: "task-submission" });
  }
  const template = skillTemplate(definition);
  if (input.skill_template_version && input.skill_template_version !== template.version) {
    throw new HttpFail(409, { code: "skill_template_version_conflict", message: "技能模板已更新，请刷新模板并检查参数后再提交。" });
  }
  input._skill_template = template;
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
      `INSERT INTO tickets
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
    ensureTicketForWorkItem(id, { conn: db });
    appendTaskEventInConn(
      db,
      id,
      null,
      "task.created",
      definition.title,
      status,
      resolution.missing_fields.length ? `缺少：${formatMissingFields(resolution.missing_fields)}` : "任务已创建",
    );
  });
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
  return c.json(taskDefinitions().map((definition) => {
    const { path: _path, ...publicDefinition } = definition;
    return {
      ...publicDefinition,
      skill: definition.id,
      skill_id: definition.id,
      granted: granted.has(definition.id),
      ...(granted.has(definition.id) && definition.employee_visible ? { ui_template: skillTemplate(definition) } : {}),
    };
  }));
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
 * Cheap "did anything the list reads change" fingerprint. Keep it portable
 * across SQLite and PostgreSQL: task event count catches every append and the
 * latest creation time provides a readable companion value. Any write that
 * moves it drops the cached projection immediately instead of waiting out TTL.
 */
function tasksEpoch(): string {
  const row = getConn().prepare(
    `SELECT (SELECT COUNT(*) FROM task_events) AS event_count,
            (SELECT MAX(created_at) FROM task_events) AS event_updated_at,
            (SELECT MAX(updated_at) FROM tickets) AS work_items,
            (SELECT COUNT(*) FROM tickets) AS work_item_count,
            (SELECT COUNT(*) FROM collaborations) AS collaborations`,
  ).get() as { event_count: number; event_updated_at: string | null; work_items: string | null; work_item_count: number; collaborations: number };
  return pollEpoch([row.event_count, row.event_updated_at, row.work_items, row.work_item_count, row.collaborations]);
}

/** Canonical employee task projection. Today is deliberately a subset of todo. */
tasks.get("/workbench/tasks", (c) => {
  const view = String(c.req.query("view") || "");
  if (view !== "today" && view !== "todo") throw new HttpFail(400, "view must be today or todo");
  const limit = parseLimit(c.req.query("limit"));
  const cursor = decodeProjectionCursor(c.req.query("cursor"));
  const owner = ownerId();
  const todoCount = getConn().prepare(`SELECT COUNT(*) AS count FROM tickets WHERE owner_user_id=? AND ${TODO_WORK_ITEM_SQL}`)
    .get(owner) as { count: number };
  // Today is currently evaluated by a versioned server predicate rather than a
  // SQL business rule. Scan bounded raw chunks until this filtered page is full;
  // the cursor remains the last emitted ticket so no non-matching raw row can
  // make a later matching ticket disappear between pages.
  const rows: Row[] = [];
  let scanCursor = cursor;
  let exhausted = false;
  const rawChunk = Math.max(limit + 1, 200);
  while (!exhausted && rows.length < limit + 1) {
    const clauses = ["owner_user_id=?", TODO_WORK_ITEM_SQL];
    const values: unknown[] = [owner];
    if (scanCursor) {
      clauses.push("(updated_at < ? OR (updated_at = ? AND id < ?))");
      values.push(scanCursor.updated_at, scanCursor.updated_at, scanCursor.id);
    }
    const batch = getConn().prepare(
      `SELECT * FROM tickets WHERE ${clauses.join(" AND ")} ORDER BY updated_at DESC, id DESC LIMIT ?`,
    ).all(...values, rawChunk) as Row[];
    if (!batch.length) {
      exhausted = true;
      break;
    }
    for (const row of batch) {
      if (view === "todo" || todayMembershipReasons(row).length > 0) rows.push(row);
      scanCursor = { updated_at: String(row.updated_at), id: String(row.id) };
      if (rows.length >= limit + 1) break;
    }
    if (batch.length < rawChunk) exhausted = true;
  }
  const page = rows.slice(0, limit);
  const collabs = collabsByIds(page.map((row) => String(row.project_id || "")).filter(Boolean));
  const definitions = taskDefinitionIndex();
  const items = page
    .map((row) => {
      const reasons = todayMembershipReasons(row);
      const projected = decorateTaskFromCollab(publicWorkItem(row, collabs.get(String(row.project_id || "")) || null, definitions), collabs.get(String(row.project_id || "")));
      return {
        ...projected,
        plan_view: reasons.length ? "today" : "todo",
        is_today: reasons.length > 0,
        membership_reason: reasons,
        source_ref: { ticket_id: String(row.id), data_version: Number(row.data_version || 1) },
      };
    });
  const hasMore = rows.length > limit || !exhausted;
  const meta = requestMetadata();
  c.header("Cache-Control", "no-store");
  return c.json({
    items,
    page: { limit, next_cursor: hasMore && page.length ? encodeProjectionCursor(page.at(-1)!) : null, total_estimate: Number(todoCount.count || 0) },
    ...meta,
    evaluated_at: meta.as_of,
    timezone: c.req.query("timezone") || "Asia/Shanghai",
    projection_version: "task-workbench.v1",
    source_refs: [{ type: "ticket_projection", version: "task-workbench.v1" }],
  });
});

function ticketObjectRef(raw: string | undefined): { type: string; id: string } | null {
  if (!raw) return null;
  const pivot = raw.indexOf(":");
  if (pivot < 1 || pivot === raw.length - 1) throw new HttpFail(400, "object_ref must be type:id");
  return { type: raw.slice(0, pivot), id: raw.slice(pivot + 1) };
}

function taskRunView(run: Row): Json {
  return {
    run_id: String(run.id),
    id: String(run.id),
    ticket_id: String(run.work_item_id),
    session_id: run.session_id || null,
    thread_id: run.thread_id || null,
    turn_id: run.turn_id || null,
    worker_id: run.worker_id || null,
    status: String(run.status),
    input: parseJson(run.input),
    entities: parseJson(run.entities),
    error: run.error ? parseJson(run.error) : null,
    created_at: run.created_at,
    started_at: run.started_at || null,
    completed_at: run.completed_at || null,
  };
}

function runEventView(event: Row, run: Row, ticket: Row): Json {
  return {
    event_id: String(event.id), sequence: Number(event.sequence), occurred_at: event.time, received_at: event.created_at,
    run_id: String(run.id), ticket_id: String(ticket.id), type: event.event_type, phase: "task_run",
    event_class: event.event_class || "run_trace", status: event.status, safe_summary: event.safe_summary || null, label: event.label,
  };
}

function runEventsAfter(ticketId: string, runId: string, after: number, limit: number): Row[] {
  return getConn().prepare(
    "SELECT * FROM task_events WHERE work_item_id=? AND run_id=? AND sequence>? ORDER BY sequence LIMIT ?",
  ).all(ticketId, runId, after, limit) as Row[];
}

function streamAfter(c: { req: { query(name: string): string | undefined; header(name: string): string | undefined } }): number {
  const raw = c.req.query("after") ?? c.req.header("Last-Event-ID") ?? "0";
  const after = Math.max(0, Number(raw));
  if (!Number.isFinite(after) || !Number.isInteger(after)) throw new HttpFail(400, "invalid after");
  return after;
}

const TERMINAL_RUN_STATUSES = new Set(["succeeded", "completed", "failed", "cancelled", "stopped", "needs_takeover"]);

function ownedTaskRun(runId: string): { run: Row; ticket: Row } {
  const row = getConn().prepare(
    `SELECT tr.*, t.owner_user_id AS ticket_owner_user_id
       FROM task_runs tr JOIN tickets t ON t.id=tr.work_item_id WHERE tr.id=?`,
  ).get(runId) as Row | undefined;
  if (!row || (!isAdmin() && String(row.ticket_owner_user_id) !== ownerId())) throw new HttpFail(404, "run not found");
  const ticket = getConn().prepare("SELECT * FROM tickets WHERE id=?").get(row.work_item_id) as Row | undefined;
  if (!ticket) throw new HttpFail(404, "ticket not found");
  return { run: row, ticket };
}

function ticketSummaryView(ticket: Row): Json {
  const latestEvent = getConn().prepare(
    "SELECT id,sequence,event_type,label,status,safe_summary,time FROM task_events WHERE work_item_id=? ORDER BY sequence DESC LIMIT 1",
  ).get(ticket.id) as Row | undefined;
  const latestArtifact = getConn().prepare(
    "SELECT id,version,artifact_type,created_at FROM task_artifacts WHERE work_item_id=? ORDER BY created_at DESC LIMIT 1",
  ).get(ticket.id) as Row | undefined;
  const input = parseJson(ticket.input) as Json;
  const goal = String(ticket.content || input.goal || input.prompt || ticket.title || "");
  return {
    ticket_id: String(ticket.id),
    goal,
    progress: ticketStatusFromWorkItem(String(ticket.status)) || String(ticket.status),
    risk: String(ticket.risk_level || "none"),
    conclusion: latestEvent?.safe_summary || latestEvent?.label || null,
    evidence_refs: [
      ...(latestEvent ? [{ type: "task_event", id: String(latestEvent.id), sequence: Number(latestEvent.sequence) }] : []),
      ...(latestArtifact ? [{ type: "task_artifact", id: String(latestArtifact.id), version: Number(latestArtifact.version || 1) }] : []),
    ],
    source_fingerprint: `ticket:${ticket.id}:v${Number(ticket.data_version || 1)}:event:${latestEvent?.sequence || 0}:artifact:${latestArtifact?.version || 0}`,
    producer: "rule",
    status: "current",
    stale_reason: null,
    generated_at: ticket.updated_at,
  };
}

/**
 * The employee ticket centre reads only the PostgreSQL formal-ticket model.
 * This intentionally does not fall back to legacy work-item projections.
 */
tasks.get("/tickets", async (c) => {
  const page = await listNativeTickets(ownerId(), {
    view: c.req.query("view"),
    cursor: c.req.query("cursor"),
    limit: c.req.query("limit"),
    status: c.req.query("status"),
    priority: c.req.query("priority"),
    category: c.req.query("category"),
    stage: c.req.query("stage"),
    org_unit: c.req.query("org_unit"),
    assignee: c.req.query("assignee"),
    due: c.req.query("due"),
    q: c.req.query("q"),
    from: c.req.query("from"),
    to: c.req.query("to"),
  });
  return c.json({ ...page, ...requestMetadata() });
});

/** Personal scope only: raw persisted ticket counts, never an SLA or employee
 * performance score. This route must precede `/tickets/:id`. */
tasks.get("/tickets/reports/personal", async (c) => {
  return c.json({ ...(await personalTicketRawCountReport(ownerId(), c.req.query("timezone") || "Asia/Shanghai")), ...requestMetadata() });
});

/**
 * Native PostgreSQL form contract for employee-created formal tickets. It
 * deliberately exposes organization data-quality failures instead of silently
 * guessing a creator, assignee, or supervisory watcher.
 */
tasks.get("/tickets/form-bootstrap", async (c) => {
  const meta = requestMetadata();
  return c.json({
    ...(await ticketOrgFormBootstrap(ownerId())),
    ...meta,
  });
});

/** Missing organization facts are management data-quality work, never an
 * employee-side fallback that fabricates responsibility or supervision. */
tasks.get("/admin/work-orders/data-quality", async (c) => {
  if (!isAdmin()) throw new HttpFail(403, "admin required");
  return c.json({ ...(await ticketOrganizationQualityReport()), ...requestMetadata() });
});

/**
 * Formal employee ticket creation. This path is PostgreSQL-native and writes
 * the ticket, immutable lifecycle fact, assignment, watcher, organization
 * scope, basis references and idempotent receipt atomically.
 */
tasks.post("/tickets", async (c) => {
  const body = await c.req.json().catch(() => ({})) as FormalTicketCreateInput;
  const headerKey = String(c.req.header("Idempotency-Key") || "").trim();
  const result = await createFormalTicketPostgres(ownerId(), {
    ...body,
    idempotency_key: headerKey || body.idempotency_key,
  });
  return c.json({ ...result, ...requestMetadata() }, result.replayed ? 200 : 201);
});

tasks.get("/tickets/:id/summary", async (c) => {
  const ticket = await nativeTicketById(ownerId(), c.req.param("id"));
  return c.json({
    ticket_id: ticket.id,
    goal: ticket.goal || ticket.title,
    progress: ticket.status,
    risk: "none",
    conclusion: null,
    evidence_refs: [],
    source_fingerprint: `ticket:${ticket.id}:v${ticket.data_version}`,
    producer: "postgresql_ticket_center",
    status: "current",
    stale_reason: null,
    generated_at: ticket.updated_at,
    ...requestMetadata(),
    source_refs: ticket.source_refs,
  });
});

tasks.get("/tickets/:id/timeline", async (c) => {
  const after = Math.max(0, Number(c.req.query("after") || 0));
  if (!Number.isFinite(after) || !Number.isInteger(after)) throw new HttpFail(400, "invalid after");
  const limit = parseLimit(c.req.query("limit"), 100);
  const timeline = await nativeTicketTimeline(ownerId(), c.req.param("id"), after, limit);
  return c.json({ ...timeline, related_business_events: [], ...requestMetadata(), source_refs: [{ type: "postgresql_ticket_timeline", id: timeline.ticket_id }] });
});

tasks.get("/tickets/:id", async (c) => {
  const ticket = await nativeTicketById(ownerId(), c.req.param("id"));
  return c.json({
    ...ticket,
    latest_run: null,
    summary: {
      ticket_id: ticket.id,
      goal: ticket.goal || ticket.title,
      progress: ticket.status,
      risk: "none",
      conclusion: null,
      evidence_refs: [],
      source_fingerprint: `ticket:${ticket.id}:v${ticket.data_version}`,
      producer: "postgresql_ticket_center",
      status: "current",
      stale_reason: null,
      generated_at: ticket.updated_at,
    },
    ...requestMetadata(),
  });
});

/** Pending-ticket business edits are PostgreSQL-native, versioned and auditable.
 * Status, acceptance and assignment deliberately remain separate commands. */
tasks.patch("/tickets/:id", async (c) => {
  const ticket = await nativeTicketById(ownerId(), c.req.param("id"));
  if (!ticket.allowed_actions.includes("edit")) throw new HttpFail(409, { code: "ticket_edit_not_allowed" });
  const body = await c.req.json().catch(() => ({})) as FormalTicketEditInput;
  const idempotencyKey = String(c.req.header("Idempotency-Key") || body.idempotency_key || "").trim();
  const result = await editFormalTicketPostgres(ticket.id, ownerId(), { ...body, idempotency_key: idempotencyKey });
  return c.json({ ...result, ticket: await nativeTicketById(ownerId(), ticket.id), ...requestMetadata() });
});

tasks.post("/tickets/:id/commands", async (c) => {
  const ticket = await nativeTicketById(ownerId(), c.req.param("id"));
  const body = await c.req.json().catch(() => ({})) as Json;
  const action = String(body.action || "");
  if (action !== "assign" && action !== "accept" && action !== "complete" && action !== "cancel" && action !== "reopen") {
    throw new HttpFail(409, { code: "action_not_enabled", message: "当前仅支持转办、受理、完成、取消或重开工单命令" });
  }
  const requiredAction = action === "complete" ? "complete" : action;
  if (!ticket.allowed_actions.includes(requiredAction)) {
    throw new HttpFail(403, { code: "ticket_command_not_authorized", action, required_action: requiredAction });
  }
  const idempotencyKey = String(c.req.header("Idempotency-Key") || body.idempotency_key || "").trim();
  const expectedVersion = Number(body.expected_version);
  if (action === "assign") {
    const result = await assignFormalTicketPostgres({
      ticket_id: ticket.id,
      actor_user_id: ownerId(),
      expected_version: expectedVersion,
      idempotency_key: idempotencyKey,
      assignee_person_ref: String(body.assignee_person_ref || ""),
      assignee_unit_id: String(body.assignee_unit_id || ""),
      cross_group_reason: body.cross_group_reason == null ? null : String(body.cross_group_reason),
    });
    return c.json({ ...result, ticket: await nativeTicketById(ownerId(), ticket.id), ...requestMetadata() });
  }
  const transitionInput = {
    ticketId: ticket.id,
    action: action as "accept" | "complete" | "cancel" | "reopen",
    expectedVersion,
    idempotencyKey,
    actorId: ownerId(),
    acceptanceEvidence: body.acceptance_evidence,
    reason: body.reason,
  };
  const result = await transitionTicketLifecyclePostgres(transitionInput);
  return c.json({ ...result, ticket: await nativeTicketById(ownerId(), ticket.id), ...requestMetadata() });
});

tasks.get("/runs/:id/events", (c) => {
  const { run, ticket } = ownedTaskRun(c.req.param("id"));
  const after = Math.max(0, Number(c.req.query("after") || 0));
  if (!Number.isFinite(after)) throw new HttpFail(400, "invalid after");
  const limit = parseLimit(c.req.query("limit"), 100);
  const events = runEventsAfter(String(ticket.id), String(run.id), after, limit);
  const meta = requestMetadata();
  return c.json({
    run_id: String(run.id), ticket_id: String(ticket.id),
    items: events.map((event) => runEventView(event, run, ticket)),
    next_sequence: events.length ? Number(events.at(-1)?.sequence || after) : after,
    ...meta,
  });
});

/**
 * Durable run-event stream. The database remains the source of truth: an SSE
 * reconnect supplies `Last-Event-ID` (or `after`) and receives every later
 * immutable task_event in sequence order. This deliberately avoids in-process
 * pub/sub, which would lose events on API restarts or across PostgreSQL nodes.
 */
tasks.get("/runs/:id/stream", (c) => {
  const { run, ticket } = ownedTaskRun(c.req.param("id"));
  let cursor = streamAfter(c);
  const initial = runEventsAfter(String(ticket.id), String(run.id), cursor, 200);
  if (initial.length) cursor = Number(initial.at(-1)?.sequence || cursor);
  const meta = requestMetadata();
  return new Response(new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      let polling = false;
      const send = (event: string, payload: unknown, id?: number) => {
        if (closed) return;
        const prefix = id == null ? "" : `id: ${id}\n`;
        controller.enqueue(encoder.encode(`${prefix}event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
      };
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(poll);
        try { controller.close(); } catch { /* stream is already closed */ }
      };
      const pollOnce = async () => {
        if (closed || polling) return;
        polling = true;
        try {
          const rows = runEventsAfter(String(ticket.id), String(run.id), cursor, 200);
          for (const event of rows) {
            const item = runEventView(event, run, ticket);
            cursor = Number(item.sequence || cursor);
            send("task_event", item, cursor);
          }
          const current = getConn().prepare("SELECT status,completed_at,error FROM task_runs WHERE id=?").get(run.id) as Row | undefined;
          if (current && TERMINAL_RUN_STATUSES.has(String(current.status || ""))) {
            send("terminal", { run_id: String(run.id), status: String(current.status), completed_at: current.completed_at || null, error: current.error || null, next_sequence: cursor });
            close();
          }
        } catch {
          send("stream_error", { code: "run_stream_unavailable", next_sequence: cursor });
          close();
        } finally {
          polling = false;
        }
      };
      send("snapshot", {
        run: taskRunView(run), ticket_id: String(ticket.id),
        items: initial.map((event) => runEventView(event, run, ticket)),
        next_sequence: cursor, ...meta,
      });
      const poll = setInterval(() => { void pollOnce(); }, 1_000);
      void pollOnce();
      c.req.raw.signal.addEventListener("abort", close);
    },
    cancel() {
      // The request abort listener clears the timer and closes the stream.
    },
  }), {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
});

tasks.get("/runs/:id", (c) => {
  const { run, ticket } = ownedTaskRun(c.req.param("id"));
  const meta = requestMetadata();
  return c.json({ ...taskRunView(run), ...meta, source_refs: ticketSourceRefs(ticket) });
});

tasks.get("/tasks", async (c) => {
  const view = String(c.req.query("view") || "");
  const requestedPeriod = c.req.query("period");
  const reportPeriod = requestedPeriod ? taskOperationsPeriod(requestedPeriod) : null;
  const openView = view === "open" || view === "todo" || view === "active";
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
  if (view === "active") clauses.push("status IN ('pending','queued','running','starting','in_progress','waiting','waiting_approval')");
  const sort = c.req.query("sort") || "updated_desc";
  const order: Record<string, string> = {
    updated_desc: "updated_at DESC",
    updated_asc: "updated_at ASC",
    due_asc: "due_at IS NULL, due_at ASC",
    priority_desc: "CASE priority WHEN 'important_urgent' THEN 5 WHEN 'important' THEN 4 WHEN 'high' THEN 4 WHEN 'urgent' THEN 3 WHEN 'normal' THEN 2 WHEN 'medium' THEN 2 ELSE 1 END DESC, updated_at DESC",
  };
  if (!order[sort]) throw new HttpFail(400, "invalid sort");
  const cursor = decodeProjectionCursor(c.req.query("cursor"));
  if (cursor && openView) {
    throw new HttpFail(400, "cursor pagination is available from the task center history view");
  }
  if (cursor && sort !== "updated_desc") {
    throw new HttpFail(400, "cursor pagination currently requires updated_desc sort");
  }
  const queryText = String(c.req.query("q") || "").trim().slice(0, 200);
  if (queryText) {
    clauses.push("(title LIKE ? COLLATE NOCASE OR content LIKE ? COLLATE NOCASE)");
    const like = `%${queryText.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    values.push(like, like);
  }
  const from = String(c.req.query("from") || "").trim();
  if (from) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new HttpFail(400, "invalid from date");
    clauses.push("created_at>=?");
    values.push(`${from}T00:00:00.000Z`);
  }
  const to = String(c.req.query("to") || "").trim();
  if (to) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new HttpFail(400, "invalid to date");
    clauses.push("created_at<?");
    values.push(`${to}T23:59:59.999Z`);
  }
  if (reportPeriod && reportPeriod !== "realtime") {
    if (from || to) throw new HttpFail(400, "period cannot be combined with manual date range");
    const range = taskOperationsDashboardRanges(reportPeriod, new Date(), "Asia/Shanghai").current!;
    clauses.push("((created_at>=? AND created_at<?) OR (completed_at>=? AND completed_at<?))");
    values.push(range.start.toISOString(), range.end.toISOString(), range.start.toISOString(), range.end.toISOString());
  }
  const countWhere = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const countValues = [...values];
  if (cursor) {
    clauses.push("(updated_at < ? OR (updated_at = ? AND id < ?))");
    values.push(cursor.updated_at, cursor.updated_at, cursor.id);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  // A list projection is not an export endpoint. Keeping it bounded protects
  // every employee poller from one pathological historical row and keeps the
  // response below the PostgreSQL synchronous-bridge transport budget.
  const limit = parseLimit(c.req.query("limit"), openView ? 50 : MAX_TASK_LIST_ROWS);
  const paged = !openView && (c.req.query("cursor") !== undefined || c.req.query("limit") !== undefined);
  // This endpoint is polled every few seconds by every open tab, so an
  // unchanged data window is served from the 4s in-process cache.
  const cacheKey = `tasks:${owner}:${view}:${sort}:${limit}:${cursor ? c.req.query("cursor") : ""}:${queryText}:${from}:${to}:${reportPeriod || ""}:${c.req.query("status") || ""}:${c.req.query("priority") || ""}:${c.req.query("source") || ""}:${c.req.query("profile") || ""}`;
  const payload = await cachedPollAsync(cacheKey, tasksEpoch(), async () => {
    const definitions = taskDefinitionIndex();
    const total = paged || openView
      ? Number((getConn().prepare(`SELECT COUNT(*) AS c FROM tickets ${countWhere}`).get(...countValues) as { c: number }).c || 0)
      : 0;
    const fetched = getConn().prepare(
      `SELECT ${TASK_LIST_TICKET_COLUMNS.replaceAll("\n", " ")}
       FROM tickets ${where} ORDER BY ${order[sort]} LIMIT ?`,
    ).all(
      MAX_TASK_LIST_TEXT_CHARS,
      MAX_TASK_LIST_TEXT_CHARS,
      MAX_TASK_LIST_TEXT_CHARS,
      ...values,
      paged ? limit + 1 : limit,
    ) as Row[];
    const hasMore = paged && fetched.length > limit;
    const rows = paged ? fetched.slice(0, limit) : fetched;
    const ids = rows.map((row) => String(row.id));
    const lastByTask = openView ? lastEventsByWorkItem(ids) : new Map<string, Row>();
    const eventsByTask = openView ? new Map<string, Row[]>() : await eventsByWorkItem(ids);
    const collabIds = [...new Set(rows.flatMap((row) => [String(row.collaboration_id || ""), String(row.project_id || "")]).filter(Boolean))];
    const collabById = collabsByIds(collabIds);
    const discoveryIds = rows.filter((row) => row.task_type === "discovery_crawl").map((row) => String(row.id));
    const discoveryRows = discoveryIds.length ? await postgresQuery<Row>(
      `SELECT DISTINCT ON (work_item_id) work_item_id, id FROM discovery_runs
       WHERE work_item_id=ANY($1::text[]) AND kind='home' ORDER BY work_item_id, created_at DESC`,
      [discoveryIds],
    ) : [];
    const listReads = {
      templates: new Map<string, ReturnType<typeof skillTemplate>>(),
      discoveryRuns: new Map(discoveryRows.map((row) => [String(row.work_item_id), String(row.id)])),
      projects: collabById,
    };
    const list = rows.map((row) => {
      const collab = collabById.get(String(row.collaboration_id || row.project_id || ""));
      const events = openView
        ? (lastByTask.get(String(row.id)) ? [eventView(lastByTask.get(String(row.id))!)] : [])
        : (eventsByTask.get(String(row.id)) || []).map(eventView);
      return decorateTaskFromCollab({
        ...publicWorkItem(row, collab, definitions, listReads),
        ...(openView ? {} : { history: events }),
        history_summary: historySummary(events),
      }, collab);
    });
    if (paged) {
      const meta = requestMetadata();
      return {
        items: list,
        page: { limit, next_cursor: hasMore && rows.length ? encodeProjectionCursor(rows.at(-1)!) : null, total },
        ...meta,
        source_refs: [{ type: "ticket_projection", version: "task-list.v1" }],
      };
    }
    if (!openView) return list;
    return {
      view: view === "todo" ? "todo" : view === "active" ? "active" : "open",
      tasks: list.filter((task) => isOpenWorkItem(task)),
      total,
      limit,
      creates_session: false,
      entry: "memory",
    };
  });
  return c.json(payload);
});

/**
 * Read-only operational dashboard for the same Agent/system-task projection
 * used by GET /api/tasks. It deliberately remains in this router so the KPI
 * and the task table share one authorization boundary and one source of truth.
 */
tasks.get("/tasks/operations-dashboard", (c) => {
  const period = taskOperationsPeriod(c.req.query("period"));
  const queryText = String(c.req.query("q") || "").trim().slice(0, 200);
  const scoped = !isAdmin() || c.req.query("scope") !== "all";
  const owner = scoped ? ownerId() : "all";
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (scoped) {
    clauses.push("owner_user_id=?");
    values.push(owner);
  }
  if (queryText) {
    clauses.push("(title LIKE ? COLLATE NOCASE OR content LIKE ? COLLATE NOCASE)");
    const like = `%${queryText.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    values.push(like, like);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const cacheKey = `task-operations:${owner}:${period}:${queryText}`;
  const payload = cachedPoll(cacheKey, tasksEpoch(), () => {
    const rows = getConn().prepare(
      `SELECT id,task_type,title,status,due_at,created_at,completed_at,updated_at
       FROM tickets ${where}`,
    ).all(...values) as TaskOperationsRow[];
    const dashboard = buildTaskOperationsDashboard(rows, { period, timezone: "Asia/Shanghai", scope: scoped ? "personal" : "organization" });
    return {
      ...dashboard,
      task_types: dashboard.task_types.slice(0, 8).map((item) => ({
        ...item,
        title: taskDefinition(item.task_type)?.title || "系统任务",
      })),
      ...requestMetadata(),
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
    "SELECT * FROM tickets WHERE owner_user_id=? AND dismissed_at IS NULL ORDER BY updated_at DESC",
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
          "UPDATE tickets SET promoted_at=COALESCE(promoted_at,?),dismissed_at=NULL,title=CASE WHEN ?!='' THEN ? ELSE title END,updated_at=?,data_version=data_version+1 WHERE id=?",
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
      "UPDATE tickets SET promoted_at=COALESCE(promoted_at,?),dismissed_at=NULL,updated_at=? WHERE id=?",
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
    agent_id: body.agent_id ? String(body.agent_id) : undefined,
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
    agent_id: body.agent_id ? String(body.agent_id) : undefined,
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
    agent_id: resolution.agent_id,
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

async function executionView(row: Row) {
  const runs = await postgresQuery<Row>(
    "SELECT id,status FROM task_runs WHERE work_item_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1", [row.id],
  );
  return taskExecutionView(String(row.status), taskDefinition(String(row.task_type))?.side_effects,
    runs[0] ? { id: runs[0].id, status: runs[0].status } : null);
}

tasks.get("/tasks/by-session/:sid", async (c) => {
  const row = getConn().prepare(
    "SELECT * FROM tickets WHERE session_id=? ORDER BY updated_at DESC LIMIT 1",
  ).get(c.req.param("sid")) as Row | undefined;
  if (!row) throw new HttpFail(404, "task not found");
  const owned = ownedWorkItem(String(row.id));
  return c.json({ ...publicWorkItem(owned), execution: await executionView(owned) });
});

tasks.get("/tasks/:id", async (c) => {
  const row = ownedWorkItem(c.req.param("id"));
  const runs = getConn().prepare("SELECT * FROM task_runs WHERE work_item_id=? ORDER BY created_at").all(row.id) as Row[];
  const artifacts = getConn().prepare(
    "SELECT * FROM task_artifacts WHERE work_item_id=? ORDER BY created_at",
  ).all(row.id) as Row[];
  return c.json({
    ...publicWorkItem(row),
    execution: await executionView(row),
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
  const template = skillTemplate(definition);
  if (isSkillTemplateSnapshot(storedInput._skill_template, definition.id)
    && storedInput._skill_template.version !== template.version) {
    throw new HttpFail(409, { code: "skill_template_version_conflict", message: "此任务的技能模板已更新，请重新选用模板并检查参数后创建任务。" });
  }
  const runInput = {
    ...storedInput,
    ...((body.input as Json) || {}),
    _skill_template: template,
    ...(body.compose_input && typeof body.compose_input === "object" && !Array.isArray(body.compose_input)
      ? { compose_input: body.compose_input }
      : {}),
  };
  const runText = String(body.text || storedInput.prompt || item.title);
  if (storedInput.agent_id && (runInput as Json).agent_id !== storedInput.agent_id) throw new HttpFail(409, "任务已绑定其他智能体");
  if (!(isTestRuntime() && codexMode() === "stub" && !scopedUser() && !(runInput as Json).agent_id)) {
    const runAgentId = String((runInput as Json).agent_id || storedInput.agent_id || runtimeAgentForSkill(definition.id, ownerId(), { employeeChoice: true }));
    assertRuntimeSkill({ agentId: runAgentId, skillId: definition.id, userId: ownerId(), runId: "task-run" });
    (runInput as Json).agent_id = runAgentId;
  }
  const resolution = resolveTaskIntent({
    text: runText,
    task_type: definition.id,
    entities: { ...(parseJson(item.entities) as Json), ...((body.entities as Json) || {}) },
    input: runInput,
  });
  if (resolution.needs_clarification) {
    getConn().prepare("UPDATE tickets SET status='needs_clarification',updated_at=? WHERE id=?")
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
    db.prepare("UPDATE tickets SET session_id=?,input=?,status='pending',updated_at=?,data_version=data_version+1 WHERE id=?")
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
      `UPDATE tickets
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
      "UPDATE tickets SET promoted_at=COALESCE(promoted_at,?),dismissed_at=NULL,updated_at=?,data_version=data_version+1 WHERE id=?",
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
      "UPDATE tickets SET dismissed_at=COALESCE(dismissed_at,?),updated_at=?,data_version=data_version+1 WHERE id=?",
    ).run(now, now, item.id);
  });
  if (!item.dismissed_at) {
    appendTaskEvent(String(item.id), null, "task.dismissed", "忽略建议", String(item.status), "已从今日任务中移除");
    audit(ownerId(), "task.dismissed", { work_item_id: item.id });
  }
  return c.json(publicWorkItem(ownedWorkItem(String(item.id))));
});

/** The PostgreSQL ticket command is the only lifecycle write path. */
tasks.post("/tasks/:id/cancel", (c) => {
  throw new HttpFail(410, {
    code: "legacy_write_endpoint_retired",
    message: "旧任务取消端点已停用；请使用 POST /api/tickets/:id/commands。",
    migrate_to: "/api/tickets/:id/commands",
  });
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
  ownedWorkItem(c.req.param("id"));
  throw new HttpFail(410, {
    code: "legacy_write_endpoint_retired",
    message: "旧任务完成端点已停用；请使用带验收证据、版本和幂等键的 /api/tickets/:id/commands。",
    migrate_to: "/api/tickets/:id/commands",
  });
});
