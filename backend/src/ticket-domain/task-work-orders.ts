import { createHash } from "node:crypto";
import { HttpFail } from "../host/errors.js";
import { nid } from "../ids.js";
import { postgresPool, postgresTransaction } from "../postgres/pool.js";

const TASK_PROFILE = "task-root";
const TASK_TYPE = "business_task";
const OPEN_WORK_ORDER_STATUSES = new Set([
  "proposed", "pending_assignment", "assigned", "accepted", "in_progress",
  "waiting_external", "waiting_approval", "ready_for_acceptance", "needs_review",
]);

export type TaskRootInput = {
  title: unknown;
  goal?: unknown;
  priority?: unknown;
  due_at?: unknown;
  idempotency_key: unknown;
};

export type TaskRoot = {
  task_id: string;
  title: string;
  goal: string;
  status: string;
  priority: string;
  due_at: string | null;
  data_version: number;
  created_at: string;
  updated_at: string;
};

export type WorkOrderSummary = {
  work_order_id: string;
  template_code: string;
  template_version: number;
  template_title: string;
  status: string;
  priority: string;
  stage_code: string | null;
  title: string;
  objective: string;
  due_at: string | null;
  automation_level: string;
  created_at: string;
  updated_at: string;
  primary_assignee: { principal_id: string; person_ref: string | null; org_unit_id: string | null } | null;
  latest_decision: { id: string; decision_mode: string; outcome: string; status: string; confidence: number | null; created_at: string } | null;
};

export type TaskWorkOrderAggregate = {
  task: TaskRoot;
  work_orders: WorkOrderSummary[];
  counts: { total: number; open: number; blocked: number; waiting_review: number; completed: number };
  current_blocking_work_order: WorkOrderSummary | null;
  as_of: string;
  source: "postgresql_task_work_orders";
};

export type TaskWorkOrderList = {
  items: Array<Pick<TaskWorkOrderAggregate, "task" | "counts" | "current_blocking_work_order">>;
  as_of: string;
  source: "postgresql_task_work_orders";
};

function text(value: unknown, field: string, max: number, required = false): string | null {
  const result = String(value ?? "").trim();
  if (!result) {
    if (required) throw new HttpFail(422, { code: "missing_fields", missing_fields: [field] });
    return null;
  }
  if (result.length > max) throw new HttpFail(422, { code: "field_too_long", field, max });
  return result;
}

function dateTime(value: unknown): string | null {
  const raw = text(value, "due_at", 80);
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw new HttpFail(422, { code: "invalid_due_at" });
  return parsed.toISOString();
}

function taskRow(row: Record<string, unknown>): TaskRoot {
  const payload = row.input && typeof row.input === "object" && !Array.isArray(row.input) ? row.input as Record<string, unknown> : {};
  return {
    task_id: String(row.id),
    title: String(row.title),
    goal: String(row.goal || payload.goal || row.content || row.title),
    status: String(row.status),
    priority: String(row.priority),
    due_at: row.due_at == null ? null : new Date(String(row.due_at)).toISOString(),
    data_version: Number(row.data_version || 1),
    created_at: new Date(String(row.created_at)).toISOString(),
    updated_at: new Date(String(row.updated_at)).toISOString(),
  };
}

/** Creates a PostgreSQL task root for new AI-work-order flows. It does not
 * touch legacy workbench task tables or make the task complete on child order
 * completion. */
