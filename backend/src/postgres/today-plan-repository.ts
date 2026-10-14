import type { PoolClient } from "pg";
import { nid } from "../ids.js";
import { pgEnqueueExecutionJob } from "../execution-jobs/postgres-store.js";
import { postgresPool, postgresQuery, postgresTransaction } from "./pool.js";
import type { Json, Row } from "../types.js";
import type { ClaimedExecutionJob } from "../execution-jobs/contracts.js";
import type { PlanScope, SourceItem, TodayPlanPack } from "../host/today-plan-context.js";

export type NativePlanStart = {
  work_item_id: string;
  session_id: string;
  run_id: string;
  execution_job_id: string;
  producer: "deterministic_organize" | "agent_plan";
  attached: boolean;
  planning: boolean;
};

export type NativePlanInput = {
  owner: string;
  taskType: "today_plan" | "today_analyze";
  title: string;
  scope: PlanScope;
  producer: "deterministic_organize" | "agent_plan";
  payload: Json;
  extraPayload: Json;
  queuedLabel: string;
  progress?: Array<{ label: string; summary: string }>;
};

const OPEN_PLAN_STATUSES = ["pending", "queued", "running", "in_progress", "starting"];
const CLOSED_DISPLAY_STATUSES = new Set(["completed", "done", "cancelled"]);
const PLAN_WATCHDOG_MS = 15 * 60 * 1_000;

function stamp(): string { return new Date().toISOString(); }
function asJson(value: unknown, fallback: Json = {}): Json {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Json;
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Json : fallback;
  } catch { return fallback; }
}
function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  try { const parsed = JSON.parse(String(value || "[]")); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}
function planTaskType(scope: PlanScope): "today_plan" | "todo_plan" { return scope === "todo" ? "todo_plan" : "today_plan"; }
function pointerTable(scope: PlanScope): "employee_today_briefs" | "employee_todo_briefs" {
  return scope === "todo" ? "employee_todo_briefs" : "employee_today_briefs";
}
function sourceCursor(ids: string[], stageCounts: { greet: number; follow: number; quote: number; negotiate: number }): string {
  return `src:${ids.slice().sort().join(",")}|stages:${stageCounts.greet},${stageCounts.follow},${stageCounts.quote},${stageCounts.negotiate}`;
}
function normSourceItem(row: Row, kind: SourceItem["kind"], reason: string, objectType: SourceItem["object_type"] = "task"): SourceItem {
  const collab = row.collaboration_id ? String(row.collaboration_id) : null;
  return {
    id: `${kind === "failed_run" ? "run" : kind === "correspondence" ? "mail" : kind === "follow_plan" ? "follow" : "task"}:${String(row.id)}`,
    kind, title: String(row.title || row.work_title || ""), status: String(row.status || ""),
    object_type: collab ? "person" : objectType, person_id: collab,
    work_item_id: String(row.work_item_id || row.id || ""),
    run_id: row.run_id ? String(row.run_id) : undefined,
    updated_at: row.updated_at ? String(row.updated_at) : row.completed_at ? String(row.completed_at) : null,
    priority: row.priority ? String(row.priority) : null,
    due_at: row.due_at ? String(row.due_at) : null,
    start_date: row.start_date ? String(row.start_date) : null,
    risk: row.risk ? String(row.risk) : null,
    risk_level: row.risk_level ? String(row.risk_level) : null,
    source: row.source ? String(row.source) : null,
    reason, p0: kind === "formal_task" || kind === "failed_run",
  };
}

