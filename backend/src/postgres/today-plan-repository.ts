import type { PoolClient } from "pg";
import { nid } from "../ids.js";
import { pgEnqueueExecutionJob } from "../execution-jobs/postgres-store.js";
import { postgresPool, postgresQuery, postgresTransaction } from "./pool.js";
import { appendTaskEventIn } from "../task-events.js";
import type { Json, Row } from "../types.js";
import type { ClaimedExecutionJob } from "../execution-jobs/contracts.js";
import { packTodayPlanContext, planningRunInput, planningRuntimeIdentity, type PlanScope, type SourceItem, type TodayPlanPack } from "../host/today-plan-context.js";
import { validateTodayBrief } from "../host/today-brief.js";
import { runWorker } from "../worker/runner.js";

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

/** Aggregate plan source facts directly from PostgreSQL, always tenant (owner) scoped. */
export async function nativeTodayPlanContext(owner: string, scope: PlanScope = "today"): Promise<TodayPlanPack> {
  return packTodayPlanContext(owner, scope);
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
    const identity = planningRuntimeIdentity(input.taskType);
    await client.query(`INSERT INTO sessions (id,title,created_at,updated_at,kind,disabled,owner_user_id,expert_id,expert_version)
      VALUES ($1,$2,$3,$3,$4,0,$5,$6,NULL)`, [sessionId, input.title.slice(0, 200), now, input.taskType, input.owner, identity.session_identity]);
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
    await appendTaskEventIn(client, workItemId, runId, "run.queued", input.queuedLabel, "queued", "已通过 PostgreSQL 原子事务持久化等待执行");
    for (const progress of input.progress || []) await appendTaskEventIn(client, workItemId, runId, "run.progress", progress.label, "queued", progress.summary);
    return { work_item_id: workItemId, session_id: sessionId, run_id: runId, execution_job_id: String(queued.job.id), producer: input.producer, attached: false, planning: true };
  }, { isolation: "SERIALIZABLE" });
}

/** Extract only a structured planner response. Production never turns a host-side
 * deterministic projection into an AI result; the worker/model (or its explicit
 * CODEX_MODE=stub test implementation) is the sole producer. */
function briefFromWorkerItems(items: Json[]): Json | null {
  const candidates = items.filter((item) => item && typeof item === "object" && !Array.isArray(item)
    && (item.type === "today_brief" || (item.lead != null && item.sections != null)));
  if (!candidates.length) return null;
  const preferred = [...candidates].reverse().find((item) => Array.isArray(item.display_tasks)) || candidates[candidates.length - 1];
  const { type: _type, narrative: _narrative, ...brief } = preferred;
  return brief as Json;
}

/** Every formal unfinished ticket must have its own model-generated display row.
 * Do not fill missing rows with host defaults: that would conceal a partial model
 * result as a completed plan. */
function missingDisplayCoverage(brief: Json | null, pack: TodayPlanPack): string[] {
  if (!brief || !Array.isArray(brief.display_tasks)) return pack.history.unfinished_tasks
    .map((item) => String(item.work_item_id || item.id || "")).filter(Boolean);
  const displayed = new Set(brief.display_tasks.map((item) => item && typeof item === "object"
    ? String((item as Json).work_item_id || "") : "").filter(Boolean));
  return pack.history.unfinished_tasks.map((item) => String(item.work_item_id || item.id || ""))
    .filter((id) => id && !displayed.has(id));
}

