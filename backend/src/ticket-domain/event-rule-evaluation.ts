import type { PoolClient } from "pg";
import { HttpFail } from "../host/errors.js";
import { nid } from "../ids.js";
import { postgresPool, postgresTransaction } from "../postgres/pool.js";
import type { Json, Row } from "../types.js";
import { FORMAL_BUSINESS_EVENT_TYPE_SET, type FormalBusinessEventType } from "./event-contracts.js";

type RuleRow = Row & {
  id: string;
  version: number | string;
  rule_type: string;
  title: string;
  status: string;
  scope_json: unknown;
  definition_json: unknown;
};

type EventRow = Row & {
  id: string;
  source_system: string;
  source_event_id: string;
  source_version: string;
  event_type: FormalBusinessEventType;
  company_id: string;
  brand_id: string | null;
  region_id: string | null;
  ticket_id: string | null;
  occurred_at: string;
  summary: string;
  evidence_ref: string;
  payload_json: unknown;
  evidence_json: unknown;
  verified_by: string;
  verified_at: string;
  created_at: string;
  idempotency_key: string;
};

type TicketSnapshot = {
  id: string;
  status: string;
  priority: string;
  business_category: string | null;
  due_at: string | null;
  data_version: number | string;
  company_id: string;
};

type RuleScope = { company_id?: string; brand_id?: string; region_id?: string };
type RuleDefinition = {
  execution_mode?: string;
  requires_human_confirmation?: boolean;
  proposed_action?: string;
  trigger_event_types?: string[];
  conditions?: {
    ticket_statuses?: string[];
    priorities?: string[];
    business_categories?: string[];
    overdue?: boolean;
  };
};

type ParsedEvent = {
  source_system: string;
  source_event_id: string;
  source_version: string;
  event_type: FormalBusinessEventType;
  company_id: string;
  brand_id: string | null;
  region_id: string | null;
  ticket_id: string | null;
  occurred_at: string;
  summary: string;
  evidence_ref: string;
  payload: Json;
  evidence: Json;
  idempotency_key: string;
};

function object(value: unknown, fallback: Json = {}): Json {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Json;
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Json : fallback;
  } catch {
    return fallback;
  }
}

function required(value: unknown, field: string, max = 500): string {
  const text = String(value || "").trim();
  if (!text) throw new HttpFail(422, { code: "event_field_required", field });
  if (text.length > max) throw new HttpFail(422, { code: "event_field_too_long", field, max });
  return text;
}

function optional(value: unknown, field: string, max = 500): string | null {
  if (value == null || String(value).trim() === "") return null;
  return required(value, field, max);
}

function iso(value: unknown, field: string): string {
  const text = required(value, field, 80);
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) throw new HttpFail(422, { code: "event_timestamp_invalid", field });
  return parsed.toISOString();
}

function idempotencyKey(value: unknown): string {
  const key = required(value, "idempotency_key", 240);
  if (key.length < 8) throw new HttpFail(422, { code: "idempotency_key_invalid" });
  return key;
}

function nonEmptyObject(value: unknown, field: string): Json {
  const parsed = object(value);
  if (!Object.keys(parsed).length) throw new HttpFail(422, { code: "event_evidence_required", field });
  return parsed;
}

function parseEvent(input: Record<string, unknown>): ParsedEvent {
  const type = required(input.event_type, "event_type", 120);
  if (!FORMAL_BUSINESS_EVENT_TYPE_SET.has(type)) {
    throw new HttpFail(422, { code: "event_type_not_in_first_wave", allowed: [...FORMAL_BUSINESS_EVENT_TYPE_SET] });
  }
  return {
    source_system: required(input.source_system, "source_system", 120),
    source_event_id: required(input.source_event_id, "source_event_id", 240),
    source_version: optional(input.source_version, "source_version", 240) || "",
    event_type: type as FormalBusinessEventType,
    company_id: required(input.company_id, "company_id", 160),
    brand_id: optional(input.brand_id, "brand_id", 160),
    region_id: optional(input.region_id, "region_id", 160),
    ticket_id: optional(input.ticket_id, "ticket_id", 240),
    occurred_at: iso(input.occurred_at, "occurred_at"),
    summary: required(input.summary, "summary", 1_000),
    evidence_ref: required(input.evidence_ref, "evidence_ref", 1_000),
    payload: object(input.payload),
    evidence: nonEmptyObject(input.evidence, "evidence"),
    idempotency_key: idempotencyKey(input.idempotency_key),
  };
}

