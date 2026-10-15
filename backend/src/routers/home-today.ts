import { Hono } from "hono";
import { startNativeTodayPlan, nativeTodayPlanContext, nativeTodayBriefSnapshot, nativeTodayTaskResults } from "../postgres/today-plan-repository.js";
import { TASK_MEMORY } from "../host/memory-kinds.js";
import { ownerId, PLAN_SCOPES, SCOPE_TABLE, planningHarnessMount, planningRunInput, planningRuntimeIdentity } from "../host/today-plan-context.js";
import { planTaskType } from "../host/planning-types.js";
import { HttpFail } from "../host/errors.js";
import type { Json } from "../types.js";

export const homeToday = new Hono();

async function startPlan(owner: string, mode: "agent_plan" | "deterministic_organize") {
  const pack = await nativeTodayPlanContext(owner, "today");
  return startNativeTodayPlan({
    owner,
    taskType: "today_plan",
    title: "统一工作计划",
    scope: "today",
    producer: mode,
    payload: (await planningRunInput(pack, {}, "today")),
    extraPayload: { producer: mode },
    queuedLabel: "工作计划已入队",
    progress: [
      { label: "已读取当前任务记忆", summary: `未了结 ${pack.now_counts.unfinished} 项` },
      { label: "已打包来源增量", summary: `来源增量 ${pack.delta.added.length} 项` },
    ],
  });
}

homeToday.get("/workbench/plan", async (c) => {
  c.header("Cache-Control", "no-store");
  const owner = ownerId();
  const snapshot = await nativeTodayBriefSnapshot(owner, "today");
  return c.json({ ...snapshot, plan_id: snapshot.work_item_id || null, plan_scope: "all_open_todos", projection_version: "task-workbench.v1", schema_version: "compat.v1" });
});

homeToday.post("/workbench/plan-runs", async (c) => {
  const body = await c.req.json().catch(() => ({})) as Json;
  const mode = String(body.mode || "agent_plan");
  if (mode !== "agent_plan" && mode !== "deterministic_organize") throw new HttpFail(400, "invalid planning mode");
  const started = await startPlan(ownerId(), mode);
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

for (const scope of PLAN_SCOPES) {
  const cfg = SCOPE_TABLE[scope];
  homeToday.get(`/home/${scope}-brief`, async (c) => {
    c.header("Cache-Control", "no-store");
    const snapshot = await nativeTodayBriefSnapshot(ownerId(), scope);
    return c.json({ ...snapshot, memory_kind: cfg.memoryKindCover, domain: "summary", layer: "display" });
  });

  homeToday.get(`/home/${scope}-tasks`, async (c) => {
    c.header("Cache-Control", "no-store");
    const results = await nativeTodayTaskResults(ownerId(), scope);
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

  homeToday.post(`/home/${scope}-brief/plan`, async (c) => {
    const started = await startPlan(ownerId(), "agent_plan");
    return c.json({
      ...started,
      task_type: planTaskType(scope),
      canonical_scope: "today",
      job_id: started.execution_job_id,
      entry: "think",
      kind: "think",
      creates_session: true,
      calls_model: true,
    }, started.attached ? 200 : 202);
  });
}

homeToday.get("/home/today-task-memory", (c) => {
  c.header("Cache-Control", "no-store");
  return c.json({ memory_kind: TASK_MEMORY, domain: "task", layer: "raw", entry: "memory", kind: "memory", creates_session: false, calls_model: false, read: "GET /api/tasks?view=open" });
});

homeToday.post("/home/today-brief/enqueue", async (c) => {
  const body = await c.req.json().catch(() => ({})) as Json;
  const owner = ownerId();
  const identity = (await planningRuntimeIdentity("today_analyze"));
  const objects = Array.isArray(body.objects) ? body.objects : Array.isArray(body.object_ids) ? body.object_ids : [];
  const payload: Json = { mode: "today_analyze", agent_id: identity.agent_id, expert_id: identity.session_identity, skip_user_memory: true, objects, planning_harness: (await planningHarnessMount("today_analyze")) };
  const started = await startNativeTodayPlan({
    owner,
    taskType: "today_analyze",
    title: "今日对象分析",
    scope: "today",
    producer: "agent_plan",
    payload,
    extraPayload: { prompt: String(body.text || "分析所选对象并建议下一步，不要改状态。") },
    queuedLabel: "对象分析已入队",
  });
  return c.json({ ...started, task_type: "today_analyze", entry: "think", kind: "think", creates_session: true, calls_model: true }, started.attached ? 200 : 202);
});
