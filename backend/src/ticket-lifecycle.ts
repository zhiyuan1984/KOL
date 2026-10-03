import { nowIso, tx, type SqliteConn } from "./db.js";
import { HttpFail } from "./host/errors.js";
import { nid } from "./ids.js";
import { postgresTransaction } from "./postgres/pool.js";
import { appendTaskEventInConn } from "./task-events.js";
import type { Json, Row } from "./types.js";

export type TicketLifecycleAction = "accept" | "complete" | "cancel";

export type TicketTransitionInput = {
  ticketId: string;
  action: TicketLifecycleAction;
  expectedVersion: number;
  idempotencyKey: string;
  actorId: string;
  acceptanceEvidence?: unknown;
  reason?: unknown;
};

export type TicketTransitionReceipt = {
  ticket_id: string;
  action: TicketLifecycleAction;
  status: "accepted" | "completed" | "cancelled";
  version: number;
  event_id: string;
  replayed: boolean;
};

function parseReceipt(value: unknown): TicketTransitionReceipt {
  try {
    if (value && typeof value === "object") return value as TicketTransitionReceipt;
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
  if (status === "pending") actions.push("accept");
  if (["accepted", "waiting", "waiting_approval", "in_progress"].includes(status)) actions.push("complete");
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
  const ticket = db.prepare("SELECT id,owner_user_id,status,data_version FROM tickets WHERE id=?").get(input.ticketId) as Row | undefined;
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
  const nextStatus = input.action === "complete" ? "completed" : input.action === "accept" ? "accepted" : "cancelled";
  const changed = db.prepare(
    `UPDATE tickets SET status=?, completed_at=CASE WHEN ?='completed' THEN ? ELSE completed_at END,
     updated_at=?, data_version=data_version+1
     WHERE id=? AND data_version=?`,
  ).run(nextStatus, nextStatus, now, now, ticket.id, input.expectedVersion);
  if (!changed.changes) {
    throw new HttpFail(409, { code: "version_conflict", message: "工单已更新，请刷新后确认。", refresh: `/api/tickets/${ticket.id}` });
  }

  const event = appendTaskEventInConn(
    db,
    String(ticket.id),
    null,
    input.action === "complete" ? "task.accepted" : input.action === "accept" ? "task.claimed" : "task.cancelled",
    input.action === "complete" ? "任务验收完成" : input.action === "accept" ? "工单已受理" : "任务已取消",
    nextStatus,
    input.action === "complete"
      ? "已记录验收证据；运行成功与工单完成分别保留。"
      : input.action === "accept"
        ? "主受理人已明确确认受理；执行与验收仍需单独记录。"
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

/**
 * PostgreSQL-native formal lifecycle transition. It intentionally does not
 * flow through the SQLite-shaped compatibility connection: the ticket row
 * lock, optimistic version, immutable event, acceptance snapshot and command
 * receipt are committed as a single PostgreSQL transaction.
 */
export async function transitionTicketLifecyclePostgres(input: TicketTransitionInput): Promise<TicketTransitionReceipt> {
  validateCommand(input);
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
    const nextStatus = input.action === "complete" ? "completed" : input.action === "accept" ? "accepted" : "cancelled";
    const updatedResult = await client.query<Row>(
      `UPDATE tickets SET status=$1,completed_at=CASE WHEN $1='completed' THEN $2 ELSE completed_at END,
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
      event_type: input.action === "complete" ? "task.accepted" : input.action === "accept" ? "task.claimed" : "task.cancelled",
      event_class: "lifecycle",
      label: input.action === "complete" ? "任务验收完成" : input.action === "accept" ? "工单已受理" : "任务已取消",
      status: nextStatus,
      safe_summary: input.action === "complete"
        ? "已记录验收证据；运行成功与工单完成分别保留。"
        : input.action === "accept"
          ? "主受理人已明确确认受理；执行与验收仍需单独记录。"
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
      await client.query(
        `INSERT INTO ticket_acceptances
         (ticket_id,acceptance_event_id,accepted_at,owner_user_id_at_acceptance,accepted_by_user_id,evidence_json,rules_version,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,'ticket-acceptance.v1',$3)`,
        [ticket.id, event.id, now, String(ticket.owner_user_id), input.actorId, JSON.stringify(input.acceptanceEvidence)],
      );
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
