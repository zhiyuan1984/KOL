import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { nid } from "../ids.js";
import { requireTicketPrincipal, ticketIsAdmin, ticketPrincipal } from "../ticket-domain/auth.js";
import { assertHandlerGates, assertCanMutateJob, assertCanSeeJob, assertJobRunnable, canSeeJob } from "../cron/authz.js";
import { handlerContract, isCronHandlerKey } from "../cron/handlers.js";
import { nextScheduledAt, type ScheduleWindow } from "../cron/schedule.js";
import { DEFAULT_EXPERT } from "../cron/contracts.js";
import { normalizeSystemTemplate } from "../cron/contracts.js";
import {
  pgCreateCronJob,
  pgCronJobById,
  pgCronPublicJob,
  pgCronPublicJobSummary,
  pgCronPublicRun,
  pgCronRunById,
  pgCronSystemJob,
  pgEnsureSystemCronJobs,
  pgListCronJobs,
  pgListCronRuns,
  pgSchedulingAdminReadModel,
  pgUpdateCronJob,
} from "../cron/postgres-store.js";
import { runCronJobNow, tickCronDue } from "../cron/worker.js";
import { pgExecutionJobPublic, pgRetryFailedExecutionJob } from "../execution-jobs/postgres-store.js";
import { postgresPool } from "../postgres/pool.js";
import { HttpFail } from "../host/errors.js";
import { label } from "../stages.js";
import type { Json, Row } from "../types.js";
import { taskDefinition } from "../tasks/registry.js";

export const cron = new Hono();

function parseBody(raw: unknown): Json {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Json : {};
}

