import type { PoolClient } from "pg";
import { HttpFail } from "../host/errors.js";
import { nid } from "../ids.js";
import { postgresPool, postgresTransaction } from "../postgres/pool.js";
import type { Json } from "../types.js";
import { ensurePostgresOrganizationSeed, postgresCreatorOrgContext } from "./organization.js";

const MAX_TEXT = 4_000;
const BUSINESS_CATEGORIES = new Set(["kol", "marketing", "operations", "data", "general"]);
const PRIORITIES = new Set(["important_urgent", "important", "urgent", "normal", "low"]);

type BasisRefInput = {
  source_type?: unknown;
  source_id?: unknown;
  source_version?: unknown;
  occurred_at?: unknown;
  summary?: unknown;
};

export type FormalTicketCreateInput = {
  title?: unknown;
  goal?: unknown;
  business_category?: unknown;
  stage_group?: unknown;
  stage_code?: unknown;
  priority?: unknown;
  due_at?: unknown;
  no_due_reason?: unknown;
  timezone?: unknown;
  acceptance_criteria?: unknown;
  assignee_person_ref?: unknown;
  assignee_unit_id?: unknown;
  cross_group_reason?: unknown;
  basis_refs?: unknown;
  idempotency_key?: unknown;
};

export type FormalTicketCreateResult = {
  ticket_id: string;
  status: "pending";
  data_version: number;
  replayed: boolean;
  org_version: number;
  created_at: string;
};

function text(value: unknown, field: string, required = false, max = MAX_TEXT): string | null {
  if (value == null) {
    if (required) throw new HttpFail(422, { code: "missing_fields", missing_fields: [field] });
    return null;
  }
  const result = String(value).trim();
  if (!result) {
    if (required) throw new HttpFail(422, { code: "missing_fields", missing_fields: [field] });
    return null;
  }
  if (result.length > max) throw new HttpFail(422, { code: "field_too_long", field, max });
  return result;
}

function criteria(value: unknown): string[] {
  if (!Array.isArray(value)) throw new HttpFail(422, { code: "acceptance_criteria_required", missing_fields: ["acceptance_criteria"] });
  const rows = value.map((item) => String(item || "").trim()).filter(Boolean);
  if (!rows.length) throw new HttpFail(422, { code: "acceptance_criteria_required", missing_fields: ["acceptance_criteria"] });
  if (rows.length > 20 || rows.some((item) => item.length > 500)) {
    throw new HttpFail(422, { code: "acceptance_criteria_invalid" });
  }
  return rows;
}

function dateTime(value: unknown): string | null {
  const raw = text(value, "due_at");
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw new HttpFail(422, { code: "invalid_due_at", field: "due_at" });
  return parsed.toISOString();
}

function basisRefs(value: unknown): Array<{ source_type: string; source_id: string; source_version: string | null; occurred_at: string | null; summary: Json }> {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new HttpFail(422, { code: "basis_refs_invalid" });
  if (value.length > 50) throw new HttpFail(422, { code: "basis_refs_invalid" });
  return value.map((raw) => {
    const row = (raw && typeof raw === "object" ? raw : {}) as BasisRefInput;
    const sourceType = text(row.source_type, "basis_refs.source_type", true, 120)!;
    const sourceId = text(row.source_id, "basis_refs.source_id", true, 500)!;
    const sourceVersion = text(row.source_version, "basis_refs.source_version", false, 300);
    const occurred = row.occurred_at == null ? null : dateTime(row.occurred_at);
    const summary = row.summary && typeof row.summary === "object" && !Array.isArray(row.summary) ? row.summary as Json : {};
    return { source_type: sourceType, source_id: sourceId, source_version: sourceVersion, occurred_at: occurred, summary };
  });
}

