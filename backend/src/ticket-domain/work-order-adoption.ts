import type { PoolClient } from "pg";
import { HttpFail } from "../host/errors.js";
import { postgresTransaction } from "../postgres/pool.js";
import { collaborationContentHash } from "./collaboration-context.js";

const OPEN = ["proposed", "pending_assignment", "assigned", "accepted", "in_progress", "waiting_external", "waiting_approval", "ready_for_acceptance", "needs_review"];

/** Current task owner only. Scope is checked before reading suggestion text;
 * administrator status does not widen this command's authority. */
export async function lockAdoptionTask(client: PoolClient, actorId: string, taskId: string) {
  const task = (await client.query(`SELECT t.id,t.title,t.status,t.data_version,t.collaboration_id,a.name AS owner_name
    FROM tickets t JOIN ticket_accounts a ON a.id=$1 AND a.active=true
    WHERE t.id=$2 AND t.owner_user_id=a.id AND t.task_type='business_task' AND t.profile='task-root'
    FOR SHARE OF t,a`, [actorId, taskId])).rows[0];
  if (!task) throw new HttpFail(404, { code: "task_not_found" });
  if (task.collaboration_id) {
    const scope = await client.query(`SELECT c.id FROM collaborations c JOIN users u ON u.id=$1 AND u.active=1
      WHERE c.id=$2 AND u.brands::jsonb ? c.brand FOR SHARE OF c,u`, [actorId, task.collaboration_id]);
    if (!scope.rows[0]) throw new HttpFail(404, { code: "task_not_found" });
  }
  return task;
}

/** Locks the basis until the caller's write commits. The token binds the actor,
 * source, published rules, parent version and every offered merge target. */
