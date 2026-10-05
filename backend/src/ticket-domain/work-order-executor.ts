import type { PoolClient } from "pg";
import { HttpFail } from "../host/errors.js";
import { nid } from "../ids.js";
import { postgresTransaction } from "../postgres/pool.js";
import { workOrderAdoptionBasis, validateWorkOrderAdoption, type WorkOrderAdoptionInput } from "./work-order-adoption.js";

type DecisionRow = {
  id: string; task_id: string; source_event_id: string | null; template_code: string | null; template_version: number | string | null;
  routing_policy_code: string | null; decision_mode: string; outcome: string; input_json: unknown; confidence: number | string | null;
};
type TemplateRow = {
  id: string; template_code: string; version: number | string; title: string; description: string; status: string; automation_level: "A0" | "A1" | "A2" | "A3" | "L3";
  routing_policy_code: string | null; acceptance_criteria_json: unknown;
};
type ReleaseRow = { template_id: string; automation_level: "A1" | "A2"; status: string; minimum_confidence: number | string; routing_policy_code: string | null };
type TaskRow = { id: string; owner_user_id: string; title: string; content: string; due_at: string | null; status: string; task_type: string; profile: string };
type WorkOrderRow = { id: string; status: string; data_version: number | string; created_at: Date | string };
type AttemptRow = { id: string; decision_id: string; actor_ref: string; work_order_id: string | null; execution_mode: string; status: string; reason_code: string | null; receipt_json: unknown; created_at: Date | string };

export type WorkOrderExecutionInput = { idempotency_key?: unknown; mode?: unknown };

