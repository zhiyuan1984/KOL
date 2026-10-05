import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { HttpFail } from "../host/errors.js";
import { postgresTransaction } from "../postgres/pool.js";

type Query = Pick<PoolClient, "query">;
type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
  return value && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : {};
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as ObjectValue)[key])]));
  return value;
}
export function collaborationContentHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

/** This is a technical binding contract, not an approval chain or completion
 * rule. Only the existing template publication path can make it executable. */
export type CollaborationDependencyPolicy = {
  schema: "work-order-collaboration.v1";
  action_id: "work_order.advance_stage";
  prerequisites: Array<{ template_code: string; template_version: number }>;
  review?: {
    company_id: string;
    template_id: string;
    template_version: number;
    fields: { collaboration_id: string; work_order_id: string; action_id: string; artifact_id: string; artifact_version: string; content_hash: string };
  };
};
export function parseCollaborationPolicy(fillPolicy: unknown): CollaborationDependencyPolicy | null {
  const raw = object(fillPolicy).collaboration_dependencies;
  if (raw === undefined) return null;
  const p = object(raw);
  const positive = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0;
  if (p.schema !== "work-order-collaboration.v1" || p.action_id !== "work_order.advance_stage" ||
    !Array.isArray(p.prerequisites) || p.prerequisites.length > 20 ||
    p.prerequisites.some(v => { const x = object(v); return typeof x.template_code !== "string" || !/^[a-z][a-z0-9_]{2,119}$/.test(x.template_code) || !positive(x.template_version); })) {
    throw new HttpFail(422, { code: "collaboration_dependency_policy_invalid" });
  }
  if (p.review !== undefined) {
    const r = object(p.review), fields = object(r.fields);
    const names = ["collaboration_id", "work_order_id", "action_id", "artifact_id", "artifact_version", "content_hash"];
    if (typeof r.company_id !== "string" || !r.company_id || typeof r.template_id !== "string" || !r.template_id || !positive(r.template_version) ||
      names.some(key => typeof fields[key] !== "string" || !fields[key] || String(fields[key]).length > 120) ||
      new Set(names.map(key => fields[key])).size !== names.length) throw new HttpFail(422, { code: "collaboration_review_mapping_invalid" });
  }
  if (!p.review && !p.prerequisites.length) throw new HttpFail(422, { code: "collaboration_dependencies_empty" });
  return p as CollaborationDependencyPolicy;
}

export type CollaborationGate = {
  work_order_id: string;
  action_id: "work_order.advance_stage";
  configured: boolean;
  allowed: boolean;
  version: string;
  blockers: string[];
  prerequisites: Array<{ id: string; status: string; version: number }>;
  review: { id: string; company_id: string; status: string; version: number; round: number } | null;
};

/** Called inside the existing executor transaction as well as the L1 read.
 * Shared locks make the source versions stable until the action commits. */
