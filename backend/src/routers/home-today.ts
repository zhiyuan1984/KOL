import { Hono } from "hono";
import { TASK_MEMORY } from "../host/memory-kinds.js";
import { ownerId, PLAN_SCOPES, SCOPE_TABLE } from "../host/today-plan-context.js";
import { loadTodayTaskResults } from "../host/today-tasks.js";
import { startTodayAnalyze, startTodayPlan, todayBriefSnapshot } from "../host/today-plan-run.js";
import type { Json } from "../types.js";

export const homeToday = new Hono();

/** Cover/result/plan routes per plan scope. Same pipeline, scope-specific memory kinds. */
for (const scope of PLAN_SCOPES) {
  const cfg = SCOPE_TABLE[scope];

  /** Cover memory GET. Zero model. Not the display task list. */
  homeToday.get(`/home/${scope}-brief`, (c) => {
    c.header("Cache-Control", "no-store");
    return c.json({
      ...todayBriefSnapshot(ownerId(), scope),
      memory_kind: cfg.memoryKindCover,
      domain: "summary",
      layer: "display",
    });
  });

  /** Result memory GET: Codex-processed tasks for display. Zero model. */
  homeToday.get(`/home/${scope}-tasks`, (c) => {
    c.header("Cache-Control", "no-store");
    const results = loadTodayTaskResults(ownerId(), scope);
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
  homeToday.post(`/home/${scope}-brief/plan`, (c) => {
    const started = startTodayPlan(ownerId(), scope);
    return c.json({
      ...started,
      ...(scope === "todo" ? { task_type: "todo_plan" } : {}),
      entry: "think",
      kind: "think",
      creates_session: true,
      calls_model: true,
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
  const started = startTodayAnalyze(body, ownerId());
  return c.json({
    ...started,
    task_type: "today_analyze",
    entry: "think",
    kind: "think",
    creates_session: true,
    calls_model: true,
  }, 202);
});
