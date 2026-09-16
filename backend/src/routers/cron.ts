import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { authDisabled, isAdmin, requireAdmin, scopedUser } from "../auth.js";
import { assertHandlerGates, assertCanMutateJob, assertCanSeeJob, assertJobRunnable, canSeeJob } from "../cron/authz.js";
import { handlerContract, isCronHandlerKey } from "../cron/handlers.js";
import { nextRunAt } from "../cron/schedule.js";
import {
  DEFAULT_EXPERT,
  ensureSystemCronJobs,
  isSystemJob,
  jobById,
  listJobs,
  listRuns,
  newJobId,
  publicJob,
  publicRun,
  runById,
} from "../cron/store.js";
import { runCronJobNow, tickCronDue } from "../cron/worker.js";
import { getConn, nowIso } from "../db.js";
import { HttpFail } from "../host/errors.js";
import { label } from "../stages.js";
import type { Json } from "../types.js";

export const cron = new Hono();

function parseBody(raw: unknown): Json {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Json : {};
}

function secretOk(provided: string | undefined, expected: string): boolean {
  const a = Buffer.from(String(provided || ""));
  const b = Buffer.from(expected);
  if (!a.length || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function authorizeTick(c: { req: { header: (name: string) => string | undefined } }): void {
  const secret = String(process.env.CRON_TICK_SECRET || "").trim();
  const provided = String(c.req.header("x-cron-tick-secret") || "").trim();
  if (secret && secretOk(provided, secret)) return;
  if (authDisabled()) return;
  const user = scopedUser();
  if (user && isAdmin(user)) {
    requireAdmin();
    return;
  }
  throw new HttpFail(403, { code: "tick_forbidden", message: "需要管理员或 CRON_TICK_SECRET" });
}

function visibleJobs() {
  ensureSystemCronJobs();
  return listJobs().filter((job) => canSeeJob(job)).map(publicJob);
}

function attention(jobs: Json[]): { failed: number; needs_takeover: number } {
  return {
    failed: jobs.filter((job) => job.last_terminal_status === "failed").length,
    needs_takeover: jobs.filter((job) => job.last_terminal_status === "needs_takeover").length,
  };
}

cron.get("/cron/jobs", (c) => {
  const jobs = visibleJobs();
  return c.json({ jobs, alerts: attention(jobs) });
});

cron.post("/cron/jobs", async (c) => {
  const user = scopedUser();
  if (!authDisabled() && !user) throw new HttpFail(401, "authentication required");
  const body = parseBody(await c.req.json().catch(() => ({})));
  const handlerKey = String(body.handler_key || "");
  if (!isCronHandlerKey(handlerKey)) throw new HttpFail(400, { code: "unknown_handler", message: "只能使用已登记的 handler" });
  if (handlerKey === "discovery-search") throw new HttpFail(409, { code: "not_enabled", message: "发现搜索未启用" });
  assertHandlerGates(handlerKey);
  const cronExpr = String(body.cron_expr || "0 8 * * *");
  const timezone = String(body.timezone || "Asia/Shanghai");
  let next: string;
  try {
    next = nextRunAt(cronExpr, timezone).toISOString();
  } catch {
    throw new HttpFail(400, { code: "invalid_cron_expr", message: "cron_expr 无效" });
  }
  const now = nowIso();
  const id = newJobId();
  const owner = user?.id || null;
  getConn().prepare(
    `INSERT INTO cron_jobs
     (id,job_key,title,owner_account_id,execute_as,capability_expert_id,handler_key,
      scope_json,condition_json,cron_expr,timezone,status,retry_policy_json,takeover_policy_json,
      published_rev,next_run_at,last_run_at,last_terminal_status,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    String(body.job_key || id),
    String(body.title || handlerContract(handlerKey).title || handlerKey),
    owner,
    owner || "employee",
    String(body.capability_expert_id || DEFAULT_EXPERT),
    handlerKey,
    JSON.stringify(body.scope && typeof body.scope === "object" ? body.scope : { applies: "self" }),
    JSON.stringify(body.condition && typeof body.condition === "object" ? body.condition : {}),
    cronExpr,
    timezone,
    String(body.status || "published"),
    JSON.stringify(body.retry_policy && typeof body.retry_policy === "object" ? body.retry_policy : { max_attempts: 1 }),
    JSON.stringify(body.takeover_policy && typeof body.takeover_policy === "object" ? body.takeover_policy : { after_minutes: 30 }),
    1,
    next,
    null,
    null,
    now,
    now,
  );
  return c.json(publicJob(jobById(id)!), 201);
});

cron.get("/cron/jobs/:id", (c) => {
  ensureSystemCronJobs();
  const job = jobById(c.req.param("id"));
  if (!job) throw new HttpFail(404, "cron job not found");
  assertCanSeeJob(job);
  return c.json({ job: publicJob(job), runs: listRuns(String(job.id), 20).map(publicRun) });
});

cron.patch("/cron/jobs/:id", async (c) => {
  ensureSystemCronJobs();
  const job = jobById(c.req.param("id"));
  if (!job) throw new HttpFail(404, "cron job not found");
  assertCanMutateJob(job);
  const body = parseBody(await c.req.json().catch(() => ({})));
  const system = isSystemJob(job);
  if (system && (body.handler_key || body.execute_as || body.job_key || body.capability_expert_id || body.owner_account_id)) {
    throw new HttpFail(403, { code: "legal_field_readonly", message: "系统作业的法定字段只读" });
  }
  const nextStatus = body.status != null ? String(body.status) : String(job.status);
  if (!["draft", "published", "paused", "disabled"].includes(nextStatus)) {
    throw new HttpFail(400, { code: "invalid_status", message: "status 无效" });
  }
  if (system && String(job.handler_key) === "discovery-search" && nextStatus === "published") {
    throw new HttpFail(409, { code: "not_enabled", message: "发现搜索未启用" });
  }
  let cronExpr = String(job.cron_expr);
  let timezone = String(job.timezone || "Asia/Shanghai");
  let scopeJson = String(job.scope_json);
  let bump = false;
  if (body.cron_expr != null) {
    cronExpr = String(body.cron_expr);
    bump = true;
  }
  if (body.timezone != null) {
    timezone = String(body.timezone);
    bump = true;
  }
  if (body.scope != null) {
    scopeJson = JSON.stringify(body.scope);
    bump = true;
  }
  let nextRun = job.next_run_at ? String(job.next_run_at) : null;
  if (bump || (nextStatus === "published" && String(job.status) !== "published")) {
    try {
      nextRun = nextRunAt(cronExpr, timezone).toISOString();
    } catch {
      throw new HttpFail(400, { code: "invalid_cron_expr", message: "cron_expr 无效" });
    }
  }
  if (nextStatus === "paused" || nextStatus === "disabled") nextRun = job.next_run_at ? String(job.next_run_at) : nextRun;
  const publishedRev = Number(job.published_rev || 1) + (bump ? 1 : 0);
  const title = system ? String(job.title) : String(body.title || job.title);
  getConn().prepare(
    `UPDATE cron_jobs
        SET title=?, scope_json=?, cron_expr=?, timezone=?, status=?, published_rev=?, next_run_at=?, updated_at=?
      WHERE id=?`,
  ).run(title, scopeJson, cronExpr, timezone, nextStatus, publishedRev, nextRun, nowIso(), job.id);
  return c.json({ job: publicJob(jobById(String(job.id))!) });
});

cron.post("/cron/jobs/:id/run", (c) => {
  ensureSystemCronJobs();
  const job = jobById(c.req.param("id"));
  if (!job) throw new HttpFail(404, "cron job not found");
  assertCanSeeJob(job);
  assertJobRunnable(job);
  assertHandlerGates(String(job.handler_key));
  const result = runCronJobNow(String(job.id), scopedUser());
  return c.json({ run_id: result.run_id });
});

cron.get("/cron/jobs/:id/runs", (c) => {
  ensureSystemCronJobs();
  const job = jobById(c.req.param("id"));
  if (!job) throw new HttpFail(404, "cron job not found");
  assertCanSeeJob(job);
  return c.json({ runs: listRuns(String(job.id)).map(publicRun) });
});

cron.get("/cron/runs/:runId", (c) => {
  ensureSystemCronJobs();
  const run = runById(c.req.param("runId"));
  if (!run) throw new HttpFail(404, "cron run not found");
  const job = jobById(String(run.job_id));
  if (!job) throw new HttpFail(404, "cron job not found");
  assertCanSeeJob(job);
  return c.json({ run: publicRun(run), job: publicJob(job) });
});

cron.post("/cron/internal/tick", (c) => {
  authorizeTick(c);
  const result = tickCronDue(new Date());
  return c.json({ ok: true, claimed: result.claimed.length, run_ids: result.claimed });
});

cron.get("/cron/risks", (c) => {
  ensureSystemCronJobs();
  const job = jobById("overdue-scan");
  const items = (getConn().prepare(
    "SELECT id, handle, display_name, brand, stage_code, days_in_stage, overdue FROM collaborations WHERE overdue = 1",
  ).all() as Array<Record<string, unknown>>).map((row) => ({
    ...row,
    stage_label: label(String(row.stage_code || "")),
  }));
  return c.json({
    p0: job ? String(job.title) : "失联与延期扫描",
    job_id: job?.id || null,
    items,
  });
});

cron.post("/cron/risk-scan", (c) => {
  ensureSystemCronJobs();
  const job = jobById("overdue-scan");
  if (!job) throw new HttpFail(404, "cron job not found");
  assertCanSeeJob(job);
  assertJobRunnable(job);
  assertHandlerGates("overdue-scan");
  const result = runCronJobNow(String(job.id), scopedUser());
  return c.json({ run_id: result.run_id });
});
