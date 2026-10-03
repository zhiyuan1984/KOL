import { Hono } from "hono";
import { requireAdmin } from "../auth.js";
import { getConn, nowIso } from "../db.js";
import { HttpFail } from "../host/errors.js";
import type { Row } from "../types.js";

/**
 * Daily work report: an admin-only, ticket-centred read model.
 *
 * This route deliberately reads acceptance facts (`ticket_acceptances`) separately
 * from task-run facts. A succeeded run is process evidence only; it never increases
 * the delivery count. Historic `task.accepted` events written before acceptance
 * attribution existed remain visible, but are explicitly marked unattributed.
 */
export const workReport = new Hono();

const REPORT_VERSION = "daily-work-report.v1";
const DEFAULT_TIMEZONE = "Asia/Shanghai";
const MAX_REPORT_ROWS = 100;
const FORMAL_TICKET_SQL = "COALESCE(t.task_type,'') NOT IN ('today_plan','todo_plan')";
const PROCESSING_STATUSES = ["pending", "queued", "starting", "running", "in_progress", "needs_clarification"];
const WAITING_STATUSES = ["waiting", "waiting_approval"];
const EXCEPTION_STATUSES = ["failed", "cancelled"];

type ReportFilters = {
  date: string;
  timezone: string;
  owner: string | null;
  kind: string | null;
  team: string | null;
  start: string;
  end: string;
};

type SqlScope = { clauses: string[]; values: unknown[] };

function jsonObject(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parseDate(value: string): { year: number; month: number; day: number } {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!matched) throw new HttpFail(400, "date must be YYYY-MM-DD");
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) {
    throw new HttpFail(400, "invalid date");
  }
  return { year, month, day };
}

function formatter(timezone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    throw new HttpFail(400, "invalid timezone");
  }
}

function timeZoneParts(value: Date, timezone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } {
  const parts = formatter(timezone).formatToParts(value);
  const byType = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return {
    year: Number(byType.year),
    month: Number(byType.month),
    day: Number(byType.day),
    hour: Number(byType.hour === "24" ? "0" : byType.hour),
    minute: Number(byType.minute),
    second: Number(byType.second),
  };
}

function dateAtTimezone(value: Date, timezone: string): string {
  const parts = timeZoneParts(value, timezone);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

/** Convert a local midnight in an IANA zone into an ISO instant without a date library. */
function zonedMidnightIso(date: string, timezone: string): string {
  const { year, month, day } = parseDate(date);
  const desiredWallClock = Date.UTC(year, month - 1, day, 0, 0, 0);
  let instant = desiredWallClock;
  // Re-evaluate once after the first offset adjustment, which also handles DST zones.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = timeZoneParts(new Date(instant), timezone);
    const displayedWallClock = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    instant += desiredWallClock - displayedWallClock;
  }
  return new Date(instant).toISOString();
}

