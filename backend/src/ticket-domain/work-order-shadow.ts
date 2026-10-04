import { HttpFail } from "../host/errors.js";
import { postgresPool, postgresTransaction } from "../postgres/pool.js";
import { taskWorkOrderAggregate, workOrderDecisionInputHash } from "./task-work-orders.js";
import { JevWorkOrderUnavailable, judgeWorkOrderWithJev, type JevWorkOrderTemplateChoice, type JevWorkOrderVerdict } from "./work-order-jev.js";

type SourceEvent = { id: string; type: string; summary: string; occurred_at: string | null };
type TemplateRow = {
  id: string; template_code: string; version: number | string; title: string; description: string; automation_level: JevWorkOrderTemplateChoice["automation_level"];
  routing_policy_code: string | null; stage_policy_json: unknown;
};
type DecisionRow = {
  id: string; task_id: string; template_code: string | null; template_version: number | null; routing_policy_code: string | null;
  decision_mode: string; outcome: string; status: string; input_hash: string; input_json: unknown; judgment_json: unknown;
  gate_results_json: unknown; jev_model: string | null; prompt_version: string | null; confidence: number | string | null; reason: string | null;
  actor_ref: string; created_at: Date | string;
};

export type WorkOrderShadowInput = {
  source_event?: unknown;
  idempotency_key?: unknown;
};

function required(value: unknown, field: string, max: number): string {
  const result = String(value ?? "").trim();
  if (!result) throw new HttpFail(422, { code: "missing_fields", missing_fields: [field] });
  if (result.length > max) throw new HttpFail(422, { code: "field_too_long", field, max });
  return result;
}

function sourceEvent(value: unknown): SourceEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpFail(422, { code: "source_event_invalid" });
  const source = value as Record<string, unknown>;
  const occurred = source.occurred_at == null || String(source.occurred_at).trim() === "" ? null : new Date(String(source.occurred_at));
  if (occurred && Number.isNaN(occurred.getTime())) throw new HttpFail(422, { code: "source_event_occurred_at_invalid" });
  return {
    id: required(source.id, "source_event.id", 160),
    type: required(source.type, "source_event.type", 120),
    summary: required(source.summary, "source_event.summary", 800),
    occurred_at: occurred?.toISOString() || null,
  };
}

function stageCodes(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const raw = (value as Record<string, unknown>).allowed_next_stages;
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((item) => String(item || "").trim()).filter(Boolean))].slice(0, 12);
}

function publicDecision(row: DecisionRow, replayed: boolean) {
  return {
    id: row.id,
    task_id: row.task_id,
    template_code: row.template_code,
    template_version: row.template_version == null ? null : Number(row.template_version),
    routing_policy_code: row.routing_policy_code,
    decision_mode: row.decision_mode,
    outcome: row.outcome,
    status: row.status,
    input_hash: row.input_hash,
    judgment: row.judgment_json,
    gates: row.gate_results_json,
    model: row.jev_model,
    prompt_version: row.prompt_version,
    confidence: row.confidence == null ? null : Number(row.confidence),
    reason: row.reason,
    actor_ref: row.actor_ref,
    created_at: new Date(row.created_at).toISOString(),
    replayed,
    execution_effect: "decision_only",
    automatic_action: "requires_durable_queue_handoff",
  };
}

function disabledVerdict(reason: string): JevWorkOrderVerdict {
  return {
    template_code: null, template_version: null, action: "needs_review", routing_policy_code: null, stage_action: null,
    confidence: 0, probabilities: {}, model: "jev-disabled", prompt_version: "work-order-jev.v1", reason,
  };
}

/**
 * Evaluates an already-authorized task against only published templates and
 * writes an immutable `shadow` decision. This function deliberately has no
 * import of work-order creation, assignment, lifecycle, queue or stage writer.
 */
