import { nowIso, tx, type SqliteConn } from "./db.js";
import { HttpFail } from "./host/errors.js";
import { nid } from "./ids.js";
import { appendTaskEventInConn } from "./task-events.js";
import type { Json, Row } from "./types.js";
import { parseTicketLifecycleReceipt, ticketAllowedLifecycleActions, validateTicketLifecycleCommand, type TicketTransitionInput, type TicketTransitionReceipt } from "./ticket-lifecycle-contract.js";

/** Compatibility-only lifecycle implementation. PostgreSQL-only HTTP never imports this module. */
export function transitionTicketLifecycle(input: TicketTransitionInput): TicketTransitionReceipt {
  validateTicketLifecycleCommand(input);
  return tx((db) => transitionTicketLifecycleInConn(db, input));
}

export function transitionTicketLifecycleInConn(db: SqliteConn, input: TicketTransitionInput): TicketTransitionReceipt {
  validateTicketLifecycleCommand(input);
  const ticket = db.prepare("SELECT id,owner_user_id,status,data_version FROM tickets WHERE id=?").get(input.ticketId) as Row | undefined;
  if (!ticket) throw new HttpFail(404, "task not found");

  const replay = db.prepare(
    "SELECT ticket_id,action,result_json FROM ticket_command_receipts WHERE idempotency_key=?",
  ).get(input.idempotencyKey) as Row | undefined;
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

  const now = nowIso();
  const nextStatus = input.action === "complete" ? "completed" : input.action === "accept" ? "accepted" : input.action === "reopen" ? "pending" : "cancelled";
  const changed = db.prepare(
    `UPDATE tickets SET status=?, completed_at=CASE WHEN ?='completed' THEN ? WHEN ?='pending' THEN NULL ELSE completed_at END,
     updated_at=?, data_version=data_version+1
     WHERE id=? AND data_version=?`,
  ).run(nextStatus, nextStatus, now, nextStatus, now, ticket.id, input.expectedVersion);
  if (!changed.changes) {
    throw new HttpFail(409, { code: "version_conflict", message: "工单已更新，请刷新后确认。", refresh: `/api/tickets/${ticket.id}` });
  }

  const event = appendTaskEventInConn(
    db,
    String(ticket.id),
    null,
    input.action === "complete" ? "task.accepted" : input.action === "accept" ? "task.claimed" : input.action === "reopen" ? "task.reopened" : "task.cancelled",
    input.action === "complete" ? "任务验收完成" : input.action === "accept" ? "工单已受理" : input.action === "reopen" ? "工单已重开" : "任务已取消",
    nextStatus,
    input.action === "complete"
      ? "已记录验收证据；运行成功与工单完成分别保留。"
      : input.action === "accept"
        ? "主受理人已明确确认受理；执行与验收仍需单独记录。"
      : input.action === "reopen"
        ? String(input.reason).slice(0, 1000)
      : String(input.reason || "任务在未开始外部执行前已取消").slice(0, 1000),
  );
  if (!event) throw new HttpFail(500, { code: "lifecycle_event_write_failed", message: "未能记录工单生命周期事件。" });

  if (input.action === "complete") {
    // Completion is a human acceptance fact, distinct from an execution run.
    // Keep the evidence, actor and then-owner frozen in this same transaction
    // as the completed ticket and immutable task.accepted event.
    db.prepare(
      `INSERT INTO ticket_acceptances
       (ticket_id,acceptance_event_id,accepted_at,owner_user_id_at_acceptance,accepted_by_user_id,evidence_json,rules_version,created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).run(
      ticket.id,
      event.id,
      now,
      String(ticket.owner_user_id),
      input.actorId,
      JSON.stringify(input.acceptanceEvidence),
      "ticket-acceptance.v1",
      now,
    );
  }
  if (input.action === "reopen") {
    db.prepare("DELETE FROM ticket_acceptances WHERE ticket_id=?").run(ticket.id);
  }

  const response: TicketTransitionReceipt = {
    ticket_id: String(ticket.id),
    action: input.action,
    status: nextStatus,
    version: input.expectedVersion + 1,
    event_id: String(event.id),
    replayed: false,
  };
  db.prepare(
    "INSERT INTO ticket_command_receipts (idempotency_key,ticket_id,action,result_json,created_at) VALUES (?,?,?,?,?)",
  ).run(input.idempotencyKey, ticket.id, input.action, JSON.stringify(response as Json), now);
  return response;
}