export async function workOrderCollaborationGate(db: Query, actorId: string, workOrderId: string): Promise<CollaborationGate> {
  const row = (await db.query(`SELECT wo.*,t.collaboration_id AS task_collaboration_id,wt.status AS template_status,wt.fill_policy_json
    FROM work_orders wo JOIN work_order_templates wt ON wt.id=wo.template_id
    JOIN tickets t ON t.id=wo.task_id JOIN ticket_accounts a ON a.id=$2 AND a.active
    WHERE wo.id=$1 AND (t.owner_user_id=$2 OR EXISTS (SELECT 1 FROM work_order_assignments wa
      WHERE wa.work_order_id=wo.id AND wa.principal_id=$2 AND wa.status='active'))
    FOR SHARE OF wo,wt,t,a`, [workOrderId, actorId])).rows[0];
  if (!row) throw new HttpFail(404, { code: "work_order_not_found_or_not_authorized" });
  const blockers: string[] = [], prerequisites: CollaborationGate["prerequisites"] = [];
  let review: CollaborationGate["review"] = null;
  const policy = parseCollaborationPolicy(row.fill_policy_json);
  const context = object(object(row.payload_json).collaboration_context);
  const basis: unknown[] = [row.id, row.data_version, row.template_id, row.template_version, row.template_status, policy, context];
  if (!policy) blockers.push("dependency_rule_not_published");
  else {
    if (row.template_status !== "published") blockers.push("template_not_published");
    const refs = Array.isArray(context.prerequisite_work_order_ids) ? [...new Set(context.prerequisite_work_order_ids)] : [];
    if (refs.length !== policy.prerequisites.length || refs.some(id => typeof id !== "string" || id === row.id)) blockers.push("prerequisite_binding_missing");
    else {
      const rows = (await db.query(`SELECT wo.id,wo.status,wo.data_version,wo.template_code,wo.template_version
        FROM work_orders wo JOIN tickets t ON t.id=wo.task_id WHERE wo.id=ANY($1::text[]) AND wo.task_id=$2
          AND (t.owner_user_id=$3 OR EXISTS (SELECT 1 FROM work_order_assignments wa
            WHERE wa.work_order_id=wo.id AND wa.principal_id=$3 AND wa.status='active')) ORDER BY wo.id FOR SHARE OF wo`,
        [refs, row.task_id, actorId])).rows;
      if (rows.length !== refs.length) blockers.push("prerequisite_not_available");
      const matched = new Set<string>();
      for (const requirement of policy.prerequisites) {
        const prior = rows.find(r => !matched.has(r.id) && r.template_code === requirement.template_code && Number(r.template_version) === requirement.template_version);
        if (!prior) { blockers.push("prerequisite_template_mismatch"); continue; }
        matched.add(prior.id);
        prerequisites.push({ id: prior.id, status: prior.status, version: Number(prior.data_version) });
        if (prior.status !== "completed") blockers.push("prerequisite_not_completed");
      }
      basis.push(prerequisites);
    }
    if (policy.review) {
      const collaboration = (await db.query(`SELECT c.id FROM collaborations c JOIN users u ON u.id=$2 AND u.active=1
        WHERE c.id=$1 AND u.brands::jsonb ? c.brand FOR SHARE OF c,u`, [context.collaboration_id || null, actorId])).rows[0];
      if (!collaboration || row.task_collaboration_id !== context.collaboration_id) blockers.push("collaboration_not_available");
      const artifact = (await db.query(`SELECT id,version,payload FROM task_artifacts WHERE id=$1 AND work_item_id=$2 FOR SHARE`,
        [context.artifact_id || null, row.task_id])).rows[0];
      if (!artifact) blockers.push("artifact_not_available");
      else {
        const material = typeof artifact.payload === "string" ? JSON.parse(artifact.payload) : artifact.payload;
        const hash = collaborationContentHash(material);
        basis.push(artifact.id, Number(artifact.version), hash);
        if (Number(artifact.version) !== context.artifact_version || hash !== context.content_hash) blockers.push("artifact_version_conflict");
      }
      const company = context.company_id, reviewId = context.review_instance_id;
      const current = blockers.includes("collaboration_not_available") || company !== policy.review.company_id ? null : (await db.query(`SELECT i.*,v.definition,l.enabled
        FROM review_instances i JOIN review_versions v ON v.tenant=i.tenant AND v.template_id=i.template_id AND v.version=i.template_version
        LEFT JOIN review_template_lifecycle l ON l.tenant=i.tenant AND l.template_id=i.template_id
        WHERE i.tenant=$1 AND i.id=$2 AND EXISTS (SELECT 1 FROM review_participants p
          WHERE p.tenant=i.tenant AND p.instance_id=i.id AND p.user_id=$3)
        AND EXISTS (SELECT 1 FROM organization_people p JOIN organization_memberships m ON m.person_ref=p.person_ref
          JOIN organization_units u ON u.id=m.org_unit_id AND u.company_id=m.company_id
          JOIN users a ON a.id=p.user_id AND a.active=1
          WHERE p.user_id=$3 AND p.status='active' AND m.status='active' AND u.status='active' AND m.company_id=i.tenant
            AND (m.effective_from IS NULL OR m.effective_from<=now()::text) AND (m.effective_to IS NULL OR m.effective_to>now()::text))
        FOR SHARE OF i,v`, [company || null, reviewId || null, actorId])).rows[0];
      if (!current) blockers.push("review_not_available");
      else {
        const payload = object(typeof current.payload === "string" ? JSON.parse(current.payload) : current.payload);
        const values = object(payload.values), mapping = policy.review.fields;
        review = { id: current.id, company_id: current.tenant, status: current.status, version: Number(current.version), round: Number(payload.round || 1) };
        basis.push(review, values, current.enabled);
        if (current.template_id !== policy.review.template_id || Number(current.template_version) !== policy.review.template_version || current.enabled === 0) blockers.push("review_template_mismatch");
        if (current.status !== "approved") blockers.push("review_not_approved");
        const expected: ObjectValue = { collaboration_id: context.collaboration_id, work_order_id: row.id, action_id: policy.action_id,
          artifact_id: context.artifact_id, artifact_version: context.artifact_version, content_hash: context.content_hash };
        if (Object.entries(expected).some(([key, value]) => value == null || value === "" || values[mapping[key as keyof typeof mapping]] !== value)) blockers.push("review_content_mismatch");
      }
    }
  }
  return { work_order_id: row.id, action_id: "work_order.advance_stage", configured: Boolean(policy), allowed: blockers.length === 0,
    version: collaborationContentHash(basis), blockers: [...new Set(blockers)], prerequisites, review };
}