async function writeNativeBrief(client: PoolClient, input: { owner: string; workItemId: string; runId: string; scope: PlanScope; brief: Json; producer: "agent_plan" }): Promise<{ artifactId: string }> {
  const checked = validateTodayBrief(input.brief);
  if (!checked.ok) throw new Error(checked.reason);
  const now = stamp(); const artifactId = nid("art"); const table = pointerTable(input.scope);
  const snapshot: Json = { ...checked.brief, producer: input.producer, source_revision: String((checked.brief.source_cursor as Json | undefined)?.cursor_to || ""), generated_at: now };
  await client.query(`INSERT INTO task_artifacts (id,work_item_id,run_id,artifact_type,message_id,version,payload,created_at) VALUES ($1,$2,$3,'today_brief',NULL,1,$4,$5)`, [artifactId, input.workItemId, input.runId, JSON.stringify(snapshot), now]);
  await client.query(`INSERT INTO ${table} (owner_user_id,artifact_id,work_item_id,updated_at) VALUES ($1,$2,$3,$4)
    ON CONFLICT (owner_user_id) DO UPDATE SET artifact_id=EXCLUDED.artifact_id,work_item_id=EXCLUDED.work_item_id,updated_at=EXCLUDED.updated_at`, [input.owner, artifactId, input.workItemId, now]);
  const taskArtifact = nid("art"); const items = asArray(snapshot.display_tasks);
  await client.query(`INSERT INTO task_artifacts (id,work_item_id,run_id,artifact_type,message_id,version,payload,created_at) VALUES ($1,$2,$3,$4,NULL,1,$5,$6)`, [taskArtifact, input.workItemId, input.runId, input.scope === "todo" ? "todo_tasks" : "today_tasks", JSON.stringify({ items, planned_at: now }), now]);
  await client.query(`UPDATE ${table} SET result_artifact_id=$1,updated_at=$2 WHERE owner_user_id=$3`, [taskArtifact, now, input.owner]);
  return { artifactId };
}

async function nativePlanTerminalIn(client: PoolClient, workItemId: string, runId: string, ok: boolean, reason?: string): Promise<void> {
  const now = stamp();
  const run = await client.query(
    `UPDATE task_runs SET status=$1,error=$2,completed_at=$3
       WHERE id=$4 AND work_item_id=$5 AND status NOT IN ('completed','failed','cancelled')`,
    [ok ? "completed" : "failed", ok ? null : JSON.stringify({ message: reason || "planning failed" }), now, runId, workItemId],
  );
  if (!run.rowCount) return;
  await client.query(`UPDATE tickets SET status=$1,completed_at=$2,updated_at=$2,data_version=data_version+1 WHERE id=$3`, [ok ? "waiting" : "failed", now, workItemId]);
  await appendTaskEventIn(client, workItemId, runId, ok ? "run.completed" : "run.failed", ok ? "今日规划已完成" : "今日规划失败", ok ? "completed" : "failed", ok ? "真实模型计划结果已写入 PostgreSQL" : String(reason || "planning failed"));
}

async function nativePlanTerminal(workItemId: string, runId: string, ok: boolean, reason?: string): Promise<void> {
  await postgresTransaction((client) => nativePlanTerminalIn(client, workItemId, runId, ok, reason));
}

/** PostgreSQL durable executor. The model is authoritative in normal runtime;
 * a stub is reachable only through runWorker's explicit CODEX_MODE=stub test
 * branch. No deterministic plan is substituted for a real AI execution. */
