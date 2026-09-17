import { Hono } from "hono";
import { DEMO_USER } from "../config.js";
import { authDisabled, isAdmin, scopedUser } from "../auth.js";
import { HttpFail } from "../host/errors.js";
import { startTodayAnalyze, startTodayPlan, todayBriefSnapshot } from "../host/today-plan-run.js";
import type { Json } from "../types.js";

export const homeToday = new Hono();

function ownerId(): string {
  const user = scopedUser();
  if (user) return user.id;
  if (authDisabled() || isAdmin()) return DEMO_USER.id;
  throw new HttpFail(401, "authentication required");
}

/** Memory GET. Zero model / zero Codex / zero session insert. */
homeToday.get("/home/today-brief", (c) => {
  c.header("Cache-Control", "no-store");
  return c.json(todayBriefSnapshot(ownerId()));
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