function publicEvent(event: EventRow): Json {
  return {
    id: String(event.id), source_system: String(event.source_system), source_event_id: String(event.source_event_id),
    source_version: String(event.source_version || ""), event_type: String(event.event_type), company_id: String(event.company_id),
    brand_id: event.brand_id || null, region_id: event.region_id || null, ticket_id: event.ticket_id || null,
    occurred_at: event.occurred_at, summary: event.summary, evidence_ref: event.evidence_ref,
    verified_by: event.verified_by, verified_at: event.verified_at, created_at: event.created_at,
  };
}

function scopeMatches(scope: RuleScope, event: ParsedEvent): boolean {
  return scope.company_id === event.company_id
    && (!scope.brand_id || scope.brand_id === event.brand_id)
    && (!scope.region_id || scope.region_id === event.region_id);
}

function evaluationOutcome(rule: RuleRow, event: ParsedEvent, ticket: TicketSnapshot | null): { outcome: string; reason: string | null } {
  const definition = object(rule.definition_json) as RuleDefinition;
  const conditions = definition.conditions || {};
  const needsTicket = String(rule.rule_type) !== "ticket_candidate" || Object.keys(conditions).length > 0;
  if (!ticket && needsTicket) return { outcome: "missing_fields", reason: "ticket_id_required_for_rule_conditions" };
  if (!ticket) return { outcome: "matched", reason: null };
  if (conditions.ticket_statuses?.length && !conditions.ticket_statuses.includes(ticket.status)) return { outcome: "skipped", reason: "ticket_status_not_matched" };
  if (conditions.priorities?.length && !conditions.priorities.includes(ticket.priority)) return { outcome: "skipped", reason: "ticket_priority_not_matched" };
  if (conditions.business_categories?.length && !conditions.business_categories.includes(String(ticket.business_category || ""))) return { outcome: "skipped", reason: "ticket_category_not_matched" };
  if (conditions.overdue) {
    const due = ticket.due_at ? Date.parse(ticket.due_at) : Number.NaN;
    if (!Number.isFinite(due) || due >= Date.parse(event.occurred_at)) return { outcome: "skipped", reason: "ticket_not_overdue_at_event_time" };
  }
  return { outcome: "matched", reason: null };
}

async function ticketForEvent(client: PoolClient, event: ParsedEvent): Promise<TicketSnapshot | null> {
  if (!event.ticket_id) return null;
  const result = await client.query<TicketSnapshot>(
    `SELECT t.id,t.status,t.priority,t.business_category,t.due_at,t.data_version,scope.company_id
       FROM tickets t JOIN ticket_org_scopes scope ON scope.ticket_id=t.id
      WHERE t.id=$1 AND t.task_type='manual_ticket' AND t.profile='ticket-workbench'
      FOR SHARE`,
    [event.ticket_id],
  );
  const ticket = result.rows[0];
  if (!ticket) throw new HttpFail(422, { code: "event_ticket_not_formal", ticket_id: event.ticket_id });
  if (ticket.company_id !== event.company_id) throw new HttpFail(422, { code: "event_ticket_scope_mismatch", ticket_id: event.ticket_id });
  return ticket;
}

async function eventByIdempotency(client: PoolClient, key: string): Promise<EventRow | undefined> {
  const result = await client.query<EventRow>("SELECT * FROM ticket_business_events WHERE idempotency_key=$1 FOR UPDATE", [key]);
  return result.rows[0];
}