function required(value: unknown, field: string, max: number): string {
  const result = String(value ?? "").trim();
  if (!result) throw new HttpFail(422, { code: "missing_fields", missing_fields: [field] });
  if (result.length > max) throw new HttpFail(422, { code: "field_too_long", field, max });
  return result;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function publicAttempt(row: AttemptRow) {
  return {
    id: row.id,
    decision_id: row.decision_id,
    work_order_id: row.work_order_id,
    execution_mode: row.execution_mode,
    status: row.status,
    reason_code: row.reason_code,
    receipt: object(row.receipt_json),
    created_at: new Date(row.created_at).toISOString(),
  };
}

async function recordAttempt(
  client: PoolClient,
  input: { decisionId: string; actorId: string; mode: "automatic" | "operator_replay" | "human_adoption"; status: "created" | "merged" | "skipped" | "failed"; reason: string | null; workOrderId?: string | null; idempotencyKey: string; receipt: Record<string, unknown> },
) {
  const inserted = await client.query<AttemptRow>(
    `INSERT INTO work_order_execution_attempts
     (id,decision_id,work_order_id,actor_ref,execution_mode,status,reason_code,receipt_json,idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [nid("woe"), input.decisionId, input.workOrderId || null, input.actorId, input.mode, input.status, input.reason, JSON.stringify(input.receipt), input.idempotencyKey],
  );
  if (!inserted.rows[0]) throw new Error("work order execution attempt insert failed");
  return publicAttempt(inserted.rows[0]);
}

/**
 * Converts one immutable decision into a work order only after independent
 * template-release, confidence and routing checks. It never transitions or
 * completes the parent Task; it writes a durable work-order outbox event in the
 * same transaction for later non-domain notification handling.
 */
export async function executeWorkOrderDecision(
  actorId: string,
  decisionId: string,
  raw: WorkOrderExecutionInput,
  adoption?: WorkOrderAdoptionInput,
): Promise<{ attempt: ReturnType<typeof publicAttempt>; work_order: { id: string; status: string; data_version: number; created_at: string } | null; replayed: boolean }> {
  const idempotencyKey = required(raw.idempotency_key, "idempotency_key", 240);
  if (idempotencyKey.length < 8) throw new HttpFail(422, { code: "idempotency_key_invalid" });
  const mode = adoption ? "human_adoption" as const : raw.mode === "operator_replay" ? "operator_replay" as const : "automatic" as const;
  return postgresTransaction(async (client) => {
    // Serialize parent-task materialization and merges, including decisions
    // for the same verified event/template with different idempotency keys.
    // READ COMMITTED below gives a waiter the winner's committed receipt.
    const metadata = (await client.query<DecisionRow>("SELECT * FROM work_order_decisions WHERE id=$1", [decisionId])).rows[0];
    if (!metadata) throw new HttpFail(404, { code: "work_order_decision_not_found" });
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`work-order-materialization:${metadata.task_id}`]);
    const basis = adoption ? await workOrderAdoptionBasis(client, actorId, decisionId) : null;
    const replay = await client.query<AttemptRow>("SELECT * FROM work_order_execution_attempts WHERE idempotency_key=$1 FOR UPDATE", [idempotencyKey]);
    if (replay.rows[0]) {
      if (replay.rows[0].decision_id !== decisionId) throw new HttpFail(409, { code: "idempotency_key_reused" });
      if (adoption) {
        const receipt = object(replay.rows[0].receipt_json);
        if (replay.rows[0].actor_ref !== actorId || replay.rows[0].execution_mode !== mode || adoption.confirmed !== true
          || receipt.confirmed_basis_version !== adoption.basis_version || receipt.confirmed_action !== adoption.action
          || (receipt.confirmed_target_id || null) !== (adoption.target_id || null)) throw new HttpFail(409, { code: "idempotency_key_reused" });
      }
      const workOrder = replay.rows[0].work_order_id
        ? await client.query<WorkOrderRow>("SELECT id,status,data_version,created_at FROM work_orders WHERE id=$1", [replay.rows[0].work_order_id])
        : null;
      return {
        attempt: publicAttempt(replay.rows[0]),
        work_order: workOrder?.rows[0] ? { id: workOrder.rows[0].id, status: workOrder.rows[0].status, data_version: Number(workOrder.rows[0].data_version), created_at: new Date(workOrder.rows[0].created_at).toISOString() } : null,
        replayed: true,
      };
    }
    const decision = await client.query<DecisionRow>("SELECT * FROM work_order_decisions WHERE id=$1 FOR UPDATE", [decisionId]);
    if (!decision.rows[0]) throw new HttpFail(404, { code: "work_order_decision_not_found" });
    const value = decision.rows[0];
    const skip = async (reason: string, receipt: Record<string, unknown>) => ({
      attempt: await recordAttempt(client, { decisionId, actorId, mode, status: "skipped", reason, idempotencyKey, receipt }), work_order: null, replayed: false,
    });
    if (basis && adoption) validateWorkOrderAdoption(adoption, basis);
    if (value.outcome !== "create" && !(adoption?.action === "merge" && value.outcome === "merge_open_order")) return skip("decision_not_create", { decision_outcome: value.outcome, automatic_effect: "none" });
    if (!value.template_code || !value.template_version) return skip("decision_template_missing", { automatic_effect: "none" });
    const templateResult = await client.query<TemplateRow>(
      "SELECT * FROM work_order_templates WHERE template_code=$1 AND version=$2 FOR UPDATE",
      [value.template_code, Number(value.template_version)],
    );
    const template = templateResult.rows[0];
    if (!template || template.status !== "published") return skip("template_not_published", { template_code: value.template_code, automatic_effect: "none" });
    if (template.automation_level !== "A1" && template.automation_level !== "A2") return skip("automation_level_not_executable", { automation_level: template.automation_level, automatic_effect: "none" });
    const releaseResult = await client.query<ReleaseRow>("SELECT * FROM work_order_automation_releases WHERE template_id=$1 FOR UPDATE", [template.id]);
    const release = releaseResult.rows[0];
    if (!release || release.status !== "enabled" || release.automation_level !== template.automation_level) {
      return skip("automation_release_disabled", { template_id: template.id, automatic_effect: "none" });
    }
    const confidence = Number(value.confidence || 0);
    if (!Number.isFinite(confidence) || confidence < Number(release.minimum_confidence)) {
      return skip("decision_confidence_below_release_threshold", { confidence, minimum_confidence: Number(release.minimum_confidence), automatic_effect: "none" });
    }
    const previous = await client.query<WorkOrderRow>(`SELECT wo.id,wo.status,wo.data_version,wo.created_at FROM work_orders wo
      WHERE wo.decision_id=$1 OR EXISTS (SELECT 1 FROM work_order_execution_attempts attempt JOIN work_order_decisions d ON d.id=attempt.decision_id
        WHERE attempt.work_order_id=wo.id AND attempt.status IN ('created','merged') AND d.task_id=$2
          AND d.source_event_id=$3 AND d.template_code=$4 AND d.template_version=$5)
      ORDER BY wo.created_at LIMIT 1 FOR UPDATE OF wo`, [decisionId, value.task_id, value.source_event_id, value.template_code, value.template_version]);
    if (previous.rows[0]) {
      return {
        attempt: await recordAttempt(client, { decisionId, actorId, mode, status: "skipped", reason: "decision_already_materialized", workOrderId: previous.rows[0].id, idempotencyKey, receipt: { automatic_effect: "none", existing_work_order_id: previous.rows[0].id } }),
        work_order: { id: previous.rows[0].id, status: previous.rows[0].status, data_version: Number(previous.rows[0].data_version), created_at: new Date(previous.rows[0].created_at).toISOString() }, replayed: false,
      };
    }
    const taskResult = await client.query<TaskRow>(
      "SELECT id,owner_user_id,title,content,due_at,status,task_type,profile FROM tickets WHERE id=$1 FOR UPDATE",
      [value.task_id],
    );
    const task = taskResult.rows[0];
    if (!task || task.task_type !== "business_task" || task.profile !== "task-root") return skip("task_not_active_root", { automatic_effect: "none" });
    if (!["open", "in_progress", "waiting", "blocked", "ready_for_review"].includes(task.status)) return skip("task_status_not_executable", { task_status: task.status, automatic_effect: "none" });
    if (release.routing_policy_code && value.routing_policy_code !== release.routing_policy_code) {
      return skip("decision_routing_policy_not_released", { decision_routing_policy_code: value.routing_policy_code, released_routing_policy_code: release.routing_policy_code, automatic_effect: "none" });
    }
    if (template.automation_level === "A2" && (value.routing_policy_code !== "task_owner" || release.routing_policy_code !== "task_owner")) {
      return skip("routing_policy_not_supported", { routing_policy_code: value.routing_policy_code, supported: ["task_owner"], automatic_effect: "none" });
    }
    const owner = await client.query<{ id: string; active: boolean; person_ref: string | null; org_unit_id: string | null }>(
      `SELECT a.id,a.active,p.person_ref,m.org_unit_id
         FROM ticket_accounts a
         LEFT JOIN organization_people p ON p.user_id=a.id AND p.status='active'
         LEFT JOIN organization_memberships m ON m.person_ref=p.person_ref AND m.status='active' AND m.relation='primary'
        WHERE a.id=$1 FOR UPDATE OF a`,
      [task.owner_user_id],
    );
    if (template.automation_level === "A2" && (!owner.rows[0] || !owner.rows[0].active)) return skip("routing_target_inactive", { routing_policy_code: "task_owner", automatic_effect: "none" });
    const now = new Date();
    const input = object(value.input_json);
    const source = adoption && basis?.source_event ? { ...basis.source_event, type: "verified_business_event" } : object(input.source_event);
    const confirmation = adoption ? { confirmed_basis_version: adoption.basis_version, confirmed_action: adoption.action, confirmed_target_id: adoption.target_id || null } : {};
    await client.query("SELECT set_config('app.actor_id',$1,true)", [actorId]);
    if (adoption?.action === "merge") {
      const target = await client.query<WorkOrderRow>(`UPDATE work_orders SET data_version=data_version+1,updated_at=$2,latest_decision_id=$3
        WHERE id=$1 RETURNING id,status,data_version,created_at`, [adoption.target_id, now, decisionId]);
      const merged = target.rows[0]!;
      await client.query(`INSERT INTO work_order_basis_refs(id,work_order_id,source_type,source_id,source_version,source_hash,occurred_at,summary_json,created_at)
        VALUES ($1,$2,'verified_business_event',$3,$4,$5,$6,$7,$8)`, [nid("wob"), merged.id, value.source_event_id,
        basis!.source_event!.source_version, decisionId, source.occurred_at || null, JSON.stringify({ summary: basis!.source_event!.summary, adopted_by: actorId }), now]);
      await client.query(`INSERT INTO work_order_outbox(id,work_order_id,decision_id,event_type,payload_json,idempotency_key,status,created_at)
        VALUES ($1,$2,$3,'work_order.evidence_merged',$4,$5,'pending',$6)`, [nid("woo"), merged.id, decisionId,
        JSON.stringify({ work_order_id: merged.id, task_id: task.id, source_event_id: value.source_event_id }), `work-order:${decisionId}:evidence-merged`, now]);
      const order = { id: merged.id, status: merged.status, data_version: Number(merged.data_version), created_at: new Date(merged.created_at).toISOString() };
      const attempt = await recordAttempt(client, { decisionId, actorId, mode, status: "merged", workOrderId: merged.id, idempotencyKey,
        reason: null, receipt: { ...confirmation, automatic_effect: "none", effect: "evidence_merged", work_order: order, assignment_created: false, outbox_event: "work_order.evidence_merged" } });
      return { attempt, work_order: order, replayed: false };
    }
    const workOrderId = nid("wo");
    const workOrderStatus = template.automation_level === "A2" ? "assigned" : "proposed";
    const workOrder = await client.query<WorkOrderRow>(
      `INSERT INTO work_orders
       (id,task_id,template_id,template_code,template_version,status,priority,title,objective,due_at,no_due_reason,automation_level,automation_ref,payload_json,decision_id,latest_decision_id,created_by,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,'normal',$7,$8,$9,$10,$11,$12,$13,$14,$14,$15,$16,$16)
       RETURNING id,status,data_version,created_at`,
      [
        workOrderId, task.id, template.id, template.template_code, Number(template.version), workOrderStatus,
        `${template.title} · ${task.title}`.slice(0, 200), template.description, task.due_at ? new Date(task.due_at).toISOString() : null,
        task.due_at ? null : "inherit_task_has_no_due_at", template.automation_level,
        JSON.stringify({ decision_id: decisionId, decision_mode: value.decision_mode, release_level: release.automation_level }),
        JSON.stringify({ task_id: task.id, source_event: source, acceptance_criteria: Array.isArray(template.acceptance_criteria_json) ? template.acceptance_criteria_json : [] }),
        decisionId, actorId, now,
      ],
    );
    const created = workOrder.rows[0]!;
    const sourceId = String(source.id || value.source_event_id || "decision");
    await client.query(
      `INSERT INTO work_order_basis_refs (id,work_order_id,source_type,source_id,source_version,source_hash,occurred_at,summary_json,created_at)
       VALUES ($1,$2,'verified_business_event',$3,$4,$5,$6,$7,$8)`,
      [nid("wob"), workOrderId, sourceId, basis?.source_event?.source_version || null, decisionId, source.occurred_at || null, JSON.stringify({ type: source.type || null, summary: source.summary || null }), now],
    );
    if (template.automation_level === "A2") {
      const target = owner.rows[0]!;
      await client.query(
        `INSERT INTO work_order_assignments
         (id,work_order_id,principal_id,person_ref,org_unit_id,role,status,routing_policy_code,routing_trace_json,assigned_by,effective_from,created_at)
         VALUES ($1,$2,$3,$4,$5,'primary','active','task_owner',$6,$7,$8,$8)`,
        [nid("woa"), workOrderId, target.id, target.person_ref, target.org_unit_id, JSON.stringify({ resolver: "task_owner", task_owner_id: target.id, unique: true }), actorId, now],
      );
    }
    await client.query(
      `INSERT INTO work_order_stage_events
       (id,work_order_id,sequence,from_status,to_status,actor_ref,decision_id,evidence_json,reason,created_at)
       VALUES ($1,$2,1,NULL,$3,$4,$5,$6,'deterministic_template_materialization',$7)`,
      [nid("wose"), workOrderId, workOrderStatus, actorId, decisionId, JSON.stringify({ template_id: template.id, release_level: release.automation_level }), now],
    );
    await client.query(
      `INSERT INTO work_order_outbox (id,work_order_id,decision_id,event_type,payload_json,idempotency_key,status,created_at)
       VALUES ($1,$2,$3,'work_order.materialized',$4,$5,'pending',$6)`,
      [nid("woo"), workOrderId, decisionId, JSON.stringify({ work_order_id: workOrderId, task_id: task.id, template_code: template.template_code, automation_level: template.automation_level }), `work-order:${decisionId}:materialized`, now],
    );
    const publicOrder = { id: created.id, status: created.status, data_version: Number(created.data_version), created_at: new Date(created.created_at).toISOString() };
    const attempt = await recordAttempt(client, {
      decisionId, actorId, mode, status: "created", workOrderId, idempotencyKey,
      reason: null, receipt: { ...confirmation, automatic_effect: adoption ? "none" : "work_order_created", effect: "work_order_created", work_order: publicOrder, assignment_created: template.automation_level === "A2", outbox_event: "work_order.materialized" },
    });
    return { attempt, work_order: publicOrder, replayed: false };
  }, { isolation: "READ COMMITTED" }).catch((error: unknown) => {
    const failure = error as { code?: string; constraint?: string };
    if (failure.code === "23505" && failure.constraint === "work_order_execution_attempts_idempotency_key_key") {
      throw new HttpFail(409, { code: "idempotency_key_reused" });
    }
    throw error;
  });
}
