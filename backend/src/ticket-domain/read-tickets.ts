import { HttpFail } from "../host/errors.js";
import { postgresPool } from "../postgres/pool.js";

export type TicketCenterView = "authorized" | "created" | "assigned" | "watching" | "completed";

export type NativeTicketListItem = {
  id: string;
  title: string;
  goal: string | null;
  status: string;
  priority: string;
  business_category: string | null;
  stage_group: string | null;
  stage_code: string | null;
  due_at: string | null;
  no_due_reason: string | null;
  data_version: number;
  created_at: string;
  updated_at: string;
  owner_user_id: string;
  assignee_person_ref: string | null;
  assignee_user_id: string | null;
  assignee_org_unit_id: string | null;
  company_id: string | null;
  org_version: number | null;
  accepted_at: string | null;
  allowed_actions: string[];
};

type TicketRow = Omit<NativeTicketListItem, "allowed_actions">;

type Cursor = { updated_at: string; id: string };

const VIEWS = new Set<TicketCenterView>(["authorized", "created", "assigned", "watching", "completed"]);
const STATUS = new Set(["pending", "accepted", "in_progress", "waiting", "waiting_approval", "completed", "cancelled", "failed"]);
const PRIORITY = new Set(["important_urgent", "important", "urgent", "normal", "low"]);

function parseCsv(value: string | undefined, accepted: Set<string>, field: string): string[] {
  if (!value?.trim()) return [];
  const items = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (!items.length || items.some((item) => !accepted.has(item))) throw new HttpFail(400, { code: `invalid_${field}` });
  return items;
}

function parseLimit(value: string | undefined): number {
  const limit = Number(value || 50);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new HttpFail(400, { code: "invalid_limit" });
  return limit;
}

function decodeCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const decoded = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Cursor;
    if (!decoded?.updated_at || !decoded?.id) throw new Error("invalid");
    return decoded;
  } catch {
    throw new HttpFail(400, { code: "invalid_cursor" });
  }
}

function encodeCursor(row: TicketRow): string {
  return Buffer.from(JSON.stringify({ updated_at: row.updated_at, id: row.id })).toString("base64url");
}

function allowedActions(row: TicketRow, userId: string): string[] {
  const creator = row.owner_user_id === userId;
  const primary = row.assignee_user_id === userId;
  const result: string[] = [];
  if (creator && row.status === "pending") result.push("edit", "cancel");
  if (primary && row.status === "pending") result.push("accept");
  if (primary && ["accepted", "in_progress", "waiting"].includes(row.status)) result.push("complete", "request_update");
  if (creator && row.status === "completed") result.push("reopen");
  return result;
}

/**
 * Native PostgreSQL read model for the employee ticket centre. The authorization
 * relation is evaluated by the database before pagination and no historical
 * SQLite record is consulted or used as a fallback.
 */
export async function listNativeTickets(userId: string, query: Record<string, string | undefined>) {
  const view = String(query.view || "authorized") as TicketCenterView;
  if (!VIEWS.has(view)) throw new HttpFail(400, { code: "invalid_view" });
  const limit = parseLimit(query.limit);
  const cursor = decodeCursor(query.cursor);
  const params: unknown[] = [userId];
  const where: string[] = ["t.task_type='manual_ticket'", "t.profile='ticket-workbench'"];

  const relation = {
    created: "t.owner_user_id=$1",
    assigned: "pa.assignee_user_id=$1",
    watching: "EXISTS (SELECT 1 FROM ticket_watchers tw WHERE tw.ticket_id=t.id AND tw.watcher_user_id=$1 AND tw.status='active')",
    completed: "(pa.assignee_user_id=$1 OR t.owner_user_id=$1 OR EXISTS (SELECT 1 FROM ticket_watchers tw WHERE tw.ticket_id=t.id AND tw.watcher_user_id=$1 AND tw.status='active')) AND ta.ticket_id IS NOT NULL",
    authorized: "(t.owner_user_id=$1 OR pa.assignee_user_id=$1 OR EXISTS (SELECT 1 FROM ticket_watchers tw WHERE tw.ticket_id=t.id AND tw.watcher_user_id=$1 AND tw.status='active'))",
  } as const;
  where.push(relation[view]);

  const statuses = parseCsv(query.status, STATUS, "status");
  if (statuses.length) { params.push(statuses); where.push(`t.status = ANY($${params.length}::text[])`); }
  const priorities = parseCsv(query.priority, PRIORITY, "priority");
  if (priorities.length) { params.push(priorities); where.push(`t.priority = ANY($${params.length}::text[])`); }
  for (const [key, column] of [["category", "t.business_category"], ["stage", "t.stage_code"], ["org_unit", "tos.assignee_unit_id"], ["assignee", "pa.assignee_user_id"]] as const) {
    const value = String(query[key] || "").trim();
    if (value) { params.push(value); where.push(`${column}=$${params.length}`); }
  }
  const search = String(query.q || "").trim();
  if (search) { params.push(`%${search.slice(0, 160)}%`); where.push(`(t.title ILIKE $${params.length} OR COALESCE(t.goal,'') ILIKE $${params.length})`); }
  for (const [key, operator, suffix] of [["from", ">=", "T00:00:00.000Z"], ["to", "<=", "T23:59:59.999Z"]] as const) {
    const value = String(query[key] || "").trim();
    if (!value) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HttpFail(400, { code: `invalid_${key}` });
    params.push(`${value}${suffix}`);
    where.push(`t.created_at ${operator} $${params.length}`);
  }
  const due = String(query.due || "").trim();
  if (due === "overdue") where.push("NULLIF(t.due_at,'')::timestamptz < now() AND t.status NOT IN ('completed','cancelled')");
  else if (due === "none") where.push("t.due_at IS NULL");
  else if (due && due !== "all") throw new HttpFail(400, { code: "invalid_due" });
  if (cursor) { params.push(cursor.updated_at, cursor.id); where.push(`(t.updated_at < $${params.length - 1} OR (t.updated_at = $${params.length - 1} AND t.id < $${params.length}))`); }
  params.push(limit + 1);

  const result = await postgresPool().query<TicketRow>(
    `SELECT t.id,t.title,t.goal,t.status,t.priority,t.business_category,t.stage_group,t.stage_code,t.due_at,t.no_due_reason,
            t.data_version,t.created_at,t.updated_at,t.owner_user_id,
            pa.assignee_person_ref,pa.assignee_user_id,pa.org_unit_id AS assignee_org_unit_id,
            tos.company_id,tos.org_version,ta.accepted_at
     FROM tickets t
     LEFT JOIN LATERAL (
       SELECT assignee_person_ref,assignee_user_id,org_unit_id FROM ticket_assignments
       WHERE ticket_id=t.id AND status='active' AND role='primary' ORDER BY assignment_version DESC LIMIT 1
     ) pa ON true
     LEFT JOIN ticket_org_scopes tos ON tos.ticket_id=t.id
     LEFT JOIN ticket_acceptances ta ON ta.ticket_id=t.id
     WHERE ${where.join(" AND ")}
     ORDER BY t.updated_at DESC,t.id DESC LIMIT $${params.length}`,
    params,
  );
  const hasMore = result.rows.length > limit;
  const page = result.rows.slice(0, limit);
  return {
    items: page.map((row) => ({
      ...row,
      ticket_id: row.id,
      description: row.goal,
      content: row.goal,
      source: "manual",
      skill: "ticket_form",
      profile: "ticket-workbench",
      missing_fields: [],
      source_refs: [{ type: "postgresql_ticket", id: row.id, org_version: row.org_version }],
      allowed_actions: allowedActions(row, userId),
    })),
    page: { limit, next_cursor: hasMore && page.length ? encodeCursor(page.at(-1)!) : null },
    source_refs: [{ type: "postgresql_ticket_center", view }],
    schema_version: "ticket-center.v1",
  };
}

