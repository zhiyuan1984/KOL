import { HttpFail } from "../host/errors.js";
import { postgresPool } from "../postgres/pool.js";

const TIMEZONE = /^(?:UTC|[A-Za-z]+\/[A-Za-z_]+)$/;

export type PersonalTicketReport = {
  report_version: "ticket-personal-raw-count.v1";
  as_of: string;
  timezone: string;
  scope: "personal_authorized";
  source: "postgresql_formal_tickets";
  note: string;
  total_authorized: number;
  by_status: Record<string, number>;
  memberships: { created: number; assigned_primary: number; watching: number };
};

/**
 * Personal report deliberately exposes only persisted raw counts. It is not an
 * SLA, productivity, ranking, or performance score; one ticket may belong to
 * multiple authorized relations, so membership counts are presented separately.
 */
export async function personalTicketRawCountReport(userId: string, timezone = "Asia/Shanghai"): Promise<PersonalTicketReport> {
  if (!TIMEZONE.test(timezone)) throw new HttpFail(400, { code: "invalid_timezone" });
  const pool = postgresPool();
  const [statusRows, membership] = await Promise.all([
    pool.query<{ status: string; count: string }>(
      `WITH authorized AS (
         SELECT t.id,t.status
           FROM tickets t
          WHERE t.task_type='manual_ticket' AND t.profile='ticket-workbench'
            AND (t.owner_user_id=$1 OR EXISTS (
              SELECT 1 FROM ticket_assignments ta WHERE ta.ticket_id=t.id AND ta.role='primary' AND ta.status='active' AND ta.assignee_user_id=$1
            ) OR EXISTS (
              SELECT 1 FROM ticket_watchers tw WHERE tw.ticket_id=t.id AND tw.status='active' AND tw.watcher_user_id=$1
            ))
       ) SELECT status,COUNT(*)::text AS count FROM authorized GROUP BY status ORDER BY status`,
      [userId],
    ),
    pool.query<{ created: string; assigned_primary: string; watching: string }>(
      `SELECT
         (SELECT COUNT(*) FROM tickets t WHERE t.task_type='manual_ticket' AND t.profile='ticket-workbench' AND t.owner_user_id=$1)::text AS created,
         (SELECT COUNT(DISTINCT ta.ticket_id) FROM ticket_assignments ta JOIN tickets t ON t.id=ta.ticket_id
           WHERE t.task_type='manual_ticket' AND t.profile='ticket-workbench' AND ta.role='primary' AND ta.status='active' AND ta.assignee_user_id=$1)::text AS assigned_primary,
         (SELECT COUNT(DISTINCT tw.ticket_id) FROM ticket_watchers tw JOIN tickets t ON t.id=tw.ticket_id
           WHERE t.task_type='manual_ticket' AND t.profile='ticket-workbench' AND tw.status='active' AND tw.watcher_user_id=$1)::text AS watching`,
      [userId],
    ),
  ]);
  const byStatus = Object.fromEntries(statusRows.rows.map((row) => [row.status, Number(row.count)]));
  return {
    report_version: "ticket-personal-raw-count.v1",
    as_of: new Date().toISOString(),
    timezone,
    scope: "personal_authorized",
    source: "postgresql_formal_tickets",
    note: "仅展示 PostgreSQL 正式工单的当前原始计数；不定义 SLA、绩效、排名或生产率指标。",
    total_authorized: Object.values(byStatus).reduce((sum, count) => sum + count, 0),
    by_status: byStatus,
    memberships: {
      created: Number(membership.rows[0]?.created || 0),
      assigned_primary: Number(membership.rows[0]?.assigned_primary || 0),
      watching: Number(membership.rows[0]?.watching || 0),
    },
  };
}