function nextDate(date: string): string {
  const { year, month, day } = parseDate(date);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

function boundedQuery(value: string | undefined, name: string): string | null {
  const result = String(value || "").trim();
  if (!result) return null;
  if (result.length > 160) throw new HttpFail(400, `invalid ${name}`);
  return result;
}

function reportFilters(query: (name: string) => string | undefined): ReportFilters {
  const timezone = String(query("timezone") || DEFAULT_TIMEZONE).trim();
  formatter(timezone);
  const date = String(query("date") || dateAtTimezone(new Date(), timezone)).trim();
  parseDate(date);
  return {
    date,
    timezone,
    owner: boundedQuery(query("owner"), "owner"),
    kind: boundedQuery(query("kind"), "kind"),
    team: boundedQuery(query("team"), "team"),
    start: zonedMidnightIso(date, timezone),
    end: zonedMidnightIso(nextDate(date), timezone),
  };
}

function listScope(alias: string, filters: ReportFilters, ownerColumn: string): SqlScope {
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (filters.owner) {
    clauses.push(`${ownerColumn}=?`);
    values.push(filters.owner);
  }
  if (filters.kind) {
    clauses.push(`${alias}.kind=?`);
    values.push(filters.kind);
  }
  if (filters.team) {
    // memberships are current-directory scope only. The response declares this
    // explicitly because assignment/transfer history is not yet available.
    clauses.push(`EXISTS (
      SELECT 1
      FROM users report_scope_user
      JOIN memberships report_scope_membership ON report_scope_membership.user_handle=report_scope_user.username
      WHERE report_scope_user.id=${ownerColumn}
        AND report_scope_membership.scope='team'
        AND report_scope_membership.scope_id=?
    )`);
    values.push(filters.team);
  }
  return { clauses, values };
}

function where(scope: SqlScope, prefix: string[] = []): string {
  const clauses = [...prefix, ...scope.clauses];
  return clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
}

function placeholders(values: string[]): string {
  return values.map(() => "?").join(",");
}

function number(value: unknown): number {
  return Number(value || 0);
}

function statusRows(filters: ReportFilters): Map<string, { responsible: number; processing: number; waiting: number; earliest_waiting_at: string | null }> {
  const scope = listScope("t", filters, "t.owner_user_id");
  const rows = getConn().prepare(
    `SELECT t.owner_user_id AS owner_id,
      COUNT(*) AS responsible,
      SUM(CASE WHEN t.status IN (${placeholders(PROCESSING_STATUSES)}) THEN 1 ELSE 0 END) AS processing,
      SUM(CASE WHEN t.status IN (${placeholders(WAITING_STATUSES)}) THEN 1 ELSE 0 END) AS waiting,
      MIN(CASE WHEN t.status IN (${placeholders(WAITING_STATUSES)}) THEN COALESCE(NULLIF(t.due_at,''), t.created_at) END) AS earliest_waiting_at
     FROM tickets t
     ${where(scope, [FORMAL_TICKET_SQL])}
     GROUP BY t.owner_user_id`,
  ).all(...PROCESSING_STATUSES, ...WAITING_STATUSES, ...WAITING_STATUSES, ...scope.values) as Row[];
  return new Map(rows.map((row) => [String(row.owner_id), {
    responsible: number(row.responsible),
    processing: number(row.processing),
    waiting: number(row.waiting),
    earliest_waiting_at: row.earliest_waiting_at ? String(row.earliest_waiting_at) : null,
  }]));
}

function acceptanceRows(filters: ReportFilters): Map<string, { accepted: number; last_accepted_at: string | null }> {
  const scope = listScope("t", filters, "a.owner_user_id_at_acceptance");
  const rows = getConn().prepare(
    `SELECT a.owner_user_id_at_acceptance AS owner_id, COUNT(DISTINCT a.ticket_id) AS accepted, MAX(a.accepted_at) AS last_accepted_at
       FROM ticket_acceptances a
       JOIN tickets t ON t.id=a.ticket_id
     ${where(scope, [FORMAL_TICKET_SQL, "a.accepted_at>=?", "a.accepted_at<?"])}
      GROUP BY a.owner_user_id_at_acceptance`,
  ).all(filters.start, filters.end, ...scope.values) as Row[];
  return new Map(rows.map((row) => [String(row.owner_id), {
    accepted: number(row.accepted),
    last_accepted_at: row.last_accepted_at ? String(row.last_accepted_at) : null,
  }]));
}

function legacyAcceptedCount(filters: ReportFilters): number {
  const scope = listScope("t", filters, "t.owner_user_id");
  const row = getConn().prepare(
    `SELECT COUNT(DISTINCT e.work_item_id) AS count
       FROM task_events e
       JOIN tickets t ON t.id=e.work_item_id
       LEFT JOIN ticket_acceptances a ON a.ticket_id=e.work_item_id
      ${where(scope, [FORMAL_TICKET_SQL, "e.event_type='task.accepted'", "a.ticket_id IS NULL", "e.time>=?", "e.time<?"])}`,
  ).get(filters.start, filters.end, ...scope.values) as Row | undefined;
  return number(row?.count);
}

function currentStatusCounts(filters: ReportFilters): { processing: number; waiting: number; exception: number } {
  const scope = listScope("t", filters, "t.owner_user_id");
  const row = getConn().prepare(
    `SELECT
      SUM(CASE WHEN t.status IN (${placeholders(PROCESSING_STATUSES)}) THEN 1 ELSE 0 END) AS processing,
      SUM(CASE WHEN t.status IN (${placeholders(WAITING_STATUSES)}) THEN 1 ELSE 0 END) AS waiting,
      SUM(CASE WHEN t.status IN (${placeholders(EXCEPTION_STATUSES)}) THEN 1 ELSE 0 END) AS exception
       FROM tickets t
       ${where(scope, [FORMAL_TICKET_SQL])}`,
  ).get(...PROCESSING_STATUSES, ...WAITING_STATUSES, ...EXCEPTION_STATUSES, ...scope.values) as Row | undefined;
  return { processing: number(row?.processing), waiting: number(row?.waiting), exception: number(row?.exception) };
}

function usersForReport(filters: ReportFilters, status: Map<string, { responsible: number; processing: number; waiting: number; earliest_waiting_at: string | null }>, accepted: Map<string, { accepted: number; last_accepted_at: string | null }>) {
  const active = getConn().prepare(
    "SELECT id,name,username,site FROM users WHERE active=1 ORDER BY name COLLATE NOCASE,username COLLATE NOCASE LIMIT 200",
  ).all() as Row[];
  const userById = new Map(active.map((row) => [String(row.id), row]));
  const ownerIds = new Set([...status.keys(), ...accepted.keys()]);
  if (filters.owner) ownerIds.add(filters.owner);
  const missing = [...ownerIds].filter((id) => !userById.has(id));
  if (missing.length) {
    const rows = getConn().prepare(
      `SELECT id,name,username,site FROM users WHERE id IN (${placeholders(missing)})`,
    ).all(...missing) as Row[];
    for (const row of rows) userById.set(String(row.id), row);
  }
  const ids = filters.owner ? [filters.owner] : [...new Set([...active.map((row) => String(row.id)), ...ownerIds])];
  return ids.map((id) => {
    const person = userById.get(id);
    const current = status.get(id) || { responsible: 0, processing: 0, waiting: 0, earliest_waiting_at: null };
    const delivered = accepted.get(id) || { accepted: 0, last_accepted_at: null };
    return {
      user_id: id,
      name: person?.name ? String(person.name) : "未归档员工",
      username: person?.username ? String(person.username) : null,
      site: person?.site ? String(person.site) : null,
      ...current,
      accepted: delivered.accepted,
      last_accepted_at: delivered.last_accepted_at,
    };
  });
}

function blockedAndActivity(filters: ReportFilters) {
  const scope = listScope("t", filters, "t.owner_user_id");
  const blocked = getConn().prepare(
    `SELECT t.id AS ticket_id,t.title,t.status,t.owner_user_id,t.due_at,t.updated_at,t.kind,u.name AS owner_name
       FROM tickets t LEFT JOIN users u ON u.id=t.owner_user_id
       ${where(scope, [FORMAL_TICKET_SQL, `t.status IN (${placeholders([...WAITING_STATUSES, ...EXCEPTION_STATUSES])})`])}
      ORDER BY CASE t.status WHEN 'failed' THEN 0 WHEN 'waiting_approval' THEN 1 WHEN 'waiting' THEN 2 ELSE 3 END,
               COALESCE(NULLIF(t.due_at,''),t.updated_at) ASC,t.id ASC
      LIMIT 20`,
  ).all(...WAITING_STATUSES, ...EXCEPTION_STATUSES, ...scope.values) as Row[];
  const activity = getConn().prepare(
    `SELECT e.id AS event_id,e.work_item_id AS ticket_id,e.event_type,e.label,e.status,e.safe_summary,e.time,
            t.title,t.owner_user_id,t.kind,u.name AS owner_name
       FROM task_events e
       JOIN tickets t ON t.id=e.work_item_id
       LEFT JOIN users u ON u.id=t.owner_user_id
       ${where(scope, [FORMAL_TICKET_SQL, "e.time>=?", "e.time<?"])}
      ORDER BY e.time DESC,e.id DESC
      LIMIT 24`,
  ).all(filters.start, filters.end, ...scope.values) as Row[];
  return {
    blockers: blocked.map((row) => ({
      kind: "blocker",
      ticket_id: String(row.ticket_id),
      title: String(row.title),
      status: String(row.status),
      owner_user_id: String(row.owner_user_id),
      owner_name: row.owner_name ? String(row.owner_name) : null,
      due_at: row.due_at ? String(row.due_at) : null,
      occurred_at: String(row.updated_at),
      ticket_kind: String(row.kind || "general"),
    })),
    activity: activity.map((row) => ({
      kind: "event",
      event_id: String(row.event_id),
      ticket_id: String(row.ticket_id),
      title: String(row.title),
      event_type: String(row.event_type),
      label: String(row.label),
      status: String(row.status),
      safe_summary: row.safe_summary ? String(row.safe_summary) : null,
      occurred_at: String(row.time),
      owner_user_id: String(row.owner_user_id),
      owner_name: row.owner_name ? String(row.owner_name) : null,
      ticket_kind: String(row.kind || "general"),
    })),
  };
}

function filterOptions() {
  const db = getConn();
  const owners = db.prepare("SELECT id,name,username FROM users WHERE active=1 ORDER BY name COLLATE NOCASE,username COLLATE NOCASE LIMIT 200").all() as Row[];
  const kinds = db.prepare("SELECT kind,COUNT(*) AS count FROM tickets GROUP BY kind ORDER BY count DESC,kind ASC LIMIT 100").all() as Row[];
  const teams = db.prepare("SELECT id,name FROM teams ORDER BY name COLLATE NOCASE,id LIMIT 100").all() as Row[];
  return {
    owners: owners.map((row) => ({ id: String(row.id), name: String(row.name), username: String(row.username) })),
    kinds: kinds.map((row) => ({ id: String(row.kind || "general"), count: number(row.count) })),
    teams: teams.map((row) => ({ id: String(row.id), name: String(row.name) })),
  };
}

function reportResponse(filters: ReportFilters) {
  const status = statusRows(filters);
  const accepted = acceptanceRows(filters);
  const legacyAccepted = legacyAcceptedCount(filters);
  const totals = currentStatusCounts(filters);
  const process = blockedAndActivity(filters);
  return {
    report_version: REPORT_VERSION,
    as_of: nowIso(),
    data_cutoff_at: nowIso(),
    period: { date: filters.date, timezone: filters.timezone, start: filters.start, end: filters.end },
    filters: { owner: filters.owner, kind: filters.kind, team: filters.team },
    filter_options: filterOptions(),
    summary: {
      accepted: [...accepted.values()].reduce((sum, row) => sum + row.accepted, 0) + legacyAccepted,
      accepted_attributed: [...accepted.values()].reduce((sum, row) => sum + row.accepted, 0),
      accepted_unattributed: legacyAccepted,
      processing: totals.processing,
      waiting: totals.waiting,
      exception: totals.exception,
    },
    employees: usersForReport(filters, status, accepted),
    process,
    attribution: {
      accepted_owner: "验收时负责人快照",
      accepted_actor: "实际执行验收命令的用户",
      legacy_accepted: legacyAccepted,
      legacy_note: legacyAccepted ? "历史验收事件缺少验收时负责人，已计入团队验收但不会回填到现任负责人。" : null,
      team_scope_note: filters.team ? "团队按当前目录成员关系筛选；尚未提供成员历史快照。" : null,
    },
    contribution_note: "成员表展示负责工单与已验收成果，不生成个人绩效分数或排名。",
    source_refs: [
      { type: "tickets", scope: "admin_authorized" },
      { type: "ticket_acceptances", scope: "accepted_owner_snapshot" },
      { type: "task_events", scope: "legacy_acceptance_and_process" },
      { type: "users", scope: "display_directory" },
    ],
  };
}

function ticketListRow(row: Row, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ticket_id: String(row.ticket_id || row.id),
    title: String(row.title || "未命名工单"),
    status: String(row.status || "pending"),
    kind: String(row.kind || "general"),
    owner_user_id: String(row.owner_user_id || ""),
    owner_name: row.owner_name ? String(row.owner_name) : null,
    due_at: row.due_at ? String(row.due_at) : null,
    updated_at: row.updated_at ? String(row.updated_at) : null,
    ...extra,
  };
}