async function eventEvaluations(client: PoolClient, eventId: string): Promise<Json[]> {
  const rows = await client.query<Row>(
    `SELECT evaluation.id,evaluation.rule_id,evaluation.rule_version,evaluation.outcome,evaluation.ticket_id,
            evaluation.business_scope,evaluation.details_json,evaluation.evaluated_at,evaluation.evaluated_by,
            rule.title,rule.rule_type
       FROM ticket_rule_evaluations evaluation
       JOIN scheduling_rules rule ON rule.id=evaluation.rule_id AND rule.version=evaluation.rule_version
      WHERE evaluation.source_event_id=$1
      ORDER BY evaluation.evaluated_at,evaluation.id`,
    [eventId],
  );
  return rows.rows.map((row) => ({
    id: row.id, rule_id: row.rule_id, rule_version: Number(row.rule_version), rule_title: row.title,
    rule_type: row.rule_type, outcome: row.outcome, ticket_id: row.ticket_id || null,
    scope: object(row.business_scope), details: object(row.details_json), evaluated_at: row.evaluated_at,
    evaluated_by: row.evaluated_by,
  }));
}

/**
 * Records a verified first-wave business event and evaluates only published,
 * explicitly event-bound rules. This is intentionally a no-side-effect
 * evaluator: matched results are pending human confirmation, never ticket
 * creation, assignment, escalation or lifecycle mutation.
 */