export async function recordWorkOrderShadowDecision(
  actorId: string,
  taskId: string,
  raw: WorkOrderShadowInput,
  options: { isAdmin?: boolean } = {},
) {
  const event = sourceEvent(raw.source_event);
  const idempotencyKey = required(raw.idempotency_key, "idempotency_key", 240);
  if (idempotencyKey.length < 8) throw new HttpFail(422, { code: "idempotency_key_invalid" });
  const task = await taskWorkOrderAggregate(actorId, required(taskId, "task_id", 120), Boolean(options.isAdmin));
  const templateRows = await postgresPool().query<TemplateRow>(
    `SELECT id,template_code,version,title,description,automation_level,routing_policy_code,stage_policy_json
       FROM work_order_templates
      WHERE status='published'
      ORDER BY template_code,version DESC
      LIMIT 24`,
  );
  const templates = templateRows.rows.map<JevWorkOrderTemplateChoice>((row) => ({
    template_code: row.template_code, version: Number(row.version), title: row.title, description: row.description, automation_level: row.automation_level,
  }));
  const routingPolicyCodes = [...new Set(templateRows.rows.map((row) => row.routing_policy_code).filter((value): value is string => Boolean(value)))];
  const allowedNextStages = [...new Set(templateRows.rows.flatMap((row) => stageCodes(row.stage_policy_json)))];
  const input = {
    task: task.task,
    source_event: event,
    templates: templates.map((template) => ({ code: template.template_code, version: template.version })),
    routing_policy_codes: routingPolicyCodes,
    allowed_next_stages: allowedNextStages,
    mode: "shadow",
    policy: "no_create_no_assign_no_stage_write",
  };
  const inputHash = workOrderDecisionInputHash(input);
  const verdict = !templates.length
    ? disabledVerdict("没有已发布工单模板；已记录为需要人工配置，未执行任何动作。")
    : await judgeWorkOrderWithJev({
      task: { id: task.task.task_id, title: task.task.title, goal: task.task.goal, status: task.task.status },
      source_event: event, templates, routing_policy_codes: routingPolicyCodes, allowed_next_stages: allowedNextStages,
    })
      .catch((error) => error instanceof JevWorkOrderUnavailable ? disabledVerdict(error.message) : Promise.reject(error));
  const selected = verdict.template_code
    ? templateRows.rows.find((row) => row.template_code === verdict.template_code && Number(row.version) === verdict.template_version) || null
    : null;
  const normalizedOutcome = verdict.action === "create" && !selected ? "needs_review" : verdict.action;
  return postgresTransaction(async (client) => {
    const replay = await client.query<DecisionRow>(
      `SELECT id,task_id,template_code,template_version,routing_policy_code,decision_mode,outcome,status,input_hash,input_json,judgment_json,
              gate_results_json,jev_model,prompt_version,confidence,reason,actor_ref,created_at
         FROM work_order_decisions WHERE idempotency_key=$1 FOR UPDATE`,
      [idempotencyKey],
    );
    if (replay.rows[0]) {
      if (replay.rows[0].task_id !== task.task.task_id || replay.rows[0].actor_ref !== actorId) throw new HttpFail(409, { code: "idempotency_key_reused" });
      return { decision: publicDecision(replay.rows[0], true), task: task.task };
    }
    const gates = {
      execution_mode: "shadow_only",
      automatic_execution: false,
      host_policy_validation_required: true,
      human_confirmation_required: true,
      published_template_required: true,
      selected_template_published: Boolean(selected),
      no_assignment_written: true,
      no_stage_written: true,
      no_task_completion_written: true,
    };
    const inserted = await client.query<DecisionRow>(
      `INSERT INTO work_order_decisions
       (task_id,source_event_id,template_code,template_version,routing_policy_code,decision_mode,outcome,status,input_hash,input_json,judgment_json,
        gate_results_json,jev_model,prompt_version,confidence,reason,actor_ref,idempotency_key)
       VALUES ($1,$2,$3,$4,$5,'shadow',$6,'recorded',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING id,task_id,template_code,template_version,routing_policy_code,decision_mode,outcome,status,input_hash,input_json,judgment_json,
                 gate_results_json,jev_model,prompt_version,confidence,reason,actor_ref,created_at`,
      [
        task.task.task_id, event.id, selected?.template_code || null, selected ? Number(selected.version) : null, verdict.routing_policy_code,
        normalizedOutcome, inputHash, JSON.stringify(input), JSON.stringify({ ...verdict, action: normalizedOutcome }), JSON.stringify(gates),
        verdict.model, verdict.prompt_version, verdict.confidence, verdict.reason, actorId, idempotencyKey,
      ],
    );
    if (!inserted.rows[0]) throw new Error("work order shadow decision insert failed");
    return { decision: publicDecision(inserted.rows[0], false), task: task.task };
  }, { isolation: "SERIALIZABLE" });
}
