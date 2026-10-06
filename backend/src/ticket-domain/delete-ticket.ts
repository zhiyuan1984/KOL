import { HttpFail } from "../host/errors.js";
import { nid } from "../ids.js";
import { postgresTransaction } from "../postgres/pool.js";
import type { Json, Row } from "../types.js";

export type FormalTicketDeleteInput = {
  expected_version: number;
  idempotency_key: string;
};

export type FormalTicketDeleteReceipt = {
  ticket_id: string;
  deleted: true;
  replayed: boolean;
};

function receipt(value: unknown): FormalTicketDeleteReceipt {
  try {
    if (value && typeof value === "object") return value as FormalTicketDeleteReceipt;
    return JSON.parse(String(value || "{}")) as FormalTicketDeleteReceipt;
  } catch {
    throw new HttpFail(500, { code: "ticket_command_receipt_corrupt" });
  }
}

function validate(input: FormalTicketDeleteInput) {
  if (!Number.isInteger(input.expected_version) || input.expected_version < 1) throw new HttpFail(400, { code: "expected_version_required" });
  if (input.idempotency_key.length < 8 || input.idempotency_key.length > 200) throw new HttpFail(400, { code: "idempotency_key_required" });
}

/**
 * Removes a pending manual ticket from all employee ticket-center projections.
 * We retain its immutable lifecycle evidence instead of physically cascading it,
 * which is both reversible at the database layer and compatible with the
 * formal-event immutability trigger.
 */
export async function deleteFormalTicketPostgres(ticketId: string, actorId: string, input: FormalTicketDeleteInput): Promise<FormalTicketDeleteReceipt> {
  validate(input);
  return postgresTransaction(async (client) => {
    const ticketResult = await client.query<Row>(
      "SELECT id,owner_user_id,status,data_version,deleted_at FROM tickets WHERE id=$1 AND task_type='manual_ticket' AND profile='ticket-workbench' FOR UPDATE",
      [ticketId],
    );
    const ticket = ticketResult.rows[0];
    if (!ticket || ticket.deleted_at) throw new HttpFail(404, { code: "ticket_not_found" });
    if (String(ticket.owner_user_id) !== actorId) throw new HttpFail(403, { code: "ticket_delete_not_authorized" });
    if (String(ticket.status) !== "pending") throw new HttpFail(409, { code: "ticket_delete_not_allowed", message: "仅待受理工单可删除" });

    const existing = await client.query<Row>("SELECT ticket_id,action,result_json FROM ticket_command_receipts WHERE idempotency_key=$1", [input.idempotency_key]);
    if (existing.rows[0]) {
      const row = existing.rows[0];
      if (String(row.ticket_id) !== ticketId || String(row.action) !== "delete") throw new HttpFail(409, { code: "idempotency_key_reused" });
      return { ...receipt(row.result_json), replayed: true };
    }
    if (Number(ticket.data_version) !== input.expected_version) throw new HttpFail(409, { code: "version_conflict", current_version: Number(ticket.data_version), refresh: `/api/tickets/${ticketId}` });

    const now = new Date().toISOString();
    const updated = await client.query<Row>(
      `UPDATE tickets
       SET deleted_at=$1,status='cancelled',updated_at=$1,data_version=data_version+1
       WHERE id=$2 AND data_version=$3 AND deleted_at IS NULL
       RETURNING data_version`,
      [now, ticketId, input.expected_version],
    );
    if (!updated.rows[0]) throw new HttpFail(409, { code: "version_conflict", refresh: `/api/tickets/${ticketId}` });

    const result: FormalTicketDeleteReceipt = { ticket_id: ticketId, deleted: true, replayed: false };
    await client.query(
      `INSERT INTO ticket_audit_events (id,ticket_id,actor_user_id,command,request_json,result_json,created_at)
       VALUES ($1,$2,$3,'ticket.delete',$4,$5,$6)`,
      [nid("tad"), ticketId, actorId, JSON.stringify({ expected_version: input.expected_version }), JSON.stringify(result as Json), now],
    );
    await client.query(
      "INSERT INTO ticket_command_receipts (idempotency_key,ticket_id,action,result_json,created_at) VALUES ($1,$2,'delete',$3,$4)",
      [input.idempotency_key, ticketId, JSON.stringify(result as Json), now],
    );
    return result;
  }, { isolation: "SERIALIZABLE" });
}
