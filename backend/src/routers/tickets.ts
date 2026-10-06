import { Hono } from "hono";
import { HttpFail } from "../host/errors.js";
import { nid } from "../ids.js";
import type { Json } from "../types.js";
import { transitionTicketLifecyclePostgres } from "../ticket-lifecycle.js";
import { assignFormalTicketPostgres } from "../ticket-domain/assign-ticket.js";
import { addTicketCollaboratorPostgres, removeTicketCollaboratorPostgres } from "../ticket-domain/collaborate-ticket.js";
import { createFormalTicketPostgres, type FormalTicketCreateInput } from "../ticket-domain/create-ticket.js";
import { deleteFormalTicketPostgres, type FormalTicketDeleteInput } from "../ticket-domain/delete-ticket.js";
import { editFormalTicketPostgres, type FormalTicketEditInput } from "../ticket-domain/edit-ticket.js";
import { bindTicketAccountToOrganizationPerson, ticketAccountOrganizationBindingOptions, ticketOrgFormBootstrap, ticketOrganizationQualityReport } from "../ticket-domain/organization.js";
import { listNativeTickets, nativeTicketById, nativeTicketTimeline } from "../ticket-domain/read-tickets.js";
import { organizationTicketRawCountReport, organizationTicketStageRawReport, personalTicketRawCountReport } from "../ticket-domain/reports.js";
import { createTaskRootPostgres, listTaskWorkOrderAggregates, taskWorkOrderAggregate, taskWorkOrderDashboard, taskWorkOrderDashboardExport, type TaskRootInput } from "../ticket-domain/task-work-orders.js";
import { recordWorkOrderShadowDecision } from "../ticket-domain/work-order-shadow.js";
import { createWorkOrderTemplateDraft, disableWorkOrderTemplate, listWorkOrderTemplates, publishWorkOrderTemplate, type WorkOrderTemplateInput } from "../ticket-domain/work-order-template-governance.js";
import { listWorkOrderAutomationReleases, setWorkOrderAutomationRelease } from "../ticket-domain/work-order-automation-release.js";
import { executeWorkOrderDecision } from "../ticket-domain/work-order-executor.js";
import { readWorkOrderSuggestions } from "../ticket-domain/work-order-adoption.js";
import { openTaskCollaborationSession, taskSessionHarnessEvidence } from "../ticket-domain/task-collaboration-session.js";
import { advanceWorkOrderStageForDecision } from "../ticket-domain/work-order-stage-executor.js";
import { enqueueWorkOrderDecisionExecution } from "../ticket-domain/work-order-automation-pipeline.js";
import { recordVerifiedWorkOrderEvent } from "../ticket-domain/work-order-verified-event.js";
import { readTaskCollaborationContext } from "../ticket-domain/collaboration-context.js";
import { confirmTicketRuleEvaluation } from "../ticket-domain/rule-confirmation.js";
import { schedulingRuleEffectivenessRawReport } from "../ticket-domain/rule-effectiveness.js";
import { requireTicketPrincipal, ticketIsAdmin } from "../ticket-domain/auth.js";
import { listTicketRuleEvaluations, recordVerifiedBusinessEventAndEvaluate } from "../ticket-domain/event-rule-evaluation.js";
import {
  createSchedulingRuleDraft,
  disableSchedulingRule,
  listSchedulingRules,
  publishSchedulingRule,
  restoreSchedulingRuleDraft,
  schedulingRuleDetail,
  simulateSchedulingRule,
} from "../ticket-domain/rule-governance.js";

/**
 * PostgreSQL authority router for formal tickets. Do not add imports from
 * `db.ts`, legacy `/tasks` projections, or the PostgreSQL sync bridge here.
 */
export const tickets = new Hono();

tickets.onError((error, c) => {
  if (error instanceof HttpFail) {
    return c.json({ detail: error.detail }, error.status as 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 500 | 502 | 503);
  }
  console.error(error);
  return c.json({ detail: error instanceof Error ? error.message : "internal error" }, 500);
});

function ownerId(): string {
  return requireTicketPrincipal().id;
}

function requestMetadata(): { request_id: string; as_of: string; schema_version: string } {
  return { request_id: nid("req"), as_of: new Date().toISOString(), schema_version: "ticket-api.v1" };
}

function parseLimit(raw: string | undefined, fallback = 50): number {
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) throw new HttpFail(400, "invalid limit");
  return Math.min(200, Math.floor(n));
}

