import { audit, getConn, nowIso, tx, type SqliteConn } from "../db.js";
import {
  claimExecutionJobById,
  completeExecutionJob,
  enqueueExecutionJob,
  executionJobPayload,
  failExecutionJob,
  publishExecutionOutboxForJob,
  type ClaimedExecutionJob,
} from "../execution-jobs/store.js";
import { nid } from "../ids.js";
import { ensureTicketForWorkItem } from "../tickets.js";
import { requireTaskDefinition } from "../tasks/registry.js";
import type { Json } from "../types.js";
import { appendTaskEvent, appendTaskEventInConn } from "../routers/tasks.js";
import { runWorker } from "../worker/runner.js";
import { HttpFail } from "./errors.js";
import { createRunTraceSink } from "./run-trace.js";
import { isTodayWorkItem, todayDateStr } from "./home-board.js";
import { runningTodayPlan, writeTodayBriefArtifact, markTodayPlanCompleted, markTodayPlanFailed } from "./today-brief.js";
import {
  briefPointerTable,
  ownerId,
  packTodayPlanContext,
  planTaskType,
  planningHarnessMount,
  planningRuntimeIdentity,
  planningRunInput,
  type PlanScope,
  type TodayPlanPack,
} from "./today-plan-context.js";

function parseJson(value: unknown): Json {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Json : {};
  } catch {
    return {};
  }
}

export function planningEvents(workItemId: string): Json[] {
  return (getConn().prepare(
    "SELECT * FROM task_events WHERE work_item_id=? ORDER BY sequence",
  ).all(workItemId) as Array<Record<string, unknown>>).map((event) => ({
    ...event,
    type: event.event_type,
    title: event.label,
    summary: event.safe_summary,
    created_at: event.time,
  }));
}