export async function executeNativeClaimedPlanningJob(claimed: ClaimedExecutionJob): Promise<Json> {
  const payload = asJson((claimed as Row).payload_json);
  const workItemId = String(payload.work_item_id || claimed.ticket_id || "");
  const runId = String(payload.run_id || claimed.run_id || "");
  const owner = String(payload.owner || claimed.actor_ref || "");
  if (!workItemId || !runId || !owner) throw new Error("invalid planning execution job payload");
  const claimedRun = await postgresTransaction(async (client) => {
    const row = await client.query<Row>(`SELECT t.status AS ticket_status,r.status AS run_status,r.session_id FROM tickets t JOIN task_runs r ON r.work_item_id=t.id WHERE t.id=$1 AND r.id=$2 AND t.owner_user_id=$3 FOR UPDATE`, [workItemId, runId, owner]);
    const current = row.rows[0]; if (!current) throw new Error("planning task run not found or tenant mismatch");
    if (["completed", "failed", "cancelled", "running"].includes(String(current.run_status)) || ["completed", "failed", "cancelled"].includes(String(current.ticket_status))) return { duplicate: true, sessionId: "" };
    const sessionId = String(payload.session_id || current.session_id || "");
    if (!sessionId) throw new Error("planning task run has no session");
    const now = stamp();
    await client.query("UPDATE task_runs SET status='running',started_at=COALESCE(started_at,$1) WHERE id=$2", [now, runId]);
    await client.query("UPDATE tickets SET status='running',started_at=COALESCE(started_at,$1),updated_at=$1,data_version=data_version+1 WHERE id=$2", [now, workItemId]);
    await appendTaskEventIn(client, workItemId, runId, "run.started", "开始生成统一工作计划", "running", "PostgreSQL 执行器已领取真实模型作业");
    return { duplicate: false, sessionId };
  });
  if (claimedRun.duplicate) return { work_item_id: workItemId, run_id: runId, duplicate: true };
  try {
    if (String(claimed.job_type) === "today_analyze.run") {
      const taskPayload = payload.task_payload && typeof payload.task_payload === "object" && !Array.isArray(payload.task_payload) ? payload.task_payload as Json : {};
      const result = await Promise.resolve(runWorker(claimedRun.sessionId, "today_analyze", String(payload.prompt || "分析所选对象并建议下一步，不要改状态。"), { ...taskPayload, work_item_id: workItemId, task_run_id: runId, actor_user_id: owner }));
      await nativePlanTerminal(workItemId, runId, true);
      return { work_item_id: workItemId, run_id: runId, mode: "agent_plan", side_effect: "none", worker_id: result.worker_id };
    }
    const scope: PlanScope = String(payload.scope) === "todo" ? "todo" : "today";
    const packRaw = payload.pack;
    const pack = packRaw && typeof packRaw === "object" && !Array.isArray(packRaw) ? packRaw as TodayPlanPack : await nativeTodayPlanContext(owner, scope);
    const extra = planningRunInput(pack, { work_item_id: workItemId, task_run_id: runId, actor_user_id: owner }, scope);
    const result = await Promise.resolve(runWorker(claimedRun.sessionId, planTaskType(scope), scope === "todo" ? "规划待办工作。只输出 today_brief JSON。" : "规划今天的工作。只输出 today_brief JSON。", extra));
    const brief = briefFromWorkerItems(result.items);
    const missing = missingDisplayCoverage(brief, pack);
    if (!brief || missing.length) {
      const reason = !brief ? "真实模型没有返回 today_brief 结构化结果" : `真实模型展示行漏了 ${missing.length} 项任务（${missing.slice(0, 3).join("、")}）`;
      await nativePlanTerminal(workItemId, runId, false, reason);
      throw new Error(reason);
    }
    // Cursor provenance is an authority fact calculated from native PostgreSQL
    // reads. Do not trust a model to reconstruct it from the prompt excerpt.
    const persistedBrief: Json = { ...brief, source_cursor: pack.source_cursor };
    const stored = await postgresTransaction(async (client) => {
      const written = await writeNativeBrief(client, { owner, workItemId, runId, scope, brief: persistedBrief, producer: "agent_plan" });
      await nativePlanTerminalIn(client, workItemId, runId, true);
      return written;
    });
    return { work_item_id: workItemId, run_id: runId, artifact_id: stored.artifactId, mode: "agent_plan", scope, worker_id: result.worker_id };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    // A validation failure was terminalized above; this compare-and-set remains
    // harmless and records real worker/model failures exactly once.
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
    const rows = await client.query<Row>(
      `SELECT r.id AS run_id,r.work_item_id FROM task_runs r JOIN tickets t ON t.id=r.work_item_id
        WHERE r.status='running' AND t.task_type=ANY($1::text[]) ${cutoff ? "AND COALESCE(t.updated_at,r.created_at)<$2" : ""}
        FOR UPDATE OF r SKIP LOCKED`,
      cutoff ? [["today_plan", "todo_plan", "today_analyze"], cutoff] : [["today_plan", "todo_plan", "today_analyze"]],
    );
    const touched: string[] = [];
    for (const row of rows.rows) {
      const now = stamp();
      const changed = await client.query("UPDATE task_runs SET status='failed',error=$1,completed_at=$2 WHERE id=$3 AND status='running'", [JSON.stringify({ code: "interrupted", message: reason }), now, row.run_id]);
      if (!changed.rowCount) continue;
      await client.query("UPDATE tickets SET status='failed',updated_at=$1,data_version=data_version+1 WHERE id=$2 AND status IN ('running','in_progress','starting')", [now, row.work_item_id]);
      await appendTaskEventIn(client, String(row.work_item_id), String(row.run_id), "run.failed", "执行被中断", "failed", `${reason}；未产生结果，可重新执行。`);
      touched.push(String(row.work_item_id));
    }
    return touched;
  });
}

export async function failStaleNativePlans(reason: string, olderThanMs = PLAN_WATCHDOG_MS): Promise<string[]> {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  return recoverNativeTaskRuns(reason, Math.max(1, Date.now() - Date.parse(cutoff)));
}
