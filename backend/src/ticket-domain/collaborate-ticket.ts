import { HttpFail } from "../host/errors.js";
import { nid } from "../ids.js";
import type { PoolClient } from "pg";
import { postgresTransaction } from "../postgres/pool.js";
import type { Json, Row } from "../types.js";

export type CollaboratorTicketInput = {
  ticket_id: string;
  actor_user_id: string;
  expected_version: number;
  idempotency_key: string;
  assignee_person_ref: string;
  assignee_unit_id?: string;
  cross_group_reason?: string | null;
};

export type CollaboratorTicketResult = {
  ticket_id: string;
  action: "add_collaborator" | "remove_collaborator";
  assignee_person_ref: string;
  assignee_user_id?: string;
  assignee_unit_id?: string;
  version: number;
  event_id: string;
  replayed: boolean;
};

function parseReceipt(value: unknown): CollaboratorTicketResult {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as CollaboratorTicketResult;
  try { return JSON.parse(String(value || "{}")) as CollaboratorTicketResult; } catch {
    throw new HttpFail(500, { code: "ticket_command_receipt_corrupt" });
  }
}

function text(value: unknown, field: string, max = 800): string {
  const result = String(value || "").trim();
  if (!result || result.length > max) throw new HttpFail(422, { code: "invalid_collaborator", field });
  return result;
}

function base(raw: CollaboratorTicketInput) {
  const input = {
    ...raw,
    ticket_id: text(raw.ticket_id, "ticket_id", 200),
    actor_user_id: text(raw.actor_user_id, "actor_user_id", 200),
    idempotency_key: text(raw.idempotency_key, "idempotency_key", 200),
    assignee_person_ref: text(raw.assignee_person_ref, "assignee_person_ref", 200),
    assignee_unit_id: raw.assignee_unit_id == null ? null : text(raw.assignee_unit_id, "assignee_unit_id", 200),
    cross_group_reason: raw.cross_group_reason == null ? null : text(raw.cross_group_reason, "cross_group_reason"),
  };
  if (input.idempotency_key.length < 8 || !Number.isInteger(raw.expected_version) || raw.expected_version < 1) {
    throw new HttpFail(422, { code: "collaborator_version_or_idempotency_invalid" });
  }
  return input;
}

async function lockedTicket(client: PoolClient, input: ReturnType<typeof base>) {
  const result = await client.query<Row>("SELECT id,owner_user_id,status,data_version FROM tickets WHERE id=$1 FOR UPDATE", [input.ticket_id]);
  const ticket = result.rows[0];
  if (!ticket) throw new HttpFail(404, { code: "ticket_not_found" });
  if (String(ticket.owner_user_id) !== input.actor_user_id) throw new HttpFail(403, { code: "collaborator_not_authorized" });
  if (["completed", "cancelled", "failed"].includes(String(ticket.status))) throw new HttpFail(409, { code: "collaborator_not_allowed" });
  return ticket;
}

async function replayOrVersion(
  client: PoolClient, ticket: Row, input: ReturnType<typeof base>, action: CollaboratorTicketResult["action"],
): Promise<CollaboratorTicketResult | null> {
  const result = await client.query<Row>("SELECT ticket_id,action,result_json FROM ticket_command_receipts WHERE idempotency_key=$1", [input.idempotency_key]);
  const receipt = result.rows[0];
  if (receipt) {
    if (String(receipt.ticket_id) !== String(ticket.id) || String(receipt.action) !== action) throw new HttpFail(409, { code: "idempotency_key_reused" });
    return { ...parseReceipt(receipt.result_json), replayed: true };
  }
  if (Number(ticket.data_version) !== input.expected_version) {
    throw new HttpFail(409, { code: "version_conflict", current_version: Number(ticket.data_version), refresh: `/api/tickets/${ticket.id}` });
  }
  return null;
}

