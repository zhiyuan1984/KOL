import { Hono } from "hono";
import { DEMO_USER } from "../config.js";
import { authDisabled, isAdmin, scopedUser } from "../auth.js";
import { HttpFail } from "../host/errors.js";
import { TASK_COVER_MEMORY, TASK_MEMORY, TASK_RESULT_MEMORY } from "../host/memory-kinds.js";
import { loadTodayTaskResults } from "../host/today-tasks.js";
import { startTodayAnalyze, startTodayPlan, todayBriefSnapshot } from "../host/today-plan-run.js";
import type { Json } from "../types.js";

export const homeToday = new Hono();

function ownerId(): string {
  const user = scopedUser();
  if (user) return user.id;
  if (authDisabled() || isAdmin()) return DEMO_USER.id;
  throw new HttpFail(401, "authentication required");
}

/** Cover memory GET. Zero model. Not the display task list. */
homeToday.get("/home/today-brief", (c) => {
  c.header("Cache-Control", "no-store");
  return c.json({
    ...todayBriefSnapshot(ownerId()),
    memory_kind: TASK_COVER_MEMORY,
    domain: "summary",
    layer: "display",
  });
});

/** Result memory GET: Codex-processed tasks for display. Zero model. */
homeToday.get("/home/today-tasks", (c) => {
  c.header("Cache-Control", "no-store");
  const results = loadTodayTaskResults(ownerId());
  return c.json({
    memory_kind: TASK_RESULT_MEMORY,
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

/** Think POST. Locks task_type=today_plan and runs internally. Never from-text. */
homeToday.post("/home/today-brief/plan", (c) => {
  const started = startTodayPlan(ownerId());
  return c.json({
    ...started,
    entry: "think",
    kind: "think",
    creates_session: true,
    calls_model: true,
  }, started.attached ? 200 : 202);
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
