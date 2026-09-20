import { DEMO_USER } from "../config.js";
import { audit, getConn, nowIso, tx } from "../db.js";
import { nid } from "../ids.js";
import { requireTaskDefinition } from "../tasks/registry.js";
import type { Json } from "../types.js";
import {
  applyProgress,
  finishProcessItems,
  mcpCallDisplay,
  upsertOperationItem,
  type WorkerProgress,
  type WorkerTraceItem,
} from "../worker/progress.js";
import { authDisabled, isAdmin, scopedUser } from "../auth.js";
import { appendTaskEvent, upsertTaskEvent } from "../routers/tasks.js";
import { runWorker } from "../worker/runner.js";
import { HttpFail } from "./errors.js";
import { runningTodayPlan, writeTodayBriefArtifact, markTodayPlanCompleted, markTodayPlanFailed } from "./today-brief.js";
import {
  briefPointerTable,
  packTodayPlanContext,
  planTaskType,
  planningHarnessMount,
  planningRunInput,
  type PlanScope,
  type TodayPlanPack,
} from "./today-plan-context.js";

function ownerId(): string {
  const user = scopedUser();
  if (user) return user.id;
  if (authDisabled() || isAdmin()) return DEMO_USER.id;
  return DEMO_USER.id;
}

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

function createPlanningSession(title: string, owner: string, expertId: string, kind = "today_plan"): string {
  const now = nowIso();
  const sid = nid("ses");
  tx((db) => {
    db.prepare(
      `INSERT INTO sessions
       (id,title,created_at,updated_at,kind,disabled,owner_user_id,expert_id,expert_version)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(sid, title, now, now, kind, 0, owner, expertId, null);
  });
  return sid;
}

function createPlanningWorkItem(input: {
  owner: string;
  taskType: "today_plan" | "today_analyze" | "todo_plan";
  title: string;
  sessionId: string;
  payload: Json;
}): string {
  const definition = requireTaskDefinition(input.taskType);
  const now = nowIso();
  const id = nid("tsk");
  tx((db) => {
    db.prepare(
      `INSERT INTO work_items
       (id,owner_user_id,task_type,title,source,status,priority,skill,profile,project_id,
        collaboration_id,session_id,due_at,input,entities,data_version,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id,
      input.owner,
      definition.id,
      input.title.slice(0, 200),
      "planning",
      "running",
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
  });
  return id;
}

function createPlanningRun(workItemId: string, sessionId: string, payload: Json): string {
  const now = nowIso();
  const runId = nid("run");
  tx((db) => {
    db.prepare(
      `INSERT INTO task_runs
       (id,work_item_id,session_id,status,input,entities,created_at,started_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).run(runId, workItemId, sessionId, "running", JSON.stringify(payload), "{}", now, now);
    db.prepare(
      "UPDATE work_items SET started_at=COALESCE(started_at,?), updated_at=?, data_version=data_version+1 WHERE id=?",
    ).run(now, now, workItemId);
  });
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

/** Reasoning deltas arrive per token; batch them into one row write each tick. */
const TRACE_FLUSH_MS = 400;

type PlanTraceRow = {
  itemKey: string;
  eventType: string;
  label: string;
  status: string;
  summary: string;
};

/**
 * Harness trace item → 处理过程 row. The card used to keep only the last 600
 * characters of one reasoning summary, so every Host phase and MCP read was
 * dropped and the few rows left looked canned. These are the same items the
 * session page renders; each is persisted under its own item_key.
 */
function planTraceRow(item: WorkerTraceItem): PlanTraceRow {
  if (item.kind === "reasoning") {
    const text = item.label === "正在分析…" ? "" : String(item.label || "").replace(/\*\*/g, "").trim();
    return {
      itemKey: item.id,
      eventType: "run.think",
      label: "Codex 推理",
      status: item.status,
      summary: text.slice(-1000),
    };
  }
  return {
    itemKey: item.id,
    eventType: "run.step",
    label: String(item.label || "").trim() || "处理中",
    status: item.status,
    summary: "",
  };
}

export async function executeTodayPlanRun(input: {
  owner: string;
  workItemId: string;
  sessionId: string;
  runId: string;
  pack: TodayPlanPack;
  scope?: PlanScope;
}): Promise<void> {
  const scope = input.scope ?? "today";
  const copy = PLAN_EMPLOYEE_EVENTS[scope];
  const extra = planningRunInput(input.pack, {
    work_item_id: input.workItemId,
    task_run_id: input.runId,
  }, scope);
  let items: WorkerTraceItem[] = [];
  let operations: { id: string; name: string; label: string; status: string }[] = [];
  let traceDirty = false;
  let traceHandle: ReturnType<typeof setTimeout> | null = null;
  /** Only changed rows are written: a flush re-walks every item. */
  const written = new Map<string, string>();
  const writeRow = (
    itemKey: string,
    eventType: string,
    label: string,
    status: string,
    summary: string,
  ) => {
    const stamp = `${label}\u0000${status}\u0000${summary}`;
    if (written.get(itemKey) === stamp) return;
    written.set(itemKey, stamp);
    upsertTaskEvent(input.workItemId, input.runId, itemKey, eventType, label, status, summary);
  };
  const writeTrace = () => {
    for (const item of items) {
      const row = planTraceRow(item);
      writeRow(row.itemKey, row.eventType, row.label, row.status, row.summary);
    }
    for (const operation of operations) {
      writeRow(
        `op:${operation.id}`,
        "run.tool",
        mcpCallDisplay(operation),
        operation.status,
        operation.name,
      );
    }
  };
  const flushTrace = () => {
    traceHandle = null;
    if (!traceDirty) return;
    traceDirty = false;
    writeTrace();
  };
  const scheduleTrace = (immediate: boolean) => {
    traceDirty = true;
    if (immediate) {
      if (traceHandle) clearTimeout(traceHandle);
      flushTrace();
      return;
    }
    if (!traceHandle) traceHandle = setTimeout(flushTrace, TRACE_FLUSH_MS);
  };
  const onStream = (progress: WorkerProgress) => {
    if (progress.operation) {
      operations = upsertOperationItem(operations, progress.operation);
      scheduleTrace(true);
      return;
    }
    if (!progress.trace) return;
    items = applyProgress(items, progress);
    // Phase and tool transitions are rare and worth showing at once; reasoning
    // text grows every token, so it batches.
    scheduleTrace(progress.trace.kind !== "reasoning");
  };
  const finishTrace = (failed: boolean) => {
    items = finishProcessItems(items, failed);
    operations = operations.map((operation) => ({ ...operation, status: failed ? "failed" : "done" }));
    scheduleTrace(true);
  };
  try {
    appendTaskEvent(
      input.workItemId,
      input.runId,
      "run.progress",
      copy.codexSubmitted,
      "running",
      copy.codexSubmitted,
    );
    const wr = await Promise.resolve(runWorker(
      input.sessionId,
      planTaskType(scope),
      scope === "todo" ? "规划待办工作。只输出 today_brief JSON。" : "规划今天的工作。只输出 today_brief JSON。",
      extra,
      undefined,
      onStream,
    ));
    finishTrace(false);
    appendTaskEvent(
      input.workItemId,
      input.runId,
      "run.progress",
      copy.writingBrief,
      "running",
      copy.writingBrief,
    );
    const brief = briefFromWorkerItems(wr.items);
    if (brief && typeof brief === "object" && !Array.isArray(brief)) {
      const root = brief as Json;
      const stats = root.stats && typeof root.stats === "object" && !Array.isArray(root.stats)
        ? { ...(root.stats as Json) }
        : {};
      if (stats.candidates == null) stats.candidates = input.pack.catalog.length;
      root.stats = stats;
    }
    const missingCoverage = missingDisplayCoverage(brief, input.pack);
    if (missingCoverage.length) {
      const reason = `展示行漏了 ${missingCoverage.length} 项任务（${missingCoverage.slice(0, 3).join("、")}）`;
      markTodayPlanFailed(input.workItemId, input.runId, reason);
      finishTrace(true);
      appendTaskEvent(input.workItemId, input.runId, "run.failed", copy.invalid, "failed", reason);
      return;
    }
    const written = writeTodayBriefArtifact({
      owner: input.owner,
      workItemId: input.workItemId,
      runId: input.runId,
      brief,
      scope,
    });
    if (!written.ok) {
      markTodayPlanFailed(input.workItemId, input.runId, written.reason);
      finishTrace(true);
      appendTaskEvent(input.workItemId, input.runId, "run.failed", copy.invalid, "failed", written.reason);
      return;
    }
    markTodayPlanCompleted(input.workItemId, input.runId);
    appendTaskEvent(input.workItemId, input.runId, "run.completed", copy.completed, "completed", "today_brief 已更新");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    markTodayPlanFailed(input.workItemId, input.runId, reason);
    finishTrace(true);
    appendTaskEvent(input.workItemId, input.runId, "run.failed", copy.failed, "failed", reason.slice(0, 1000));
  }
}

export function startTodayPlan(owner = ownerId(), scope: PlanScope = "today"): {
  work_item_id: string;
  session_id: string;
  run_id: string;
  attached: boolean;
  planning: boolean;
} {
  const existing = runningTodayPlan(owner, scope);
  if (existing?.session_id && existing.run_id) {
    return {
      work_item_id: existing.work_item_id,
      session_id: existing.session_id,
      run_id: existing.run_id,
      attached: true,
      planning: true,
    };
  }
  const copy = PLAN_EMPLOYEE_EVENTS[scope];
  const taskType = planTaskType(scope);
  const title = scope === "todo" ? "待办规划" : "今日规划";
  const pack = packTodayPlanContext(owner, scope);
  const payload = planningRunInput(pack, {}, scope);
  const sessionId = createPlanningSession(title, owner, "expert:kol", taskType);
  const workItemId = createPlanningWorkItem({
    owner,
    taskType,
    title,
    sessionId,
    payload,
  });
  const runId = createPlanningRun(workItemId, sessionId, payload);
  appendTaskEvent(
    workItemId,
    runId,
    "run.progress",
    copy.memoryRead,
    "running",
    memoryReadSummary(pack, scope),
  );
  appendTaskEvent(
    workItemId,
    runId,
    "run.progress",
    copy.deltaPacked,
    "running",
    `来源增量 ${pack.delta.added.length} 项`,
  );
  audit(owner, `${taskType}.started`, {
    work_item_id: workItemId,
    session_id: sessionId,
    run_id: runId,
    creates_session: true,
  });
  void executeTodayPlanRun({ owner, workItemId, sessionId, runId, pack, scope });
  return {
    work_item_id: workItemId,
    session_id: sessionId,
    run_id: runId,
    attached: false,
    planning: true,
  };
}

export function startTodayAnalyze(body: Json, owner = ownerId()): {
  work_item_id: string;
  session_id: string;
  run_id: string;
} {
  const definition = requireTaskDefinition("today_analyze");
  if (!definition) throw new HttpFail(400, { code: "unknown_task_type", task_type: "today_analyze" });
  const objects = Array.isArray(body.objects) ? body.objects : Array.isArray(body.object_ids) ? body.object_ids : [];
  const payload: Json = {
    mode: "today_analyze",
    expert_id: "expert:kol",
    skip_user_memory: true,
    objects,
    planning_harness: planningHarnessMount("today_analyze"),
  };
  const sessionId = createPlanningSession("今日对象分析", owner, "expert:kol");
  const workItemId = createPlanningWorkItem({
    owner,
    taskType: "today_analyze",
    title: "今日对象分析",
    sessionId,
    payload,
  });
  const runId = createPlanningRun(workItemId, sessionId, payload);
  appendTaskEvent(workItemId, runId, "run.started", "正在分析所选对象", "running", "只读分析，不写正式状态");
  void Promise.resolve(runWorker(
    sessionId,
    "today_analyze",
    String(body.text || "分析所选对象并建议下一步，不要改状态。"),
    { ...payload, work_item_id: workItemId, task_run_id: runId },
  )).then(() => {
    markTodayPlanCompleted(workItemId, runId);
    appendTaskEvent(workItemId, runId, "run.completed", "对象分析已完成", "completed", "未写入正式状态");
  }).catch((error) => {
    const reason = error instanceof Error ? error.message : String(error);
    markTodayPlanFailed(workItemId, runId, reason);
    appendTaskEvent(workItemId, runId, "run.failed", "对象分析失败", "failed", reason.slice(0, 1000));
  });
  return { work_item_id: workItemId, session_id: sessionId, run_id: runId };
}

export function todayBriefSnapshot(owner = ownerId(), scope: PlanScope = "today"): Json {
  const running = runningTodayPlan(owner, scope);
  const latest = getConn().prepare(
    `SELECT artifact_id, work_item_id FROM ${briefPointerTable(scope)} WHERE owner_user_id=?`,
  ).get(owner) as { artifact_id: string; work_item_id: string } | undefined;
  let brief: Json | null = null;
  if (latest) {
    const row = getConn().prepare("SELECT payload FROM task_artifacts WHERE id=?").get(latest.artifact_id) as
      | { payload: string }
      | undefined;
    brief = row ? parseJson(row.payload) : null;
  }
  // The 思考过程 card must show the trace of the newest attempt, including a
  // failed one; the brief pointer only exists after a success, so it is the
  // last resort rather than the default.
  const newestRun = getConn().prepare(
    `SELECT id FROM work_items WHERE owner_user_id=? AND task_type=? ORDER BY created_at DESC LIMIT 1`,
  ).get(owner, planTaskType(scope)) as { id: string } | undefined;
  const traceItem = running?.work_item_id || newestRun?.id || latest?.work_item_id || null;
  const briefItem = running?.work_item_id || latest?.work_item_id || null;
  return {
    planning: Boolean(running),
    brief,
    events: traceItem ? planningEvents(traceItem) : [],
    work_item_id: briefItem || traceItem,
    session_id: running?.session_id || null,
    run_id: running?.run_id || null,
    entry: "memory",
    kind: "memory",
    creates_session: false,
    calls_model: false,
  };
}
