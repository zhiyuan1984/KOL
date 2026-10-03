import { HttpFail } from "../host/errors.js";
import { nid } from "../ids.js";
import { postgresTransaction } from "../postgres/pool.js";
import type { Json, Row } from "../types.js";

export type FormalTicketEditInput = {
  expected_version: number;
  idempotency_key: string;
  title?: string;
  goal?: string | null;
  priority?: "important_urgent" | "important" | "urgent" | "normal" | "low";
  due_at?: string | null;
  no_due_reason?: string | null;
  acceptance_criteria?: string[];
};

export type FormalTicketEditReceipt = {
  ticket_id: string;
  action: "edit";
  version: number;
  event_id: string;
  replayed: boolean;
};

const PRIORITIES = new Set(["important_urgent", "important", "urgent", "normal", "low"]);

function receipt(value: unknown): FormalTicketEditReceipt {
  try {
    if (value && typeof value === "object") return value as FormalTicketEditReceipt;
    return JSON.parse(String(value || "{}")) as FormalTicketEditReceipt;
  }
  catch { throw new HttpFail(500, { code: "ticket_command_receipt_corrupt" }); }
}

function validate(input: FormalTicketEditInput) {
  if (!Number.isInteger(input.expected_version) || input.expected_version < 1) throw new HttpFail(400, { code: "expected_version_required" });
  if (input.idempotency_key.length < 8 || input.idempotency_key.length > 200) throw new HttpFail(400, { code: "idempotency_key_required" });
  if (input.title !== undefined && (!input.title.trim() || input.title.trim().length > 120)) throw new HttpFail(422, { code: "invalid_title" });
  if (input.goal !== undefined && input.goal !== null && input.goal.length > 4_000) throw new HttpFail(422, { code: "goal_too_long" });
  if (input.priority !== undefined && !PRIORITIES.has(input.priority)) throw new HttpFail(422, { code: "invalid_priority" });
  if (input.due_at !== undefined && input.due_at !== null && Number.isNaN(new Date(input.due_at).valueOf())) throw new HttpFail(422, { code: "invalid_due_at" });
  if (input.acceptance_criteria && (input.acceptance_criteria.length === 0 || input.acceptance_criteria.length > 20 || input.acceptance_criteria.some((item) => !item.trim() || item.length > 500))) throw new HttpFail(422, { code: "invalid_acceptance_criteria" });
}

/** The owner may revise business fields while a ticket remains pending. State,
 * acceptance and assignment are separate governed commands. */
export async function editFormalTicketPostgres(ticketId: string, actorId: string, input: FormalTicketEditInput): Promise<FormalTicketEditReceipt> {
  validate(input);
  return postgresTransaction(async (client) => {
    const ticketResult = await client.query<Row>(
      "SELECT id,owner_user_id,status,data_version FROM tickets WHERE id=$1 AND task_type='manual_ticket' AND profile='ticket-workbench' FOR UPDATE",
      [ticketId],
    );
    const ticket = ticketResult.rows[0];
    if (!ticket) throw new HttpFail(404, { code: "ticket_not_found" });
    if (String(ticket.owner_user_id) !== actorId) throw new HttpFail(403, { code: "ticket_edit_not_authorized" });
    if (String(ticket.status) !== "pending") throw new HttpFail(409, { code: "ticket_edit_not_allowed", message: "仅待受理工单可编辑业务字段" });
    const existing = await client.query<Row>("SELECT ticket_id,action,result_json FROM ticket_command_receipts WHERE idempotency_key=$1", [input.idempotency_key]);
    if (existing.rows[0]) {
      const row = existing.rows[0];
      if (String(row.ticket_id) !== ticketId || String(row.action) !== "edit") throw new HttpFail(409, { code: "idempotency_key_reused" });
      return { ...receipt(row.result_json), replayed: true };
    }
    if (Number(ticket.data_version) !== input.expected_version) throw new HttpFail(409, { code: "version_conflict", current_version: Number(ticket.data_version), refresh: `/api/tickets/${ticketId}` });

    const updates: Array<{ column: string; value: unknown }> = [];
    if (input.title !== undefined) updates.push({ column: "title", value: input.title.trim() });
    if (input.goal !== undefined) updates.push({ column: "goal", value: input.goal?.trim() || null });
    if (input.priority !== undefined) updates.push({ column: "priority", value: input.priority });
    if (input.due_at !== undefined) updates.push({ column: "due_at", value: input.due_at });
    if (input.no_due_reason !== undefined) updates.push({ column: "no_due_reason", value: input.no_due_reason?.trim() || null });
    if (input.acceptance_criteria !== undefined) updates.push({ column: "acceptance_criteria", value: JSON.stringify(input.acceptance_criteria.map((item) => item.trim())) });
    if (!updates.length) throw new HttpFail(422, { code: "no_editable_fields" });
    const now = new Date().toISOString();
    const params: unknown[] = [];
    const set = updates.map((field) => {
      params.push(field.value);
      return `${field.column}=$${params.length}${field.column === "acceptance_criteria" ? "::jsonb" : ""}`;
    });
    params.push(now, ticketId, input.expected_version);
    const updated = await client.query<Row>(
      `UPDATE tickets SET ${set.join(",")},updated_at=$${params.length - 2},data_version=data_version+1
       WHERE id=$${params.length - 1} AND data_version=$${params.length} RETURNING data_version`,
      params,
    );
    if (!updated.rows[0]) throw new HttpFail(409, { code: "version_conflict", refresh: `/api/tickets/${ticketId}` });
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [ticketId]);
    const sequence = await client.query<{ sequence: string | number }>("SELECT COALESCE(MAX(sequence),0) AS sequence FROM task_events WHERE work_item_id=$1", [ticketId]);
    const eventId = nid("tev");
    await client.query(
      `INSERT INTO task_events (id,work_item_id,run_id,sequence,event_type,event_class,label,status,safe_summary,time,created_at)
       VALUES ($1,$2,NULL,$3,'task.updated','lifecycle','工单业务字段已更新','pending',$4,$5,$5)`,
      [eventId, ticketId, Number(sequence.rows[0]?.sequence || 0) + 1, `已更新：${updates.map((field) => field.column).join("、")}`, now],
    );
    const result: FormalTicketEditReceipt = { ticket_id: ticketId, action: "edit", version: Number(updated.rows[0].data_version), event_id: eventId, replayed: false };
    await client.query(
      `INSERT INTO ticket_audit_events (id,ticket_id,actor_user_id,command,request_json,result_json,created_at)
       VALUES ($1,$2,$3,'ticket.edit',$4,$5,$6)`,
      [nid("tad"), ticketId, actorId, JSON.stringify({ expected_version: input.expected_version, fields: updates.map((field) => field.column) }), JSON.stringify(result as Json), now],
    );
    await client.query(
      "INSERT INTO ticket_command_receipts (idempotency_key,ticket_id,action,result_json,created_at) VALUES ($1,$2,'edit',$3,$4)",
      [input.idempotency_key, ticketId, JSON.stringify(result as Json), now],
    );
    return result;
  }, { isolation: "SERIALIZABLE" });
}