export async function readTaskCollaborationContext(actorId: string, taskId: string, after = 0) {
  if (!Number.isSafeInteger(after) || after < 0) throw new HttpFail(422, { code: "invalid_event_cursor" });
  return postgresTransaction(async db => {
    const task = (await db.query(`SELECT t.id,t.collaboration_id FROM tickets t JOIN ticket_accounts a ON a.id=$2 AND a.active
      WHERE t.id=$1 AND t.task_type='business_task' AND t.profile='task-root'
        AND (t.owner_user_id=$2 OR EXISTS (SELECT 1 FROM work_orders wo JOIN work_order_assignments wa ON wa.work_order_id=wo.id
          WHERE wo.task_id=t.id AND wa.principal_id=$2 AND wa.status='active')) FOR SHARE OF t,a`, [taskId, actorId])).rows[0];
    if (!task) throw new HttpFail(404, { code: "task_not_found_or_not_authorized" });
    if (task.collaboration_id) {
      const scope = await db.query(`SELECT c.id FROM collaborations c JOIN users u ON u.id=$2 AND u.active=1
        WHERE c.id=$1 AND u.brands::jsonb ? c.brand FOR SHARE OF c,u`, [task.collaboration_id, actorId]);
      if (!scope.rows.length) throw new HttpFail(404, { code: "task_not_found_or_not_authorized" });
    }
    const orders = (await db.query(`SELECT wo.id FROM work_orders wo JOIN tickets t ON t.id=wo.task_id
      WHERE wo.task_id=$1 AND (t.owner_user_id=$2 OR EXISTS (SELECT 1 FROM work_order_assignments wa
        WHERE wa.work_order_id=wo.id AND wa.principal_id=$2 AND wa.status='active')) ORDER BY wo.id`, [taskId, actorId])).rows;
    const gates: CollaborationGate[] = [];
    for (const order of orders) gates.push(await workOrderCollaborationGate(db, actorId, order.id));
    // Private review events are only returned for a currently readable matched
    // review. Missing/mismatched content never exposes another cooperation's ID.
    const reviews = gates.filter(g => g.review && !g.blockers.some(b => ["review_content_mismatch","review_template_mismatch"].includes(b))).map(g => ({ id: g.review!.id, company_id: g.review!.company_id }));
    const events = (await db.query(`SELECT sequence,source_type,source_id,company_id,source_version,event_type,before_state,after_state,occurred_at
      FROM collaboration_source_events WHERE sequence>$1 AND
        ((source_type='work_order' AND source_id=ANY($2::text[])) OR
         (source_type='review' AND EXISTS (SELECT 1 FROM jsonb_to_recordset($3::jsonb) mapped(id text, company_id text)
           WHERE mapped.id=source_id AND mapped.company_id=collaboration_source_events.company_id) AND EXISTS (SELECT 1 FROM review_participants p
           WHERE p.tenant=company_id AND p.instance_id=source_id AND p.user_id=$4))) ORDER BY sequence LIMIT 101`,
      [after, orders.map(o => o.id), JSON.stringify(reviews), actorId])).rows;
    const page = events.slice(0, 100);
    return { risk: "L1", calls_model: false, task_id: taskId, gates: gates.map(g => g.blockers.includes("review_content_mismatch") || g.blockers.includes("review_template_mismatch") ? { ...g, review: null } : g),
      events: page, cursor: page.length ? Number(page[page.length - 1].sequence) : after, has_more: events.length > 100,
      version: collaborationContentHash(gates.map(g => g.version)), as_of: new Date().toISOString() };
  }, { isolation: "REPEATABLE READ" });
}
