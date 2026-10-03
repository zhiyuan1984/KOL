import { Hono } from "hono";
import { HttpFail } from "../host/errors.js";
import { nid } from "../ids.js";
import type { Json } from "../types.js";
import { transitionTicketLifecyclePostgres } from "../ticket-lifecycle.js";
import { assignFormalTicketPostgres } from "../ticket-domain/assign-ticket.js";
import { addTicketCollaboratorPostgres, removeTicketCollaboratorPostgres } from "../ticket-domain/collaborate-ticket.js";
import { createFormalTicketPostgres, type FormalTicketCreateInput } from "../ticket-domain/create-ticket.js";
import { editFormalTicketPostgres, type FormalTicketEditInput } from "../ticket-domain/edit-ticket.js";
import { bindTicketAccountToOrganizationPerson, ticketAccountOrganizationBindingOptions, ticketOrgFormBootstrap, ticketOrganizationQualityReport } from "../ticket-domain/organization.js";
import { listNativeTickets, nativeTicketById, nativeTicketTimeline } from "../ticket-domain/read-tickets.js";
import { organizationTicketRawCountReport, personalTicketRawCountReport } from "../ticket-domain/reports.js";
import { requireTicketPrincipal, ticketIsAdmin } from "../ticket-domain/auth.js";
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
    due: c.req.query("due"), q: c.req.query("q"), from: c.req.query("from"), to: c.req.query("to"),
  });
  return c.json({ ...page, ...requestMetadata() });
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
 * No evaluator is attached to ticket assignment, escalation or creation. */
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
  return c.json({ ...timeline, related_business_events: [], ...requestMetadata(), source_refs: [{ type: "postgresql_ticket_timeline", id: timeline.ticket_id }] });
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