function createPlanningSession(db: SqliteConn, title: string, owner: string, expertId: string, kind = "today_plan"): string {
  const now = nowIso();
  const sid = nid("ses");
  db.prepare(
    `INSERT INTO sessions
     (id,title,created_at,updated_at,kind,disabled,owner_user_id,expert_id,expert_version)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(sid, title, now, now, kind, 0, owner, expertId, null);
  return sid;
}

function createPlanningWorkItem(input: {
  db: SqliteConn;
  owner: string;
  taskType: "today_plan" | "today_analyze" | "todo_plan";
  title: string;
  sessionId: string;
  payload: Json;
}): string {
  const definition = requireTaskDefinition(input.taskType);
  const now = nowIso();
  const id = nid("tsk");
  input.db.prepare(
    `INSERT INTO tickets
     (id,owner_user_id,task_type,title,source,status,priority,skill,profile,project_id,
      collaboration_id,session_id,due_at,input,entities,data_version,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    input.owner,
    definition.id,
    input.title.slice(0, 200),
    "planning",
    "queued",
    "normal",
    definition.id,
    definition.profile,
    null,
    null,
    input.sessionId,
    null,
    JSON.stringify(input.payload),
    JSON.stringify({}),
    1,
    now,
    now,
  );
  ensureTicketForWorkItem(id, { conn: input.db });
  return id;
}

function createPlanningRun(db: SqliteConn, workItemId: string, sessionId: string, payload: Json): string {
  const now = nowIso();
  const runId = nid("run");
  db.prepare(
    `INSERT INTO task_runs
     (id,work_item_id,session_id,status,input,entities,created_at,started_at)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(runId, workItemId, sessionId, "queued", JSON.stringify(payload), "{}", now, null);
  return runId;
}

type PlanEventKey =
  | "memoryRead"
  | "deltaPacked"
  | "codexSubmitted"
  | "writingBrief"
  | "completed"
  | "failed"
  | "invalid";

export const PLAN_EMPLOYEE_EVENTS: Record<PlanScope, Record<PlanEventKey, string>> = {
  today: {
    memoryRead: "已读取当前任务记忆",
    deltaPacked: "已打包来源增量",
    codexSubmitted: "已提交 Codex 规划",
    writingBrief: "正在生成今日简报",
    completed: "今日规划已完成",
    failed: "今日规划失败",
    invalid: "今日规划未通过校验",
  },
  todo: {
    memoryRead: "已读取待办任务记忆",
    deltaPacked: "已打包待办增量",
    codexSubmitted: "已提交 Codex 待办规划",
    writingBrief: "正在生成待办简报",
    completed: "待办规划已完成",
    failed: "待办规划失败",
    invalid: "待办规划未通过校验",
  },
};

/** Back-compat export: today-scope copy (used by tests and the today chain). */
export const TODAY_PLAN_EMPLOYEE_EVENTS = PLAN_EMPLOYEE_EVENTS.today;

function memoryReadSummary(pack: TodayPlanPack, scope: PlanScope): string {
  const unfinished = Number(pack.now_counts?.unfinished);
  return Number.isFinite(unfinished) ? `未了结 ${unfinished} 项` : PLAN_EMPLOYEE_EVENTS[scope].memoryRead;
}

export function briefFromWorkerItems(items: Json[]): unknown {  const candidates = items.filter((item) => item.type === "today_brief" || (item.lead && item.sections));
  if (!candidates.length) return null;
  // Codex may emit an intermediate brief before the final structured message;
  // the authoritative row set lives on the latest candidate carrying display_tasks.
  const withDisplay = candidates.filter((item) => {
    const list = (item as Json).display_tasks;
    return Array.isArray(list) && list.length > 0;
  });
  const pool = withDisplay.length ? withDisplay : candidates;
  const hit = pool[pool.length - 1];
  if (hit.type === "today_brief") {
    const { type: _type, ...rest } = hit;
    return rest;
  }
  return hit;
}

/**
 * display_tasks（或旧 todo_layout）必须逐条覆盖 history.unfinished_tasks 的
 * 每个 work_item_id —— 展示是逐条美化，不是总结。返回缺失的 id 列表。
 */
export function missingDisplayCoverage(brief: unknown, pack: TodayPlanPack): string[] {
  const root = brief && typeof brief === "object" && !Array.isArray(brief) ? brief as Json : null;
  if (!root) return [];
  const rows = Array.isArray(root.display_tasks)
    ? root.display_tasks
    : Array.isArray(root.todo_layout)
      ? root.todo_layout
      : [];
  const covered = new Set(
    rows.map((row) => String((row as Json)?.work_item_id || (row as Json)?.id || "").trim()),
  );
  return pack.history.unfinished_tasks
    .map((item) => String(item.work_item_id || "").trim())
    .filter((id) => id && !covered.has(id));
}

function hostDisplayTasks(pack: TodayPlanPack, brief: unknown): Json[] {
  const root = brief && typeof brief === "object" && !Array.isArray(brief) ? brief as Json : {};
  const modelRows = Array.isArray(root.display_tasks) ? root.display_tasks : Array.isArray(root.todo_layout) ? root.todo_layout : [];
  const byId = new Map(modelRows.map((row) => [String((row as Json)?.work_item_id || (row as Json)?.id || ""), row as Json]));
  const rankOf = (item: TodayPlanPack["catalog"][number]) => {
    const priority = String(item.priority || "").toLowerCase();
    const rank = priority === "important_urgent" ? 0 : priority === "important" || priority === "high" ? 1 : priority === "urgent" ? 2 : priority === "normal" || priority === "medium" ? 3 : priority === "low" ? 4 : 5;
    const due = String(item.due_at || "");
    const today = todayDateStr();
    const urgency = due && due < today ? 0 : due.startsWith(today) ? 1 : item.status === "running" || item.status === "in_progress" ? 2 : 3;
    return rank * 10 + urgency;
  };
  return [...pack.catalog]
    .filter((item) => item.kind === "formal_task")
    .sort((a, b) => rankOf(a) - rankOf(b) || String(b.updated_at || "").localeCompare(String(a.updated_at || "")))
    .map((item, index) => {
      const id = String(item.work_item_id || "");
      const model = byId.get(id) || {};
      const priority = String(item.priority || "").toLowerCase();
      const group = priority === "important_urgent" ? "重要紧急" : priority === "important" || priority === "high" ? "重要" : priority === "urgent" ? "紧急" : "其他";
      return {
        work_item_id: id,
        title: String(model.title || item.title || "打开任务"),
        why: String(model.why || item.reason || "未了结正式任务"),
        rank: index + 1,
        verb: String(model.verb || model.action || "open"),
        label: String(model.label || model.next_action || "打开任务"),
        next_action: String(model.next_action || model.label || "打开任务"),
        icon: String(model.icon || (item.status === "failed" || item.risk ? "⚠️" : "📋")),
        group: String(model.group || group),
        view: isTodayWorkItem(item) ? "today" : "todo",
      } as Json;
    });
}

function withHostDisplayTasks(brief: unknown, pack: TodayPlanPack): Json | null {
  if (!brief || typeof brief !== "object" || Array.isArray(brief)) return null;
  // Model output may omit or invent its source cursor. The Host owns the
  // authorized source set and must bind its exact revision to the snapshot.
  return { ...(brief as Json), source_cursor: pack.source_cursor, display_tasks: hostDisplayTasks(pack, brief) };
}

/**
 * The task board is deterministic data, not a reasoning problem. In the fast
 * path Host writes the board immediately; Codex is no longer on the critical
 * path for a first render. A future async summary may replace only lead/
 * sections without touching display_tasks.
 */
function hostFastBrief(pack: TodayPlanPack): Json {
  const formal = pack.catalog.filter((item) => item.kind === "formal_task");
  const first = formal[0];
  return {
    lead: first ? `先处理 ${first.title || "最高优先级任务"}` : "当前没有需要优先处理的开放任务",
    sections: [{
      title: "合作阶段任务",
      body: `待打招呼 ${pack.stage_counts.greet} · 待跟进 ${pack.stage_counts.follow} · 待报价 ${pack.stage_counts.quote} · 谈判中 ${pack.stage_counts.negotiate}`,
      items: [
        `今日视图 ${formal.filter((item) => isTodayWorkItem(item)).length} 项`,
        `待办视图 ${formal.filter((item) => !isTodayWorkItem(item)).length} 项`,
      ],
    }, {
      title: "工作计划",
      body: `${formal.length} 项未了结正式任务已按优先级和期限排序。`,
      items: formal.slice(0, 6).map((item) => item.title),
    }],
    primary: first
      ? { verb: "open", label: "打开任务", object_id: first.work_item_id, object_type: "task", person_id: first.person_id || null }
      : { verb: "open", label: "查看任务列表", object_id: null, object_type: "task", person_id: null },
    reasoning: [
      "Host 已读取当前开放正式任务。",
      "任务按优先级、期限和进行中状态排序。",
      "今日任务与我的待办使用同一份计划结果，再按视图展示。",
    ],
    stats: {
      unfinished: formal.length,
      discovery_anomalies: Number(pack.now_counts?.discovery_anomalies || 0),
      failed_runs: Number(pack.now_counts?.failed_runs || 0),
      today_tasks: formal.filter((item) => isTodayWorkItem(item)).length,
      todo_tasks: formal.filter((item) => !isTodayWorkItem(item)).length,
      stage_counts: pack.stage_counts,
    },
    source_cursor: pack.source_cursor,
    increment_summary: `已生成 ${formal.length} 项任务的统一工作计划`,
    display_tasks: [],
  } as Json;
}

export async function executeTodayPlanRun(input: {
  owner: string;
  workItemId: string;
  sessionId: string;
  runId: string;
  pack: TodayPlanPack;
  scope?: PlanScope;
  producer?: "deterministic_organize" | "agent_plan";
}): Promise<{ ok: true; receipt: Json } | { ok: false; reason: string }> {
  const scope = input.scope ?? "today";
  const copy = PLAN_EMPLOYEE_EVENTS[scope];
  const extra = planningRunInput(input.pack, {
    work_item_id: input.workItemId,
    task_run_id: input.runId,
  }, scope);
  const trace = createRunTraceSink({ workItemId: input.workItemId, runId: input.runId });
  try {
    // Producer mode is persisted with the accepted job. UI copy must describe
    // the selected producer, never infer "AI planning" from a fast host view.
    const fastMode = (input.producer || "deterministic_organize") === "deterministic_organize";
    appendTaskEvent(
      input.workItemId,
      input.runId,
      "run.progress",
      fastMode ? "开始生成统一工作计划" : copy.codexSubmitted,
      "running",
      fastMode ? "Host 将直接生成任务视图" : copy.codexSubmitted,
    );
    if (fastMode) {
      appendTaskEvent(input.workItemId, input.runId, "run.phase", "读取合作阶段", "running", `待打招呼 ${input.pack.stage_counts.greet} · 待跟进 ${input.pack.stage_counts.follow} · 待报价 ${input.pack.stage_counts.quote} · 谈判中 ${input.pack.stage_counts.negotiate}`);
      appendTaskEvent(input.workItemId, input.runId, "run.phase", "整理优先级与今日范围", "running", `${input.pack.now_counts.unfinished} 项正式任务，来源增量 ${input.pack.delta.added.length} 项`);
      appendTaskEvent(input.workItemId, input.runId, "run.phase", "生成统一任务视图", "running", "今日任务与我的待办共享同一份计划结果");
      const brief = withHostDisplayTasks(hostFastBrief(input.pack), input.pack);
      const written = writeTodayBriefArtifact({
        owner: input.owner,
        workItemId: input.workItemId,
        runId: input.runId,
        brief,
        scope,
        producer: input.producer || "deterministic_organize",
      });
      appendTaskEvent(input.workItemId, input.runId, "run.phase", "校验输出", "running", written.ok ? `${input.pack.now_counts.unfinished} 项任务展示覆盖完整` : written.reason);
      if (!written.ok) {
        markTodayPlanFailed(input.workItemId, input.runId, written.reason);
        trace.finish(true);
        appendTaskEvent(input.workItemId, input.runId, "run.failed", copy.invalid, "failed", written.reason);
        return { ok: false, reason: written.reason };
      }
      markTodayPlanCompleted(input.workItemId, input.runId);
      trace.finish(false);
      appendTaskEvent(input.workItemId, input.runId, "run.completed", copy.completed, "completed", "Host 已快速生成统一工作计划");
      return { ok: true, receipt: { artifact_id: written.artifact_id, mode: "deterministic_organize", scope } };
    }
    const wr = await Promise.resolve(runWorker(
      input.sessionId,
      planTaskType(scope),
      scope === "todo" ? "规划待办工作。只输出 today_brief JSON。" : "规划今天的工作。只输出 today_brief JSON。",
      extra,
      undefined,
      trace.onStream,
    ));
    trace.finish(false);
    appendTaskEvent(
      input.workItemId,
      input.runId,
      "run.progress",
      copy.writingBrief,
      "running",
      copy.writingBrief,
    );
    const modelBrief = briefFromWorkerItems(wr.items);
    const brief = withHostDisplayTasks(modelBrief, input.pack);
    if (brief && typeof brief === "object" && !Array.isArray(brief)) {
      const root = brief as Json;
      const stats = root.stats && typeof root.stats === "object" && !Array.isArray(root.stats)
        ? { ...(root.stats as Json) }
        : {};
      if (stats.candidates == null) stats.candidates = input.pack.catalog.length;
      if (root.stage_counts == null) root.stage_counts = input.pack.stage_counts;
      root.stats = stats;
    }
    const missingCoverage = missingDisplayCoverage(brief, input.pack);
    if (missingCoverage.length) {
      const reason = `展示行漏了 ${missingCoverage.length} 项任务（${missingCoverage.slice(0, 3).join("、")}）`;
      markTodayPlanFailed(input.workItemId, input.runId, reason);
      trace.finish(true);
      appendTaskEvent(input.workItemId, input.runId, "run.failed", copy.invalid, "failed", reason);
      return { ok: false, reason };
    }
    const written = writeTodayBriefArtifact({
      owner: input.owner,
      workItemId: input.workItemId,
      runId: input.runId,
      brief,
      scope,
      producer: input.producer || "agent_plan",
    });
    if (!written.ok) {
      markTodayPlanFailed(input.workItemId, input.runId, written.reason);
      trace.finish(true);
      appendTaskEvent(input.workItemId, input.runId, "run.failed", copy.invalid, "failed", written.reason);
      return { ok: false, reason: written.reason };
    }
    markTodayPlanCompleted(input.workItemId, input.runId);
    appendTaskEvent(input.workItemId, input.runId, "run.completed", copy.completed, "completed", "today_brief 已更新");
    return { ok: true, receipt: { artifact_id: written.artifact_id, mode: "agent_plan", scope } };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    markTodayPlanFailed(input.workItemId, input.runId, reason);
    trace.finish(true);
    appendTaskEvent(input.workItemId, input.runId, "run.failed", copy.failed, "failed", reason.slice(0, 1000));
    return { ok: false, reason };
  }
}

type PlanningStart = {
  work_item_id: string;
  session_id: string;
  run_id: string;
  execution_job_id: string;
  producer: "deterministic_organize" | "agent_plan";
  attached: boolean;
  planning: boolean;
};

function enqueuePlanningExecution(input: {
  db: SqliteConn;
  jobType: "work_plan.run" | "today_analyze.run";
  owner: string;
  workItemId: string;
  runId: string;
  scope: PlanScope;
  payload: Json;
  extraPayload: Json;
}): string {
  const queued = enqueueExecutionJob({
    job_type: input.jobType,
    tenant_ref: "company:amperetime",
    actor_ref: input.owner,
    ticket_id: input.workItemId,
    run_id: input.runId,
    object_ref: { type: "ticket", id: input.workItemId },
    rule_id: input.jobType === "work_plan.run" ? "workbench-plan" : "today-analyze",
    rule_version: "task-workbench.v1",
    risk_level: "low",
    scope_snapshot: { scope: input.scope, projection_version: "task-workbench.v1" },
    priority_class: "normal",
    max_attempts: 1,
    idempotency_key: `${input.jobType}:${input.runId}`,
    payload: {
      owner: input.owner,
      work_item_id: input.workItemId,
      run_id: input.runId,
      scope: input.scope,
      task_payload: input.payload,
      ...input.extraPayload,
    },
    outbox: {
      event_type: `${input.jobType}.queued`,
      aggregate_type: "task_run",
      aggregate_id: input.runId,
      payload: { work_item_id: input.workItemId, run_id: input.runId, scope: input.scope },
    },
  }, { db: input.db });
  return String(queued.job.id);
}

export function startTodayPlan(
  owner = ownerId(),
  scope: PlanScope = "today",
  producer: "deterministic_organize" | "agent_plan" = "deterministic_organize",
): PlanningStart {
  const canonicalScope: PlanScope = "today";
  const existing = runningTodayPlan(owner, canonicalScope);
  if (existing?.session_id && existing.run_id) {
    const existingJob = getConn().prepare(
      "SELECT id FROM execution_jobs WHERE run_id=? ORDER BY created_at DESC LIMIT 1",
    ).get(existing.run_id) as { id?: string } | undefined;
    return {
      work_item_id: existing.work_item_id,
      session_id: existing.session_id,
      run_id: existing.run_id,
      execution_job_id: String(existingJob?.id || ""),
      producer,
      attached: true,
      planning: true,
    };
  }
  const copy = PLAN_EMPLOYEE_EVENTS[canonicalScope];
  const taskType = planTaskType(canonicalScope);
  const title = "统一工作计划";
  const pack = packTodayPlanContext(owner, canonicalScope);
  const payload = planningRunInput(pack, {}, canonicalScope);
  const identity = planningRuntimeIdentity(taskType);
  const created = tx((db) => {
    const sessionId = createPlanningSession(db, title, owner, identity.session_identity, taskType);
    const workItemId = createPlanningWorkItem({ db, owner, taskType, title, sessionId, payload });
    const runId = createPlanningRun(db, workItemId, sessionId, payload);
    const executionJobId = enqueuePlanningExecution({
      db, jobType: "work_plan.run", owner, workItemId, runId, scope: canonicalScope, payload,
      extraPayload: { session_id: sessionId, pack, producer },
    });
    appendTaskEventInConn(db, workItemId, runId, "run.queued", "工作计划已入队", "queued", "已持久化等待执行");
    appendTaskEventInConn(db, workItemId, runId, "run.progress", copy.memoryRead, "queued", memoryReadSummary(pack, scope));
    appendTaskEventInConn(db, workItemId, runId, "run.progress", copy.deltaPacked, "queued", `来源增量 ${pack.delta.added.length} 项`);
    return { sessionId, workItemId, runId, executionJobId };
  });
  audit(owner, `${taskType}.started`, {
    work_item_id: created.workItemId,
    session_id: created.sessionId,
    run_id: created.runId,
    execution_job_id: created.executionJobId,
    creates_session: true,
  });
  return {
    work_item_id: created.workItemId,
    session_id: created.sessionId,
    run_id: created.runId,
    execution_job_id: created.executionJobId,
    producer,
    attached: false,
    planning: true,
  };
}

export function startTodayAnalyze(body: Json, owner = ownerId()): Omit<PlanningStart, "attached" | "planning" | "producer"> {
  const definition = requireTaskDefinition("today_analyze");
  if (!definition) throw new HttpFail(400, { code: "unknown_task_type", task_type: "today_analyze" });
  const identity = planningRuntimeIdentity("today_analyze");
  const objects = Array.isArray(body.objects) ? body.objects : Array.isArray(body.object_ids) ? body.object_ids : [];
  const payload: Json = {
    mode: "today_analyze",
    agent_id: identity.agent_id,
    expert_id: identity.session_identity,
    skip_user_memory: true,
    objects,
    planning_harness: planningHarnessMount("today_analyze"),
  };
  const created = tx((db) => {
    const sessionId = createPlanningSession(db, "今日对象分析", owner, identity.session_identity, "today_analyze");
    const workItemId = createPlanningWorkItem({ db, owner, taskType: "today_analyze", title: "今日对象分析", sessionId, payload });
    const runId = createPlanningRun(db, workItemId, sessionId, payload);
    const executionJobId = enqueuePlanningExecution({
      db, jobType: "today_analyze.run", owner, workItemId, runId, scope: "today", payload,
      extraPayload: { session_id: sessionId, prompt: String(body.text || "分析所选对象并建议下一步，不要改状态。") },
    });
    appendTaskEventInConn(db, workItemId, runId, "run.queued", "对象分析已入队", "queued", "只读分析，不写正式状态");
    return { sessionId, workItemId, runId, executionJobId };
  });
  audit(owner, "today_analyze.started", { work_item_id: created.workItemId, session_id: created.sessionId, run_id: created.runId, execution_job_id: created.executionJobId });
  return { work_item_id: created.workItemId, session_id: created.sessionId, run_id: created.runId, execution_job_id: created.executionJobId };
}

function terminalPlanningStatus(value: unknown): boolean {
  return ["completed", "failed", "cancelled"].includes(String(value || ""));
}

async function executeTodayAnalyzeRun(input: {
  owner: string;
  workItemId: string;
  sessionId: string;
  runId: string;
  payload: Json;
  prompt: string;
}): Promise<{ ok: true; receipt: Json } | { ok: false; reason: string }> {
  try {
    await Promise.resolve(runWorker(
      input.sessionId,
      "today_analyze",
      input.prompt,
      { ...input.payload, work_item_id: input.workItemId, task_run_id: input.runId },
    ));
    markTodayPlanCompleted(input.workItemId, input.runId);
    appendTaskEvent(input.workItemId, input.runId, "run.completed", "对象分析已完成", "completed", "未写入正式状态");
    return { ok: true, receipt: { mode: "today_analyze", side_effect: "none" } };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    markTodayPlanFailed(input.workItemId, input.runId, reason);
    appendTaskEvent(input.workItemId, input.runId, "run.failed", "对象分析失败", "failed", reason.slice(0, 1000));
    return { ok: false, reason };
  }
}

/**
 * Common durable handler for the work-plan and today-analyze task types. The
 * HTTP request creates the session, ticket, run, task event, job, and outbox
 * fact atomically; only this handler is allowed to cross into a worker/model.
 */
export async function executeClaimedPlanningJob(claimed: ClaimedExecutionJob): Promise<string> {
  const executionJobId = String(claimed.id);
  const jobType = String(claimed.job_type);
  const payload = executionJobPayload(claimed);
  const workItemId = String(payload.work_item_id || claimed.ticket_id || "");
  const runId = String(payload.run_id || claimed.run_id || "");
  const owner = String(payload.owner || claimed.actor_ref || "");
  if (!workItemId || !runId || !owner) {
    failExecutionJob(executionJobId, { code: "invalid_payload", summary: `${jobType} requires owner, work_item_id, and run_id` });
    throw new HttpFail(500, "invalid planning execution job payload");
  }
  const db = getConn();
  const current = db.prepare(
    `SELECT t.status AS ticket_status, r.status AS run_status, r.session_id
       FROM tickets t JOIN task_runs r ON r.work_item_id=t.id
      WHERE t.id=? AND r.id=?`,
  ).get(workItemId, runId) as { ticket_status?: string; run_status?: string; session_id?: string | null } | undefined;
  if (!current) {
    failExecutionJob(executionJobId, { code: "task_run_missing", summary: `Task run missing: ${runId}` });
    throw new HttpFail(404, "planning task run not found");
  }
  if (terminalPlanningStatus(current.run_status) || terminalPlanningStatus(current.ticket_status)) {
    completeExecutionJob(executionJobId, { work_item_id: workItemId, run_id: runId, duplicate: true, status: current.run_status || current.ticket_status });
    return workItemId;
  }
  tx((transaction) => {
    const now = nowIso();
    transaction.prepare(
      "UPDATE task_runs SET status='running',started_at=COALESCE(started_at,?) WHERE id=? AND work_item_id=?",
    ).run(now, runId, workItemId);
    transaction.prepare(
      "UPDATE tickets SET status='running',started_at=COALESCE(started_at,?),updated_at=?,data_version=data_version+1 WHERE id=?",
    ).run(now, now, workItemId);
    appendTaskEventInConn(
      transaction,
      workItemId,
      runId,
      "run.started",
      jobType === "work_plan.run" ? "开始生成统一工作计划" : "正在分析所选对象",
      "running",
      "持久执行器已领取作业",
    );
  });
  publishExecutionOutboxForJob(executionJobId, claimed.worker_id);

  const sessionId = String(payload.session_id || current.session_id || "");
  let result: { ok: true; receipt: Json } | { ok: false; reason: string };
  if (jobType === "work_plan.run") {
    const pack = payload.pack;
    if (!pack || typeof pack !== "object" || Array.isArray(pack) || !sessionId) {
      const reason = "work_plan.run payload is missing plan context or session";
      markTodayPlanFailed(workItemId, runId, reason);
      failExecutionJob(executionJobId, { code: "invalid_payload", summary: reason });
      return workItemId;
    }
    result = await executeTodayPlanRun({
      owner,
      workItemId,
      sessionId,
      runId,
      pack: pack as TodayPlanPack,
      scope: String(payload.scope || "today") === "todo" ? "todo" : "today",
      producer: payload.producer === "agent_plan" ? "agent_plan" : "deterministic_organize",
    });
  } else if (jobType === "today_analyze.run") {
    result = await executeTodayAnalyzeRun({
      owner,
      workItemId,
      sessionId,
      runId,
      payload: (payload.task_payload && typeof payload.task_payload === "object" && !Array.isArray(payload.task_payload)
        ? payload.task_payload : {}) as Json,
      prompt: String(payload.prompt || "分析所选对象并建议下一步，不要改状态。"),
    });
  } else {
    const reason = `Unsupported planning job type: ${jobType}`;
    markTodayPlanFailed(workItemId, runId, reason);
    failExecutionJob(executionJobId, { code: "unsupported_job_type", summary: reason });
    return workItemId;
  }
  if (result.ok) {
    completeExecutionJob(executionJobId, { work_item_id: workItemId, run_id: runId, ...result.receipt });
  } else {
    failExecutionJob(executionJobId, { code: "planning_failed", summary: result.reason });
  }
  return workItemId;
}

export function todayBriefSnapshot(owner = ownerId(), scope: PlanScope = "today"): Json {
  const running = runningTodayPlan(owner, scope);
  const latest = getConn().prepare(
    `SELECT artifact_id, work_item_id FROM ${briefPointerTable(scope)} WHERE owner_user_id=?`,
  ).get(owner) as { artifact_id: string; work_item_id: string } | undefined;
  let brief: Json | null = null;
  let snapshotRunId: string | null = null;
  let snapshotGeneratedAt: string | null = null;
  if (latest) {
    const row = getConn().prepare("SELECT payload,run_id,created_at FROM task_artifacts WHERE id=?").get(latest.artifact_id) as
      | { payload: string; run_id: string | null; created_at: string }
      | undefined;
    brief = row ? parseJson(row.payload) : null;
    snapshotRunId = row?.run_id || null;
    snapshotGeneratedAt = row?.created_at || null;
  }
  const snapshot = brief && typeof brief === "object" && !Array.isArray(brief) ? brief : {} as Json;
  const storedRevision = String(snapshot.source_revision || ((snapshot.source_cursor as Json | undefined)?.cursor_to || ""));
  let currentRevision = "";
  if (brief) {
    try {
      currentRevision = String(packTodayPlanContext(owner, scope).source_cursor?.cursor_to || "");
    } catch {
      // A source lookup failure never erases the last good plan snapshot.
      currentRevision = "";
    }
  }
  const staleReason = brief && storedRevision && currentRevision && storedRevision !== currentRevision
    ? "source_revision_changed"
    : null;
  // The 思考过程 card must show the trace of the newest attempt, including a
  // failed one; the brief pointer only exists after a success, so it is the
  // last resort rather than the default.
  const newestRun = getConn().prepare(
    `SELECT id FROM tickets WHERE owner_user_id=? AND task_type=? ORDER BY created_at DESC LIMIT 1`,
  ).get(owner, planTaskType(scope)) as { id: string } | undefined;
  const traceItem = running?.work_item_id || newestRun?.id || latest?.work_item_id || null;
  const briefItem = running?.work_item_id || latest?.work_item_id || null;
  // The folded history is relative to the trace currently on screen. When the
  // newest run failed it has no brief pointer, so using `briefItem` here would
  // pair an older brief with this failed run's timestamp and task count.
  const previous = previousPlan(owner, scope, traceItem);
  return {
    plan_id: latest?.artifact_id || null,
    status: running ? "running" : brief ? (staleReason ? "stale" : "ready") : "empty",
    producer: String(snapshot.producer || "unknown"),
    source_revision: storedRevision || null,
    generated_at: String(snapshot.generated_at || snapshotGeneratedAt || "") || null,
    stale_reason: staleReason,
    planning: Boolean(running),
    brief,
    events: traceItem ? planningEvents(traceItem) : [],
    work_item_id: briefItem || traceItem,
    session_id: running?.session_id || null,
    run_id: running?.run_id || snapshotRunId,
    previous_brief: previous.brief,
    previous_events: previous.events,
    previous_work_item_id: previous.work_item_id,
    entry: "memory",
    kind: "memory",
    creates_session: false,
    calls_model: false,
  };
}

/**
 * The plan before the current one, so the pane can fold it to a single row
 * instead of stacking versions. Keyed off the current work item so a second
 * artifact of the same run never counts as "previous".
 */
export function previousPlan(owner: string, scope: PlanScope, currentWorkItemId: string | null): {
  brief: Json | null;
  events: Json[];
  work_item_id: string | null;
} {
  const current = String(currentWorkItemId || "");
  const artifacts = getConn().prepare(
    `SELECT a.work_item_id, a.payload
       FROM task_artifacts a
       JOIN tickets w ON w.id = a.work_item_id
      WHERE w.owner_user_id=? AND w.task_type=? AND a.artifact_type='today_brief'
      ORDER BY a.created_at DESC
      LIMIT 4`,
  ).all(owner, planTaskType(scope)) as { work_item_id: string; payload: string }[];
  const previousArtifact = artifacts.find((row) => String(row.work_item_id) !== current) || null;
  const runs = getConn().prepare(
    `SELECT id FROM tickets WHERE owner_user_id=? AND task_type=? ORDER BY created_at DESC LIMIT 4`,
  ).all(owner, planTaskType(scope)) as { id: string }[];
  const previousRun = runs.find((row) => String(row.id) !== current) || null;
  return {
    brief: previousArtifact ? parseJson(previousArtifact.payload) : null,
    events: previousRun ? planningEvents(String(previousRun.id)) : [],
    work_item_id: previousRun ? String(previousRun.id) : null,
  };
}
