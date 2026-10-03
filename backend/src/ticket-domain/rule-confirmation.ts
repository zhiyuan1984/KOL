import { HttpFail } from "../host/errors.js";
import { postgresTransaction } from "../postgres/pool.js";
import type { Json } from "../types.js";

type Decision = "confirmed" | "dismissed";

type DecisionRow = {
  id: string;
  evaluation_id: string;
  decision: Decision;
  reason: string;
  decided_by: string;
  decided_at: string;
};

function required(value: unknown, field: string, max: number): string {
  const text = String(value || "").trim();
  if (!text) throw new HttpFail(422, { code: "rule_confirmation_field_required", field });
  if (text.length > max) throw new HttpFail(422, { code: "rule_confirmation_field_too_long", field, max });
  return text;
}

function publicDecision(row: DecisionRow): Json {
  return {
    id: row.id,
    evaluation_id: row.evaluation_id,
    decision: row.decision,
    reason: row.reason,
    decided_by: row.decided_by,
    decided_at: row.decided_at,
    execution_effect: "none",
    automatic_action: "disabled",
  };
}

/**
 * Records an irreversible review decision for one matched suggestion. It does
 * not call an assignment, escalation, creation, lifecycle, Worker or Outbox
 * path; a separately governed executor would be required before any action.
 */
export async function confirmTicketRuleEvaluation(
  actorId: string,
  evaluationId: string,
  input: Record<string, unknown>,
): Promise<Json> {
  const id = required(evaluationId, "evaluation_id", 100);
  const decision = String(input.decision || "") as Decision;
  if (decision !== "confirmed" && decision !== "dismissed") {
    throw new HttpFail(422, { code: "rule_confirmation_decision_invalid" });
  }
  const reason = required(input.reason, "reason", 1_000);
  const idempotencyKey = required(input.idempotency_key, "idempotency_key", 240);
  if (idempotencyKey.length < 8) throw new HttpFail(422, { code: "idempotency_key_invalid" });

  return postgresTransaction(async (client) => {
    const replay = await client.query<DecisionRow>(
      "SELECT id,evaluation_id,decision,reason,decided_by,decided_at FROM ticket_rule_confirmation_decisions WHERE idempotency_key=$1 FOR UPDATE",
      [idempotencyKey],
    );
    if (replay.rows[0]) {
      if (replay.rows[0].evaluation_id !== id) throw new HttpFail(409, { code: "idempotency_key_reused" });
      return { confirmation: publicDecision(replay.rows[0]), replayed: true };
    }
    const evaluation = await client.query<{ id: string; outcome: string }>(
      "SELECT id,outcome FROM ticket_rule_evaluations WHERE id=$1 FOR UPDATE",
      [id],
    );
    if (!evaluation.rows[0]) throw new HttpFail(404, { code: "rule_evaluation_not_found" });
    if (evaluation.rows[0].outcome !== "matched") {
      throw new HttpFail(409, { code: "rule_evaluation_not_confirmable", outcome: evaluation.rows[0].outcome });
    }
    const existing = await client.query<{ id: string; decision: Decision }>(
      "SELECT id,decision FROM ticket_rule_confirmation_decisions WHERE evaluation_id=$1 FOR UPDATE",
      [id],
    );
    if (existing.rows[0]) {
      throw new HttpFail(409, { code: "rule_evaluation_already_decided", decision_id: existing.rows[0].id, decision: existing.rows[0].decision });
    }
    const inserted = await client.query<DecisionRow>(
      `INSERT INTO ticket_rule_confirmation_decisions (evaluation_id,decision,reason,decided_by,idempotency_key)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id,evaluation_id,decision,reason,decided_by,decided_at`,
      [id, decision, reason, actorId, idempotencyKey],
    );
    if (!inserted.rows[0]) throw new Error("rule confirmation insert failed");
    return { confirmation: publicDecision(inserted.rows[0]), replayed: false };
  }, { isolation: "SERIALIZABLE" });
}