function parseJson(raw: unknown): Json {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Json;
  try {
    const parsed = JSON.parse(String(raw || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Json : {};
  } catch {
    return {};
  }
}

function validateCondition(handlerKey: string, value: unknown): Json {
  const condition = value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
  if (handlerKey === "discovery-search") {
    return { ...condition, system_template: normalizeSystemTemplate(condition.system_template) };
  }
  if (handlerKey !== "ai-task") return condition;
  const composer = condition.composer && typeof condition.composer === "object" ? condition.composer as Json : {};
  if (!String(composer.text || "").trim()) throw new HttpFail(400, "请填写任务内容");
  const scope = composer.scope && typeof composer.scope === "object" ? composer.scope as Json : {};
  const skill = String(composer.intent || (Array.isArray(scope.skills) ? scope.skills[0] || "" : ""));
  const definition = skill ? taskDefinition(skill) : undefined;
  if (definition && definition.side_effects === "write") throw new HttpFail(400, "此技能不可无人在场自动执行");
  const schedule = condition.schedule && typeof condition.schedule === "object" ? condition.schedule as ScheduleWindow : {};
  if (!["recurring", "interval", "once"].includes(String(schedule.kind))) throw new HttpFail(400, "请选择周期、间隔或单次");
  return { ...condition, composer, schedule };
}

function nextFor(expr: string, zone: string, condition: Json): string | null {
  try {
    return nextScheduledAt(expr, zone, (condition.schedule || {}) as ScheduleWindow)?.toISOString() || null;
  } catch {
    throw new HttpFail(400, { code: "invalid_schedule", message: "执行时间或生效区间无效" });
  }
}

function secretOk(provided: string | undefined, expected: string): boolean {
  const a = Buffer.from(String(provided || ""));
  const b = Buffer.from(expected);
  return Boolean(a.length && a.length === b.length && timingSafeEqual(a, b));
}

function authorizeTick(c: { req: { header: (name: string) => string | undefined } }): void {
  const secret = String(process.env.CRON_TICK_SECRET || "").trim();
  if (secret && secretOk(c.req.header("x-cron-tick-secret"), secret)) return;
  const user = requireTicketPrincipal();
  if (ticketIsAdmin(user)) return;
  throw new HttpFail(403, { code: "tick_forbidden", message: "需要管理员或 CRON_TICK_SECRET" });
}

async function visibleJobs(): Promise<Json[]> {
  await pgEnsureSystemCronJobs();
  return (await pgListCronJobs()).filter((job) => canSeeJob(job)).map(pgCronPublicJobSummary);
}

function attention(jobs: Json[]): { failed: number; needs_takeover: number } {
  return {
    failed: jobs.filter((job) => job.last_terminal_status === "failed").length,
    needs_takeover: jobs.filter((job) => job.last_terminal_status === "needs_takeover").length,
  };
}

cron.get("/cron/jobs", async (c) => {
  const jobs = await visibleJobs();
  return c.json({ jobs, alerts: attention(jobs) });
});

cron.get("/admin/scheduling/execution-jobs", async (c) => {
  if (!ticketIsAdmin(requireTicketPrincipal())) throw new HttpFail(403, "admin required");
  const limit = Math.min(Math.max(1, Number(c.req.query("limit") || 50)), 200);
  return c.json(await pgSchedulingAdminReadModel(limit, c.req.query("status") || undefined));
});

cron.post("/admin/scheduling/execution-jobs/:id/retry", async (c) => {
  const actor = requireTicketPrincipal();
  if (!ticketIsAdmin(actor)) throw new HttpFail(403, "admin required");
  const result = await pgRetryFailedExecutionJob(c.req.param("id"), { actor_ref: actor.id });
  if (result.reason === "not_found") throw new HttpFail(404, "execution job not found");
  if (result.reason === "risk_requires_takeover") {
    throw new HttpFail(409, { code: "takeover_required", message: "中高风险或不确定作业必须先人工核验，不能直接重试。" });
  }
  if (!result.retried || !result.job) throw new HttpFail(409, { code: "job_not_retryable", message: "仅失败的低风险作业可以重新投递。" });
  return c.json({ ...pgExecutionJobPublic(result.job), retried: true }, 202);
});

cron.post("/cron/jobs", async (c) => {
  const user = requireTicketPrincipal();
  const body = parseBody(await c.req.json().catch(() => ({})));
  const handlerKey = String(body.handler_key || "");
  if (!isCronHandlerKey(handlerKey)) throw new HttpFail(400, { code: "unknown_handler", message: "只能使用已登记的 handler" });
  if (handlerKey === "discovery-search" && !ticketIsAdmin(user)) {
    throw new HttpFail(403, { code: "admin_required", message: "发现搜索定时作业占用公共采集排队，仅管理员可创建" });
  }
  assertHandlerGates(handlerKey);
  const cronExpr = String(body.cron_expr || "0 8 * * *");
  const timezone = String(body.timezone || "Asia/Shanghai");
  const condition = validateCondition(handlerKey, body.condition);
  const next = nextFor(cronExpr, timezone, condition);
  if (handlerKey === "ai-task" && !next) throw new HttpFail(400, "生效区间内没有未来执行时间");
  const owner = user.id;
  const id = nid("cjob");
  const job = await pgCreateCronJob({
    id, job_key: String(body.job_key || id), title: String(body.title || handlerContract(handlerKey).title || handlerKey),
    owner_account_id: owner, execute_as: owner, capability_expert_id: String(body.capability_expert_id || DEFAULT_EXPERT),
    handler_key: handlerKey, scope: body.scope && typeof body.scope === "object" ? body.scope as Json : { applies: "self" },
    condition, cron_expr: cronExpr, timezone, status: String(body.status || "published"),
    retry_policy: body.retry_policy && typeof body.retry_policy === "object" ? body.retry_policy as Json : { max_attempts: 1 },
    takeover_policy: body.takeover_policy && typeof body.takeover_policy === "object" ? body.takeover_policy as Json : { after_minutes: 30 },
    next_run_at: next,
  });
  return c.json(pgCronPublicJob(job), 201);
});

cron.get("/cron/jobs/:id", async (c) => {
  await pgEnsureSystemCronJobs();
  const job = await pgCronJobById(c.req.param("id"));
  if (!job) throw new HttpFail(404, "cron job not found");
  assertCanSeeJob(job);
  return c.json({ job: pgCronPublicJob(job), runs: (await pgListCronRuns(String(job.id), 20)).map(pgCronPublicRun) });
});

cron.patch("/cron/jobs/:id", async (c) => {
  await pgEnsureSystemCronJobs();
  const job = await pgCronJobById(c.req.param("id"));
  if (!job) throw new HttpFail(404, "cron job not found");
  assertCanMutateJob(job);
  const body = parseBody(await c.req.json().catch(() => ({})));
  const system = pgCronSystemJob(job);
  if (system && (body.handler_key || body.execute_as || body.job_key || body.capability_expert_id || body.owner_account_id)) {
    throw new HttpFail(403, { code: "legal_field_readonly", message: "系统作业的法定字段只读" });
  }
  const status = body.status != null ? String(body.status) : String(job.status);
  if (!["draft", "published", "paused", "disabled"].includes(status)) throw new HttpFail(400, { code: "invalid_status", message: "status 无效" });
  let cronExpr = String(job.cron_expr);
  let timezone = String(job.timezone || "Asia/Shanghai");
  let scope = parseJson(job.scope_json);
  let condition = parseJson(job.condition_json);
  let bump = false;
  if (body.cron_expr != null) { cronExpr = String(body.cron_expr); bump = true; }
  if (body.timezone != null) { timezone = String(body.timezone); bump = true; }
  if (body.scope != null) { scope = body.scope as Json; bump = true; }
  if (body.condition != null) {
    if (system) {
      // 系统作业条件只读，唯一例外：discovery-search 的 system_template 允许管理员读写
      //（前端模板编辑 UI 另案叠加；此处先开放接口）。
      if (String(job.handler_key) !== "discovery-search") {
        throw new HttpFail(403, { code: "legal_field_readonly", message: "系统作业条件只读" });
      }
      const incoming = body.condition as Record<string, unknown>;
      condition = {
        ...condition,
        system_template: normalizeSystemTemplate(incoming.system_template),
      };
    } else {
      condition = validateCondition(String(job.handler_key), body.condition);
    }
    bump = true;
  }
  let nextRun = job.next_run_at ? new Date(job.next_run_at as string | Date).toISOString() : null;
  if (bump || (status === "published" && String(job.status) !== "published")) nextRun = nextFor(cronExpr, timezone, condition);
  if (String(job.handler_key) === "ai-task" && status === "published" && !nextRun) throw new HttpFail(400, "生效区间内没有未来执行时间");
  if (status === "paused" || status === "disabled") nextRun = null;
  const updated = await pgUpdateCronJob(String(job.id), {
    title: system ? String(job.title) : String(body.title || job.title), scope, condition, cron_expr: cronExpr, timezone, status,
    published_rev: Number(job.published_rev || 1) + (bump ? 1 : 0), next_run_at: nextRun,
  });
  if (!updated) throw new HttpFail(404, "cron job not found");
  return c.json({ job: pgCronPublicJob(updated) });
});

cron.post("/cron/jobs/:id/run", async (c) => {
  await pgEnsureSystemCronJobs();
  const job = await pgCronJobById(c.req.param("id"));
  if (!job) throw new HttpFail(404, "cron job not found");
  assertCanSeeJob(job);
  assertJobRunnable(job);
  assertHandlerGates(String(job.handler_key));
  const result = await runCronJobNow(String(job.id), ticketPrincipal());
  if (String(job.handler_key) !== "ai-task") return c.json({ run_id: result.run_id });
  const run = await pgCronRunById(result.run_id);
  return c.json({ run_id: result.run_id, session_id: run?.session_id || undefined, run: run ? pgCronPublicRun(run) : undefined,
    job: pgCronPublicJobSummary((await pgCronJobById(String(job.id)))!) });
});

cron.get("/cron/jobs/:id/runs", async (c) => {
  await pgEnsureSystemCronJobs();
  const job = await pgCronJobById(c.req.param("id"));
  if (!job) throw new HttpFail(404, "cron job not found");
  assertCanSeeJob(job);
  return c.json({ runs: (await pgListCronRuns(String(job.id))).map(pgCronPublicRun) });
});

cron.get("/cron/runs/:runId", async (c) => {
  await pgEnsureSystemCronJobs();
  const run = await pgCronRunById(c.req.param("runId"));
  if (!run) throw new HttpFail(404, "cron run not found");
  const job = await pgCronJobById(String(run.job_id));
  if (!job) throw new HttpFail(404, "cron job not found");
  assertCanSeeJob(job);
  return c.json({ run: pgCronPublicRun(run), job: pgCronPublicJob(job) });
});

cron.post("/cron/internal/tick", async (c) => {
  authorizeTick(c);
  const result = await tickCronDue(new Date());
  return c.json({ ok: true, claimed: result.claimed.length, run_ids: result.claimed });
});

async function nativeRiskItems(): Promise<Json[]> {
  const rows = await postgresPool().query<Row>(
    `SELECT t.id AS ticket_id,t.title,t.status,t.priority,t.due_at,t.business_category,t.stage_code,t.owner_user_id,
            pa.assignee_user_id,pa.assignee_person_ref
       FROM tickets t
       LEFT JOIN LATERAL (
         SELECT assignee_user_id,assignee_person_ref FROM ticket_assignments
          WHERE ticket_id=t.id AND role='primary' AND status='active' ORDER BY assignment_version DESC LIMIT 1
       ) pa ON true
      WHERE t.task_type='manual_ticket' AND t.profile='ticket-workbench'
        AND NULLIF(t.due_at,'')::timestamptz < now()
        AND t.status NOT IN ('completed','cancelled','failed')
      ORDER BY NULLIF(t.due_at,'')::timestamptz ASC,t.id
      LIMIT 200`,
  );
  return rows.rows.map((row) => ({
    ...row,
    source: "postgresql_formal_tickets",
    stage_label: label(String(row.stage_code || "")),
  }));
}

cron.get("/cron/risks", async (c) => {
  await pgEnsureSystemCronJobs();
  const job = await pgCronJobById("overdue-scan");
  return c.json({ p0: job ? String(job.title) : "失联与延期扫描", job_id: job?.id || null, items: await nativeRiskItems() });
});

cron.post("/cron/risk-scan", async (c) => {
  await pgEnsureSystemCronJobs();
  const job = await pgCronJobById("overdue-scan");
  if (!job) throw new HttpFail(404, "cron job not found");
  assertCanSeeJob(job);
  assertJobRunnable(job);
  assertHandlerGates("overdue-scan");
  const result = await runCronJobNow(String(job.id), ticketPrincipal());
  return c.json({ run_id: result.run_id });
});
