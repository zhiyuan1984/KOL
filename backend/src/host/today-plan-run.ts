import { DEMO_USER } from "../config.js";
import { audit, getConn, nowIso, tx } from "../db.js";
import { nid } from "../ids.js";
import { requireTaskDefinition } from "../tasks/registry.js";
import type { Json } from "../types.js";
import { authDisabled, isAdmin, scopedUser } from "../auth.js";
import { appendTaskEvent } from "../routers/tasks.js";
import { runWorker } from "../worker/runner.js";
import { HttpFail } from "./errors.js";
import { runningTodayPlan, writeTodayBriefArtifact, markTodayPlanCompleted, markTodayPlanFailed } from "./today-brief.js";
import { packTodayPlanContext, planningHarnessMount, planningRunInput, type TodayPlanPack } from "./today-plan-context.js";

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

function createPlanningSession(title: string, owner: string, expertId: string): string {
  const now = nowIso();
  const sid = nid("ses");
  tx((db) => {
    db.prepare(
      `INSERT INTO sessions
       (id,title,created_at,updated_at,kind,disabled,owner_user_id,expert_id,expert_version)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(sid, title, now, now, "today_plan", 0, owner, expertId, null);
  });
  return sid;
}

function createPlanningWorkItem(input: {
  owner: string;
  taskType: "today_plan" | "today_analyze";
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

export const TODAY_PLAN_EMPLOYEE_EVENTS = {
  memoryRead: "已读取当前任务记忆",
  deltaPacked: "已打包来源增量",
  codexSubmitted: "已提交 Codex 规划",
  writingBrief: "正在生成今日简报",
  completed: "今日规划已完成",
  failed: "今日规划失败",
  invalid: "今日规划未通过校验",
} as const;

function memoryReadSummary(pack: TodayPlanPack): string {
  const unfinished = Number(pack.now_counts?.unfinished);
  return Number.isFinite(unfinished) ? `未了结 ${unfinished} 项` : TODAY_PLAN_EMPLOYEE_EVENTS.memoryRead;
}

function briefFromWorkerItems(items: Json[]): unknown {
  const hit = items.find((item) => item.type === "today_brief" || (item.lead && item.sections));
  if (!hit) return null;
  if (hit.type === "today_brief") {
    const { type: _type, ...rest } = hit;
    return rest;
  }
  return hit;
}

export async function executeTodayPlanRun(input: {
  owner: string;
  workItemId: string;
  sessionId: string;
  runId: string;
  pack: TodayPlanPack;
}): Promise<void> {
  const extra = planningRunInput(input.pack, {
    work_item_id: input.workItemId,
    task_run_id: input.runId,
  });
  try {
    appendTaskEvent(
      input.workItemId,
      input.runId,
      "run.progress",
      TODAY_PLAN_EMPLOYEE_EVENTS.codexSubmitted,
      "running",
      "已提交 Codex 规划",
    );
    const wr = await Promise.resolve(runWorker(
      input.sessionId,
      "today_plan",
      "规划今天的工作。只输出 today_brief JSON。",
      extra,
    ));
    appendTaskEvent(
      input.workItemId,
      input.runId,
      "run.progress",
      TODAY_PLAN_EMPLOYEE_EVENTS.writingBrief,
      "running",
      "正在生成今日简报",
    );
    const written = writeTodayBriefArtifact({
      owner: input.owner,
      workItemId: input.workItemId,
      runId: input.runId,
      brief: briefFromWorkerItems(wr.items),
    });
    if (!written.ok) {
      markTodayPlanFailed(input.workItemId, input.runId, written.reason);
      appendTaskEvent(input.workItemId, input.runId, "run.failed", TODAY_PLAN_EMPLOYEE_EVENTS.invalid, "failed", written.reason);
      return;
    }
    markTodayPlanCompleted(input.workItemId, input.runId);
    appendTaskEvent(input.workItemId, input.runId, "run.completed", TODAY_PLAN_EMPLOYEE_EVENTS.completed, "completed", "today_brief 已更新");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    markTodayPlanFailed(input.workItemId, input.runId, reason);
    appendTaskEvent(input.workItemId, input.runId, "run.failed", TODAY_PLAN_EMPLOYEE_EVENTS.failed, "failed", reason.slice(0, 1000));
  }
}

export function startTodayPlan(owner = ownerId()): {
  work_item_id: string;
  session_id: string;
  run_id: string;
  attached: boolean;
  planning: boolean;
} {
  const existing = runningTodayPlan(owner);
  if (existing?.session_id && existing.run_id) {
    return {
      work_item_id: existing.work_item_id,
      session_id: existing.session_id,
      run_id: existing.run_id,
      attached: true,
      planning: true,
    };
  }
  const pack = packTodayPlanContext(owner);
  const payload = planningRunInput(pack);
  const sessionId = createPlanningSession("今日规划", owner, "expert:kol");
  const workItemId = createPlanningWorkItem({
    owner,
    taskType: "today_plan",
    title: "今日规划",
    sessionId,
    payload,
  });
  const runId = createPlanningRun(workItemId, sessionId, payload);
  appendTaskEvent(
    workItemId,
    runId,
    "run.progress",
    TODAY_PLAN_EMPLOYEE_EVENTS.memoryRead,
    "running",
    memoryReadSummary(pack),
  );
  appendTaskEvent(
    workItemId,
    runId,
    "run.progress",
    TODAY_PLAN_EMPLOYEE_EVENTS.deltaPacked,
    "running",
    `来源增量 ${pack.delta.added.length} 项`,
  );
  audit(owner, "today_plan.started", {
    work_item_id: workItemId,
    session_id: sessionId,
    run_id: runId,
    creates_session: true,
  });
  void executeTodayPlanRun({ owner, workItemId, sessionId, runId, pack });
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

export function todayBriefSnapshot(owner = ownerId()): Json {
  const running = runningTodayPlan(owner);
  const latest = getConn().prepare(
    "SELECT artifact_id, work_item_id FROM employee_today_briefs WHERE owner_user_id=?",
  ).get(owner) as { artifact_id: string; work_item_id: string } | undefined;
  let brief: Json | null = null;
  if (latest) {
    const row = getConn().prepare("SELECT payload FROM task_artifacts WHERE id=?").get(latest.artifact_id) as
      | { payload: string }
      | undefined;
    brief = row ? parseJson(row.payload) : null;
  }
  const eventSource = running?.work_item_id || latest?.work_item_id || null;
  return {
    planning: Boolean(running),
    brief,
    events: eventSource ? planningEvents(eventSource) : [],
    work_item_id: running?.work_item_id || latest?.work_item_id || null,
    session_id: running?.session_id || null,
    run_id: running?.run_id || null,
    entry: "memory",
    kind: "memory",
    creates_session: false,
    calls_model: false,
  };
}