function ticketRows(view: string, filters: ReportFilters, limit: number) {
  const db = getConn();
  if (view === "accepted") {
    const acceptedScope = listScope("t", filters, "a.owner_user_id_at_acceptance");
    const attributed = db.prepare(
      `SELECT t.id AS ticket_id,t.title,t.status,t.kind,t.due_at,t.updated_at,t.owner_user_id,
              a.accepted_at,a.owner_user_id_at_acceptance,a.accepted_by_user_id,
              owner.name AS owner_name,accepted_owner.name AS accepted_owner_name,accepted_by.name AS accepted_by_name
         FROM ticket_acceptances a
         JOIN tickets t ON t.id=a.ticket_id
         LEFT JOIN users owner ON owner.id=t.owner_user_id
         LEFT JOIN users accepted_owner ON accepted_owner.id=a.owner_user_id_at_acceptance
         LEFT JOIN users accepted_by ON accepted_by.id=a.accepted_by_user_id
         ${where(acceptedScope, [FORMAL_TICKET_SQL, "a.accepted_at>=?", "a.accepted_at<?"])}
        ORDER BY a.accepted_at DESC,a.ticket_id DESC
        LIMIT ?`,
    ).all(filters.start, filters.end, ...acceptedScope.values, limit) as Row[];
    const currentScope = listScope("t", filters, "t.owner_user_id");
    const legacy = db.prepare(
      `SELECT t.id AS ticket_id,t.title,t.status,t.kind,t.due_at,t.updated_at,t.owner_user_id,u.name AS owner_name,
              MAX(e.time) AS accepted_at
         FROM task_events e
         JOIN tickets t ON t.id=e.work_item_id
         LEFT JOIN users u ON u.id=t.owner_user_id
         LEFT JOIN ticket_acceptances a ON a.ticket_id=t.id
         ${where(currentScope, [FORMAL_TICKET_SQL, "e.event_type='task.accepted'", "a.ticket_id IS NULL", "e.time>=?", "e.time<?"])}
        GROUP BY t.id,t.title,t.status,t.kind,t.due_at,t.updated_at,t.owner_user_id,u.name
        ORDER BY accepted_at DESC,t.id DESC
        LIMIT ?`,
    ).all(filters.start, filters.end, ...currentScope.values, limit) as Row[];
    const rows = [
      ...attributed.map((row) => ticketListRow(row, {
        accepted_at: String(row.accepted_at),
        attribution_status: "accepted_owner_snapshot",
        accepted_owner_user_id: String(row.owner_user_id_at_acceptance),
        accepted_owner_name: row.accepted_owner_name ? String(row.accepted_owner_name) : null,
        accepted_by_user_id: String(row.accepted_by_user_id),
        accepted_by_name: row.accepted_by_name ? String(row.accepted_by_name) : null,
      })),
      ...legacy.map((row) => ticketListRow(row, {
        accepted_at: String(row.accepted_at),
        attribution_status: "legacy_unattributed",
        accepted_owner_user_id: null,
        accepted_owner_name: null,
        accepted_by_user_id: null,
        accepted_by_name: null,
      })),
    ].sort((left, right) => String(right.accepted_at).localeCompare(String(left.accepted_at))).slice(0, limit);
    return rows;
  }
  const statuses = view === "processing" ? PROCESSING_STATUSES : view === "waiting" ? WAITING_STATUSES : EXCEPTION_STATUSES;
  const scope = listScope("t", filters, "t.owner_user_id");
  const rows = db.prepare(
    `SELECT t.id AS ticket_id,t.title,t.status,t.kind,t.due_at,t.updated_at,t.owner_user_id,u.name AS owner_name
       FROM tickets t LEFT JOIN users u ON u.id=t.owner_user_id
       ${where(scope, [FORMAL_TICKET_SQL, `t.status IN (${placeholders(statuses)})`])}
      ORDER BY COALESCE(NULLIF(t.due_at,''),t.updated_at) ASC,t.id ASC
      LIMIT ?`,
  ).all(...statuses, ...scope.values, limit) as Row[];
  return rows.map((row) => ticketListRow(row));
}