export async function createTaskRootPostgres(actorId: string, raw: TaskRootInput): Promise<TaskRoot> {
  const title = text(raw.title, "title", 200, true)!;
  const goal = text(raw.goal, "goal", 4_000) || title;
  const priority = text(raw.priority, "priority", 40) || "normal";
  if (!["important_urgent", "important", "urgent", "normal", "low"].includes(priority)) {
    throw new HttpFail(422, { code: "priority_invalid" });
  }
  const idempotencyKey = text(raw.idempotency_key, "idempotency_key", 200, true)!;
  if (idempotencyKey.length < 8) throw new HttpFail(422, { code: "idempotency_key_invalid" });
  const dueAt = dateTime(raw.due_at);
  return postgresTransaction(async (client) => {
    const existing = await client.query<Record<string, unknown>>(
      `SELECT t.* FROM task_root_command_receipts r
       JOIN tickets t ON t.id=r.task_id
       WHERE r.idempotency_key=$1 AND r.requester_user_id=$2 FOR UPDATE`,
      [idempotencyKey, actorId],
    );
    if (existing.rows[0]) return taskRow(existing.rows[0]);
    const now = new Date().toISOString();
    const taskId = nid("task");
    const input = { goal, idempotency_key: idempotencyKey, source: "postgresql_task_root.v1" };
    const inserted = await client.query<Record<string, unknown>>(
      `INSERT INTO tickets
       (id,owner_user_id,task_type,title,source,status,priority,skill,profile,due_at,input,entities,data_version,created_at,updated_at,
        content,kind,channel,requester_type,requester_id)
       VALUES ($1,$2,$3,$4,'manual','open',$5,'task_root',$6,$7,$8,'{}'::jsonb,1,$9,$9,$10,'general','human','ai_task_root',$2)
       RETURNING *`,
      [taskId, actorId, TASK_TYPE, title, priority, TASK_PROFILE, dueAt, JSON.stringify(input), now, goal],
    );
    const response = taskRow(inserted.rows[0]!);
    await client.query(
      `INSERT INTO task_root_command_receipts (idempotency_key,requester_user_id,task_id,response_json,created_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [idempotencyKey, actorId, taskId, JSON.stringify(response), now],
    );
    return response;
  }, { isolation: "SERIALIZABLE" });
}

async function authorizedTask(actorId: string, taskId: string, isAdmin: boolean): Promise<TaskRoot> {
  const task = await postgresPool().query<Record<string, unknown>>(
    `SELECT t.*
       FROM tickets t
      WHERE t.id=$1 AND t.task_type=$2 AND t.profile=$3
        AND ($4::boolean OR t.owner_user_id=$5 OR EXISTS (
          SELECT 1
            FROM work_orders wo JOIN work_order_assignments wa ON wa.work_order_id=wo.id
           WHERE wo.task_id=t.id AND wa.principal_id=$5 AND wa.status='active'
        ))`,
    [taskId, TASK_TYPE, TASK_PROFILE, isAdmin, actorId],
  );
  if (!task.rows[0]) throw new HttpFail(404, { code: "task_not_found_or_not_authorized" });
  return taskRow(task.rows[0]);
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** Read-only task aggregation. The parent task retains its own status; child
 * work orders only provide workload, blocking and next-action facts. */
export async function taskWorkOrderAggregate(actorId: string, taskId: string, isAdmin = false): Promise<TaskWorkOrderAggregate> {
  const task = await authorizedTask(actorId, taskId, isAdmin);
  const rows = await postgresPool().query<{
    id: string; template_code: string; template_version: number | string; template_title: string; status: string; priority: string;
    stage_code: string | null; title: string; objective: string; due_at: Date | string | null; automation_level: string;
    created_at: Date | string; updated_at: Date | string;
    principal_id: string | null; person_ref: string | null; org_unit_id: string | null;
    decision_id: string | null; decision_mode: string | null; decision_outcome: string | null; decision_status: string | null;
    decision_confidence: string | number | null; decision_created_at: Date | string | null;
  }>(
    `SELECT wo.id,wo.template_code,wo.template_version,COALESCE(wt.title,wo.template_code) AS template_title,
            wo.status,wo.priority,wo.stage_code,wo.title,wo.objective,wo.due_at,wo.automation_level,wo.created_at,wo.updated_at,
            primary_assignment.principal_id,primary_assignment.person_ref,primary_assignment.org_unit_id,
            latest_decision.id AS decision_id,latest_decision.decision_mode,latest_decision.outcome AS decision_outcome,
            latest_decision.status AS decision_status,latest_decision.confidence AS decision_confidence,latest_decision.created_at AS decision_created_at
       FROM work_orders wo
       LEFT JOIN work_order_templates wt ON wt.id=wo.template_id
       LEFT JOIN LATERAL (
         SELECT principal_id,person_ref,org_unit_id FROM work_order_assignments
          WHERE work_order_id=wo.id AND role='primary' AND status='active'
          ORDER BY effective_from DESC LIMIT 1
       ) primary_assignment ON true
       LEFT JOIN LATERAL (
         SELECT id,decision_mode,outcome,status,confidence,created_at FROM work_order_decisions
          WHERE work_order_id=wo.id ORDER BY created_at DESC LIMIT 1
       ) latest_decision ON true
      WHERE wo.task_id=$1
      ORDER BY CASE wo.status WHEN 'needs_review' THEN 0 WHEN 'pending_assignment' THEN 1 WHEN 'waiting_external' THEN 2 ELSE 3 END,
               wo.due_at NULLS LAST,wo.created_at DESC`,
    [task.task_id],
  );
  const workOrders = rows.rows.map<WorkOrderSummary>((row) => ({
    work_order_id: row.id,
    template_code: row.template_code,
    template_version: Number(row.template_version),
    template_title: row.template_title,
    status: row.status,
    priority: row.priority,
    stage_code: row.stage_code,
    title: row.title,
    objective: row.objective,
    due_at: row.due_at == null ? null : new Date(row.due_at).toISOString(),
    automation_level: row.automation_level,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
    primary_assignee: row.principal_id ? { principal_id: row.principal_id, person_ref: row.person_ref, org_unit_id: row.org_unit_id } : null,
    latest_decision: row.decision_id ? {
      id: row.decision_id, decision_mode: String(row.decision_mode), outcome: String(row.decision_outcome), status: String(row.decision_status),
      confidence: row.decision_confidence == null ? null : Number(row.decision_confidence), created_at: new Date(String(row.decision_created_at)).toISOString(),
    } : null,
  }));
  const blocked = workOrders.filter((order) => ["needs_review", "pending_assignment", "waiting_external", "waiting_approval"].includes(order.status));
  return {
    task,
    work_orders: workOrders,
    counts: {
      total: workOrders.length,
      open: workOrders.filter((order) => OPEN_WORK_ORDER_STATUSES.has(order.status)).length,
      blocked: blocked.length,
      waiting_review: workOrders.filter((order) => order.status === "needs_review").length,
      completed: workOrders.filter((order) => order.status === "completed").length,
    },
    current_blocking_work_order: blocked[0] || null,
    as_of: new Date().toISOString(),
    source: "postgresql_task_work_orders",
  };
}

/** The compatibility workbench retains its existing task feed. This separate,
 * authorized list is the progressive read model for PostgreSQL Task roots so a
 * new AI task can be shown alongside—not masquerade as—a legacy agent run. */
export async function listTaskWorkOrderAggregates(actorId: string, isAdmin = false, limit = 50): Promise<TaskWorkOrderList> {
  const bounded = Math.max(1, Math.min(100, Math.floor(limit)));
  const rows = await postgresPool().query<{ id: string }>(
    `SELECT t.id
       FROM tickets t
      WHERE t.task_type=$1 AND t.profile=$2
        AND ($3::boolean OR t.owner_user_id=$4 OR EXISTS (
          SELECT 1 FROM work_orders wo JOIN work_order_assignments wa ON wa.work_order_id=wo.id
           WHERE wo.task_id=t.id AND wa.principal_id=$4 AND wa.status='active'
        ))
      ORDER BY t.updated_at DESC,t.id DESC LIMIT $5`,
    [TASK_TYPE, TASK_PROFILE, isAdmin, actorId, bounded],
  );
  const aggregates = await Promise.all(rows.rows.map((row) => taskWorkOrderAggregate(actorId, row.id, isAdmin)));
  return {
    items: aggregates.map(({ task, counts, current_blocking_work_order }) => ({ task, counts, current_blocking_work_order })),
    as_of: new Date().toISOString(),
    source: "postgresql_task_work_orders",
  };
}

/** Stable idempotency input fingerprint for the forthcoming Jev shadow judge.
 * It is intentionally exported so decisions and executor use one canonical key. */
export function workOrderDecisionInputHash(input: unknown): string {
  return fingerprint(input);
}