export function businessTaskExportStatusLabel(status: unknown): string {
  const key = String(status || "").toLowerCase();
  const labels: Record<string, string> = {
    open: "待启动", queued: "排队中", pending: "排队中", proposed: "待确认",
    pending_assignment: "待分派", assigned: "已分派", accepted: "已受理",
    running: "进行中", in_progress: "处理中", waiting: "等待中",
    waiting_external: "等待外部", waiting_approval: "等待确认", blocked: "已阻塞",
    ready_for_review: "待复核", ready_for_acceptance: "待验收", needs_review: "待复核",
    completed: "已完成", cancelled: "已取消", canceled: "已取消",
  };
  return labels[key] || (key || "未知");
}

function parseRuleVersion(raw: string | undefined): number {
  const version = Number(raw);
  if (!Number.isInteger(version) || version < 1) throw new HttpFail(400, "invalid rule version");
  return version;
}

function ruleBody(body: Record<string, unknown>, idempotencyKey: string): Record<string, unknown> {
  return { ...body, idempotency_key: idempotencyKey || body.idempotency_key };
}

function summary(ticket: Awaited<ReturnType<typeof nativeTicketById>>) {
  return {
    ticket_id: ticket.id,
    goal: ticket.goal || ticket.title,
    progress: ticket.status,
    risk: "none",
    conclusion: null,
    evidence_refs: [],
    source_fingerprint: `ticket:${ticket.id}:v${ticket.data_version}`,
    producer: "postgresql_ticket_center",
    status: "current",
    stale_reason: null,
    generated_at: ticket.updated_at,
  };
}

// Must precede `/tickets/:id`.
tickets.get("/tickets", async (c) => {
  const page = await listNativeTickets(ownerId(), {
    view: c.req.query("view"), cursor: c.req.query("cursor"), limit: c.req.query("limit"),
    status: c.req.query("status"), priority: c.req.query("priority"), category: c.req.query("category"),
    stage: c.req.query("stage"), org_unit: c.req.query("org_unit"), assignee: c.req.query("assignee"),
    task_id: c.req.query("task_id"), due: c.req.query("due"), q: c.req.query("q"), from: c.req.query("from"), to: c.req.query("to"),
  });
  return c.json({ ...page, ...requestMetadata() });
});

/** Task is the business-goal root; child work orders are standard execution
 * units. This remains separate from legacy `/tasks` until the workbench task
 * projection itself is migrated to PostgreSQL. */
tickets.post("/task-work-orders/tasks", async (c) => {
  const body = await c.req.json().catch(() => ({})) as TaskRootInput;
  const idempotencyKey = String(c.req.header("Idempotency-Key") || body.idempotency_key || "").trim();
  const task = await createTaskRootPostgres(ownerId(), { ...body, idempotency_key: idempotencyKey });
  return c.json({ task, ...requestMetadata() }, 201);
});

tickets.get("/task-work-orders", async (c) => {
  const actor = requireTicketPrincipal();
  return c.json({ ...(await listTaskWorkOrderAggregates(actor.id, ticketIsAdmin(actor), parseLimit(c.req.query("limit"), 50))), ...requestMetadata() });
});

/** Report-first employee task-center read model. The PostgreSQL query shares
 * one authorization scope for KPI, template counters and task rows; it does
 * not derive any metric by accumulating browser-side detail responses. */
tickets.get("/task-work-orders/dashboard", async (c) => {
  const actor = requireTicketPrincipal();
  return c.json({
    ...(await taskWorkOrderDashboard(actor.id, ticketIsAdmin(actor), {
      limit: parseLimit(c.req.query("limit"), 50),
      cursor: c.req.query("cursor"),
      timezone: c.req.query("timezone") || "Asia/Shanghai",
      period: c.req.query("period") || "realtime",
      q: c.req.query("q"),
      template: c.req.query("template"),
      status: c.req.query("status"),
    })),
    ...requestMetadata(),
  });
});

/** CSV is generated from the same authorized, period-scoped CTE as the
 * dashboard. The browser receives a stream so a long export does not require a
 * second JSON-shaped API contract. */