function ticketDetail(ticketId: string) {
  const db = getConn();
  const ticket = db.prepare(
    `SELECT t.*,owner.name AS owner_name,owner.username AS owner_username
       FROM tickets t LEFT JOIN users owner ON owner.id=t.owner_user_id WHERE t.id=?`,
  ).get(ticketId) as Row | undefined;
  if (!ticket) throw new HttpFail(404, "ticket not found");
  const acceptance = db.prepare(
    `SELECT a.*,accepted_owner.name AS accepted_owner_name,accepted_by.name AS accepted_by_name
       FROM ticket_acceptances a
       LEFT JOIN users accepted_owner ON accepted_owner.id=a.owner_user_id_at_acceptance
       LEFT JOIN users accepted_by ON accepted_by.id=a.accepted_by_user_id
      WHERE a.ticket_id=?`,
  ).get(ticketId) as Row | undefined;
  const legacyAccepted = !acceptance
    ? db.prepare("SELECT id,time FROM task_events WHERE work_item_id=? AND event_type='task.accepted' ORDER BY sequence DESC LIMIT 1").get(ticketId) as Row | undefined
    : undefined;
  const events = db.prepare(
    "SELECT id,sequence,event_type,label,status,safe_summary,time,created_at,run_id FROM task_events WHERE work_item_id=? ORDER BY sequence DESC LIMIT 100",
  ).all(ticketId) as Row[];
  const runs = db.prepare(
    "SELECT id,status,worker_id,created_at,started_at,completed_at,substr(error,1,1024) AS error_preview FROM task_runs WHERE work_item_id=? ORDER BY created_at DESC LIMIT 30",
  ).all(ticketId) as Row[];
  const artifacts = db.prepare(
    "SELECT id,artifact_type,version,run_id,created_at,substr(payload,1,4096) AS payload_preview,length(payload) AS payload_size FROM task_artifacts WHERE work_item_id=? ORDER BY created_at DESC LIMIT 30",
  ).all(ticketId) as Row[];
  const input = jsonObject(ticket.input);
  return {
    ticket: {
      ticket_id: String(ticket.id),
      title: String(ticket.title),
      goal: String(ticket.content || input.goal || input.prompt || ticket.title || ""),
      status: String(ticket.status),
      kind: String(ticket.kind || "general"),
      source: String(ticket.source || "manual"),
      owner_user_id: String(ticket.owner_user_id),
      owner_name: ticket.owner_name ? String(ticket.owner_name) : null,
      owner_username: ticket.owner_username ? String(ticket.owner_username) : null,
      due_at: ticket.due_at ? String(ticket.due_at) : null,
      created_at: String(ticket.created_at),
      updated_at: String(ticket.updated_at),
    },
    acceptance: acceptance ? {
      accepted_at: String(acceptance.accepted_at),
      acceptance_event_id: acceptance.acceptance_event_id ? String(acceptance.acceptance_event_id) : null,
      owner_user_id_at_acceptance: String(acceptance.owner_user_id_at_acceptance),
      owner_name_at_acceptance: acceptance.accepted_owner_name ? String(acceptance.accepted_owner_name) : null,
      accepted_by_user_id: String(acceptance.accepted_by_user_id),
      accepted_by_name: acceptance.accepted_by_name ? String(acceptance.accepted_by_name) : null,
      evidence: jsonObject(acceptance.evidence_json),
      attribution_status: "accepted_owner_snapshot",
      rules_version: String(acceptance.rules_version || "ticket-acceptance.v1"),
    } : legacyAccepted ? {
      accepted_at: String(legacyAccepted.time),
      acceptance_event_id: String(legacyAccepted.id),
      owner_user_id_at_acceptance: null,
      owner_name_at_acceptance: null,
      accepted_by_user_id: null,
      accepted_by_name: null,
      evidence: null,
      attribution_status: "legacy_unattributed",
      rules_version: null,
    } : null,
    timeline: events.reverse().map((event) => ({
      event_id: String(event.id), sequence: number(event.sequence), type: String(event.event_type), label: String(event.label),
      status: String(event.status), safe_summary: event.safe_summary ? String(event.safe_summary) : null,
      occurred_at: String(event.time), run_id: event.run_id ? String(event.run_id) : null,
    })),
    runs: runs.map((run) => ({
      run_id: String(run.id), status: String(run.status), worker_id: run.worker_id ? String(run.worker_id) : null,
      created_at: String(run.created_at), started_at: run.started_at ? String(run.started_at) : null,
      completed_at: run.completed_at ? String(run.completed_at) : null, error: run.error_preview ? jsonObject(run.error_preview) : null,
    })),
    artifacts: artifacts.map((artifact) => ({
      artifact_id: String(artifact.id), artifact_type: String(artifact.artifact_type), version: number(artifact.version),
      run_id: artifact.run_id ? String(artifact.run_id) : null, created_at: String(artifact.created_at),
      payload_preview: jsonObject(artifact.payload_preview), payload_truncated: number(artifact.payload_size) > String(artifact.payload_preview || "").length,
    })),
    as_of: nowIso(),
    source_refs: [
      { type: "ticket", id: ticketId, version: number(ticket.data_version || 1) },
      ...(acceptance ? [{ type: "ticket_acceptance", ticket_id: ticketId }] : []),
      { type: "task_events", ticket_id: ticketId },
      { type: "task_runs", ticket_id: ticketId },
      { type: "task_artifacts", ticket_id: ticketId },
    ],
  };
}

workReport.get("/admin/work-report", (c) => {
  requireAdmin();
  return c.json(reportResponse(reportFilters((name) => c.req.query(name))));
});

workReport.get("/admin/work-report/tickets", (c) => {
  requireAdmin();
  const view = String(c.req.query("view") || "").trim();
  if (!(["accepted", "processing", "waiting", "exception"] as string[]).includes(view)) {
    throw new HttpFail(400, "view must be accepted, processing, waiting, or exception");
  }
  const rawLimit = Number(c.req.query("limit") || 50);
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_REPORT_ROWS) : 50;
  const filters = reportFilters((name) => c.req.query(name));
  return c.json({
    view,
    items: ticketRows(view, filters, limit),
    period: { date: filters.date, timezone: filters.timezone, start: filters.start, end: filters.end },
    filters: { owner: filters.owner, kind: filters.kind, team: filters.team },
    as_of: nowIso(),
    source_refs: [{ type: "tickets", scope: "admin_authorized" }, { type: "ticket_acceptances", scope: "accepted_owner_snapshot" }],
  });
});

workReport.get("/admin/work-report/tickets/:id", (c) => {
  requireAdmin();
  return c.json(ticketDetail(c.req.param("id")));
});
