import { HttpFail } from "../host/errors.js";
import { pgEnqueueExecutionJob, pgExecutionJobPublic } from "../execution-jobs/postgres-store.js";
import { postgresPool } from "../postgres/pool.js";
import type { Json } from "../types.js";

type DecisionRow = { id: string; task_id: string; source_event_id: string | null; outcome: string; status: string };

/**
 * Durable handoff for a bounded Jev decision. The worker—not the HTTP request—
 * invokes the deterministic materializer. Replays reuse the same execution job
 * and its Outbox record, so repeated events cannot create a second action.
 */
export async function enqueueWorkOrderDecisionExecution(
  actorId: string,
  decisionId: string,
): Promise<{ execution_job: Json; created: boolean }> {
  const id = String(decisionId || "").trim();
  if (!id) throw new HttpFail(422, { code: "work_order_decision_id_required" });
  const decision = await postgresPool().query<DecisionRow>(
    "SELECT id,task_id,source_event_id,outcome,status FROM work_order_decisions WHERE id=$1",
    [id],
  );
  const row = decision.rows[0];
  if (!row) throw new HttpFail(404, { code: "work_order_decision_not_found" });
  const stageAdvance = row.outcome === "advance_stage";
  const queued = await pgEnqueueExecutionJob({
    job_type: stageAdvance ? "work_order.advance_stage" : "work_order.materialize",
    tenant_ref: "company:amperetime",
    actor_ref: actorId,
    ticket_id: row.task_id,
    trigger_event_id: row.source_event_id,
    risk_level: stageAdvance ? "medium" : "low",
    priority_class: "normal",
    max_attempts: 3,
    idempotency_key: `work-order-decision:${row.id}:materialize`,
    object_ref: { type: "work_order_decision", id: row.id, task_id: row.task_id },
    scope_snapshot: { decision_mode: "jev_bounded", decision_outcome: row.outcome, decision_status: row.status },
    payload: { decision_id: row.id, task_id: row.task_id, source_event_id: row.source_event_id, requested_by: actorId },
    outbox: {
      event_type: stageAdvance ? "work_order.stage_advance.queued" : "work_order.materialization.queued",
      aggregate_type: "work_order_decision",
      aggregate_id: row.id,
      payload: { decision_id: row.id, task_id: row.task_id },
      idempotency_key: `work-order-decision:${row.id}:${stageAdvance ? "stage-advance" : "materialization"}-queued`,
    },
  });
  return { execution_job: pgExecutionJobPublic(queued.job), created: queued.created };
}
