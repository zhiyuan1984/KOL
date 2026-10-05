import type { PoolClient } from "pg";
import { HttpFail } from "../host/errors.js";
import { nid } from "../ids.js";
import { postgresTransaction } from "../postgres/pool.js";
import { workOrderCollaborationGate } from "./collaboration-context.js";
import { judgeCollaborationStage } from "../stage-judgment.js";
import { BY_CODE, FACT_AUTO_MODES, evidencedPointer, normalizeStage } from "../stages.js";
import { isForwardMainStage, mainStageIndex, stagePolicyTarget } from "./work-order-stage-policy.js";

type DecisionRow = {
  id: string; task_id: string; work_order_id: string | null; source_event_id: string | null;
  template_code: string | null; template_version: number | string | null; routing_policy_code: string | null;
  decision_mode: string; outcome: string; status: string; input_json: unknown; judgment_json: unknown; confidence: number | string | null;
};
type TemplateRow = {
  id: string; template_code: string; version: number | string; status: string; automation_level: string;
  trigger_event_types: unknown; stage_policy_json: unknown;
};
type ReleaseRow = { template_id: string; automation_level: string; status: string; minimum_confidence: number | string; routing_policy_code: string | null };
type WorkOrderRow = {
  id: string; task_id: string; template_id: string; template_code: string; template_version: number | string;
  status: string; stage_code: string | null; data_version: number | string; created_at: Date | string;
};
type VerifiedEventRow = {
  id: string; task_id: string; source_system: string; source_event_id: string; source_version: string;
  event_type: string; occurred_at: Date | string; summary: string; evidence_ref: string; evidence_json: unknown; payload_json: unknown;
};
type AttemptRow = { id: string; decision_id: string; work_order_id: string | null; execution_mode: string; status: string; reason_code: string | null; receipt_json: unknown; created_at: Date | string };

type StageExecutionInput = { idempotency_key?: unknown; mode?: unknown };

function required(value: unknown, field: string, max: number): string {
  const result = String(value ?? "").trim();
  if (!result) throw new HttpFail(422, { code: "missing_fields", missing_fields: [field] });
  if (result.length > max) throw new HttpFail(422, { code: "field_too_long", field, max });
  return result;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringList(value: unknown, max = 30): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item ?? "").trim()).filter(Boolean))].slice(0, max);
}

function publicAttempt(row: AttemptRow) {
  return {
    id: row.id, decision_id: row.decision_id, work_order_id: row.work_order_id,
    execution_mode: row.execution_mode, status: row.status, reason_code: row.reason_code,
    receipt: object(row.receipt_json), created_at: new Date(row.created_at).toISOString(),
  };
}

function publicWorkOrder(row: WorkOrderRow) {
  return { id: row.id, status: row.status, stage_code: row.stage_code, data_version: Number(row.data_version), created_at: new Date(row.created_at).toISOString() };
}