export async function recordVerifiedBusinessEventAndEvaluate(actorId: string, input: Record<string, unknown>): Promise<Json> {
  const event = parseEvent(input);
  return postgresTransaction(async (client) => {
    const replay = await eventByIdempotency(client, event.idempotency_key);
    if (replay) {
      if (replay.source_system !== event.source_system || replay.source_event_id !== event.source_event_id || replay.source_version !== event.source_version) {
        throw new HttpFail(409, { code: "idempotency_key_reused" });
      }
      return {
        event: publicEvent(replay), evaluations: await eventEvaluations(client, String(replay.id)), replayed: true,
        execution_effect: "none", human_confirmation_required: true,
      };
    }
    const sameSource = await client.query<{ id: string }>(
      "SELECT id FROM ticket_business_events WHERE source_system=$1 AND source_event_id=$2 AND source_version=$3 FOR UPDATE",
      [event.source_system, event.source_event_id, event.source_version],
    );
    if (sameSource.rows[0]) throw new HttpFail(409, { code: "source_event_already_recorded", event_id: sameSource.rows[0].id });

    const ticket = await ticketForEvent(client, event);
    const now = new Date().toISOString();
    const inserted = await client.query<EventRow>(
      `INSERT INTO ticket_business_events
       (id,source_system,source_event_id,source_version,event_type,company_id,brand_id,region_id,ticket_id,occurred_at,summary,evidence_ref,payload_json,evidence_json,verified_by,verified_at,idempotency_key,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$16)
       RETURNING *`,
      [nid("bev"), event.source_system, event.source_event_id, event.source_version, event.event_type, event.company_id,
        event.brand_id, event.region_id, event.ticket_id, event.occurred_at, event.summary, event.evidence_ref,
        JSON.stringify(event.payload), JSON.stringify(event.evidence), actorId, now, event.idempotency_key],
    );
    const saved = inserted.rows[0];
    if (!saved) throw new Error("ticket business event insert failed");

    const published = await client.query<RuleRow>("SELECT * FROM scheduling_rules WHERE status='published' ORDER BY id,version");
    const eligible = published.rows.filter((rule) => {
      const scope = object(rule.scope_json) as RuleScope;
      const definition = object(rule.definition_json) as RuleDefinition;
      return scopeMatches(scope, event)
        && definition.execution_mode === "manual_confirmation"
        && definition.requires_human_confirmation === true
        && Array.isArray(definition.trigger_event_types)
        && definition.trigger_event_types.includes(event.event_type);
    });
    for (const rule of eligible) {
      const definition = object(rule.definition_json) as RuleDefinition;
      const decision = evaluationOutcome(rule, event, ticket);
      const details: Json = {
        evaluation_version: "ticket-event-rule-evaluation.v1",
        event_type: event.event_type,
        proposed_action: definition.proposed_action || null,
        requires_human_confirmation: true,
        execution_effect: "none",
        suggestion_status: decision.outcome === "matched" ? "pending_human_confirmation" : "not_actionable",
        reason: decision.reason,
        ticket_snapshot: ticket ? {
          ticket_id: ticket.id, status: ticket.status, priority: ticket.priority,
          business_category: ticket.business_category, due_at: ticket.due_at,
          data_version: Number(ticket.data_version),
        } : null,
      };
      await client.query(
        `INSERT INTO ticket_rule_evaluations
         (source_event_id,rule_id,rule_version,business_scope,outcome,ticket_id,details_json,idempotency_key,evaluated_at,evaluated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [saved.id, rule.id, Number(rule.version), JSON.stringify({ company_id: event.company_id, brand_id: event.brand_id, region_id: event.region_id }),
          decision.outcome, event.ticket_id, JSON.stringify(details), `ticket-rule-evaluation:${saved.id}:${rule.id}:${rule.version}`, now, actorId],
      );
    }
    const evaluations = await eventEvaluations(client, String(saved.id));
    return {
      event: publicEvent(saved), evaluations, replayed: false, execution_effect: "none", human_confirmation_required: true,
      evaluation_summary: {
        published_rules_considered: eligible.length,
        matched: evaluations.filter((item) => item.outcome === "matched").length,
        skipped: evaluations.filter((item) => item.outcome === "skipped").length,
        missing_fields: evaluations.filter((item) => item.outcome === "missing_fields").length,
      },
    };
  }, { isolation: "SERIALIZABLE" });
}

export async function listTicketRuleEvaluations(limit = 50): Promise<Json> {
  const bounded = Math.min(Math.max(1, Math.floor(limit)), 200);
  const rows = await postgresPool().query<Row>(
    `SELECT evaluation.id,evaluation.rule_id,evaluation.rule_version,evaluation.outcome,evaluation.ticket_id,
            evaluation.business_scope,evaluation.details_json,evaluation.evaluated_at,evaluation.evaluated_by,
            rule.title AS rule_title,rule.rule_type,
            event.id AS event_id,event.event_type,event.source_system,event.source_event_id,event.source_version,
            event.company_id,event.brand_id,event.region_id,event.occurred_at,event.summary,event.evidence_ref
       FROM ticket_rule_evaluations evaluation
       JOIN scheduling_rules rule ON rule.id=evaluation.rule_id AND rule.version=evaluation.rule_version
       JOIN ticket_business_events event ON event.id=evaluation.source_event_id
      ORDER BY evaluation.evaluated_at DESC,evaluation.id DESC LIMIT $1`,
    [bounded],
  );
  return {
    items: rows.rows.map((row) => ({
      id: row.id, rule_id: row.rule_id, rule_version: Number(row.rule_version), rule_title: row.rule_title,
      rule_type: row.rule_type, outcome: row.outcome, ticket_id: row.ticket_id || null,
      scope: object(row.business_scope), details: object(row.details_json), evaluated_at: row.evaluated_at,
      evaluated_by: row.evaluated_by,
      event: {
        id: row.event_id, event_type: row.event_type, source_system: row.source_system, source_event_id: row.source_event_id,
        source_version: row.source_version || "", company_id: row.company_id, brand_id: row.brand_id || null,
        region_id: row.region_id || null, occurred_at: row.occurred_at, summary: row.summary, evidence_ref: row.evidence_ref,
      },
    })),
    policy: {
      execution_effect: "none",
      requirement: "仅已发布且明确声明首批 trigger_event_types 的规则会被评估；所有命中仍待人工确认。",
    },
    as_of: new Date().toISOString(),
  };
}
