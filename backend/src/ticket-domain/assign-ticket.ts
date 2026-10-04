import { HttpFail } from "../host/errors.js";
import { nid } from "../ids.js";
import { postgresTransaction } from "../postgres/pool.js";
import type { Json, Row } from "../types.js";

export type AssignTicketInput = {
  ticket_id: string;
  actor_user_id: string;
  expected_version: number;
  idempotency_key: string;
  assignee_person_ref: string;
  assignee_unit_id: string;
  cross_group_reason?: string | null;
};

export type AssignTicketResult = {
  ticket_id: string;
  action: "assign";
  assignee_person_ref: string;
  assignee_user_id: string;
  assignee_unit_id: string;
  version: number;
  event_id: string;
  replayed: boolean;
};

function parseReceipt(value: unknown): AssignTicketResult {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as AssignTicketResult;
  try { return JSON.parse(String(value || "{}")) as AssignTicketResult; } catch {
    throw new HttpFail(500, { code: "ticket_command_receipt_corrupt" });
  }
}

function text(value: unknown, field: string, max = 800): string {
  const result = String(value || "").trim();
  if (!result || result.length > max) throw new HttpFail(422, { code: "invalid_assignment", field });
  return result;
}

/** Replaces the active primary assignment while retaining the full assignment history. */
export async function assignFormalTicketPostgres(raw: AssignTicketInput): Promise<AssignTicketResult> {
  const input = {
    ...raw,
    ticket_id: text(raw.ticket_id, "ticket_id", 200),
    actor_user_id: text(raw.actor_user_id, "actor_user_id", 200),
    idempotency_key: text(raw.idempotency_key, "idempotency_key", 200),
    assignee_person_ref: text(raw.assignee_person_ref, "assignee_person_ref", 200),
    assignee_unit_id: text(raw.assignee_unit_id, "assignee_unit_id", 200),
    cross_group_reason: raw.cross_group_reason == null ? null : text(raw.cross_group_reason, "cross_group_reason"),
  };
  if (input.idempotency_key.length < 8 || !Number.isInteger(raw.expected_version) || raw.expected_version < 1) {
    throw new HttpFail(422, { code: "assignment_version_or_idempotency_invalid" });
  }
  return postgresTransaction(async (client) => {
    const ticketResult = await client.query<Row>("SELECT id,owner_user_id,status,data_version FROM tickets WHERE id=$1 FOR UPDATE", [input.ticket_id]);
    const ticket = ticketResult.rows[0];
    if (!ticket) throw new HttpFail(404, { code: "ticket_not_found" });
    if (String(ticket.owner_user_id) !== input.actor_user_id) throw new HttpFail(403, { code: "assignment_not_authorized" });
    if (["completed", "cancelled", "failed"].includes(String(ticket.status))) throw new HttpFail(409, { code: "assignment_not_allowed" });
    const replayResult = await client.query<Row>("SELECT ticket_id,action,result_json FROM ticket_command_receipts WHERE idempotency_key=$1", [input.idempotency_key]);
    const replay = replayResult.rows[0];
    if (replay) {
      if (String(replay.ticket_id) !== input.ticket_id || String(replay.action) !== "assign") throw new HttpFail(409, { code: "idempotency_key_reused" });
      return { ...parseReceipt(replay.result_json), replayed: true };
    }
    if (Number(ticket.data_version) !== raw.expected_version) {
      throw new HttpFail(409, { code: "version_conflict", current_version: Number(ticket.data_version), refresh: `/api/tickets/${ticket.id}` });
    }
    const currentResult = await client.query<Row>(
      "SELECT * FROM ticket_assignments WHERE ticket_id=$1 AND role='primary' AND status='active' FOR UPDATE",
      [ticket.id],
    );
    const current = currentResult.rows[0];
    if (!current) throw new HttpFail(409, { code: "active_primary_assignment_missing" });
    const assigneeResult = await client.query<Row>(
      `SELECT p.person_ref,p.user_id,m.org_unit_id
       FROM organization_people p JOIN organization_memberships m ON m.person_ref=p.person_ref
       WHERE p.person_ref=$1 AND p.status='active' AND m.status='active' AND m.relation='primary' FOR UPDATE`,
      [input.assignee_person_ref],
    );
    const assignee = assigneeResult.rows.find((row) => String(row.org_unit_id) === input.assignee_unit_id);
    if (!assignee?.user_id) throw new HttpFail(422, { code: "assignee_resolution_required" });
    if (String(current.org_unit_id) !== input.assignee_unit_id && !input.cross_group_reason) {
      throw new HttpFail(422, { code: "cross_group_reason_required", missing_fields: ["cross_group_reason"] });
    }
    const now = new Date().toISOString();
    const nextAssignmentVersion = Number(current.assignment_version || 1) + 1;
    await client.query("UPDATE ticket_assignments SET status='superseded',effective_to=$1 WHERE ticket_id=$2 AND role='primary' AND status='active'", [now, ticket.id]);
    await client.query(
      `INSERT INTO ticket_assignments
       (ticket_id,assignee_person_ref,assignee_user_id,org_unit_id,role,status,cross_group_reason,assigned_by_user_id,assignment_version,effective_from,created_at)
       VALUES ($1,$2,$3,$4,'primary','active',$5,$6,$7,$8,$8)`,
      [ticket.id, assignee.person_ref, assignee.user_id, input.assignee_unit_id, input.cross_group_reason, input.actor_user_id, nextAssignmentVersion, now],
    );
    const update = await client.query<Row>(
      "UPDATE tickets SET updated_at=$1,data_version=data_version+1 WHERE id=$2 AND data_version=$3 RETURNING data_version",
      [now, ticket.id, raw.expected_version],
    );
    if (!update.rows[0]) throw new HttpFail(409, { code: "version_conflict", refresh: `/api/tickets/${ticket.id}` });
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [String(ticket.id)]);
    const sequence = await client.query<{ sequence: number }>("SELECT COALESCE(MAX(sequence),0)::int AS sequence FROM task_events WHERE work_item_id=$1", [ticket.id]);
    const eventId = nid("tev");
    await client.query(
      `INSERT INTO task_events (id,work_item_id,run_id,sequence,event_type,event_class,label,status,safe_summary,time,created_at)
       VALUES ($1,$2,NULL,$3,'task.reassigned','lifecycle','工单已转办',$4,$5,$6,$6)`,
      [eventId, ticket.id, Number(sequence.rows[0]?.sequence || 0) + 1, ticket.status,
        `主受理人已转办至 ${String(assignee.person_ref)}；${input.cross_group_reason ? `跨组原因：${input.cross_group_reason}` : "同组转办"}`, now],
    );
    const response: AssignTicketResult = {
      ticket_id: String(ticket.id), action: "assign", assignee_person_ref: String(assignee.person_ref),
      assignee_user_id: String(assignee.user_id), assignee_unit_id: input.assignee_unit_id,
      version: Number(update.rows[0].data_version), event_id: eventId, replayed: false,
    };
    await client.query(
      `INSERT INTO ticket_audit_events (id,ticket_id,actor_user_id,command,request_json,result_json,created_at)
       VALUES ($1,$2,$3,'ticket.assign',$4,$5,$6)`,
      [nid("tad"), ticket.id, input.actor_user_id, JSON.stringify({ expected_version: raw.expected_version, assignee_person_ref: input.assignee_person_ref, assignee_unit_id: input.assignee_unit_id, cross_group_reason: input.cross_group_reason }), JSON.stringify(response as Json), now],
    );
    await client.query("INSERT INTO ticket_command_receipts (idempotency_key,ticket_id,action,result_json,created_at) VALUES ($1,$2,'assign',$3,$4)", [input.idempotency_key, ticket.id, JSON.stringify(response as Json), now]);
    return response;
  }, { isolation: "SERIALIZABLE" });
}