/** Authorizes a single formal ticket through the same creator/assignee/watcher
 * relationship used by the list endpoint. */
export async function nativeTicketById(userId: string, ticketId: string) {
  const result = await postgresPool().query<TicketRow>(
    `SELECT t.id,t.title,t.goal,t.status,t.priority,t.business_category,t.stage_group,t.stage_code,t.due_at,t.no_due_reason,
            t.data_version,t.created_at,t.updated_at,t.owner_user_id,
            pa.assignee_person_ref,pa.assignee_user_id,pa.org_unit_id AS assignee_org_unit_id,
            tos.company_id,tos.org_version,ta.accepted_at
     FROM tickets t
     LEFT JOIN LATERAL (
       SELECT assignee_person_ref,assignee_user_id,org_unit_id FROM ticket_assignments
       WHERE ticket_id=t.id AND status='active' AND role='primary' ORDER BY assignment_version DESC LIMIT 1
     ) pa ON true
     LEFT JOIN ticket_org_scopes tos ON tos.ticket_id=t.id
     LEFT JOIN ticket_acceptances ta ON ta.ticket_id=t.id
     WHERE t.id=$1 AND t.task_type='manual_ticket' AND t.profile='ticket-workbench'
       AND (t.owner_user_id=$2 OR pa.assignee_user_id=$2 OR EXISTS (
         SELECT 1 FROM ticket_watchers tw WHERE tw.ticket_id=t.id AND tw.watcher_user_id=$2 AND tw.status='active'
       ))`,
    [ticketId, userId],
  );
  const row = result.rows[0];
  if (!row) throw new HttpFail(404, { code: "ticket_not_found" });
  return {
    ...row,
    ticket_id: row.id,
    description: row.goal,
    content: row.goal,
    source: "manual",
    skill: "ticket_form",
    profile: "ticket-workbench",
    missing_fields: [],
    source_refs: [{ type: "postgresql_ticket", id: row.id, org_version: row.org_version }],
    allowed_actions: allowedActions(row, userId),
  };
}

export async function nativeTicketTimeline(userId: string, ticketId: string, after: number, limit: number) {
  const ticket = await nativeTicketById(userId, ticketId);
  const result = await postgresPool().query<{
    id: string; sequence: number; event_type: string; event_class: string; label: string; status: string; safe_summary: string | null; time: string;
  }>(
    `SELECT id,sequence,event_type,event_class,label,status,safe_summary,time
     FROM task_events WHERE work_item_id=$1 AND sequence>$2
     ORDER BY sequence ASC LIMIT $3`,
    [ticket.id, after, limit],
  );
  const items = result.rows.map((event) => ({
    event_id: event.id,
    sequence: Number(event.sequence),
    type: event.event_type,
    phase: event.event_class === "lifecycle" ? "ticket_lifecycle" : "task_run",
    status: event.status,
    occurred_at: event.time,
    safe_summary: event.safe_summary || event.label,
  }));
  return { ticket_id: ticket.id, items, next_sequence: items.at(-1)?.sequence || after };
}
