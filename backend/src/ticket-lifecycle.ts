import { HttpFail } from "./host/errors.js";
import { nid } from "./ids.js";
import { postgresTransaction } from "./postgres/pool.js";
import type { Json, Row } from "./types.js";
import { parseTicketLifecycleReceipt, ticketAllowedLifecycleActions, validateTicketLifecycleCommand, type TicketTransitionInput, type TicketTransitionReceipt } from "./ticket-lifecycle-contract.js";

export { ticketAllowedLifecycleActions } from "./ticket-lifecycle-contract.js";
export type { TicketLifecycleAction, TicketTransitionInput, TicketTransitionReceipt } from "./ticket-lifecycle-contract.js";

/**
 * PostgreSQL-native formal lifecycle transition. It intentionally does not
 * flow through the SQLite-shaped compatibility connection: the ticket row
 * lock, optimistic version, immutable event, acceptance snapshot and command
 * receipt are committed as a single PostgreSQL transaction.
 */
export async function transitionTicketLifecyclePostgres(input: TicketTransitionInput): Promise<TicketTransitionReceipt> {
  validateTicketLifecycleCommand(input);
  return postgresTransaction(async (client) => {
    const ticketResult = await client.query<Row>(
      "SELECT id,owner_user_id,status,data_version FROM tickets WHERE id=$1 FOR UPDATE",
      [input.ticketId],
    );
    const ticket = ticketResult.rows[0] as Row | undefined;
    if (!ticket) throw new HttpFail(404, "task not found");

    const replayResult = await client.query<Row>(
      "SELECT ticket_id,action,result_json FROM ticket_command_receipts WHERE idempotency_key=$1",
      [input.idempotencyKey],
    );
    const replay = replayResult.rows[0] as Row | undefined;
    if (replay) {
      if (String(replay.ticket_id) !== input.ticketId || String(replay.action) !== input.action) {
        throw new HttpFail(409, { code: "idempotency_key_reused", message: "幂等键已用于另一条工单命令" });
      }
      return { ...parseTicketLifecycleReceipt(replay.result_json), replayed: true };
    }

    const currentVersion = Number(ticket.data_version || 1);
    if (currentVersion !== input.expectedVersion) {
      throw new HttpFail(409, {
        code: "version_conflict",
        message: "工单已更新，请刷新后确认。",
        expected_version: input.expectedVersion,
        current_version: currentVersion,
        refresh: `/api/tickets/${ticket.id}`,
      });
    }
    if (!ticketAllowedLifecycleActions(ticket).includes(input.action)) {
      throw new HttpFail(409, { code: "action_not_allowed", message: "当前工单状态不能执行此动作" });
    }

    const now = new Date().toISOString();
    const nextStatus = input.action === "complete" ? "completed" : input.action === "accept" ? "accepted" : input.action === "reopen" ? "pending" : "cancelled";
    const updatedResult = await client.query<Row>(
      `UPDATE tickets SET status=$1,completed_at=CASE WHEN $1='completed' THEN $2 WHEN $1='pending' THEN NULL ELSE completed_at END,
       updated_at=$2,data_version=data_version+1
       WHERE id=$3 AND data_version=$4
       RETURNING id,owner_user_id,status,data_version`,
      [nextStatus, now, ticket.id, input.expectedVersion],
    );
    const updated = updatedResult.rows[0] as Row | undefined;
    if (!updated) {
      throw new HttpFail(409, { code: "version_conflict", message: "工单已更新，请刷新后确认。", refresh: `/api/tickets/${ticket.id}` });
    }

    // The row lock above serializes formal transitions. This advisory lock also
    // serializes the append sequence with concurrent native run-trace writers.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [String(ticket.id)]);
    const sequenceResult = await client.query<{ sequence: string | number }>(
      "SELECT COALESCE(MAX(sequence),0) AS sequence FROM task_events WHERE work_item_id=$1",
      [ticket.id],
    );
    const event = {
      id: nid("tev"),
      work_item_id: String(ticket.id),
      run_id: null,
      sequence: Number(sequenceResult.rows[0]?.sequence || 0) + 1,
      event_type: input.action === "complete" ? "task.accepted" : input.action === "accept" ? "task.claimed" : input.action === "reopen" ? "task.reopened" : "task.cancelled",
      event_class: "lifecycle",
      label: input.action === "complete" ? "任务验收完成" : input.action === "accept" ? "工单已受理" : input.action === "reopen" ? "工单已重开" : "任务已取消",
      status: nextStatus,
      safe_summary: input.action === "complete"
        ? "已记录验收证据；运行成功与工单完成分别保留。"
        : input.action === "accept"
          ? "主受理人已明确确认受理；执行与验收仍需单独记录。"
        : input.action === "reopen"
          ? String(input.reason).slice(0, 1000)
        : String(input.reason || "任务在未开始外部执行前已取消").slice(0, 1000),
      time: now,
      created_at: now,
    };
    await client.query(
      `INSERT INTO task_events
       (id,work_item_id,run_id,sequence,event_type,event_class,label,status,safe_summary,time,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        event.id, event.work_item_id, event.run_id, event.sequence, event.event_type, event.event_class,
        event.label, event.status, event.safe_summary, event.time, event.created_at,
      ],
    );

    if (input.action === "complete") {
      const historyVersion = await client.query<{ version: number }>(
        "SELECT COALESCE(MAX(acceptance_version),0)::int + 1 AS version FROM ticket_acceptance_history WHERE ticket_id=$1",
        [ticket.id],
      );
      await client.query(
        `INSERT INTO ticket_acceptance_history
         (id,ticket_id,acceptance_event_id,acceptance_version,accepted_at,owner_user_id_at_acceptance,accepted_by_user_id,evidence_json,rules_version,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'ticket-acceptance.v1',$5)`,
        [nid("tah"), ticket.id, event.id, Number(historyVersion.rows[0]?.version || 1), now, String(ticket.owner_user_id), input.actorId, JSON.stringify(input.acceptanceEvidence)],
      );
      await client.query(
        `INSERT INTO ticket_acceptances
         (ticket_id,acceptance_event_id,accepted_at,owner_user_id_at_acceptance,accepted_by_user_id,evidence_json,rules_version,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,'ticket-acceptance.v1',$3)
         ON CONFLICT (ticket_id) DO UPDATE SET acceptance_event_id=EXCLUDED.acceptance_event_id,accepted_at=EXCLUDED.accepted_at,
           owner_user_id_at_acceptance=EXCLUDED.owner_user_id_at_acceptance,accepted_by_user_id=EXCLUDED.accepted_by_user_id,
           evidence_json=EXCLUDED.evidence_json,rules_version=EXCLUDED.rules_version,created_at=EXCLUDED.created_at`,
        [ticket.id, event.id, now, String(ticket.owner_user_id), input.actorId, JSON.stringify(input.acceptanceEvidence)],
      );
    }
    if (input.action === "reopen") {
      await client.query("DELETE FROM ticket_acceptances WHERE ticket_id=$1", [ticket.id]);
    }

    const response: TicketTransitionReceipt = {
      ticket_id: String(ticket.id),
      action: input.action,
      status: nextStatus,
      version: Number(updated.data_version),
      event_id: event.id,
      replayed: false,
    };
    await client.query(
      `INSERT INTO ticket_audit_events
       (id,ticket_id,actor_user_id,command,request_json,result_json,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        nid("tad"), ticket.id, input.actorId, `ticket.${input.action}`,
        JSON.stringify({ expected_version: input.expectedVersion, reason: input.reason || null, acceptance_evidence: input.action === "complete" ? input.acceptanceEvidence : undefined }),
        JSON.stringify(response as Json), now,
      ],
    );
    await client.query(
      "INSERT INTO ticket_command_receipts (idempotency_key,ticket_id,action,result_json,created_at) VALUES ($1,$2,$3,$4,$5)",
      [input.idempotencyKey, ticket.id, input.action, JSON.stringify(response as Json), now],
    );
    return response;
  }, { isolation: "SERIALIZABLE" });
}