function parseInput(input: FormalTicketCreateInput) {
  const title = text(input.title, "title", true, 200)!;
  const goal = text(input.goal, "goal", true)!;
  const businessCategory = text(input.business_category, "business_category", true, 80)!;
  if (!BUSINESS_CATEGORIES.has(businessCategory)) throw new HttpFail(422, { code: "business_category_invalid" });
  const stageGroup = text(input.stage_group, "stage_group", false, 120);
  const stageCode = text(input.stage_code, "stage_code", false, 120);
  const priority = text(input.priority, "priority", false, 80) || "normal";
  if (!PRIORITIES.has(priority)) throw new HttpFail(422, { code: "priority_invalid" });
  const dueAt = dateTime(input.due_at);
  const noDueReason = text(input.no_due_reason, "no_due_reason", false, 600);
  if (!dueAt && !noDueReason) throw new HttpFail(422, { code: "due_at_or_reason_required", missing_fields: ["due_at", "no_due_reason"] });
  const assigneePersonRef = text(input.assignee_person_ref, "assignee_person_ref", true, 200)!;
  const assigneeUnitId = text(input.assignee_unit_id, "assignee_unit_id", true, 200)!;
  const crossGroupReason = text(input.cross_group_reason, "cross_group_reason", false, 800);
  const timezone = text(input.timezone, "timezone", false, 80) || "Asia/Shanghai";
  const idempotencyKey = text(input.idempotency_key, "idempotency_key", true, 200)!;
  if (idempotencyKey.length < 8) throw new HttpFail(422, { code: "idempotency_key_invalid" });
  return {
    title, goal, businessCategory, stageGroup, stageCode, priority, dueAt, noDueReason, assigneePersonRef,
    assigneeUnitId, crossGroupReason, timezone, idempotencyKey, acceptanceCriteria: criteria(input.acceptance_criteria), basisRefs: basisRefs(input.basis_refs),
  };
}

async function hierarchy(client: PoolClient, companyId: string, assigneeUnitId: string) {
  const units = await client.query<{ id: string; parent_id: string | null; type: string }>(
    "SELECT id,parent_id,type FROM organization_units WHERE company_id=$1 AND status='active'",
    [companyId],
  );
  const byId = new Map(units.rows.map((unit) => [unit.id, unit]));
  if (!byId.has(assigneeUnitId)) throw new HttpFail(422, { code: "assignee_unit_invalid" });
  let cursor: string | null = assigneeUnitId;
  const seen = new Set<string>();
  let center: string | null = null;
  let department: string | null = null;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const current = byId.get(cursor);
    if (!current) break;
    if (current.type === "center" && !center) center = current.id;
    if (current.type === "department" && !department) department = current.id;
    cursor = current.parent_id;
  }
  return { center, department };
}

