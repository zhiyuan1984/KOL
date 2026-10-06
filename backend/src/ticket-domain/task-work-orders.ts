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
  workspace_allowed?: boolean;
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
  /** Immutable execution-attempt fact; never inferred from template level. */
  automatic_created: boolean;
  /** Successful automatic materialization plus active deterministic primary route. */
  automatic_assigned: boolean;
  creation_mode: "automatic" | "manual";
  assignment_origin: "automatic" | "manual_or_unverified" | "unassigned";
  routing_policy_code: string | null;
  created_at: string;
  updated_at: string;
  primary_assignee: { principal_id: string; person_ref: string | null; org_unit_id: string | null } | null;
  latest_decision: { id: string; decision_mode: string; outcome: string; status: string; confidence: number | null; created_at: string } | null;
};

export type WorkOrderVerifiedEventSummary = {
  id: string;
  event_type: string;
  occurred_at: string;
  summary: string;
  evidence_ref: string;
  verified_by: string;
  verified_at: string;
};

export type TaskWorkOrderAggregate = {
  task: TaskRoot;
  work_orders: WorkOrderSummary[];
  verified_events: WorkOrderVerifiedEventSummary[];
  counts: TaskWorkOrderCounts;
  current_blocking_work_order: WorkOrderSummary | null;
  as_of: string;
  source: "postgresql_task_work_orders";
};

export type TaskWorkOrderList = {
  items: Array<Pick<TaskWorkOrderAggregate, "task" | "counts" | "current_blocking_work_order">>;
  as_of: string;
  source: "postgresql_task_work_orders";
};

export type TaskWorkOrderCounts = {
  total: number;
  open: number;
  blocked: number;
  waiting_review: number;
  completed: number;
  automatic_created: number;
  automatic_assigned: number;
};

export type TaskWorkOrderCompact = Pick<WorkOrderSummary,
  "work_order_id" | "template_code" | "template_version" | "template_title" |
  "status" | "stage_code" | "title" | "automation_level" |
  "automatic_created" | "automatic_assigned" | "creation_mode" |
  "assignment_origin" | "routing_policy_code" | "primary_assignee"