async function updateTicketAndEvent(
  client: PoolClient,
  ticket: Row,
  input: ReturnType<typeof base>,
  event: { type: string; label: string; summary: string },
): Promise<{ version: number; eventId: string; now: string }> {
  const now = new Date().toISOString();
  const updated = await client.query<Row>(
    "UPDATE tickets SET updated_at=$1,data_version=data_version+1 WHERE id=$2 AND data_version=$3 RETURNING data_version",
    [now, ticket.id, input.expected_version],
  );
  if (!updated.rows[0]) throw new HttpFail(409, { code: "version_conflict", refresh: `/api/tickets/${ticket.id}` });
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [String(ticket.id)]);
  const sequence = await client.query<{ sequence: number }>("SELECT COALESCE(MAX(sequence),0)::int AS sequence FROM task_events WHERE work_item_id=$1", [ticket.id]);
  const eventId = nid("tev");
  await client.query(
    `INSERT INTO task_events (id,work_item_id,run_id,sequence,event_type,event_class,label,status,safe_summary,time,created_at)
     VALUES ($1,$2,NULL,$3,$4,'lifecycle',$5,$6,$7,$8,$8)`,
    [eventId, ticket.id, Number(sequence.rows[0]?.sequence || 0) + 1, event.type, event.label, ticket.status, event.summary, now],
  );
  return { version: Number(updated.rows[0].data_version), eventId, now };
}

/** Adds a secondary responsibility. The active primary remains the sole person
 * entitled to accept or submit acceptance evidence. */
export async function addTicketCollaboratorPostgres(raw: CollaboratorTicketInput): Promise<CollaboratorTicketResult> {
  const input = base(raw);
  if (!input.assignee_unit_id) throw new HttpFail(422, { code: "invalid_collaborator", field: "assignee_unit_id" });
  return postgresTransaction(async (client) => {
    const ticket = await lockedTicket(client, input);
    const replay = await replayOrVersion(client, ticket, input, "add_collaborator");
    if (replay) return replay;
    const assignments = await client.query<Row>("SELECT * FROM ticket_assignments WHERE ticket_id=$1 AND status='active' FOR UPDATE", [ticket.id]);
    const primary = assignments.rows.find((item) => String(item.role) === "primary");
    if (!primary) throw new HttpFail(409, { code: "active_primary_assignment_missing" });
    const assigneeResult = await client.query<Row>(
      `SELECT p.person_ref,p.user_id,m.org_unit_id
         FROM organization_people p JOIN organization_memberships m ON m.person_ref=p.person_ref
        WHERE p.person_ref=$1 AND p.status='active' AND m.status='active' AND m.relation='primary' FOR UPDATE`,
      [input.assignee_person_ref],
    );
    const assignee = assigneeResult.rows.find((row) => String(row.org_unit_id) === input.assignee_unit_id);
    if (!assignee?.user_id) throw new HttpFail(422, { code: "assignee_resolution_required" });
    if (String(assignee.user_id) === String(primary.assignee_user_id)) throw new HttpFail(422, { code: "primary_cannot_be_collaborator" });
    if (assignments.rows.some((item) => String(item.role) === "collaborator" && String(item.assignee_user_id) === String(assignee.user_id))) {
      throw new HttpFail(409, { code: "collaborator_already_active" });
    }
    if (String(primary.org_unit_id) !== input.assignee_unit_id && !input.cross_group_reason) {
      throw new HttpFail(422, { code: "cross_group_reason_required", missing_fields: ["cross_group_reason"] });
    }
    const nextAssignmentVersion = Math.max(0, ...assignments.rows.map((item) => Number(item.assignment_version || 0))) + 1;
    const now = new Date().toISOString();
    await client.query(
      `INSERT INTO ticket_assignments
       (ticket_id,assignee_person_ref,assignee_user_id,org_unit_id,role,status,cross_group_reason,assigned_by_user_id,assignment_version,effective_from,created_at)
       VALUES ($1,$2,$3,$4,'collaborator','active',$5,$6,$7,$8,$8)`,
      [ticket.id, assignee.person_ref, assignee.user_id, input.assignee_unit_id, input.cross_group_reason, input.actor_user_id, nextAssignmentVersion, now],
    );
    const updated = await updateTicketAndEvent(client, ticket, input, {
      type: "task.collaborator_added", label: "已添加协同受理人",
      summary: `协同受理人已添加：${String(assignee.person_ref)}；${input.cross_group_reason ? `跨组原因：${input.cross_group_reason}` : "同组协同"}`,
    });
    const response: CollaboratorTicketResult = {
      ticket_id: String(ticket.id), action: "add_collaborator", assignee_person_ref: String(assignee.person_ref),
      assignee_user_id: String(assignee.user_id), assignee_unit_id: String(input.assignee_unit_id), version: updated.version, event_id: updated.eventId, replayed: false,
    };
    await client.query(
      `INSERT INTO ticket_audit_events (id,ticket_id,actor_user_id,command,request_json,result_json,created_at)
       VALUES ($1,$2,$3,'ticket.collaborator.add',$4,$5,$6)`,
      [nid("tad"), ticket.id, input.actor_user_id, JSON.stringify({ ...input, expected_version: raw.expected_version }), JSON.stringify(response as Json), updated.now],
    );
    await client.query("INSERT INTO ticket_command_receipts (idempotency_key,ticket_id,action,result_json,created_at) VALUES ($1,$2,'add_collaborator',$3,$4)", [input.idempotency_key, ticket.id, JSON.stringify(response as Json), updated.now]);
    return response;
  }, { isolation: "SERIALIZABLE" });
}

