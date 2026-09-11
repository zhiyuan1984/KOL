import { Hono } from "hono";
import { authDisabled, isAdmin, requireSkill, scopedUser } from "../auth.js";
import { DEMO_USER } from "../config.js";
import { audit, getConn, nowIso, tx } from "../db.js";
import { HttpFail } from "../host/errors.js";
import { nid } from "../ids.js";
import type { Json, Row } from "../types.js";
import { recognizeTaskIntent } from "../tasks/recognize.js";
import { resolveTaskIntent } from "../tasks/resolver.js";
import { taskDefinition, taskDefinitions } from "../tasks/registry.js";
import { historySummary, decorateTaskFromCollab } from "../host/home-board.js";
import { formatMissingFields, missingFieldsMessage } from "../labels.js";

export const tasks = new Hono();

const STATUSES = new Set(["needs_clarification", "pending", "running", "waiting", "completed", "failed", "cancelled"]);
const PRIORITIES = new Set(["low", "normal", "high", "urgent"]);

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
    ...((body.prompt || body.text) ? { prompt: String(body.prompt || body.text) } : {}),
  };
}

function publicWorkItem(row: Row): Json {
  const definition = taskDefinition(String(row.task_type));
  const project = row.project_id
    ? getConn().prepare("SELECT display_name FROM collaborations WHERE id=?").get(row.project_id) as { display_name?: string } | undefined
    : undefined;
  return {
    ...row,
    description: definition?.description || "",
    suggested_actions: definition?.actions || [],
    project: project?.display_name || null,
    input: parseJson(row.input),
    entities: parseJson(row.entities),
  };
}

function ownedWorkItem(id: string): Row {
  const row = getConn().prepare("SELECT * FROM work_items WHERE id=?").get(id) as Row | undefined;
  if (!row) throw new HttpFail(404, "task not found");
  if (!isAdmin() && String(row.owner_user_id) !== ownerId()) throw new HttpFail(404, "task not found");
  return row;
}

export function appendTaskEvent(
  workItemId: string,
  runId: string | null,
  eventType: string,
  label: string,
  status: string,
  safeSummary?: string,
): Row {
  return tx((db) => {
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
}

function createWorkItem(body: Json, source: string): Json {
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
  const status = resolution.needs_clarification ? "needs_clarification" : String(body.status || "pending");
  const priority = String(body.priority || "normal");
  if (!STATUSES.has(status)) throw new HttpFail(400, "invalid status");
  if (!PRIORITIES.has(priority)) throw new HttpFail(400, "invalid priority");
  const now = nowIso();
  const id = nid("tsk");
  const owner = ownerId();
  tx((db) => {
    db.prepare(
      `INSERT INTO work_items
       (id,owner_user_id,task_type,title,source,status,priority,skill,profile,project_id,
        collaboration_id,session_id,due_at,input,entities,data_version,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id, owner, definition.id, String(body.title || definition.title).slice(0, 200), source,
      status, priority, definition.id, definition.profile, body.project_id || null,
      body.collaboration_id || input.collaboration_id || null, body.session_id || null, body.due_at || null,
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

tasks.get("/tasks", (c) => {
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (!isAdmin() || c.req.query("scope") !== "all") {
    clauses.push("owner_user_id=?");
    values.push(ownerId());
  }
  for (const key of ["status", "priority", "source", "profile"] as const) {
    const value = c.req.query(key);
    if (value) {
      clauses.push(`${key}=?`);
      values.push(value);
    }
  }
  const sort = c.req.query("sort") || "updated_desc";
  const order: Record<string, string> = {
    updated_desc: "updated_at DESC",
    updated_asc: "updated_at ASC",
    due_asc: "due_at IS NULL, due_at ASC",
    priority_desc: "CASE priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'normal' THEN 2 ELSE 1 END DESC, updated_at DESC",
  };
  if (!order[sort]) throw new HttpFail(400, "invalid sort");
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = getConn().prepare(`SELECT * FROM work_items ${where} ORDER BY ${order[sort]}`).all(...values) as Row[];
  const ids = rows.map((row) => String(row.id));
  const eventsByTask = new Map<string, Row[]>();
  if (ids.length) {
    const placeholders = ids.map(() => "?").join(",");
    const eventRows = getConn().prepare(
      `SELECT * FROM task_events WHERE work_item_id IN (${placeholders}) ORDER BY work_item_id, sequence`,
    ).all(...ids) as Row[];
    for (const event of eventRows) {
      const list = eventsByTask.get(String(event.work_item_id)) || [];
      list.push(event);
      eventsByTask.set(String(event.work_item_id), list);
    }
  }
  const collabIds = [...new Set(rows.map((row) => String(row.collaboration_id || row.project_id || "")).filter(Boolean))];
  const collabById = new Map<string, Row>();
  if (collabIds.length) {
    const placeholders = collabIds.map(() => "?").join(",");
    const collabRows = getConn().prepare(
      `SELECT * FROM collaborations WHERE id IN (${placeholders})`,
    ).all(...collabIds) as Row[];
    for (const collab of collabRows) collabById.set(String(collab.id), collab);
  }
  return c.json(rows.map((row) => {
    const events = (eventsByTask.get(String(row.id)) || []).map((event) => ({
      id: event.id,
      type: event.event_type,
      label: event.label,
      status: event.status,
      summary: event.safe_summary,
      safe_summary: event.safe_summary,
      time: event.time,
      created_at: event.time,
    }));
    return decorateTaskFromCollab({
      ...publicWorkItem(row),
      history: events,
      history_summary: historySummary(events),
    }, collabById.get(String(row.collaboration_id || row.project_id || "")));
  }));
});

tasks.post("/tasks", async (c) => {
  const body = await c.req.json() as Json;
  return c.json(createWorkItem(body, String(body.source || "manual")), 201);
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
  const runText = String(body.text || storedInput.prompt || item.title);
  const resolution = resolveTaskIntent({
    text: runText,
    task_type: definition.id,
    entities: { ...(parseJson(item.entities) as Json), ...((body.entities as Json) || {}) },
    input: { ...storedInput, ...((body.input as Json) || {}) },
  });
  if (resolution.missing_fields.length) {
    getConn().prepare("UPDATE work_items SET status='needs_clarification',updated_at=? WHERE id=?")
      .run(nowIso(), item.id);
    appendTaskEvent(String(item.id), null, "task.clarification", "还需要补充信息", "needs_clarification",
      `缺少：${formatMissingFields(resolution.missing_fields)}`);
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
    ).run(runId, item.id, sid, "pending", item.input, JSON.stringify(resolution.entities), now);
    db.prepare("UPDATE work_items SET session_id=?,status='pending',updated_at=?,data_version=data_version+1 WHERE id=?")
      .run(sid, now, item.id);
  });
  appendTaskEvent(String(item.id), runId, "run.pending", "任务已加入队列", "pending", "等待会话开始执行");
  audit(ownerId(), "task.run.created", { work_item_id: item.id, run_id: runId, session_id: sid });
  const pendingMessage = {
    ...(storedInput || {}),
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
    appendTaskEvent(String(item.id), null, "task.promoted", "转为我的待办", String(item.status), "已从 AI 发现转入待办");
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
    appendTaskEvent(String(item.id), null, "task.dismissed", "忽略发现", String(item.status), "已从 AI 发现中移除");
    audit(ownerId(), "task.dismissed", { work_item_id: item.id });
  }
  return c.json(publicWorkItem(ownedWorkItem(String(item.id))));
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