/** PostgreSQL-native, auditable formal ticket creation. */
export async function createFormalTicketPostgres(actorUserId: string, raw: FormalTicketCreateInput): Promise<FormalTicketCreateResult> {
  const input = parseInput(raw);
  await ensurePostgresOrganizationSeed();
  return postgresTransaction(async (client) => {
    const replay = await client.query<{ requester_user_id: string; response_json: FormalTicketCreateResult }>(
      "SELECT requester_user_id,response_json FROM ticket_create_receipts WHERE idempotency_key=$1 FOR UPDATE",
      [input.idempotencyKey],
    );
    if (replay.rows[0]) {
      if (replay.rows[0].requester_user_id !== actorUserId) throw new HttpFail(409, { code: "idempotency_key_reused" });
      return { ...replay.rows[0].response_json, replayed: true };
    }

    const creator = await postgresCreatorOrgContext(actorUserId);
    if (!creator.person_ref || !creator.org_unit_id || !creator.company_id || !creator.org_version || creator.quality_issues.length) {
      throw new HttpFail(422, { code: "organization_resolution_required", missing_fields: ["creator_organization", "creator_supervisor"], details: creator.quality_issues });
    }
    const assigneeResult = await client.query<{ person_ref: string; user_id: string | null; org_unit_id: string | null }>(
      `SELECT p.person_ref,p.user_id,m.org_unit_id
       FROM organization_people p
       JOIN organization_memberships m ON m.person_ref=p.person_ref AND m.status='active' AND m.relation='primary'
       WHERE p.person_ref=$1 AND p.status='active'
       FOR UPDATE`,
      [input.assigneePersonRef],
    );
    const assignee = assigneeResult.rows[0];
    if (!assignee || !assignee.user_id || !assignee.org_unit_id || assignee.org_unit_id !== input.assigneeUnitId) {
      throw new HttpFail(422, { code: "assignee_resolution_required", missing_fields: ["assignee_person_ref", "assignee_unit_id"] });
    }
    if (assignee.org_unit_id !== creator.org_unit_id && !input.crossGroupReason) {
      throw new HttpFail(422, { code: "cross_group_reason_required", missing_fields: ["cross_group_reason"] });
    }
    const scope = await hierarchy(client, creator.company_id, input.assigneeUnitId);
    const now = new Date().toISOString();
    const ticketId = nid("tsk");
    const ticketInput = {
      goal: input.goal,
      business_category: input.businessCategory,
      stage_group: input.stageGroup,
      stage_code: input.stageCode,
      acceptance_criteria: input.acceptanceCriteria,
      origin: "ticket_form",
    };
    await client.query(
      `INSERT INTO tickets
       (id,owner_user_id,task_type,title,source,status,priority,skill,profile,due_at,input,entities,data_version,created_at,updated_at,
        kind,channel,requester_type,requester_id,goal,next_action,business_category,stage_group,stage_code,ticket_timezone,no_due_reason,acceptance_criteria)
       VALUES ($1,$2,'manual_ticket',$3,'manual','pending',$4,'ticket_form','ticket-workbench',$5,$6,$7,1,$8,$8,
         'general','human','human',$2,$9,NULL,$10,$11,$12,$13,$14,$15)`,
      [ticketId, actorUserId, input.title, input.priority, input.dueAt, JSON.stringify(ticketInput), JSON.stringify({}), now,
        input.goal, input.businessCategory, input.stageGroup, input.stageCode, input.timezone, input.noDueReason, JSON.stringify(input.acceptanceCriteria)],
    );
    await client.query(
      `INSERT INTO ticket_org_scopes
       (ticket_id,company_id,center_unit_id,department_unit_id,assignee_unit_id,org_version,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7)`,
      [ticketId, creator.company_id, scope.center, scope.department, input.assigneeUnitId, creator.org_version, now],
    );
    await client.query(
      `INSERT INTO ticket_assignments
       (ticket_id,assignee_person_ref,assignee_user_id,org_unit_id,role,status,cross_group_reason,assigned_by_user_id,assignment_version,effective_from,created_at)
       VALUES ($1,$2,$3,$4,'primary','active',$5,$6,1,$7,$7)`,
      [ticketId, assignee.person_ref, assignee.user_id, input.assigneeUnitId, input.crossGroupReason, actorUserId, now],
    );
    if (creator.supervisor_person_ref && creator.supervisor_user_id) {
      await client.query(
        `INSERT INTO ticket_watchers
         (ticket_id,watcher_person_ref,watcher_user_id,reason,automatic,org_version,status,created_at)
         VALUES ($1,$2,$3,'creator_supervisor',true,$4,'active',$5)
         ON CONFLICT DO NOTHING`,
        [ticketId, creator.supervisor_person_ref, creator.supervisor_user_id, creator.org_version, now],
      );
    }
    for (const basis of input.basisRefs) {
      await client.query(
        `INSERT INTO ticket_basis_refs (ticket_id,source_type,source_id,source_version,occurred_at,summary_json,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (ticket_id,source_type,source_id,source_version) DO NOTHING`,
        [ticketId, basis.source_type, basis.source_id, basis.source_version, basis.occurred_at, JSON.stringify(basis.summary), now],
      );
    }
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [ticketId]);
    const eventId = nid("tev");
    await client.query(
      `INSERT INTO task_events
       (id,work_item_id,run_id,sequence,event_type,event_class,label,status,safe_summary,time,created_at)
       VALUES ($1,$2,NULL,1,'task.created','lifecycle','正式工单已创建','pending',$3,$4,$4)`,
      [eventId, ticketId, `已创建${input.businessCategory}工单；组织范围和负责人观察人已固化。`, now],
    );
    const response: FormalTicketCreateResult = { ticket_id: ticketId, status: "pending", data_version: 1, replayed: false, org_version: creator.org_version, created_at: now };
    await client.query(
      `INSERT INTO ticket_audit_events
       (id,ticket_id,actor_user_id,command,request_json,result_json,created_at)
       VALUES ($1,$2,$3,'ticket.create',$4,$5,$6)`,
      [
        nid("tae"), ticketId, actorUserId,
        JSON.stringify({
          idempotency_key: input.idempotencyKey,
          assignee_person_ref: input.assigneePersonRef,
          assignee_unit_id: input.assigneeUnitId,
          organization_version: creator.org_version,
        }),
        JSON.stringify({ event_id: eventId, status: "pending", data_version: 1 }), now,
      ],
    );
    await client.query(
      `INSERT INTO ticket_create_receipts (idempotency_key,requester_user_id,ticket_id,response_json,created_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [input.idempotencyKey, actorUserId, ticketId, JSON.stringify(response), now],
    );
    return response;
  }, { isolation: "SERIALIZABLE" });
}