export async function workOrderAdoptionBasis(client: PoolClient, actorId: string, decisionId: string) {
  const metadata = (await client.query("SELECT task_id FROM work_order_decisions WHERE id=$1", [decisionId])).rows[0];
  if (!metadata) throw new HttpFail(404, { code: "work_order_decision_not_found" });
  const task = await lockAdoptionTask(client, actorId, metadata.task_id);
  const decision = (await client.query("SELECT * FROM work_order_decisions WHERE id=$1 FOR SHARE", [decisionId])).rows[0]!;
  const template = (await client.query(`SELECT * FROM work_order_templates WHERE template_code=$1 AND version=$2 FOR SHARE`,
    [decision.template_code, decision.template_version])).rows[0];
  const release = template ? (await client.query("SELECT * FROM work_order_automation_releases WHERE template_id=$1 FOR SHARE", [template.id])).rows[0] : null;
  const event = (await client.query("SELECT * FROM work_order_verified_events WHERE id=$1 AND task_id=$2 FOR SHARE", [decision.source_event_id, task.id])).rows[0];
  const candidates = template ? (await client.query(`SELECT id,title,status,data_version FROM work_orders
    WHERE task_id=$1 AND template_code=$2 AND template_version=$3 AND status=ANY($4::text[])
    ORDER BY created_at,id FOR SHARE`, [task.id, template.template_code, template.version, OPEN])).rows : [];
  const previous = (await client.query(`SELECT attempt.work_order_id,attempt.status FROM work_order_execution_attempts attempt
    JOIN work_order_decisions d ON d.id=attempt.decision_id
    WHERE d.task_id=$1 AND d.source_event_id=$2 AND d.template_code=$3 AND d.template_version=$4
      AND attempt.status IN ('created','merged') ORDER BY attempt.created_at LIMIT 1`,
    [task.id, decision.source_event_id, decision.template_code, decision.template_version])).rows[0];
  const receipt = (await client.query(`SELECT id,status,work_order_id FROM work_order_execution_attempts
    WHERE decision_id=$1 AND actor_ref=$2 AND status IN ('created','merged') ORDER BY created_at DESC LIMIT 1`, [decisionId, actorId])).rows[0];
  const blockers: string[] = [];
  if (!["create", "merge_open_order"].includes(decision.outcome)) blockers.push("decision_not_adoptable");
  if (!["open", "in_progress", "waiting", "blocked", "ready_for_review"].includes(task.status)) blockers.push("task_status_not_executable");
  if (!event) blockers.push("verified_event_missing");
  if (!template || template.status !== "published") blockers.push("template_not_published");
  if (!template || !["A1", "A2"].includes(template.automation_level)) blockers.push("automation_level_not_executable");
  if (!release || release.status !== "enabled" || release.automation_level !== template?.automation_level) blockers.push("automation_release_disabled");
  if (release && Number(decision.confidence || 0) < Number(release.minimum_confidence)) blockers.push("decision_confidence_below_release_threshold");
  if (release?.routing_policy_code && release.routing_policy_code !== decision.routing_policy_code) blockers.push("decision_routing_policy_not_released");
  if (template?.automation_level === "A2" && (release?.routing_policy_code !== "task_owner" || decision.routing_policy_code !== "task_owner")) blockers.push("routing_policy_not_supported");
  if (previous) blockers.push("source_event_already_adopted");
  const actions = blockers.length ? [] : candidates.length ? ["merge"] : decision.outcome === "create" ? ["create"] : [];
  if (!blockers.length && !actions.length) blockers.push("merge_target_missing");
  return {
    decision_id: decision.id, task_id: task.id, outcome: decision.outcome,
    template_title: template?.title || "", template_code: decision.template_code, template_version: Number(decision.template_version),
    automation_level: String(template?.automation_level || ""),
    assignment_target: template?.automation_level === "A2" ? { id: actorId, name: String(task.owner_name) } : null,
    source_event: event ? { id: event.id, summary: event.summary, evidence_ref: event.evidence_ref, source_version: event.source_version, occurred_at: event.occurred_at } : null,
    candidates: candidates.map(row => ({ id: String(row.id), title: String(row.title), status: String(row.status), version: Number(row.data_version) })),
    actions, blockers, existing_work_order_id: previous?.work_order_id || null,
    execution_receipt: receipt ? { id: String(receipt.id), status: String(receipt.status), work_order_id: String(receipt.work_order_id) } : null,
    version: collaborationContentHash({ actorId, task, decision, template, release, event, candidates, previous: previous || null }),
    risk: "L3" as const,
  };
}

export async function readWorkOrderSuggestions(actorId: string, taskId: string) {
  return postgresTransaction(async client => {
    // Keep the read/write lock order identical to the shared executor.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`work-order-materialization:${taskId}`]);
    await lockAdoptionTask(client, actorId, taskId);
    const ids = await client.query(`SELECT id FROM work_order_decisions WHERE task_id=$1 AND outcome IN ('create','merge_open_order')
      ORDER BY created_at DESC,id LIMIT 30`, [taskId]);
    const suggestions = [];
    for (const row of ids.rows) suggestions.push(await workOrderAdoptionBasis(client, actorId, row.id));
    return { suggestions, calls_model: false as const };
  }, { isolation: "REPEATABLE READ" });
}

export type WorkOrderAdoptionInput = { confirmed?: unknown; basis_version?: unknown; action?: unknown; target_id?: unknown };

export function validateWorkOrderAdoption(raw: WorkOrderAdoptionInput, basis: Awaited<ReturnType<typeof workOrderAdoptionBasis>>) {
  if (raw.confirmed !== true) throw new HttpFail(422, { code: "human_confirmation_required" });
  if (raw.basis_version !== basis.version) throw new HttpFail(409, { code: "adoption_basis_changed" });
  if (!basis.actions.includes(String(raw.action))) throw new HttpFail(409, { code: "adoption_not_allowed", blockers: basis.blockers });
  if (raw.action === "merge" && !basis.candidates.some(item => item.id === raw.target_id)) throw new HttpFail(409, { code: "merge_target_not_available" });
  if (raw.action === "create" && raw.target_id) throw new HttpFail(422, { code: "unexpected_merge_target" });
}
