import { nowIso, tx, type SqliteConn } from "./db.js";
import { HttpFail } from "./host/errors.js";
import { appendTaskEventInConn } from "./task-events.js";
import type { Json, Row } from "./types.js";

export type TicketLifecycleAction = "complete" | "cancel";

export type TicketTransitionInput = {
  ticketId: string;
  action: TicketLifecycleAction;
  expectedVersion: number;
  idempotencyKey: string;
  acceptanceEvidence?: unknown;
  reason?: unknown;
};

export type TicketTransitionReceipt = {
  ticket_id: string;
  action: TicketLifecycleAction;
  status: "completed" | "cancelled";
  version: number;
  event_id: string;
  replayed: boolean;
};

function parseReceipt(value: unknown): TicketTransitionReceipt {
  try {
    return JSON.parse(String(value || "{}")) as TicketTransitionReceipt;
  } catch {
    throw new HttpFail(500, { code: "ticket_command_receipt_corrupt", message: "工单命令回执已损坏，请联系管理员。" });
  }
}

export function ticketAllowedLifecycleActions(row: Row): TicketLifecycleAction[] {
  const status = String(row.status || "");
  if (["completed", "failed", "cancelled"].includes(status)) return [];
  const actions: TicketLifecycleAction[] = [];
  if (["pending", "queued", "waiting", "needs_clarification"].includes(status)) actions.push("cancel");
  if (["waiting", "waiting_approval", "in_progress"].includes(status)) actions.push("complete");
  return actions;
}

function validateCommand(input: TicketTransitionInput): void {
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new HttpFail(400, "expected_version is required");
  }
  if (input.idempotencyKey.length < 8 || input.idempotencyKey.length > 200) {
    throw new HttpFail(400, "Idempotency-Key is required");
  }
  if (
    input.action === "complete"
    && (!input.acceptanceEvidence || typeof input.acceptanceEvidence !== "object" || Array.isArray(input.acceptanceEvidence))
  ) {
    throw new HttpFail(422, { code: "acceptance_evidence_required", missing_fields: ["acceptance_evidence"] });
  }
}

/**
 * The only formal completion/cancellation transition. The caller is
 * responsible for authorization/scope checks before entering this service;
 * this service owns version checks, idempotency, ticket projection, immutable
 * lifecycle event and command receipt in one database transaction.
 */
export function transitionTicketLifecycle(input: TicketTransitionInput): TicketTransitionReceipt {
  validateCommand(input);
  return tx((db) => transitionTicketLifecycleInConn(db, input));
}

export function transitionTicketLifecycleInConn(db: SqliteConn, input: TicketTransitionInput): TicketTransitionReceipt {
  validateCommand(input);
  const ticket = db.prepare("SELECT id,status,data_version FROM tickets WHERE id=?").get(input.ticketId) as Row | undefined;
  if (!ticket) throw new HttpFail(404, "task not found");

  const replay = db.prepare(
    "SELECT ticket_id,action,result_json FROM ticket_command_receipts WHERE idempotency_key=?",
  ).get(input.idempotencyKey) as Row | undefined;
  if (replay) {
    if (String(replay.ticket_id) !== input.ticketId || String(replay.action) !== input.action) {
      throw new HttpFail(409, { code: "idempotency_key_reused", message: "幂等键已用于另一条工单命令" });
    }
    return { ...parseReceipt(replay.result_json), replayed: true };
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
  const nextStatus = input.action === "complete" ? "completed" : "cancelled";
  const changed = db.prepare(
    `UPDATE tickets SET status=?, completed_at=?, updated_at=?, data_version=data_version+1
     WHERE id=? AND data_version=?`,
  ).run(nextStatus, now, now, ticket.id, input.expectedVersion);
  if (!changed.changes) {
    throw new HttpFail(409, { code: "version_conflict", message: "工单已更新，请刷新后确认。", refresh: `/api/tickets/${ticket.id}` });
  }

  const event = appendTaskEventInConn(
    db,
    String(ticket.id),
    null,
    input.action === "complete" ? "task.accepted" : "task.cancelled",
    input.action === "complete" ? "任务验收完成" : "任务已取消",
    nextStatus,
    input.action === "complete"
      ? "已记录验收证据；运行成功与工单完成分别保留。"
      : String(input.reason || "任务在未开始外部执行前已取消").slice(0, 1000),
  );
  if (!event) throw new HttpFail(500, { code: "lifecycle_event_write_failed", message: "未能记录工单生命周期事件。" });

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