/** Native append-only task fact. Caller owns transaction and target ticket lock. */
export async function appendNativeTaskEventIn(
  client: PoolClient, workItemId: string, runId: string | null, eventType: string, label: string, status: string,
  safeSummary?: string, eventClass: "lifecycle" | "run_trace" | "legacy" = eventType.startsWith("task.") ? "lifecycle" : "run_trace",
): Promise<Row | null> {
  const target = await client.query<Row>(
    `SELECT t.id FROM tickets t
      WHERE t.id=$1 AND EXISTS (SELECT 1 FROM task_runs r WHERE $2::text IS NULL OR (r.id=$2 AND r.work_item_id=t.id))
      FOR UPDATE`, [workItemId, runId],
  );
  if (!target.rows[0]) return null;
  if (eventClass !== "lifecycle") {
    const count = await client.query<{ n: string }>("SELECT COUNT(*)::text AS n FROM task_events WHERE work_item_id=$1", [workItemId]);
    const max = Math.max(1, Math.floor(Number(process.env.TASK_EVENT_MAX_PER_WORK_ITEM || "5000")));
    if (Number(count.rows[0]?.n || 0) >= max) return null;
  }
  const sequence = await client.query<{ n: string }>("SELECT COALESCE(MAX(sequence),0)::text AS n FROM task_events WHERE work_item_id=$1", [workItemId]);
  const now = stamp();
  const row: Row = {
    id: nid("tev"), work_item_id: workItemId, run_id: runId,
    sequence: Number(sequence.rows[0]?.n || 0) + 1, event_type: eventType, event_class: eventClass,
    label: label.slice(0, 160), status, safe_summary: safeSummary?.slice(0, 1000) || null, time: now, created_at: now,
  };
  await client.query(
    `INSERT INTO task_events (id,work_item_id,run_id,sequence,event_type,event_class,label,status,safe_summary,time,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
    [row.id, row.work_item_id, row.run_id, row.sequence, row.event_type, row.event_class, row.label, row.status, row.safe_summary, now],
  );
  return row;
}

/** Aggregate plan source facts directly from PostgreSQL, always tenant (owner) scoped. */
export async function nativeTodayPlanContext(owner: string, scope: PlanScope = "today"): Promise<TodayPlanPack> {
  const [tickets, failedRuns, correspondence, followPlans, stages, pointerRows] = await Promise.all([
    postgresQuery<Row>(`SELECT id,task_type,title,source,status,priority,collaboration_id,updated_at,due_at,start_date,risk_level,promoted_at,dismissed_at
      FROM tickets WHERE owner_user_id=$1 AND deleted_at IS NULL ORDER BY updated_at DESC`, [owner]),
    postgresQuery<Row>(`SELECT r.id AS run_id,r.work_item_id,r.status,r.completed_at,r.created_at,w.title AS work_title,w.collaboration_id,w.task_type
      FROM task_runs r JOIN tickets w ON w.id=r.work_item_id
      WHERE w.owner_user_id=$1 AND r.status='failed' AND w.task_type NOT IN ('today_plan','todo_plan','today_analyze') ORDER BY r.created_at DESC`, [owner]),
    postgresQuery<Row>(`SELECT id,title,status,collaboration_id,updated_at,priority,due_at,start_date,risk_level,source
      FROM tickets WHERE owner_user_id=$1 AND deleted_at IS NULL AND task_type IN ('email_compose','reply_analysis','email_conversation_read') ORDER BY updated_at DESC`, [owner]),
    postgresQuery<Row>(`SELECT id,title,status,collaboration_id,updated_at,priority,due_at,start_date,risk_level,source
      FROM tickets WHERE owner_user_id=$1 AND deleted_at IS NULL AND (task_type IN ('creator_outreach','email_compose') OR title LIKE '%跟进%') ORDER BY updated_at DESC`, [owner]),
    postgresQuery<Row>("SELECT stage_code FROM collaborations"),
    postgresQuery<Row>(`SELECT a.payload FROM ${pointerTable(scope)} p JOIN task_artifacts a ON a.id=p.artifact_id WHERE p.owner_user_id=$1`, [owner]),
  ]);
  const isOpen = (r: Row) => !["completed", "done", "cancelled", "stopped"].includes(String(r.status || ""));
  const formal = tickets.filter((r) => !["today_plan", "todo_plan", "today_analyze"].includes(String(r.task_type)) && isOpen(r)
    && !((String(r.source) === "ai" || String(r.source) === "discovery") && !r.promoted_at))
    .map((r) => normSourceItem(r, "formal_task", String(r.status) === "failed" ? "执行失败" : "未了结正式任务"));
  const failed = failedRuns.map((r) => normSourceItem({ ...r, id: r.run_id, status: "failed" }, "failed_run", "运行失败", "run"));
  const mail = correspondence.filter(isOpen).map((r) => normSourceItem(r, "correspondence", "往来待办"));
  const follows = followPlans.filter((r) => isOpen(r) && r.collaboration_id).map((r) => normSourceItem(r, "follow_plan", "跟进计划", "person"));
  const seen = new Set<string>();
  let catalog = [...formal, ...failed, ...follows, ...mail].filter((item) => !seen.has(item.id) && (seen.add(item.id), true));
  if (scope === "todo") {
    const todayIds = new Set(tickets.filter((r) => String(r.task_type) === "today_task").map((r) => String(r.id)));
    catalog = catalog.filter((item) => item.kind !== "formal_task" || !todayIds.has(String(item.work_item_id)));
  }
  const stageCounts = { greet: 0, follow: 0, quote: 0, negotiate: 0 };
  for (const row of stages) {
    const stage = String(row.stage_code || "").toUpperCase();
    if (stage === "INITIAL_CONTACT") stageCounts.greet += 1;
    else if (stage === "INTERESTED") stageCounts.follow += 1;
    else if (stage === "QUOTE_PENDING") stageCounts.quote += 1;
    else if (stage === "NEGOTIATING") stageCounts.negotiate += 1;
  }
  const previous = asJson(pointerRows[0]?.payload, {});
  const oldCursor = asJson(previous.source_cursor, {});
  const oldIds = new Set([...(asArray(oldCursor.added)), ...(asArray(oldCursor.unchanged))].map(String));
  const added = oldCursor.cursor_to ? catalog.filter((item) => !oldIds.has(item.id)).slice(0, 40) : [...catalog].slice(0, 40);
  const unchanged = oldCursor.cursor_to ? catalog.filter((item) => oldIds.has(item.id)) : [];
  const ids = catalog.map((item) => item.id);
  const cursor = { cursor_from: oldCursor.cursor_to ? String(oldCursor.cursor_to) : null, cursor_to: sourceCursor(ids, stageCounts), added: added.map((x) => x.id), removed: [...oldIds].filter((id) => !ids.includes(id)), unchanged: unchanged.map((x) => x.id) };
  return {
    history: { unfinished_tasks: formal, previous_brief: pointerRows[0] ? previous : null, source_cursor: oldCursor.cursor_to ? { cursor_from: oldCursor.cursor_from ? String(oldCursor.cursor_from) : null, cursor_to: String(oldCursor.cursor_to), added: asArray(oldCursor.added).map(String), removed: asArray(oldCursor.removed).map(String), unchanged: asArray(oldCursor.unchanged).map(String) } : null },
    delta: { added, removed: cursor.removed.map((id) => ({ id, kind: "formal_task" as const, title: id, status: "removed", object_type: "task" as const, person_id: null, p0: true })), unchanged },
    now_counts: { unfinished: formal.length, discovery_anomalies: 0, failed_runs: failed.length, follow_plans: follows.length, correspondence: mail.length, follow_timers: 0, anomalies: 0 },
    stage_counts: stageCounts, source_cursor: cursor, catalog,
  };
}

async function activePlanIn(client: PoolClient, owner: string): Promise<NativePlanStart | null> {
  const result = await client.query<Row>(
    `SELECT t.id AS work_item_id,t.session_id,r.id AS run_id,j.id AS execution_job_id
       FROM tickets t JOIN task_runs r ON r.work_item_id=t.id
       LEFT JOIN LATERAL (SELECT id FROM execution_jobs WHERE run_id=r.id ORDER BY created_at DESC LIMIT 1) j ON true
      WHERE t.owner_user_id=$1 AND t.task_type='today_plan' AND t.status = ANY($2::text[])
      ORDER BY t.created_at DESC LIMIT 1`, [owner, OPEN_PLAN_STATUSES],
  );
  const row = result.rows[0];
  return row ? { work_item_id: String(row.work_item_id), session_id: String(row.session_id), run_id: String(row.run_id), execution_job_id: String(row.execution_job_id || ""), producer: "deterministic_organize", attached: true, planning: true } : null;
}

/** Atomic plan/session/run/job creation; advisory owner lock makes duplicate clicks attach rather than double-create. */
export async function startNativeTodayPlan(input: NativePlanInput): Promise<NativePlanStart> {
  return postgresTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`today-plan:${input.owner}`]);
    if (input.taskType === "today_plan") {
      const current = await activePlanIn(client, input.owner);
      if (current) return { ...current, producer: input.producer };
    }
    const now = stamp(); const sessionId = nid("ses"); const workItemId = nid("tsk"); const runId = nid("run");
    await client.query(`INSERT INTO sessions (id,title,created_at,updated_at,kind,disabled,owner_user_id,expert_id,expert_version)
      VALUES ($1,$2,$3,$3,$4,0,$5,$6,NULL)`, [sessionId, input.title.slice(0, 200), now, input.taskType, input.owner, input.taskType]);
    await client.query(`INSERT INTO tickets (id,owner_user_id,task_type,title,source,status,priority,skill,profile,session_id,input,entities,data_version,created_at,updated_at,kind,channel,requester_type,kind_version)
      VALUES ($1,$2,$3,$4,'planning','queued','normal',$3,$5,$6,$7,'{}',1,$8,$8,'general','system','system',1)`,
      [workItemId, input.owner, input.taskType, input.title.slice(0, 200), input.taskType, sessionId, JSON.stringify(input.payload), now]);
    await client.query(`INSERT INTO task_runs (id,work_item_id,session_id,status,input,entities,created_at,started_at)
      VALUES ($1,$2,$3,'queued',$4,'{}',$5,NULL)`, [runId, workItemId, sessionId, JSON.stringify(input.payload), now]);
    const queued = await pgEnqueueExecutionJob({
      job_type: input.taskType === "today_plan" ? "work_plan.run" : "today_analyze.run", tenant_ref: "company:amperetime", actor_ref: input.owner,
      ticket_id: workItemId, run_id: runId, object_ref: { type: "ticket", id: workItemId }, rule_id: input.taskType === "today_plan" ? "workbench-plan" : "today-analyze",
      rule_version: "task-workbench.v1", risk_level: "low", scope_snapshot: { scope: input.scope, projection_version: "task-workbench.v1" }, priority_class: "normal", max_attempts: 1,
      idempotency_key: `${input.taskType === "today_plan" ? "work_plan.run" : "today_analyze.run"}:${runId}`,
      payload: { owner: input.owner, work_item_id: workItemId, run_id: runId, session_id: sessionId, scope: input.scope, task_payload: input.payload, ...input.extraPayload },
      outbox: { event_type: `${input.taskType === "today_plan" ? "work_plan.run" : "today_analyze.run"}.queued`, aggregate_type: "task_run", aggregate_id: runId, payload: { work_item_id: workItemId, run_id: runId, scope: input.scope } },
    }, { client });
    await appendNativeTaskEventIn(client, workItemId, runId, "run.queued", input.queuedLabel, "queued", "已通过 PostgreSQL 原子事务持久化等待执行");
    for (const progress of input.progress || []) await appendNativeTaskEventIn(client, workItemId, runId, "run.progress", progress.label, "queued", progress.summary);
    return { work_item_id: workItemId, session_id: sessionId, run_id: runId, execution_job_id: String(queued.job.id), producer: input.producer, attached: false, planning: true };
  }, { isolation: "SERIALIZABLE" });
}

function deterministicBrief(pack: TodayPlanPack): Json {
  const formal = pack.catalog.filter((item) => item.kind === "formal_task");
  const first = formal[0];
  return {
    lead: first ? `先处理 ${first.title || "最高优先级任务"}` : "当前没有需要优先处理的开放任务",
    sections: [{ title: "工作计划", body: `${formal.length} 项未了结正式任务已按优先级和期限排序。`, items: formal.slice(0, 6).map((item) => item.title) }],
    primary: first ? { verb: "open", label: "打开任务", object_id: first.work_item_id || null, object_type: "task", person_id: first.person_id || null } : { verb: "open", label: "查看任务列表", object_id: null, object_type: "task", person_id: null },
    stats: { unfinished: formal.length, failed_runs: pack.now_counts.failed_runs, stage_counts: pack.stage_counts }, source_cursor: pack.source_cursor,
    display_tasks: formal.map((item, index) => ({ work_item_id: item.work_item_id, title: item.title, why: item.reason || "未了结正式任务", rank: index + 1, verb: "open", label: "打开任务", next_action: "打开任务", view: "today" })),
  };
}

async function writeNativeBrief(client: PoolClient, input: { owner: string; workItemId: string; runId: string; scope: PlanScope; brief: Json; producer: string }): Promise<{ artifactId: string }> {
  const now = stamp(); const artifactId = nid("art"); const table = pointerTable(input.scope);
  const snapshot: Json = { ...input.brief, producer: input.producer, source_revision: String((input.brief.source_cursor as Json | undefined)?.cursor_to || ""), generated_at: now };
  await client.query(`INSERT INTO task_artifacts (id,work_item_id,run_id,artifact_type,message_id,version,payload,created_at) VALUES ($1,$2,$3,'today_brief',NULL,1,$4,$5)`, [artifactId, input.workItemId, input.runId, JSON.stringify(snapshot), now]);
  await client.query(`INSERT INTO ${table} (owner_user_id,artifact_id,work_item_id,updated_at) VALUES ($1,$2,$3,$4)
    ON CONFLICT (owner_user_id) DO UPDATE SET artifact_id=EXCLUDED.artifact_id,work_item_id=EXCLUDED.work_item_id,updated_at=EXCLUDED.updated_at`, [input.owner, artifactId, input.workItemId, now]);
  const taskArtifact = nid("art"); const items = asArray(snapshot.display_tasks);
  await client.query(`INSERT INTO task_artifacts (id,work_item_id,run_id,artifact_type,message_id,version,payload,created_at) VALUES ($1,$2,$3,$4,NULL,1,$5,$6)`, [taskArtifact, input.workItemId, input.runId, input.scope === "todo" ? "todo_tasks" : "today_tasks", JSON.stringify({ items, planned_at: now }), now]);
  await client.query(`UPDATE ${table} SET result_artifact_id=$1,updated_at=$2 WHERE owner_user_id=$3`, [taskArtifact, now, input.owner]);
  return { artifactId };
}

async function nativePlanTerminal(workItemId: string, runId: string, ok: boolean, reason?: string): Promise<void> {
  await postgresTransaction(async (client) => {
    const now = stamp();
    await client.query(`UPDATE task_runs SET status=$1,error=$2,completed_at=$3 WHERE id=$4 AND work_item_id=$5`, [ok ? "completed" : "failed", ok ? null : JSON.stringify({ message: reason || "planning failed" }), now, runId, workItemId]);
    await client.query(`UPDATE tickets SET status=$1,completed_at=$2,updated_at=$2,data_version=data_version+1 WHERE id=$3`, [ok ? "waiting" : "failed", now, workItemId]);
    await appendNativeTaskEventIn(client, workItemId, runId, ok ? "run.completed" : "run.failed", ok ? "今日规划已完成" : "今日规划失败", ok ? "completed" : "failed", ok ? "PostgreSQL 原生任务链已完成" : String(reason || "planning failed"));
  });
}

/** Executor used by the PostgreSQL dispatcher; it never imports execution-jobs/store or the SQLite plan projection. */
export async function executeNativeClaimedPlanningJob(claimed: ClaimedExecutionJob): Promise<Json> {
  const payload = asJson((claimed as Row).payload_json);
  const workItemId = String(payload.work_item_id || claimed.ticket_id || ""); const runId = String(payload.run_id || claimed.run_id || ""); const owner = String(payload.owner || claimed.actor_ref || "");
  if (!workItemId || !runId || !owner) throw new Error("invalid planning execution job payload");
  const claimedRun = await postgresTransaction(async (client) => {
    const row = await client.query<Row>(`SELECT t.status AS ticket_status,r.status AS run_status,r.session_id FROM tickets t JOIN task_runs r ON r.work_item_id=t.id WHERE t.id=$1 AND r.id=$2 AND t.owner_user_id=$3 FOR UPDATE`, [workItemId, runId, owner]);
    const current = row.rows[0]; if (!current) throw new Error("planning task run not found or tenant mismatch");
    // The execution-job lease should normally serialize workers. Keep an
    // independent task-run CAS as defense in depth: a second claimant cannot
    // create a second artifact while the first one is running.
    if (["completed", "failed", "cancelled", "running"].includes(String(current.run_status)) || ["completed", "failed", "cancelled"].includes(String(current.ticket_status))) return { duplicate: true };
    const now = stamp();
    await client.query("UPDATE task_runs SET status='running',started_at=COALESCE(started_at,$1) WHERE id=$2", [now, runId]);
    await client.query("UPDATE tickets SET status='running',started_at=COALESCE(started_at,$1),updated_at=$1,data_version=data_version+1 WHERE id=$2", [now, workItemId]);
    await appendNativeTaskEventIn(client, workItemId, runId, "run.started", "开始生成统一工作计划", "running", "持久执行器已领取作业");
    return { duplicate: false };
  });
  if (claimedRun.duplicate) return { work_item_id: workItemId, run_id: runId, duplicate: true };
  try {
    if (String(claimed.job_type) === "today_analyze.run") {
      await nativePlanTerminal(workItemId, runId, true);
      return { work_item_id: workItemId, run_id: runId, mode: "today_analyze", side_effect: "none" };
    }
    const packRaw = payload.pack;
    const pack = packRaw && typeof packRaw === "object" && !Array.isArray(packRaw) ? packRaw as TodayPlanPack : await nativeTodayPlanContext(owner, String(payload.scope) === "todo" ? "todo" : "today");
    const scope: PlanScope = String(payload.scope) === "todo" ? "todo" : "today";
    const producer = payload.producer === "agent_plan" ? "agent_plan" : "deterministic_organize";
    // Planning output remains deterministic in this native path. It retains the declared producer for audit but never crosses a compatibility storage bridge.
    const brief = deterministicBrief(pack);
    const stored = await postgresTransaction((client) => writeNativeBrief(client, { owner, workItemId, runId, scope, brief, producer }));
    await nativePlanTerminal(workItemId, runId, true);
    return { work_item_id: workItemId, run_id: runId, artifact_id: stored.artifactId, mode: producer, scope };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await nativePlanTerminal(workItemId, runId, false, reason);
    throw error;
  }
}

export async function nativeTodayBriefSnapshot(owner: string, scope: PlanScope = "today"): Promise<Json> {
  const table = pointerTable(scope);
  const rows = await postgresQuery<Row>(`SELECT p.artifact_id,p.work_item_id,a.payload,a.run_id,a.created_at FROM ${table} p JOIN task_artifacts a ON a.id=p.artifact_id WHERE p.owner_user_id=$1`, [owner]);
  const active = await postgresQuery<Row>(`SELECT t.id AS work_item_id,t.session_id,r.id AS run_id FROM tickets t LEFT JOIN task_runs r ON r.work_item_id=t.id WHERE t.owner_user_id=$1 AND t.task_type=$2 AND t.status = ANY($3::text[]) ORDER BY t.updated_at DESC LIMIT 1`, [owner, planTaskType(scope), OPEN_PLAN_STATUSES]);
  const row = rows[0]; const brief = row ? asJson(row.payload) : null; const activeRow = active[0];
  let staleReason: string | null = null;
  if (brief) {
    const current = await nativeTodayPlanContext(owner, scope);
    const stored = String((brief.source_cursor as Json | undefined)?.cursor_to || brief.source_revision || "");
    if (stored && stored !== current.source_cursor.cursor_to) staleReason = "source_revision_changed";
  }
  const eventTicketId = String(activeRow?.work_item_id || row?.work_item_id || "");
  const events = eventTicketId ? await postgresQuery<Row>("SELECT * FROM task_events WHERE work_item_id=$1 ORDER BY sequence", [eventTicketId]) : [];
  return { plan_id: row?.artifact_id || null, status: activeRow ? "running" : brief ? (staleReason ? "stale" : "ready") : "empty", producer: String(brief?.producer || "unknown"), source_revision: brief ? String(brief.source_revision || "") || null : null, generated_at: brief ? String(brief.generated_at || row?.created_at || "") || null : null, stale_reason: staleReason, planning: Boolean(activeRow), brief, events: events.map((event) => ({ ...event, type: event.event_type, title: event.label, summary: event.safe_summary, created_at: event.time })), work_item_id: activeRow?.work_item_id || row?.work_item_id || null, session_id: activeRow?.session_id || null, run_id: activeRow?.run_id || row?.run_id || null, previous_brief: null, previous_events: [], previous_work_item_id: null, entry: "memory", kind: "memory", creates_session: false, calls_model: false };
}

export async function nativeTodayTaskResults(owner: string, scope: PlanScope = "today"): Promise<Json | null> {
  const table = pointerTable(scope);
  const rows = await postgresQuery<Row>(`SELECT a.payload FROM ${table} p JOIN task_artifacts a ON a.id=p.result_artifact_id WHERE p.owner_user_id=$1`, [owner]);
  const result = rows[0] ? asJson(rows[0].payload) : null; if (!result) return null;
  const items = asArray(result.items); if (!items.length) return { ...result, items: [] };
  const ids = items.map((item) => String((item as Json).work_item_id || "")).filter(Boolean);
  const hosts = ids.length ? await postgresQuery<Row>("SELECT id,status,dismissed_at FROM tickets WHERE id=ANY($1::text[])", [ids]) : [];
  const allowed = new Map(hosts.map((r) => [String(r.id), r]));
  return { ...result, items: items.filter((item) => { const host = allowed.get(String((item as Json).work_item_id || "")); return host && !CLOSED_DISPLAY_STATUSES.has(String(host.status || "")) && !host.dismissed_at; }) };
}

/** Boot/restart recovery claims each stale run with SKIP LOCKED and writes terminal facts atomically. */
export async function recoverNativeTaskRuns(reason: string, olderThanMs = 0): Promise<string[]> {
  const cutoff = olderThanMs > 0 ? new Date(Date.now() - olderThanMs).toISOString() : null;
  return postgresTransaction(async (client) => {
    const rows = await client.query<Row>(`SELECT r.id AS run_id,r.work_item_id FROM task_runs r JOIN tickets t ON t.id=r.work_item_id WHERE r.status='running' ${cutoff ? "AND COALESCE(t.updated_at,r.created_at)<$1" : ""} FOR UPDATE OF r SKIP LOCKED`, cutoff ? [cutoff] : []);
    const touched: string[] = [];
    for (const row of rows.rows) {
      const now = stamp();
      const changed = await client.query("UPDATE task_runs SET status='failed',error=$1,completed_at=$2 WHERE id=$3 AND status='running'", [JSON.stringify({ code: "interrupted", message: reason }), now, row.run_id]);
      if (!changed.rowCount) continue;
      await client.query("UPDATE tickets SET status='failed',updated_at=$1,data_version=data_version+1 WHERE id=$2 AND status IN ('running','in_progress','starting')", [now, row.work_item_id]);
      await appendNativeTaskEventIn(client, String(row.work_item_id), String(row.run_id), "run.failed", "执行被中断", "failed", `${reason}；未产生结果，可重新执行。`);
      touched.push(String(row.work_item_id));
    }
    return touched;
  });
}

export async function failStaleNativePlans(reason: string, olderThanMs = PLAN_WATCHDOG_MS): Promise<string[]> {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  return recoverNativeTaskRuns(reason, Math.max(1, Date.now() - Date.parse(cutoff)));
}
