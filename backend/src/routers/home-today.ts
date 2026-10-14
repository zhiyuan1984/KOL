import { Hono } from "hono";
import { databaseEngine } from "../postgres/access.js";
import { startNativeTodayPlan } from "../postgres/today-plan-repository.js";
import { TASK_MEMORY } from "../host/memory-kinds.js";
import { ownerId, PLAN_SCOPES, SCOPE_TABLE, packTodayPlanContext, planningRunInput, planningHarnessMount, planningRuntimeIdentity } from "../host/today-plan-context.js";
import { planTaskType } from "../host/planning-types.js";
import { loadTodayTaskResults } from "../host/today-tasks.js";
import { startTodayAnalyze, startTodayPlan, todayBriefSnapshot } from "../host/today-plan-run.js";
import { HttpFail } from "../host/errors.js";
import type { Json } from "../types.js";
export const homeToday = new Hono();
/** One plan pointer serves both Today and Todo projections. */
homeToday.get("/workbench/plan", async (c) => {
  c.header("Cache-Control", "no-store");
  const snapshot = (await todayBriefSnapshot(ownerId(), "today"));
  return c.json({
    ...snapshot,
    plan_id: snapshot.work_item_id || null,
    plan_scope: "all_open_todos",
    projection_version: "task-workbench.v1",
    schema_version: "compat.v1",
  });
});

/** Explicit producer mode; deterministic organization never claims a model call. */
homeToday.post("/workbench/plan-runs", async (c) => {
  const body = await c.req.json().catch(() => ({})) as Json;
  const mode = String(body.mode || "deterministic_organize");
  if (mode !== "agent_plan" && mode !== "deterministic_organize") {
    throw new HttpFail(400, "invalid planning mode");
  }
  const owner = ownerId();
  const started = databaseEngine() === "postgres"
    ? await startNativeTodayPlan({ owner, taskType: "today_plan", title: "统一工作计划", scope: "today", producer: mode, payload: planningRunInput((await packTodayPlanContext(owner, "today")), {}, "today"), extraPayload: { producer: mode }, queuedLabel: "工作计划已入队", progress: [] })
    : (await startTodayPlan(owner, "today", mode));
  return c.json({
    ...started,
    mode,
    plan_id: started.work_item_id,
    job_id: started.execution_job_id,
    status: started.attached ? "running" : "queued",
    producer: started.producer,
    calls_model: mode === "agent_plan",
    schema_version: "compat.v1",
  }, started.attached ? 200 : 202);
});

/** Compatibility routes per pane scope; both panes read and start one canonical work plan. */
for (const scope of PLAN_SCOPES) {
  const cfg = SCOPE_TABLE[scope];
  /** Cover memory GET. Zero model. Not the display task list. */
  homeToday.get(`/home/${scope}-brief`, async (c) => {
    c.header("Cache-Control", "no-store");
    return c.json({
      ...(await todayBriefSnapshot(ownerId(), scope)),
      memory_kind: cfg.memoryKindCover,
      domain: "summary",
      layer: "display",
    });
  });
  /** Result memory GET: Codex-processed tasks for display. Zero model. */
  homeToday.get(`/home/${scope}-tasks`, async (c) => {
    c.header("Cache-Control", "no-store");
    const results = (await loadTodayTaskResults(ownerId(), scope));
    return c.json({
      memory_kind: cfg.memoryKindResult,
      domain: "task",
      layer: "display",
      entry: "memory",
      kind: "memory",
      creates_session: false,
      calls_model: false,
      items: results?.items || [],
      planned_at: results?.planned_at || null,
      cursor: results?.planned_at || null,
    });
  });

  /** Think POST. Locks the scope's plan task_type and runs internally. Never from-text. */
  homeToday.post(`/home/${scope}-brief/plan`, async (c) => {
    const owner = ownerId();
    const started = databaseEngine() === "postgres"
      ? await startNativeTodayPlan({ owner, taskType: "today_plan", title: "统一工作计划", scope: "today", producer: "agent_plan", payload: planningRunInput((await packTodayPlanContext(owner, "today")), {}, "today"), extraPayload: { producer: "agent_plan" }, queuedLabel: "工作计划已入队", progress: [] })
      : (await startTodayPlan(owner, scope, "agent_plan"));
    return c.json({
      ...started,
      // Both scopes answer the same shape; the pane renders one component.
      task_type: planTaskType(scope),
      canonical_scope: "today",
      job_id: started.execution_job_id,
      entry: "think",
      kind: "think",
      creates_session: true,
      calls_model: started.producer === "agent_plan",
    }, started.attached ? 200 : 202);
  });
}

/** Raw task memory remains GET /api/tasks?view=open (domain=task layer=raw). */
homeToday.get("/home/today-task-memory", (c) => {
  c.header("Cache-Control", "no-store");
  return c.json({
    memory_kind: TASK_MEMORY,
    domain: "task",
    layer: "raw",
    entry: "memory",
    kind: "memory",
    creates_session: false,
    calls_model: false,
    read: "GET /api/tasks?view=open",
  });
});

/** P1: lock today_analyze without from-text recognition. */
homeToday.post("/home/today-brief/enqueue", async (c) => {
  const body = await c.req.json().catch(() => ({})) as Json;
  const owner = ownerId();
  const identity = planningRuntimeIdentity("today_analyze");
  const objects = Array.isArray(body.objects) ? body.objects : Array.isArray(body.object_ids) ? body.object_ids : [];
  const payload: Json = { mode: "today_analyze", agent_id: identity.agent_id, expert_id: identity.session_identity, skip_user_memory: true, objects, planning_harness: planningHarnessMount("today_analyze") };
  const started = databaseEngine() === "postgres"
    ? await startNativeTodayPlan({ owner, taskType: "today_analyze", title: "今日对象分析", scope: "today", producer: "agent_plan", payload, extraPayload: { prompt: String(body.text || "分析所选对象并建议下一步，不要改状态。") }, queuedLabel: "对象分析已入队", progress: [] })
    : (await startTodayAnalyze(body, owner));
  return c.json({
    ...started,
    task_type: "today_analyze",
    entry: "think",
    kind: "think",
    creates_session: true,
    calls_model: true,
  }, 202);
});