async function recordAttempt(
  client: PoolClient,
  input: { decisionId: string; actorId: string; mode: "automatic" | "operator_replay"; status: "created" | "skipped" | "failed"; reason: string | null; workOrderId: string | null; idempotencyKey: string; receipt: Record<string, unknown> },
) {
  const inserted = await client.query<AttemptRow>(
    `INSERT INTO work_order_execution_attempts
     (id,decision_id,work_order_id,actor_ref,execution_mode,status,reason_code,receipt_json,idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [nid("woe"), input.decisionId, input.workOrderId, input.actorId, input.mode, input.status, input.reason, JSON.stringify(input.receipt), input.idempotencyKey],
  );
  if (!inserted.rows[0]) throw new Error("work order stage execution attempt insert failed");
  return publicAttempt(inserted.rows[0]);
}

function snapshotMatches(input: unknown, workOrder: WorkOrderRow): boolean {
  const snapshot = object(object(input).work_order);
  return String(snapshot.id || "") === workOrder.id
    && Number(snapshot.data_version) === Number(workOrder.data_version)
    && (snapshot.stage_code == null ? workOrder.stage_code == null : normalizeStage(String(snapshot.stage_code)) === normalizeStage(String(workOrder.stage_code || "")));
}

function evidenceInput(event: VerifiedEventRow, currentStage: string) {
  const evidence = object(event.evidence_json);
  const payload = object(event.payload_json);
  return {
    subject: typeof evidence.subject === "string" ? evidence.subject : undefined,
    body: [event.summary, typeof evidence.body === "string" ? evidence.body : ""].filter(Boolean).join("\n"),
    attachments: stringList(evidence.attachments),
    links: stringList(evidence.links),
    fulfillment: object(evidence.fulfillment ?? payload.fulfillment),
    current_stage: currentStage,
  };
}

/**
 * A3 is an evidence-backed fact writer, not a generic lifecycle shortcut. A
 * non-adjacent stage is accepted only when (a) the published template names the
 * target, (b) verified evidence proves every intervening main-stage fact, and
 * (c) Jev and deterministic evidence judgment independently select the exact
 * same target. Contract, approval, review, settlement and terminal stages are
 * excluded by the canonical stage graph before any write is attempted.
 */
export async function advanceWorkOrderStageForDecision(
  actorId: string,
  decisionId: string,
  raw: StageExecutionInput,
): Promise<{ attempt: ReturnType<typeof publicAttempt>; work_order: ReturnType<typeof publicWorkOrder> | null; replayed: boolean }> {
  const idempotencyKey = required(raw.idempotency_key, "idempotency_key", 240);
  if (idempotencyKey.length < 8) throw new HttpFail(422, { code: "idempotency_key_invalid" });
  const mode = raw.mode === "operator_replay" ? "operator_replay" as const : "automatic" as const;
  return postgresTransaction(async (client) => {
    const replay = await client.query<AttemptRow>("SELECT * FROM work_order_execution_attempts WHERE idempotency_key=$1 FOR UPDATE", [idempotencyKey]);
    if (replay.rows[0]) {
      if (replay.rows[0].decision_id !== decisionId) throw new HttpFail(409, { code: "idempotency_key_reused" });
      const workOrder = replay.rows[0].work_order_id
        ? await client.query<WorkOrderRow>("SELECT id,task_id,template_id,template_code,template_version,status,stage_code,data_version,created_at FROM work_orders WHERE id=$1", [replay.rows[0].work_order_id])
        : null;
      return { attempt: publicAttempt(replay.rows[0]), work_order: workOrder?.rows[0] ? publicWorkOrder(workOrder.rows[0]) : null, replayed: true };
    }

    const decisionResult = await client.query<DecisionRow>("SELECT * FROM work_order_decisions WHERE id=$1 FOR UPDATE", [decisionId]);
    const decision = decisionResult.rows[0];
    if (!decision) throw new HttpFail(404, { code: "work_order_decision_not_found" });
    const skip = async (reason: string, receipt: Record<string, unknown>, workOrderId: string | null = decision.work_order_id) => ({
      attempt: await recordAttempt(client, { decisionId, actorId, mode, status: "skipped", reason, workOrderId, idempotencyKey, receipt }), work_order: null, replayed: false,
    });

    if (decision.outcome !== "advance_stage") return skip("decision_not_stage_advance", { decision_outcome: decision.outcome, automatic_effect: "none" });
    if (!decision.work_order_id || !decision.template_code || !decision.template_version || !decision.source_event_id) {
      return skip("stage_decision_target_missing", { automatic_effect: "none" });
    }
    const workOrderResult = await client.query<WorkOrderRow>(
      "SELECT id,task_id,template_id,template_code,template_version,status,stage_code,data_version,created_at FROM work_orders WHERE id=$1 FOR UPDATE",
      [decision.work_order_id],
    );
    const workOrder = workOrderResult.rows[0];
    if (!workOrder || workOrder.task_id !== decision.task_id) return skip("stage_target_not_found", { automatic_effect: "none" }, null);
    if (!["assigned", "accepted", "in_progress", "waiting_external", "waiting_approval", "ready_for_acceptance"].includes(workOrder.status)) {
      return skip("stage_target_status_not_open", { status: workOrder.status, automatic_effect: "none" }, workOrder.id);
    }
    if (!snapshotMatches(decision.input_json, workOrder)) return skip("stage_target_version_conflict", { automatic_effect: "none", current_data_version: Number(workOrder.data_version), current_stage_code: workOrder.stage_code }, workOrder.id);
    const collaboration = await workOrderCollaborationGate(client, actorId, workOrder.id);
    if (collaboration.configured) {
      if (!collaboration.allowed) return skip("collaboration_dependencies_blocked", { automatic_effect: "none", blockers: collaboration.blockers }, workOrder.id);
      const expected = object(object(decision.input_json).collaboration_gate);
      if (expected.version !== collaboration.version) return skip("collaboration_dependency_version_conflict", { automatic_effect: "none", current_version: collaboration.version }, workOrder.id);
    }
    if (!workOrder.stage_code) return skip("stage_target_current_stage_missing", { automatic_effect: "none" }, workOrder.id);
    if (workOrder.template_code !== decision.template_code || Number(workOrder.template_version) !== Number(decision.template_version)) {
      return skip("stage_template_mismatch", { automatic_effect: "none" }, workOrder.id);
    }

    const templateResult = await client.query<TemplateRow>("SELECT * FROM work_order_templates WHERE id=$1 FOR UPDATE", [workOrder.template_id]);
    const template = templateResult.rows[0];
    if (!template || template.status !== "published" || template.automation_level !== "A3") return skip("stage_template_not_a3_published", { automatic_effect: "none", template_status: template?.status || null, automation_level: template?.automation_level || null }, workOrder.id);
    const releaseResult = await client.query<ReleaseRow>("SELECT * FROM work_order_automation_releases WHERE template_id=$1 FOR UPDATE", [template.id]);
    const release = releaseResult.rows[0];
    if (!release || release.status !== "enabled" || release.automation_level !== "A3") return skip("stage_automation_release_disabled", { automatic_effect: "none" }, workOrder.id);
    const confidence = Number(decision.confidence || 0);
    if (!Number.isFinite(confidence) || confidence < Number(release.minimum_confidence)) {
      return skip("stage_decision_confidence_below_release_threshold", { confidence, minimum_confidence: Number(release.minimum_confidence), automatic_effect: "none" }, workOrder.id);
    }
    if (release.routing_policy_code && decision.routing_policy_code !== release.routing_policy_code) {
      return skip("stage_decision_routing_policy_not_released", { decision_routing_policy_code: decision.routing_policy_code, released_routing_policy_code: release.routing_policy_code, automatic_effect: "none" }, workOrder.id);
    }

    const judgment = object(decision.judgment_json);
    const targetStage = normalizeStage(String(judgment.stage_action || ""));
    const stage = BY_CODE[targetStage];
    const policy = stagePolicyTarget(template.stage_policy_json, targetStage);
    if (!stage || !policy || !FACT_AUTO_MODES.has(stage.advancementMode) || stage.terminal || !stage.main) {
      return skip("stage_target_not_auto_eligible", { target_stage: targetStage || null, automatic_effect: "none" }, workOrder.id);
    }
    if (!isForwardMainStage(workOrder.stage_code, targetStage)) return skip("stage_target_not_forward", { from_stage: workOrder.stage_code, target_stage: targetStage, automatic_effect: "none" }, workOrder.id);

    const eventResult = await client.query<VerifiedEventRow>("SELECT * FROM work_order_verified_events WHERE id=$1 AND task_id=$2 FOR UPDATE", [decision.source_event_id, decision.task_id]);
    const event = eventResult.rows[0];
    if (!event) return skip("stage_verified_event_not_found", { source_event_id: decision.source_event_id, automatic_effect: "none" }, workOrder.id);
    if (!stringList(template.trigger_event_types).includes(event.event_type)) {
      return skip("stage_event_not_template_trigger", { event_type: event.event_type, automatic_effect: "none" }, workOrder.id);
    }
    if (!policy.required_event_types.includes(event.event_type)) return skip("stage_event_type_not_allowed", { event_type: event.event_type, target_stage: targetStage, automatic_effect: "none" }, workOrder.id);

    const evidence = object(event.evidence_json);
    const missingEvidenceKeys = policy.required_evidence_keys.filter((key) => !evidence[key]);
    if (missingEvidenceKeys.length) return skip("stage_evidence_keys_missing", { missing_evidence_keys: missingEvidenceKeys, automatic_effect: "none" }, workOrder.id);
    const completedStages = stringList(evidence.completed_stages).map((code) => normalizeStage(code));
    const currentIndex = mainStageIndex(workOrder.stage_code);
    const targetIndex = mainStageIndex(targetStage);
    if (targetIndex > currentIndex + 1 && !policy.allow_cross_stage) {
      return skip("stage_cross_stage_not_released", { from_stage: workOrder.stage_code, target_stage: targetStage, automatic_effect: "none" }, workOrder.id);
    }
    const evidencePointer = evidencedPointer(workOrder.stage_code, completedStages);
    if (evidencePointer.pointer !== targetStage) {
      return skip("stage_intermediate_evidence_incomplete", { from_stage: workOrder.stage_code, target_stage: targetStage, evidenced_pointer: evidencePointer.pointer, completed_stages: completedStages, automatic_effect: "none" }, workOrder.id);
    }
    const deterministic = judgeCollaborationStage(evidenceInput(event, workOrder.stage_code));
    if (deterministic.suggested_stage !== targetStage || deterministic.evidence_confidence !== "high") {
      return skip("stage_evidence_judgment_mismatch", { target_stage: targetStage, suggested_stage: deterministic.suggested_stage, evidence_confidence: deterministic.evidence_confidence, flags: deterministic.flags, automatic_effect: "none" }, workOrder.id);
    }

    const taskResult = await client.query<{ id: string; status: string; task_type: string; profile: string }>("SELECT id,status,task_type,profile FROM tickets WHERE id=$1 FOR UPDATE", [decision.task_id]);
    const task = taskResult.rows[0];
    if (!task || task.task_type !== "business_task" || task.profile !== "task-root" || !["open", "in_progress", "waiting", "blocked", "ready_for_review"].includes(task.status)) {
      return skip("stage_parent_task_not_active", { task_status: task?.status || null, automatic_effect: "none" }, workOrder.id);
    }

    const now = new Date();
    await client.query("SELECT set_config('app.actor_id',$1,true)", [actorId]);
    const advanced = await client.query<WorkOrderRow>(
      `UPDATE work_orders
          SET stage_code=$1,latest_decision_id=$2,data_version=data_version+1,updated_at=$3
        WHERE id=$4
        RETURNING id,task_id,template_id,template_code,template_version,status,stage_code,data_version,created_at`,
      [targetStage, decisionId, now, workOrder.id],
    );
    const updated = advanced.rows[0]!;
    const sequenceResult = await client.query<{ sequence: number | null }>("SELECT MAX(sequence) AS sequence FROM work_order_stage_events WHERE work_order_id=$1", [workOrder.id]);
    const sequence = Number(sequenceResult.rows[0]?.sequence || 0) + 1;
    const stageEvidence = {
      event_id: event.id, event_type: event.event_type, evidence_ref: event.evidence_ref, completed_stages: evidencePointer.completed,
      deterministic_stage_judgment: deterministic, policy: { target_stage: targetStage, required_event_types: policy.required_event_types, required_evidence_keys: policy.required_evidence_keys, allow_cross_stage: policy.allow_cross_stage },
      decision_confidence: confidence, release_minimum_confidence: Number(release.minimum_confidence),
    };
    await client.query(
      `INSERT INTO work_order_stage_events
       (id,work_order_id,sequence,from_status,to_status,from_stage_code,to_stage_code,actor_ref,decision_id,evidence_json,reason,created_at)
       VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,'a3_verified_evidence_stage_advance',$10)`,
      [nid("wose"), workOrder.id, sequence, workOrder.status, workOrder.stage_code, targetStage, actorId, decisionId, JSON.stringify(stageEvidence), now],
    );
    await client.query(
      `INSERT INTO work_order_basis_refs (id,work_order_id,source_type,source_id,source_version,source_hash,occurred_at,summary_json,created_at)
       VALUES ($1,$2,'verified_business_event',$3,$4,$5,$6,$7,$8)
       ON CONFLICT (work_order_id,source_type,source_id,source_version) DO NOTHING`,
      [nid("wob"), workOrder.id, event.id, event.source_version, decisionId, event.occurred_at, JSON.stringify({ event_type: event.event_type, summary: event.summary, evidence_ref: event.evidence_ref }), now],
    );
    await client.query(
      `INSERT INTO work_order_outbox (id,work_order_id,decision_id,event_type,payload_json,idempotency_key,status,created_at)
       VALUES ($1,$2,$3,'work_order.stage_advanced',$4,$5,'pending',$6)`,
      [nid("woo"), workOrder.id, decisionId, JSON.stringify({ work_order_id: workOrder.id, task_id: decision.task_id, from_stage_code: workOrder.stage_code, to_stage_code: targetStage, source_event_id: event.id }), `work-order:${decisionId}:stage:${targetStage}`, now],
    );
    const publicOrder = publicWorkOrder(updated);
    const attempt = await recordAttempt(client, {
      decisionId, actorId, mode, status: "created", reason: null, workOrderId: workOrder.id, idempotencyKey,
      receipt: { automatic_effect: "work_order_stage_advanced", work_order: publicOrder, outbox_event: "work_order.stage_advanced", task_completion_written: false },
    });
    return { attempt, work_order: publicOrder, replayed: false };
  }, { isolation: "SERIALIZABLE" });
}