>;

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
        AND (t.collaboration_id IS NULL OR EXISTS (SELECT 1 FROM collaborations c JOIN users u ON u.id=$5 AND u.active=1
          WHERE c.id=t.collaboration_id AND u.brands::jsonb ? c.brand))
        AND ($4::boolean OR t.owner_user_id=$5 OR EXISTS (
          SELECT 1
            FROM work_orders wo JOIN work_order_assignments wa ON wa.work_order_id=wo.id
           WHERE wo.task_id=t.id AND wa.principal_id=$5 AND wa.status='active'
        ))`,
    [taskId, TASK_TYPE, TASK_PROFILE, isAdmin, actorId],
  );
  if (!task.rows[0]) throw new HttpFail(404, { code: "task_not_found_or_not_authorized" });
  return { ...taskRow(task.rows[0]), workspace_allowed: task.rows[0].owner_user_id === actorId };
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
    principal_id: string | null; person_ref: string | null; org_unit_id: string | null; routing_policy_code: string | null;
    automatic_created: boolean; automatic_assigned: boolean;
    decision_id: string | null; decision_mode: string | null; decision_outcome: string | null; decision_status: string | null;
    decision_confidence: string | number | null; decision_created_at: Date | string | null;
  }>(
    `SELECT wo.id,wo.template_code,wo.template_version,COALESCE(wt.title,wo.template_code) AS template_title,
            wo.status,wo.priority,wo.stage_code,wo.title,wo.objective,wo.due_at,wo.automation_level,wo.created_at,wo.updated_at,
            primary_assignment.principal_id,primary_assignment.person_ref,primary_assignment.org_unit_id,primary_assignment.routing_policy_code,
            EXISTS (
              SELECT 1 FROM work_order_execution_attempts attempt
               WHERE attempt.work_order_id=wo.id AND attempt.execution_mode='automatic' AND attempt.status='created'
            ) AS automatic_created,
            EXISTS (
              SELECT 1 FROM work_order_execution_attempts attempt
               JOIN work_order_assignments assigned ON assigned.work_order_id=attempt.work_order_id
                AND assigned.role='primary' AND assigned.status='active'
                AND NULLIF(BTRIM(assigned.routing_policy_code),'') IS NOT NULL
               WHERE attempt.work_order_id=wo.id AND attempt.execution_mode='automatic' AND attempt.status='created'
            ) AS automatic_assigned,
            latest_decision.id AS decision_id,latest_decision.decision_mode,latest_decision.outcome AS decision_outcome,
            latest_decision.status AS decision_status,latest_decision.confidence AS decision_confidence,latest_decision.created_at AS decision_created_at
       FROM work_orders wo
       LEFT JOIN work_order_templates wt ON wt.id=wo.template_id
       LEFT JOIN LATERAL (
         SELECT principal_id,person_ref,org_unit_id,routing_policy_code FROM work_order_assignments
          WHERE work_order_id=wo.id AND role='primary' AND status='active'
          ORDER BY effective_from DESC LIMIT 1
       ) primary_assignment ON true
       LEFT JOIN LATERAL (
         SELECT id,decision_mode,outcome,status,confidence,created_at FROM work_order_decisions
          WHERE work_order_id=wo.id OR id=wo.decision_id OR id=wo.latest_decision_id ORDER BY created_at DESC LIMIT 1
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
    automatic_created: Boolean(row.automatic_created),
    automatic_assigned: Boolean(row.automatic_assigned),
    creation_mode: row.automatic_created ? "automatic" : "manual",
    assignment_origin: row.automatic_assigned ? "automatic" : row.principal_id ? "manual_or_unverified" : "unassigned",
    routing_policy_code: row.routing_policy_code,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
    primary_assignee: row.principal_id ? { principal_id: row.principal_id, person_ref: row.person_ref, org_unit_id: row.org_unit_id } : null,
    latest_decision: row.decision_id ? {
      id: row.decision_id, decision_mode: String(row.decision_mode), outcome: String(row.decision_outcome), status: String(row.decision_status),
      confidence: row.decision_confidence == null ? null : Number(row.decision_confidence), created_at: new Date(String(row.decision_created_at)).toISOString(),
    } : null,
  }));
  const verified = await postgresPool().query<{
    id: string; event_type: string; occurred_at: Date | string; summary: string; evidence_ref: string; verified_by: string; verified_at: Date | string;
  }>(
    `SELECT id,event_type,occurred_at,summary,evidence_ref,verified_by,verified_at
       FROM work_order_verified_events
      WHERE task_id=$1
      ORDER BY occurred_at DESC,id DESC
      LIMIT 50`,
    [task.task_id],
  );
  const verifiedEvents = verified.rows.map<WorkOrderVerifiedEventSummary>((row) => ({
    id: row.id, event_type: row.event_type, occurred_at: new Date(row.occurred_at).toISOString(), summary: row.summary,
    evidence_ref: row.evidence_ref, verified_by: row.verified_by, verified_at: new Date(row.verified_at).toISOString(),
  }));
  const blocked = workOrders.filter((order) => ["needs_review", "pending_assignment", "waiting_external", "waiting_approval"].includes(order.status));
  return {
    task,
    work_orders: workOrders,
    verified_events: verifiedEvents,
    counts: {
      total: workOrders.length,
      open: workOrders.filter((order) => OPEN_WORK_ORDER_STATUSES.has(order.status)).length,
      blocked: blocked.length,
      waiting_review: workOrders.filter((order) => order.status === "needs_review").length,
      completed: workOrders.filter((order) => order.status === "completed").length,
      automatic_created: workOrders.filter((order) => order.automatic_created).length,
      automatic_assigned: workOrders.filter((order) => order.automatic_assigned).length,
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
        AND (t.collaboration_id IS NULL OR EXISTS (SELECT 1 FROM collaborations c JOIN users u ON u.id=$4 AND u.active=1
          WHERE c.id=t.collaboration_id AND u.brands::jsonb ? c.brand))
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

export type DashboardPeriod = "realtime" | "today" | "week" | "month" | "year";
export const DASHBOARD_PERIODS: DashboardPeriod[] = ["realtime", "today", "week", "month", "year"];
export type DashboardMetricKey = "total" | "in_progress" | "completion_rate" | "overdue_rate" | "automatic_rate" | "median_processing_hours";
export type DashboardMetrics = Record<DashboardMetricKey, number | null> & {
  overdue: number;
  blocked: number;
};

export type TaskWorkOrderDashboard = {
  report_version: "task-work-order-dashboard.v2.1";
  period: DashboardPeriod;
  as_of: string;
  timezone: string;
  scope: "personal_authorized" | "organization_authorized";
  source: "postgresql_task_work_orders";
  summary: {
    tasks: { total: number; open: number; blocked: number; waiting_review: number; completed: number };
    work_orders: TaskWorkOrderCounts;
  };
  metrics: DashboardMetrics;
  comparison: { previous: DashboardMetrics; deltas: Record<DashboardMetricKey, number | null> } | null;
  trends: Record<DashboardMetricKey, number[]>;
  by_template: Array<{
    template_code: string;
    template_version: number;
    template_title: string;
    automation_level: string;
    total: number;
    automatic_created: number;
    automatic_assigned: number;
    open: number;
    blocked: number;
    waiting_review: number;
    completed: number;
    period_completed: number;
    trend: number[];
  }>;
  tasks: {
    items: Array<{
      task: TaskRoot;
      counts: TaskWorkOrderCounts;
      template_codes: string[];
      current_blocking_work_order: TaskWorkOrderCompact | null;
      next_work_order: TaskWorkOrderCompact | null;
    }>;
    page: { limit: number; next_cursor: string | null; total: number };
  };
};

export type TaskWorkOrderDashboardExportRow = {
  task_title: string;
  type: "业务任务";
  status: string;
  template: string;
  assignee: string;
  created_at: string | null;
  completed_at: string | null;
};

type DashboardOptions = {
  limit?: number;
  cursor?: string | null;
  timezone?: string | null;
  period?: string | null;
  q?: string | null;
  template?: string | null;
  status?: string | null;
};

function dashboardLimit(value: number | undefined): number {
  if (value == null) return 50;
  if (!Number.isFinite(value) || value < 1) throw new HttpFail(400, "invalid dashboard limit");
  return Math.max(1, Math.min(100, Math.floor(value)));
}

function dashboardOffset(cursor: string | null | undefined): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { offset?: unknown };
    const offset = Number(parsed.offset);
    if (!Number.isInteger(offset) || offset < 0 || offset > 100_000) throw new Error("invalid offset");
    return offset;
  } catch {
    throw new HttpFail(400, "invalid dashboard cursor");
  }
}

function nextDashboardCursor(offset: number, limit: number, total: number): string | null {
  if (offset + limit >= total) return null;
  return Buffer.from(JSON.stringify({ offset: offset + limit }), "utf8").toString("base64url");
}

function jsonObject<T>(value: unknown): T {
  return value && typeof value === "object" && !Array.isArray(value) ? value as T : {} as T;
}

function jsonArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

export function dashboardPeriod(value?: unknown): DashboardPeriod {
  const period = String(value ?? "realtime").trim() || "realtime";
  if (!DASHBOARD_PERIODS.includes(period as DashboardPeriod)) {
    throw new HttpFail(400, { code: "invalid_dashboard_period", period, supported: DASHBOARD_PERIODS });
  }
  return period as DashboardPeriod;
}

function dashboardText(value: unknown, max = 200): string {
  return String(value ?? "").trim().slice(0, max);
}

function dashboardMetric(value: unknown): DashboardMetrics {
  const input = jsonObject<Record<string, unknown>>(value);
  const numberOrNull = (key: DashboardMetricKey) => {
    const raw = input[key];
    if (raw == null || raw === "") return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const count = (key: "overdue" | "blocked") => {
    const parsed = Number(input[key]);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return {
    total: numberOrNull("total") ?? 0,
    in_progress: numberOrNull("in_progress") ?? 0,
    completion_rate: numberOrNull("completion_rate"),
    overdue_rate: numberOrNull("overdue_rate"),
    automatic_rate: numberOrNull("automatic_rate"),
    median_processing_hours: numberOrNull("median_processing_hours"),
    overdue: count("overdue"),
    blocked: count("blocked"),
  };
}

export function dashboardDeltas(current: DashboardMetrics, previous: DashboardMetrics): Record<DashboardMetricKey, number | null> {
  const rateKeys = new Set<DashboardMetricKey>(["completion_rate", "overdue_rate", "automatic_rate"]);
  return (["total", "in_progress", "completion_rate", "overdue_rate", "automatic_rate", "median_processing_hours"] as DashboardMetricKey[])
    .reduce<Record<DashboardMetricKey, number | null>>((result, key) => {
      const next = current[key];
      const before = previous[key];
      const duration = key === "median_processing_hours";
      result[key] = next == null || before == null || (!rateKeys.has(key) && !duration && before === 0)
        ? null
        : Number((duration ? next - before : rateKeys.has(key) ? next - before : ((next - before) / before) * 100).toFixed(duration ? 1 : 2));
      return result;
    }, {} as Record<DashboardMetricKey, number | null>);
}

export function dashboardTrendPointCount(period: DashboardPeriod): number {
  if (period === "today") return 24;
  if (period === "week") return 7;
  if (period === "month") return 30;
  if (period === "year") return 12;
  return 7;
}

function normalizedTrends(value: unknown, period: DashboardPeriod): Record<DashboardMetricKey, number[]> {
  const expected = dashboardTrendPointCount(period);
  const data = jsonObject<Record<string, unknown>>(value);
  return (["total", "in_progress", "completion_rate", "overdue_rate", "automatic_rate", "median_processing_hours"] as DashboardMetricKey[])
    .reduce<Record<DashboardMetricKey, number[]>>((result, key) => {
      const values = jsonArray<unknown>(data[key]).map((point) => Number(point)).map((point) => Number.isFinite(point) ? point : 0);
      result[key] = values.length === expected ? values : [...values.slice(0, expected), ...Array.from({ length: Math.max(0, expected - values.length) }, () => 0)];
      return result;
    }, {} as Record<DashboardMetricKey, number[]>);
}

const DASHBOARD_SCOPE_CTES = `
  bounds AS (
    SELECT now() AS as_of,
      CASE $7::text
        WHEN 'today' THEN date_trunc('day', now() AT TIME ZONE $8) AT TIME ZONE $8
        WHEN 'week' THEN date_trunc('week', now() AT TIME ZONE $8) AT TIME ZONE $8
        WHEN 'month' THEN date_trunc('month', now() AT TIME ZONE $8) AT TIME ZONE $8
        WHEN 'year' THEN date_trunc('year', now() AT TIME ZONE $8) AT TIME ZONE $8
        ELSE NULL::timestamptz
      END AS current_start,
      CASE $7::text
        WHEN 'today' THEN (date_trunc('day', now() AT TIME ZONE $8) + interval '1 day') AT TIME ZONE $8
        WHEN 'week' THEN (date_trunc('week', now() AT TIME ZONE $8) + interval '1 week') AT TIME ZONE $8
        WHEN 'month' THEN (date_trunc('month', now() AT TIME ZONE $8) + interval '1 month') AT TIME ZONE $8
        WHEN 'year' THEN (date_trunc('year', now() AT TIME ZONE $8) + interval '1 year') AT TIME ZONE $8
        ELSE NULL::timestamptz
      END AS current_end,
      CASE $7::text
        WHEN 'today' THEN (date_trunc('day', now() AT TIME ZONE $8) - interval '1 day') AT TIME ZONE $8
        WHEN 'week' THEN (date_trunc('week', now() AT TIME ZONE $8) - interval '1 week') AT TIME ZONE $8
        WHEN 'month' THEN (date_trunc('month', now() AT TIME ZONE $8) - interval '1 month') AT TIME ZONE $8
        WHEN 'year' THEN (date_trunc('year', now() AT TIME ZONE $8) - interval '1 year') AT TIME ZONE $8
        ELSE NULL::timestamptz
      END AS previous_start,
      CASE $7::text
        WHEN 'today' THEN date_trunc('day', now() AT TIME ZONE $8) AT TIME ZONE $8
        WHEN 'week' THEN date_trunc('week', now() AT TIME ZONE $8) AT TIME ZONE $8
        WHEN 'month' THEN date_trunc('month', now() AT TIME ZONE $8) AT TIME ZONE $8
        WHEN 'year' THEN date_trunc('year', now() AT TIME ZONE $8) AT TIME ZONE $8
        ELSE NULL::timestamptz
      END AS previous_end
  ), authorized_task_scope AS MATERIALIZED (
    SELECT t.id AS task_id,t.title,COALESCE(NULLIF(t.content,''),t.title) AS goal,
      t.status,t.priority,t.due_at,t.data_version,t.created_at,t.updated_at,t.completed_at,
      NULLIF(t.created_at,'')::timestamptz AS created_at_ts,
      NULLIF(t.updated_at,'')::timestamptz AS updated_at_ts,
      NULLIF(t.completed_at,'')::timestamptz AS completed_at_ts,
      NULLIF(t.due_at,'')::timestamptz AS due_at_ts,
      t.status NOT IN ('completed','cancelled','canceled') AS task_is_open,
      t.status NOT IN ('completed','cancelled','canceled')
        AND t.status NOT IN ('open','queued','pending') AS task_is_in_progress
    FROM tickets t
    WHERE t.task_type=$1 AND t.profile=$2
      AND (t.collaboration_id IS NULL OR EXISTS (
        SELECT 1 FROM collaborations c JOIN users u ON u.id=$4 AND u.active=1
        WHERE c.id=t.collaboration_id AND u.brands::jsonb ? c.brand
      ))
      AND ($3::boolean OR t.owner_user_id=$4 OR EXISTS (
        SELECT 1 FROM work_orders access_wo JOIN work_order_assignments access_wa ON access_wa.work_order_id=access_wo.id
        WHERE access_wo.task_id=t.id AND access_wa.principal_id=$4 AND access_wa.status='active'
      ))
      AND ($9::text='' OR t.title ILIKE ('%' || $9 || '%') OR COALESCE(t.content,'') ILIKE ('%' || $9 || '%') OR EXISTS (
        SELECT 1 FROM work_orders search_wo LEFT JOIN work_order_templates search_template ON search_template.id=search_wo.template_id
        WHERE search_wo.task_id=t.id AND (search_wo.title ILIKE ('%' || $9 || '%') OR COALESCE(search_template.title,'') ILIKE ('%' || $9 || '%'))
      ))
      AND ($10::text='' OR EXISTS (SELECT 1 FROM work_orders selected_template WHERE selected_template.task_id=t.id AND selected_template.template_code=$10))
      AND ($11::text='' OR t.status=$11)
  ), authorized_tasks AS MATERIALIZED (
    SELECT scope.* FROM authorized_task_scope scope CROSS JOIN bounds
    WHERE $7::text='realtime' OR (
      (scope.created_at_ts >= bounds.current_start AND scope.created_at_ts < bounds.current_end)
      OR (scope.completed_at_ts >= bounds.current_start AND scope.completed_at_ts < bounds.current_end)
    )
  ), previous_authorized_tasks AS MATERIALIZED (
    SELECT scope.* FROM authorized_task_scope scope CROSS JOIN bounds
    WHERE $7::text<>'realtime' AND (
      (scope.created_at_ts >= bounds.previous_start AND scope.created_at_ts < bounds.previous_end)
      OR (scope.completed_at_ts >= bounds.previous_start AND scope.completed_at_ts < bounds.previous_end)
    )
  ), current_completed_tasks AS MATERIALIZED (
    SELECT scope.* FROM authorized_task_scope scope CROSS JOIN bounds
    WHERE scope.completed_at_ts IS NOT NULL AND ($7::text='realtime' OR (
      scope.completed_at_ts >= bounds.current_start AND scope.completed_at_ts < bounds.current_end
    ))
  ), previous_completed_tasks AS MATERIALIZED (
    SELECT scope.* FROM authorized_task_scope scope CROSS JOIN bounds
    WHERE scope.completed_at_ts IS NOT NULL AND $7::text<>'realtime'
      AND scope.completed_at_ts >= bounds.previous_start AND scope.completed_at_ts < bounds.previous_end
  ), work_order_scope AS MATERIALIZED (
    SELECT wo.id,wo.task_id,wo.template_code,wo.template_version,COALESCE(wt.title,wo.template_code) AS template_title,
      wo.status,wo.priority,wo.stage_code,wo.title,wo.objective,wo.due_at,COALESCE(wt.automation_level,wo.automation_level) AS automation_level,
      wo.created_at,wo.updated_at,wo.completed_at,wo.completed_at AS completed_at_ts,
      primary_assignment.principal_id,primary_assignment.person_ref,primary_assignment.org_unit_id,primary_assignment.routing_policy_code,
      EXISTS (SELECT 1 FROM work_order_execution_attempts attempt WHERE attempt.work_order_id=wo.id AND attempt.execution_mode='automatic' AND attempt.status='created') AS automatic_created,
      EXISTS (
        SELECT 1 FROM work_order_execution_attempts attempt JOIN work_order_assignments assigned ON assigned.work_order_id=attempt.work_order_id
          AND assigned.role='primary' AND assigned.status='active' AND NULLIF(BTRIM(assigned.routing_policy_code),'') IS NOT NULL
        WHERE attempt.work_order_id=wo.id AND attempt.execution_mode='automatic' AND attempt.status='created'
      ) AS automatic_assigned,
      wo.status IN ('proposed','pending_assignment','assigned','accepted','in_progress','waiting_external','waiting_approval','ready_for_acceptance','needs_review') AS is_open,
      wo.status IN ('needs_review','pending_assignment','waiting_external','waiting_approval') AS is_blocked,
      wo.status='needs_review' AS is_waiting_review,
      wo.status='completed' AS is_completed
    FROM work_orders wo
    JOIN authorized_task_scope task ON task.task_id=wo.task_id
    LEFT JOIN work_order_templates wt ON wt.id=wo.template_id
    LEFT JOIN LATERAL (
      SELECT principal_id,person_ref,org_unit_id,routing_policy_code FROM work_order_assignments
      WHERE work_order_id=wo.id AND role='primary' AND status='active' ORDER BY effective_from DESC,id DESC LIMIT 1
    ) primary_assignment ON true
  ), work_order_facts AS MATERIALIZED (
    SELECT scope.* FROM work_order_scope scope JOIN authorized_tasks task ON task.task_id=scope.task_id
    WHERE $10::text='' OR scope.template_code=$10
  ), previous_work_order_facts AS MATERIALIZED (
    SELECT scope.* FROM work_order_scope scope JOIN previous_authorized_tasks task ON task.task_id=scope.task_id
    WHERE $10::text='' OR scope.template_code=$10
  ), task_facts AS MATERIALIZED (
    SELECT task.*,COUNT(work_order.id)::int AS total,
      COUNT(work_order.id) FILTER (WHERE work_order.is_open)::int AS open,
      COUNT(work_order.id) FILTER (WHERE work_order.is_blocked)::int AS blocked,
      COUNT(work_order.id) FILTER (WHERE work_order.is_waiting_review)::int AS waiting_review,
      COUNT(work_order.id) FILTER (WHERE work_order.is_completed)::int AS completed,
      COUNT(work_order.id) FILTER (WHERE work_order.automatic_created)::int AS automatic_created,
      COUNT(work_order.id) FILTER (WHERE work_order.automatic_assigned)::int AS automatic_assigned
    FROM authorized_tasks task LEFT JOIN work_order_facts work_order ON work_order.task_id=task.task_id
    GROUP BY task.task_id,task.title,task.goal,task.status,task.priority,task.due_at,task.data_version,task.created_at,task.updated_at,task.completed_at,
      task.created_at_ts,task.updated_at_ts,task.completed_at_ts,task.due_at_ts,task.task_is_open,task.task_is_in_progress
  ), previous_task_facts AS MATERIALIZED (
    SELECT task.*,COUNT(work_order.id)::int AS total,
      COUNT(work_order.id) FILTER (WHERE work_order.is_open)::int AS open,
      COUNT(work_order.id) FILTER (WHERE work_order.is_blocked)::int AS blocked,
      COUNT(work_order.id) FILTER (WHERE work_order.is_waiting_review)::int AS waiting_review,
      COUNT(work_order.id) FILTER (WHERE work_order.is_completed)::int AS completed,
      COUNT(work_order.id) FILTER (WHERE work_order.automatic_created)::int AS automatic_created,
      COUNT(work_order.id) FILTER (WHERE work_order.automatic_assigned)::int AS automatic_assigned
    FROM previous_authorized_tasks task LEFT JOIN previous_work_order_facts work_order ON work_order.task_id=task.task_id
    GROUP BY task.task_id,task.title,task.goal,task.status,task.priority,task.due_at,task.data_version,task.created_at,task.updated_at,task.completed_at,
      task.created_at_ts,task.updated_at_ts,task.completed_at_ts,task.due_at_ts,task.task_is_open,task.task_is_in_progress
  )`;

/** PostgreSQL-native operating dashboard for the business-task → work-order
 * hierarchy. Every aggregate and export starts from the same authorization CTE. */
export async function taskWorkOrderDashboard(
  actorId: string,
  isAdmin = false,
  options: DashboardOptions = {},
): Promise<TaskWorkOrderDashboard> {
  const limit = dashboardLimit(options.limit);
  const offset = dashboardOffset(options.cursor);
  const timezone = String(options.timezone || "Asia/Shanghai").trim() || "Asia/Shanghai";
  const period = dashboardPeriod(options.period);
  const q = dashboardText(options.q);
  const template = dashboardText(options.template, 120);
  const status = dashboardText(options.status, 80);
  const values = [TASK_TYPE, TASK_PROFILE, isAdmin, actorId, limit, offset, period, timezone, q, template, status];
  const result = await postgresPool().query<{
    as_of: Date | string;
    summary: unknown;
    metrics: unknown;
    previous_metrics: unknown;
    trends: unknown;
    by_template: unknown;
    items: unknown;
    total: number | string;
  }>(
    `WITH ${DASHBOARD_SCOPE_CTES}, task_page AS MATERIALIZED (
       SELECT * FROM task_facts
       ORDER BY CASE WHEN waiting_review>0 THEN 0 WHEN blocked>0 THEN 1 ELSE 2 END,due_at_ts NULLS LAST,updated_at_ts DESC,task_id DESC
       LIMIT $5 OFFSET $6
     ), task_page_with_refs AS (
       SELECT page.*,blocking.work_order AS current_blocking_work_order,next_open.work_order AS next_work_order
       FROM task_page page
       LEFT JOIN LATERAL (
         SELECT jsonb_build_object(
           'work_order_id',work_order.id,'template_code',work_order.template_code,'template_version',work_order.template_version,
           'template_title',work_order.template_title,'status',work_order.status,'stage_code',work_order.stage_code,
           'title',work_order.title,'automation_level',work_order.automation_level,'automatic_created',work_order.automatic_created,
           'automatic_assigned',work_order.automatic_assigned,'creation_mode',CASE WHEN work_order.automatic_created THEN 'automatic' ELSE 'manual' END,
           'assignment_origin',CASE WHEN work_order.automatic_assigned THEN 'automatic' WHEN work_order.principal_id IS NOT NULL THEN 'manual_or_unverified' ELSE 'unassigned' END,
           'routing_policy_code',work_order.routing_policy_code,'primary_assignee',CASE WHEN work_order.principal_id IS NULL THEN NULL ELSE jsonb_build_object(
             'principal_id',work_order.principal_id,'person_ref',work_order.person_ref,'org_unit_id',work_order.org_unit_id) END
         ) AS work_order FROM work_order_facts work_order
         WHERE work_order.task_id=page.task_id AND work_order.is_blocked
         ORDER BY CASE work_order.status WHEN 'needs_review' THEN 0 WHEN 'pending_assignment' THEN 1 WHEN 'waiting_approval' THEN 2 ELSE 3 END,work_order.due_at NULLS LAST,work_order.id DESC LIMIT 1
       ) blocking ON true
       LEFT JOIN LATERAL (
         SELECT jsonb_build_object(
           'work_order_id',work_order.id,'template_code',work_order.template_code,'template_version',work_order.template_version,
           'template_title',work_order.template_title,'status',work_order.status,'stage_code',work_order.stage_code,
           'title',work_order.title,'automation_level',work_order.automation_level,'automatic_created',work_order.automatic_created,
           'automatic_assigned',work_order.automatic_assigned,'creation_mode',CASE WHEN work_order.automatic_created THEN 'automatic' ELSE 'manual' END,
           'assignment_origin',CASE WHEN work_order.automatic_assigned THEN 'automatic' WHEN work_order.principal_id IS NOT NULL THEN 'manual_or_unverified' ELSE 'unassigned' END,
           'routing_policy_code',work_order.routing_policy_code,'primary_assignee',CASE WHEN work_order.principal_id IS NULL THEN NULL ELSE jsonb_build_object(
             'principal_id',work_order.principal_id,'person_ref',work_order.person_ref,'org_unit_id',work_order.org_unit_id) END
         ) AS work_order FROM work_order_facts work_order
         WHERE work_order.task_id=page.task_id AND work_order.is_open
         ORDER BY work_order.due_at NULLS LAST,work_order.updated_at DESC,work_order.id DESC LIMIT 1
       ) next_open ON true
     ), metric_current AS (
       SELECT jsonb_build_object(
         'total',COUNT(*)::int,'in_progress',COUNT(*) FILTER (WHERE task_is_in_progress)::int,
         'completion_rate',CASE WHEN COUNT(*)=0 THEN NULL ELSE ROUND((100.0*COUNT(*) FILTER (WHERE status='completed')/COUNT(*))::numeric,2) END,
         'overdue_rate',CASE WHEN COUNT(*)=0 THEN NULL ELSE ROUND((100.0*COUNT(*) FILTER (WHERE due_at_ts<bounds.as_of AND task_is_open)/COUNT(*))::numeric,2) END,
         'automatic_rate',CASE WHEN (SELECT COUNT(*) FROM work_order_facts)=0 THEN NULL ELSE ROUND((100.0*(SELECT COUNT(*) FILTER (WHERE automatic_created) FROM work_order_facts)/(SELECT COUNT(*) FROM work_order_facts))::numeric,2) END,
         'median_processing_hours',(SELECT ROUND((percentile_cont(.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at_ts-created_at_ts))/3600))::numeric,2) FROM current_completed_tasks),
         'overdue',COUNT(*) FILTER (WHERE due_at_ts<bounds.as_of AND task_is_open)::int,
         'blocked',COUNT(*) FILTER (WHERE blocked>0)::int
       ) AS value FROM task_facts CROSS JOIN bounds
     ), metric_previous AS (
       SELECT jsonb_build_object(
         'total',COUNT(*)::int,'in_progress',COUNT(*) FILTER (WHERE task_is_in_progress)::int,
         'completion_rate',CASE WHEN COUNT(*)=0 THEN NULL ELSE ROUND((100.0*COUNT(*) FILTER (WHERE status='completed')/COUNT(*))::numeric,2) END,
         'overdue_rate',CASE WHEN COUNT(*)=0 THEN NULL ELSE ROUND((100.0*COUNT(*) FILTER (WHERE due_at_ts<bounds.previous_end AND task_is_open)/COUNT(*))::numeric,2) END,
         'automatic_rate',CASE WHEN (SELECT COUNT(*) FROM previous_work_order_facts)=0 THEN NULL ELSE ROUND((100.0*(SELECT COUNT(*) FILTER (WHERE automatic_created) FROM previous_work_order_facts)/(SELECT COUNT(*) FROM previous_work_order_facts))::numeric,2) END,
         'median_processing_hours',(SELECT ROUND((percentile_cont(.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at_ts-created_at_ts))/3600))::numeric,2) FROM previous_completed_tasks),
         'overdue',COUNT(*) FILTER (WHERE due_at_ts<bounds.previous_end AND task_is_open)::int,
         'blocked',COUNT(*) FILTER (WHERE blocked>0)::int
       ) AS value FROM previous_task_facts CROSS JOIN bounds
     ), trend_buckets AS (
       SELECT bucket_start,CASE WHEN $7::text='today' THEN LEAST(bucket_start+interval '1 hour',bounds.current_end)
           WHEN $7::text='year' THEN LEAST(bucket_start+interval '1 month',bounds.current_end)
           ELSE LEAST(bucket_start+interval '1 day',COALESCE(bounds.current_end,bounds.as_of)) END AS bucket_end
       FROM bounds CROSS JOIN LATERAL generate_series(
         CASE WHEN $7::text='realtime' THEN (date_trunc('day',bounds.as_of AT TIME ZONE $8)-interval '6 days') AT TIME ZONE $8 ELSE bounds.current_start END,
         CASE WHEN $7::text='realtime' THEN date_trunc('day',bounds.as_of AT TIME ZONE $8) AT TIME ZONE $8
              WHEN $7::text='today' THEN bounds.current_end-interval '1 hour'
              WHEN $7::text='year' THEN bounds.current_end-interval '1 month'
              ELSE bounds.current_end-interval '1 day' END,
         CASE WHEN $7::text='today' THEN interval '1 hour' WHEN $7::text='year' THEN interval '1 month' ELSE interval '1 day' END
       ) AS bucket_start
     ), trend_points AS (
       SELECT bucket.bucket_start,bucket.bucket_end,
         (SELECT COUNT(*)::int FROM authorized_task_scope task
           WHERE (task.created_at_ts>=bucket.bucket_start AND task.created_at_ts<bucket.bucket_end)
              OR (task.completed_at_ts>=bucket.bucket_start AND task.completed_at_ts<bucket.bucket_end)) AS total,
         (SELECT COUNT(*)::int FROM authorized_task_scope task
           WHERE task.task_is_in_progress AND (
             (task.created_at_ts>=bucket.bucket_start AND task.created_at_ts<bucket.bucket_end)
             OR (task.completed_at_ts>=bucket.bucket_start AND task.completed_at_ts<bucket.bucket_end)
           )) AS in_progress,
         (SELECT COUNT(*)::int FROM authorized_task_scope task
           WHERE task.completed_at_ts>=bucket.bucket_start AND task.completed_at_ts<bucket.bucket_end) AS completed,
         (SELECT COUNT(*)::int FROM authorized_task_scope task
           WHERE task.task_is_open AND task.created_at_ts<bucket.bucket_end
             AND task.due_at_ts<bucket.bucket_end
             AND (task.completed_at_ts IS NULL OR task.completed_at_ts>=bucket.bucket_end)) AS overdue,
         (SELECT COUNT(*)::int FROM work_order_facts work_order
           WHERE work_order.automatic_created AND work_order.created_at>=bucket.bucket_start AND work_order.created_at<bucket.bucket_end) AS automatic,
         (SELECT COUNT(*)::int FROM work_order_facts work_order
           WHERE work_order.created_at>=bucket.bucket_start AND work_order.created_at<bucket.bucket_end) AS created_work_orders,
         (SELECT percentile_cont(.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (task_completed.completed_at_ts-task_completed.created_at_ts))/3600)
            FROM authorized_task_scope task_completed
           WHERE task_completed.completed_at_ts>=bucket.bucket_start AND task_completed.completed_at_ts<bucket.bucket_end) AS median_processing_hours
       FROM trend_buckets bucket
     ), trend_metrics AS (
       SELECT jsonb_build_object(
         'total',jsonb_agg(total ORDER BY bucket_start),'in_progress',jsonb_agg(in_progress ORDER BY bucket_start),
         'completion_rate',jsonb_agg(CASE WHEN total=0 THEN 0 ELSE ROUND((100.0*completed/total)::numeric,2) END ORDER BY bucket_start),
         'overdue_rate',jsonb_agg(CASE WHEN total=0 THEN 0 ELSE ROUND((100.0*overdue/total)::numeric,2) END ORDER BY bucket_start),
         'automatic_rate',jsonb_agg(CASE WHEN created_work_orders=0 THEN 0 ELSE ROUND((100.0*automatic/created_work_orders)::numeric,2) END ORDER BY bucket_start),
         'median_processing_hours',jsonb_agg(COALESCE(ROUND(median_processing_hours::numeric,2),0) ORDER BY bucket_start)
       ) AS value FROM trend_points
     )
     SELECT (SELECT as_of FROM bounds) AS as_of,
       jsonb_build_object(
         'tasks',(SELECT jsonb_build_object('total',COUNT(*)::int,'open',COUNT(*) FILTER (WHERE task_is_open)::int,'blocked',COUNT(*) FILTER (WHERE blocked>0)::int,'waiting_review',COUNT(*) FILTER (WHERE waiting_review>0)::int,'completed',COUNT(*) FILTER (WHERE status='completed')::int) FROM task_facts),
         'work_orders',(SELECT jsonb_build_object('total',COUNT(*)::int,'open',COUNT(*) FILTER (WHERE is_open)::int,'blocked',COUNT(*) FILTER (WHERE is_blocked)::int,'waiting_review',COUNT(*) FILTER (WHERE is_waiting_review)::int,'completed',COUNT(*) FILTER (WHERE is_completed)::int,'automatic_created',COUNT(*) FILTER (WHERE automatic_created)::int,'automatic_assigned',COUNT(*) FILTER (WHERE automatic_assigned)::int) FROM work_order_facts)
       ) AS summary,
       (SELECT value FROM metric_current) AS metrics,(SELECT value FROM metric_previous) AS previous_metrics,(SELECT value FROM trend_metrics) AS trends,
       COALESCE((SELECT jsonb_agg(jsonb_build_object(
         'template_code',grouped.template_code,'template_version',grouped.template_version,'template_title',grouped.template_title,'automation_level',grouped.automation_level,
         'total',grouped.total,'automatic_created',grouped.automatic_created,'automatic_assigned',grouped.automatic_assigned,'open',grouped.open,'blocked',grouped.blocked,'waiting_review',grouped.waiting_review,'completed',grouped.completed,'period_completed',grouped.period_completed,
         'trend',COALESCE((SELECT jsonb_agg(daily.count ORDER BY daily.bucket_start) FROM (
           SELECT bucket.bucket_start,COUNT(point.id)::int AS count
           FROM trend_buckets bucket
           LEFT JOIN work_order_facts point ON point.template_code=grouped.template_code AND point.template_version=grouped.template_version
             AND point.created_at>=bucket.bucket_start AND point.created_at<bucket.bucket_end
           GROUP BY bucket.bucket_start
         ) daily),'[]'::jsonb)
       ) ORDER BY grouped.total DESC,grouped.template_title,grouped.template_version DESC) FROM (
         SELECT template_code,template_version,template_title,automation_level,COUNT(*)::int AS total,COUNT(*) FILTER (WHERE automatic_created)::int AS automatic_created,COUNT(*) FILTER (WHERE automatic_assigned)::int AS automatic_assigned,
           COUNT(*) FILTER (WHERE is_open)::int AS open,COUNT(*) FILTER (WHERE is_blocked)::int AS blocked,COUNT(*) FILTER (WHERE is_waiting_review)::int AS waiting_review,COUNT(*) FILTER (WHERE is_completed)::int AS completed,
           COUNT(*) FILTER (WHERE is_completed AND ($7::text='realtime' OR (completed_at_ts >= (SELECT current_start FROM bounds) AND completed_at_ts < (SELECT current_end FROM bounds))))::int AS period_completed
         FROM work_order_facts GROUP BY template_code,template_version,template_title,automation_level
       ) grouped),'[]'::jsonb) AS by_template,
       COALESCE((SELECT jsonb_agg(jsonb_build_object(
         'task',jsonb_build_object('task_id',task_id,'title',title,'goal',goal,'status',status,'priority',priority,'due_at',due_at,'data_version',data_version,'created_at',created_at,'updated_at',updated_at),
         'counts',jsonb_build_object('total',total,'open',open,'blocked',blocked,'waiting_review',waiting_review,'completed',completed,'automatic_created',automatic_created,'automatic_assigned',automatic_assigned),
         'template_codes',COALESCE((SELECT jsonb_agg(DISTINCT work_order.template_code) FROM work_order_facts work_order WHERE work_order.task_id=task_page_with_refs.task_id),'[]'::jsonb),
         'current_blocking_work_order',current_blocking_work_order,'next_work_order',next_work_order
       ) ORDER BY CASE WHEN waiting_review>0 THEN 0 WHEN blocked>0 THEN 1 ELSE 2 END,due_at_ts NULLS LAST,updated_at_ts DESC,task_id DESC) FROM task_page_with_refs),'[]'::jsonb) AS items,
       (SELECT COUNT(*)::int FROM task_facts) AS total`,
    values,
  );
  const row = result.rows[0] || { as_of: new Date().toISOString(), summary: {}, metrics: {}, previous_metrics: {}, trends: {}, by_template: [], items: [], total: 0 };
  const total = Number(row.total || 0);
  const metrics = dashboardMetric(row.metrics);
  const previous = dashboardMetric(row.previous_metrics);
  return {
    report_version: "task-work-order-dashboard.v2.1",
    period,
    as_of: new Date(row.as_of).toISOString(),
    timezone,
    scope: isAdmin ? "organization_authorized" : "personal_authorized",
    source: "postgresql_task_work_orders",
    summary: jsonObject<TaskWorkOrderDashboard["summary"]>(row.summary),
    metrics,
    comparison: period === "realtime" ? null : { previous, deltas: dashboardDeltas(metrics, previous) },
    trends: normalizedTrends(row.trends, period),
    by_template: jsonArray<TaskWorkOrderDashboard["by_template"][number]>(row.by_template),
    tasks: { items: jsonArray<TaskWorkOrderDashboard["tasks"]["items"][number]>(row.items), page: { limit, next_cursor: nextDashboardCursor(offset, limit, total), total } },
  };
}

export async function taskWorkOrderDashboardExport(
  actorId: string,
  isAdmin = false,
  options: DashboardOptions = {},
): Promise<TaskWorkOrderDashboardExportRow[]> {
  const period = dashboardPeriod(options.period);
  const timezone = String(options.timezone || "Asia/Shanghai").trim() || "Asia/Shanghai";
  const values = [TASK_TYPE, TASK_PROFILE, isAdmin, actorId, 100, 0, period, timezone, dashboardText(options.q), dashboardText(options.template, 120), dashboardText(options.status, 80)];
  const result = await postgresPool().query<{
    task_title: string; status: string; template: string | null; assignee: string | null; created_at: Date | string | null; completed_at: Date | string | null;
  }>(
    `WITH ${DASHBOARD_SCOPE_CTES}
     SELECT task.title AS task_title,COALESCE(work_order.status,task.status) AS status,
       COALESCE(work_order.template_title,'') AS template,COALESCE(work_order.person_ref,work_order.principal_id,'') AS assignee,
       task.created_at_ts AS created_at,COALESCE(work_order.completed_at,task.completed_at_ts) AS completed_at
     FROM authorized_tasks task LEFT JOIN work_order_facts work_order ON work_order.task_id=task.task_id
     ORDER BY task.updated_at_ts DESC,task.task_id DESC,work_order.template_title NULLS LAST`,
    values,
  );
  return result.rows.map((row) => ({
    task_title: row.task_title,
    type: "业务任务" as const,
    status: row.status,
    template: row.template || "",
    assignee: row.assignee || "",
    created_at: row.created_at == null ? null : new Date(row.created_at).toISOString(),
    completed_at: row.completed_at == null ? null : new Date(row.completed_at).toISOString(),
  }));
}

/** Stable idempotency input fingerprint for the forthcoming Jev shadow judge.
 * It is intentionally exported so decisions and executor use one canonical key. */
export function workOrderDecisionInputHash(input: unknown): string {
  return fingerprint(input);
}