tickets.get("/task-work-orders/dashboard/export", async (c) => {
  const actor = requireTicketPrincipal();
  const period = c.req.query("period") || "realtime";
  const rows = await taskWorkOrderDashboardExport(actor.id, ticketIsAdmin(actor), {
    timezone: c.req.query("timezone") || "Asia/Shanghai",
    period,
    q: c.req.query("q"),
    template: c.req.query("template"),
    status: c.req.query("status"),
  });
  const csvCell = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const head = ["业务任务标题", "类型", "业务任务状态", "模板", "受理人", "创建时间", "完成时间"];
  const lines = [head, ...rows.map((row) => [row.task_title, row.type, businessTaskExportStatusLabel(row.status), row.template, row.assignee, row.created_at || "", row.completed_at || ""])]
    .map((cells) => cells.map(csvCell).join(","));
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`\uFEFF${lines.join("\n")}\n`));
      controller.close();
    },
  });
  const stamp = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).replaceAll("-", "");
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`业务任务-${stamp}-${period}.csv`)}`,
      "cache-control": "no-store",
    },
  });
});

tickets.get("/task-work-orders/:taskId", async (c) => {
  const actor = requireTicketPrincipal();
  return c.json({ ...(await taskWorkOrderAggregate(actor.id, c.req.param("taskId"), ticketIsAdmin(actor))), ...requestMetadata() });
});

/** L1 authoritative dependencies and persistent source-event cursor. */
tickets.get("/task-work-orders/:taskId/collaboration-context", async (c) => {
  return c.json({ ...(await readTaskCollaborationContext(ownerId(), c.req.param("taskId"), Number(c.req.query("after") || 0))), ...requestMetadata() });
});

tickets.get("/task-work-orders/:taskId/suggestions", async (c) => {
  return c.json({ ...(await readWorkOrderSuggestions(ownerId(), c.req.param("taskId"))), ...requestMetadata() });
});

tickets.post("/task-work-orders/:taskId/workspace", async (c) => {
  return c.json({ ...(await openTaskCollaborationSession(ownerId(), c.req.param("taskId"))), ...requestMetadata() });
});

tickets.get("/task-work-orders/sessions/:sid/context", async (c) => {
  const evidence = await taskSessionHarnessEvidence(ownerId(), c.req.param("sid"));
  return c.json({ workspace: evidence ? { task_id: String(evidence.task.id), title: String(evidence.task.title), evidence_version: evidence.version } : null, risk:"L1", calls_model:false, ...requestMetadata() });
});

/** Explicit human command, sharing the governed executor with the Worker. */
tickets.post("/task-work-orders/decisions/:id/adopt", async (c) => {
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const result = await executeWorkOrderDecision(ownerId(), c.req.param("id"), {
    idempotency_key: String(c.req.header("Idempotency-Key") || body.idempotency_key || "").trim(),
  }, { confirmed: body.confirmed, basis_version: body.basis_version, action: body.action, target_id: body.target_id });
  return c.json({ ...result, ...requestMetadata() }, result.replayed ? 200 : 201);
});

/** The event is immutable evidence first. Only after it is stored does the
 * bounded Jev decision run and hand off a durable job to the Worker. */
tickets.post("/task-work-orders/tasks/:taskId/verified-events", async (c) => {
  const actor = requireTicketPrincipal();
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const idempotencyKey = String(c.req.header("Idempotency-Key") || body.idempotency_key || "").trim();
  const event = await recordVerifiedWorkOrderEvent(actor.id, c.req.param("taskId"), { ...body, idempotency_key: idempotencyKey }, { isAdmin: ticketIsAdmin(actor) });
  const decision = await recordWorkOrderShadowDecision(actor.id, c.req.param("taskId"), {
    source_event: { id: event.event.id, type: event.event.event_type, summary: event.event.summary, occurred_at: event.event.occurred_at },
    work_order_id: body.work_order_id,
    idempotency_key: `work-order-verified-event:${event.event.id}:jev`,
  }, { isAdmin: ticketIsAdmin(actor) });
  const execution = await enqueueWorkOrderDecisionExecution(actor.id, decision.decision.id);
  return c.json({ ...event, ...decision, ...execution, execution_mode: "verified_event_to_jev_to_outbox", ...requestMetadata() }, event.event.replayed ? 200 : 202);
});

/** Initial AI-work-order integration: administrator-triggered, immutable Jev
 * shadow decision only. It never creates, assigns, advances or completes. */
tickets.post("/admin/work-orders/tasks/:taskId/jev-shadow", async (c) => {
  const actor = requireTicketPrincipal();
  if (!ticketIsAdmin(actor)) throw new HttpFail(403, "admin required");
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const result = await recordWorkOrderShadowDecision(actor.id, c.req.param("taskId"), {
    ...body,
    idempotency_key: String(c.req.header("Idempotency-Key") || body.idempotency_key || "").trim(),
  }, { isAdmin: true });
  const execution = await enqueueWorkOrderDecisionExecution(actor.id, result.decision.id);
  return c.json({ ...result, ...execution, ...requestMetadata() }, result.decision.replayed ? 200 : 202);
});

tickets.get("/admin/work-orders/templates", async (c) => {
  if (!ticketIsAdmin()) throw new HttpFail(403, "admin required");
  return c.json({ ...(await listWorkOrderTemplates(parseLimit(c.req.query("limit"), 100), c.req.query("status"))), ...requestMetadata() });
});

tickets.post("/admin/work-orders/templates/drafts", async (c) => {
  const actor = requireTicketPrincipal();
  if (!ticketIsAdmin(actor)) throw new HttpFail(403, "admin required");
  const body = await c.req.json().catch(() => ({})) as WorkOrderTemplateInput;
  const result = await createWorkOrderTemplateDraft(actor.id, { ...body, idempotency_key: String(c.req.header("Idempotency-Key") || body.idempotency_key || "").trim() });
  return c.json({ ...result, ...requestMetadata() }, result.replayed ? 200 : 201);
});

tickets.post("/admin/work-orders/templates/:id/publish", async (c) => {
  const actor = requireTicketPrincipal();
  if (!ticketIsAdmin(actor)) throw new HttpFail(403, "admin required");
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const result = await publishWorkOrderTemplate(actor.id, c.req.param("id"), { ...body, idempotency_key: String(c.req.header("Idempotency-Key") || body.idempotency_key || "").trim() });
  return c.json({ ...result, ...requestMetadata() }, result.replayed ? 200 : 201);
});

tickets.post("/admin/work-orders/templates/:id/disable", async (c) => {
  const actor = requireTicketPrincipal();
  if (!ticketIsAdmin(actor)) throw new HttpFail(403, "admin required");
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const result = await disableWorkOrderTemplate(actor.id, c.req.param("id"), { ...body, idempotency_key: String(c.req.header("Idempotency-Key") || body.idempotency_key || "").trim() });
  return c.json({ ...result, ...requestMetadata() }, result.replayed ? 200 : 201);
});

tickets.get("/admin/work-orders/automation-releases", async (c) => {
  if (!ticketIsAdmin()) throw new HttpFail(403, "admin required");
  return c.json({ ...(await listWorkOrderAutomationReleases()), ...requestMetadata() });
});

tickets.post("/admin/work-orders/templates/:id/automation-release", async (c) => {
  const actor = requireTicketPrincipal();
  if (!ticketIsAdmin(actor)) throw new HttpFail(403, "admin required");
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const result = await setWorkOrderAutomationRelease(actor.id, c.req.param("id"), {
    ...body, idempotency_key: String(c.req.header("Idempotency-Key") || body.idempotency_key || "").trim(),
  });
  return c.json({ ...result, ...requestMetadata() }, result.replayed ? 200 : 201);
});

/** A governed materialization endpoint for the initial A1/A2 executor. It
 * accepts an immutable decision only; worker/event wiring is added separately. */
tickets.post("/admin/work-orders/decisions/:id/execute", async (c) => {
  const actor = requireTicketPrincipal();
  if (!ticketIsAdmin(actor)) throw new HttpFail(403, "admin required");
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const result = await executeWorkOrderDecision(actor.id, c.req.param("id"), {
    ...body, idempotency_key: String(c.req.header("Idempotency-Key") || body.idempotency_key || "").trim(),
  });
  return c.json({ ...result, ...requestMetadata() }, result.replayed ? 200 : 201);
});

/** Operator replay cannot bypass the A3 evidence, version, release or
 * confidence gates used by the durable Worker. */
tickets.post("/admin/work-orders/decisions/:id/execute-stage", async (c) => {
  const actor = requireTicketPrincipal();
  if (!ticketIsAdmin(actor)) throw new HttpFail(403, "admin required");
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const result = await advanceWorkOrderStageForDecision(actor.id, c.req.param("id"), {
    ...body,
    mode: "operator_replay",
    idempotency_key: String(c.req.header("Idempotency-Key") || body.idempotency_key || "").trim(),
  });
  return c.json({ ...result, ...requestMetadata() }, result.replayed ? 200 : 201);
});

tickets.get("/tickets/reports/personal", async (c) => {
  return c.json({ ...(await personalTicketRawCountReport(ownerId(), c.req.query("timezone") || "Asia/Shanghai")), ...requestMetadata() });
});

tickets.get("/tickets/reports/organization", async (c) => {
  const actor = requireTicketPrincipal();
  return c.json({
    ...(await organizationTicketRawCountReport(actor.id, { timezone: c.req.query("timezone") || "Asia/Shanghai", is_admin: ticketIsAdmin(actor) })),
    ...requestMetadata(),
  });
});

tickets.get("/tickets/reports/organization/stages", async (c) => {
  const actor = requireTicketPrincipal();
  return c.json({
    ...(await organizationTicketStageRawReport(actor.id, { timezone: c.req.query("timezone") || "Asia/Shanghai", is_admin: ticketIsAdmin(actor) })),
    ...requestMetadata(),
  });
});

tickets.get("/tickets/form-bootstrap", async (c) => {
  return c.json({ ...(await ticketOrgFormBootstrap(ownerId())), ...requestMetadata() });
});

tickets.get("/admin/work-orders/data-quality", async (c) => {
  if (!ticketIsAdmin()) throw new HttpFail(403, "admin required");
  return c.json({ ...(await ticketOrganizationQualityReport()), ...requestMetadata() });
});

tickets.get("/admin/work-orders/account-bindings/options", async (c) => {
  if (!ticketIsAdmin()) throw new HttpFail(403, "admin required");
  return c.json({ ...(await ticketAccountOrganizationBindingOptions()), ...requestMetadata() });
});

/** Explicit, audited enrollment; this never infers a person from display name
 * or silently falls back to a default assignee/supervisor. */
tickets.post("/admin/work-orders/account-bindings", async (c) => {
  const actor = requireTicketPrincipal();
  if (!ticketIsAdmin(actor)) throw new HttpFail(403, "admin required");
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  return c.json({
    ...(await bindTicketAccountToOrganizationPerson(actor.id, {
      person_ref: String(body.person_ref || ""),
      account_id: String(body.account_id || ""),
      reason: String(body.reason || ""),
    })),
    ...requestMetadata(),
  });
});

/** Rule governance records versioned, manual-confirmation suggestions only.
 * The evaluator records matched/skipped first-wave event facts but never
 * assigns, escalates, creates, or transitions a ticket. */
tickets.get("/admin/scheduling/rules", async (c) => {
  if (!ticketIsAdmin()) throw new HttpFail(403, "admin required");
  return c.json({ ...(await listSchedulingRules(parseLimit(c.req.query("limit"), 100))), ...requestMetadata() });
});

tickets.get("/admin/scheduling/rules/:id", async (c) => {
  if (!ticketIsAdmin()) throw new HttpFail(403, "admin required");
  const rawVersion = c.req.query("version");
  return c.json({ ...(await schedulingRuleDetail(c.req.param("id"), rawVersion == null ? undefined : parseRuleVersion(rawVersion))), ...requestMetadata() });
});

tickets.post("/admin/scheduling/rules/drafts", async (c) => {
  const actor = requireTicketPrincipal();
  if (!ticketIsAdmin(actor)) throw new HttpFail(403, "admin required");
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const result = await createSchedulingRuleDraft(actor.id, ruleBody(body, String(c.req.header("Idempotency-Key") || "").trim()));
  return c.json({ ...result, ...requestMetadata() }, result.replayed ? 200 : 201);
});

tickets.post("/admin/scheduling/rules/:id/versions/:version/simulate", async (c) => {
  const actor = requireTicketPrincipal();
  if (!ticketIsAdmin(actor)) throw new HttpFail(403, "admin required");
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const result = await simulateSchedulingRule(actor.id, c.req.param("id"), parseRuleVersion(c.req.param("version")), ruleBody(body, String(c.req.header("Idempotency-Key") || "").trim()));
  return c.json({ ...result, ...requestMetadata() }, result.replayed ? 200 : 201);
});

tickets.post("/admin/scheduling/rules/:id/versions/:version/publish", async (c) => {
  const actor = requireTicketPrincipal();
  if (!ticketIsAdmin(actor)) throw new HttpFail(403, "admin required");
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const result = await publishSchedulingRule(actor.id, c.req.param("id"), parseRuleVersion(c.req.param("version")), ruleBody(body, String(c.req.header("Idempotency-Key") || "").trim()));
  return c.json({ ...result, ...requestMetadata() });
});

tickets.post("/admin/scheduling/rules/:id/versions/:version/disable", async (c) => {
  const actor = requireTicketPrincipal();
  if (!ticketIsAdmin(actor)) throw new HttpFail(403, "admin required");
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const result = await disableSchedulingRule(actor.id, c.req.param("id"), parseRuleVersion(c.req.param("version")), ruleBody(body, String(c.req.header("Idempotency-Key") || "").trim()));
  return c.json({ ...result, ...requestMetadata() });
});

tickets.post("/admin/scheduling/rules/:id/versions/:version/restore-draft", async (c) => {
  const actor = requireTicketPrincipal();
  if (!ticketIsAdmin(actor)) throw new HttpFail(403, "admin required");
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const result = await restoreSchedulingRuleDraft(actor.id, c.req.param("id"), parseRuleVersion(c.req.param("version")), ruleBody(body, String(c.req.header("Idempotency-Key") || "").trim()));
  return c.json({ ...result, ...requestMetadata() }, result.replayed ? 200 : 201);
});

tickets.get("/admin/scheduling/rule-evaluations", async (c) => {
  if (!ticketIsAdmin()) throw new HttpFail(403, "admin required");
  return c.json({ ...(await listTicketRuleEvaluations(parseLimit(c.req.query("limit"), 50))), ...requestMetadata() });
});

tickets.get("/admin/scheduling/rule-effectiveness", async (c) => {
  if (!ticketIsAdmin()) throw new HttpFail(403, "admin required");
  return c.json({ ...(await schedulingRuleEffectivenessRawReport(parseLimit(c.req.query("limit"), 100))), ...requestMetadata() });
});

tickets.post("/admin/scheduling/rule-evaluations/:id/confirmation", async (c) => {
  const actor = requireTicketPrincipal();
  if (!ticketIsAdmin(actor)) throw new HttpFail(403, "admin required");
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const result = await confirmTicketRuleEvaluation(actor.id, c.req.param("id"), ruleBody(body, String(c.req.header("Idempotency-Key") || "").trim()));
  return c.json({ ...result, ...requestMetadata() }, result.replayed ? 200 : 201);
});

tickets.post("/admin/scheduling/events/evaluate", async (c) => {
  const actor = requireTicketPrincipal();
  if (!ticketIsAdmin(actor)) throw new HttpFail(403, "admin required");
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const result = await recordVerifiedBusinessEventAndEvaluate(actor.id, ruleBody(body, String(c.req.header("Idempotency-Key") || "").trim()));
  return c.json({ ...result, ...requestMetadata() }, result.replayed ? 200 : 201);
});

tickets.post("/tickets", async (c) => {
  const body = await c.req.json().catch(() => ({})) as FormalTicketCreateInput;
  const headerKey = String(c.req.header("Idempotency-Key") || "").trim();
  const result = await createFormalTicketPostgres(ownerId(), { ...body, idempotency_key: headerKey || body.idempotency_key });
  return c.json({ ...result, ...requestMetadata() }, result.replayed ? 200 : 201);
});

tickets.get("/tickets/:id/summary", async (c) => {
  const ticket = await nativeTicketById(ownerId(), c.req.param("id"));
  return c.json({ ...summary(ticket), ...requestMetadata(), source_refs: ticket.source_refs });
});

tickets.get("/tickets/:id/timeline", async (c) => {
  const after = Math.max(0, Number(c.req.query("after") || 0));
  if (!Number.isFinite(after) || !Number.isInteger(after)) throw new HttpFail(400, "invalid after");
  const timeline = await nativeTicketTimeline(ownerId(), c.req.param("id"), after, parseLimit(c.req.query("limit"), 100));
  return c.json({ ...timeline, ...requestMetadata(), source_refs: [{ type: "postgresql_ticket_timeline", id: timeline.ticket_id }] });
});

tickets.get("/tickets/:id", async (c) => {
  const ticket = await nativeTicketById(ownerId(), c.req.param("id"));
  return c.json({ ...ticket, latest_run: null, summary: summary(ticket), ...requestMetadata() });
});

tickets.patch("/tickets/:id", async (c) => {
  const ticket = await nativeTicketById(ownerId(), c.req.param("id"));
  if (!ticket.allowed_actions.includes("edit")) throw new HttpFail(409, { code: "ticket_edit_not_allowed" });
  const body = await c.req.json().catch(() => ({})) as FormalTicketEditInput;
  const idempotencyKey = String(c.req.header("Idempotency-Key") || body.idempotency_key || "").trim();
  const result = await editFormalTicketPostgres(ticket.id, ownerId(), { ...body, idempotency_key: idempotencyKey });
  return c.json({ ...result, ticket: await nativeTicketById(ownerId(), ticket.id), ...requestMetadata() });
});

/** Pending human-created tickets can be removed from the operational center.
 * The domain command retains immutable audit evidence and hides the ticket from
 * all normal reads instead of cascading historical lifecycle facts. */
tickets.delete("/tickets/:id", async (c) => {
  const ticket = await nativeTicketById(ownerId(), c.req.param("id"));
  if (!ticket.allowed_actions.includes("edit")) throw new HttpFail(409, { code: "ticket_delete_not_allowed" });
  const body = await c.req.json().catch(() => ({})) as Partial<FormalTicketDeleteInput>;
  const idempotencyKey = String(c.req.header("Idempotency-Key") || body.idempotency_key || "").trim();
  const result = await deleteFormalTicketPostgres(ticket.id, ownerId(), {
    expected_version: Number(body.expected_version),
    idempotency_key: idempotencyKey,
  });
  return c.json({ ticket_id: result.ticket_id, deleted: true, ...requestMetadata() });
});

tickets.post("/tickets/:id/commands", async (c) => {
  const ticket = await nativeTicketById(ownerId(), c.req.param("id"));
  const body = await c.req.json().catch(() => ({})) as Json;
  const action = String(body.action || "");
  if (action !== "assign" && action !== "add_collaborator" && action !== "remove_collaborator" && action !== "accept" && action !== "complete" && action !== "cancel" && action !== "reopen") {
    throw new HttpFail(409, { code: "action_not_enabled", message: "当前仅支持转办、协同受理、受理、完成、取消或重开工单命令" });
  }
  const requiredAction = action === "add_collaborator" || action === "remove_collaborator" ? "collaborate" : action === "complete" ? "complete" : action;
  if (!ticket.allowed_actions.includes(requiredAction)) {
    throw new HttpFail(403, { code: "ticket_command_not_authorized", action, required_action: requiredAction });
  }
  const idempotencyKey = String(c.req.header("Idempotency-Key") || body.idempotency_key || "").trim();
  const expectedVersion = Number(body.expected_version);
  if (action === "assign") {
    const result = await assignFormalTicketPostgres({
      ticket_id: ticket.id, actor_user_id: ownerId(), expected_version: expectedVersion, idempotency_key: idempotencyKey,
      assignee_person_ref: String(body.assignee_person_ref || ""), assignee_unit_id: String(body.assignee_unit_id || ""),
      cross_group_reason: body.cross_group_reason == null ? null : String(body.cross_group_reason),
    });
    return c.json({ ...result, ticket: await nativeTicketById(ownerId(), ticket.id), ...requestMetadata() });
  }
  if (action === "add_collaborator" || action === "remove_collaborator") {
    const command = {
      ticket_id: ticket.id, actor_user_id: ownerId(), expected_version: expectedVersion, idempotency_key: idempotencyKey,
      assignee_person_ref: String(body.assignee_person_ref || ""), assignee_unit_id: body.assignee_unit_id == null ? undefined : String(body.assignee_unit_id),
      cross_group_reason: body.cross_group_reason == null ? null : String(body.cross_group_reason),
    };
    const result = action === "add_collaborator"
      ? await addTicketCollaboratorPostgres(command)
      : await removeTicketCollaboratorPostgres(command);
    return c.json({ ...result, ticket: await nativeTicketById(ownerId(), ticket.id), ...requestMetadata() });
  }
  const result = await transitionTicketLifecyclePostgres({
    ticketId: ticket.id, action: action as "accept" | "complete" | "cancel" | "reopen", expectedVersion, idempotencyKey,
    actorId: ownerId(), acceptanceEvidence: body.acceptance_evidence, reason: body.reason,
  });
  return c.json({ ...result, ticket: await nativeTicketById(ownerId(), ticket.id), ...requestMetadata() });
});