/** Removes only an active collaborator; primary assignment and its history stay untouched. */
export async function removeTicketCollaboratorPostgres(raw: CollaboratorTicketInput): Promise<CollaboratorTicketResult> {
  const input = base(raw);
  return postgresTransaction(async (client) => {
    const ticket = await lockedTicket(client, input);
    const replay = await replayOrVersion(client, ticket, input, "remove_collaborator");
    if (replay) return replay;
    const collaboratorResult = await client.query<Row>(
      `SELECT * FROM ticket_assignments
        WHERE ticket_id=$1 AND role='collaborator' AND status='active' AND assignee_person_ref=$2 FOR UPDATE`,
      [ticket.id, input.assignee_person_ref],
    );
    const collaborator = collaboratorResult.rows[0];
    if (!collaborator) throw new HttpFail(404, { code: "active_collaborator_not_found" });
    const now = new Date().toISOString();
    await client.query("UPDATE ticket_assignments SET status='superseded',effective_to=$1 WHERE ticket_id=$2 AND role='collaborator' AND status='active' AND assignee_person_ref=$3", [now, ticket.id, input.assignee_person_ref]);
    const updated = await updateTicketAndEvent(client, ticket, input, {
      type: "task.collaborator_removed", label: "已移除协同受理人", summary: `协同受理人已移除：${String(collaborator.assignee_person_ref)}`,
    });
    const response: CollaboratorTicketResult = {
      ticket_id: String(ticket.id), action: "remove_collaborator", assignee_person_ref: String(collaborator.assignee_person_ref),
      assignee_user_id: String(collaborator.assignee_user_id), assignee_unit_id: String(collaborator.org_unit_id), version: updated.version, event_id: updated.eventId, replayed: false,
    };
    await client.query(
      `INSERT INTO ticket_audit_events (id,ticket_id,actor_user_id,command,request_json,result_json,created_at)
       VALUES ($1,$2,$3,'ticket.collaborator.remove',$4,$5,$6)`,
      [nid("tad"), ticket.id, input.actor_user_id, JSON.stringify({ ticket_id: input.ticket_id, assignee_person_ref: input.assignee_person_ref, expected_version: raw.expected_version }), JSON.stringify(response as Json), updated.now],
    );
    await client.query("INSERT INTO ticket_command_receipts (idempotency_key,ticket_id,action,result_json,created_at) VALUES ($1,$2,'remove_collaborator',$3,$4)", [input.idempotency_key, ticket.id, JSON.stringify(response as Json), updated.now]);
    return response;
  }, { isolation: "SERIALIZABLE" });
}
