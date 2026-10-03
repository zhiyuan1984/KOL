import { HttpFail } from "../host/errors.js";
import { postgresPool } from "../postgres/pool.js";
import { ensurePostgresOrganizationSeed } from "./organization.js";

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

export type OrganizationTicketRawCountReport = {
  report_version: "ticket-organization-raw-count.v1";
  as_of: string;
  timezone: string;
  scope: "organization_authorized";
  authorization: {
    mode: "company_admin" | "organization_head";
    companies: string[];
    root_units: Array<{ id: string; display_name: string; type: string }>;
  };
  source: "postgresql_formal_tickets";
  note: string;
  total_authorized: number;
  by_status: Record<string, number>;
  by_assignee_unit: Array<{ org_unit_id: string; display_name: string; type: string; total: number; by_status: Record<string, number> }>;
};

type ScopeResolution = {
  mode: "company_admin" | "organization_head";
  companies: string[];
  rootUnits: Array<{ id: string; display_name: string; type: string }>;
};

async function organizationReportScope(userId: string, isAdmin: boolean): Promise<ScopeResolution> {
  await ensurePostgresOrganizationSeed();
  const pool = postgresPool();
  const memberships = await pool.query<{ company_id: string; org_unit_id: string }>(
    `SELECT m.company_id,m.org_unit_id
       FROM organization_people p JOIN organization_memberships m ON m.person_ref=p.person_ref
      WHERE p.user_id=$1 AND p.status='active' AND m.status='active' AND m.relation='primary'`,
    [userId],
  );
  const companies = [...new Set(memberships.rows.map((row) => String(row.company_id)))];
  if (!companies.length) {
    throw new HttpFail(403, { code: "organization_report_scope_missing", message: "当前工单账号没有受控组织人员与公司范围，不能读取组织工单报表。" });
  }
  if (isAdmin) return { mode: "company_admin", companies, rootUnits: [] };
  const heads = await pool.query<{ id: string; display_name: string; type: string; company_id: string }>(
    `SELECT u.id,u.display_name,u.type,u.company_id
       FROM organization_units u JOIN organization_people p ON p.person_ref=u.head_person_ref
      WHERE p.user_id=$1 AND p.status='active' AND u.status='active'`,
    [userId],
  );
  if (!heads.rows.length) {
    throw new HttpFail(403, { code: "organization_report_head_required", message: "仅公司管理员或已绑定的组织负责人可读取组织工单报表。" });
  }
  return {
    mode: "organization_head",
    companies: [...new Set(heads.rows.map((row) => String(row.company_id)))],
    rootUnits: heads.rows.map((row) => ({ id: String(row.id), display_name: String(row.display_name), type: String(row.type) })),
  };
}

/**
 * Organization reports remain raw-current-count projections. Access is derived
 * from a bound organization head or the caller's bound company-admin scope;
 * it never accepts a browser-supplied unit/company filter and does not expose
 * employee rankings, SLA, productivity, or undeclared performance metrics.
 */
export async function organizationTicketRawCountReport(
  userId: string,
  options: { timezone?: string; is_admin?: boolean } = {},
): Promise<OrganizationTicketRawCountReport> {
  const timezone = options.timezone || "Asia/Shanghai";
  if (!TIMEZONE.test(timezone)) throw new HttpFail(400, { code: "invalid_timezone" });
  const authorization = await organizationReportScope(userId, Boolean(options.is_admin));
  const pool = postgresPool();
  const rootIds = authorization.rootUnits.map((unit) => unit.id);
  const where = authorization.mode === "company_admin"
    ? "os.company_id = ANY($1::text[])"
    : "os.assignee_unit_id IN (SELECT id FROM permitted_units)";
  const cte = authorization.mode === "company_admin"
    ? "WITH"
    : `WITH RECURSIVE permitted_units(id) AS (
         SELECT unnest($1::text[])
         UNION
         SELECT child.id FROM organization_units child JOIN permitted_units parent ON child.parent_id=parent.id
          WHERE child.status='active'
       ),`;
  const params = authorization.mode === "company_admin" ? [authorization.companies] : [rootIds];
  const [statusRows, unitRows] = await Promise.all([
    pool.query<{ status: string; count: string }>(
      `${cte} scoped AS (
         SELECT t.id,t.status FROM tickets t JOIN ticket_org_scopes os ON os.ticket_id=t.id
          WHERE t.task_type='manual_ticket' AND t.profile='ticket-workbench' AND ${where}
       ) SELECT status,COUNT(*)::text AS count FROM scoped GROUP BY status ORDER BY status`,
      params,
    ),
    pool.query<{ org_unit_id: string; display_name: string; type: string; status: string; count: string }>(
      `${cte} scoped AS (
         SELECT os.assignee_unit_id,t.status FROM tickets t JOIN ticket_org_scopes os ON os.ticket_id=t.id
          WHERE t.task_type='manual_ticket' AND t.profile='ticket-workbench' AND ${where}
       )
       SELECT scoped.assignee_unit_id AS org_unit_id,COALESCE(u.display_name,scoped.assignee_unit_id) AS display_name,
              COALESCE(u.type,'unknown') AS type,scoped.status,COUNT(*)::text AS count
         FROM scoped LEFT JOIN organization_units u ON u.id=scoped.assignee_unit_id
        GROUP BY scoped.assignee_unit_id,u.display_name,u.type,scoped.status
        ORDER BY display_name,scoped.status`,
      params,
    ),
  ]);
  const byStatus = Object.fromEntries(statusRows.rows.map((row) => [row.status, Number(row.count)]));
  const units = new Map<string, OrganizationTicketRawCountReport["by_assignee_unit"][number]>();
  for (const row of unitRows.rows) {
    const known = units.get(row.org_unit_id) || {
      org_unit_id: row.org_unit_id, display_name: row.display_name, type: row.type, total: 0, by_status: {},
    };
    known.by_status[row.status] = Number(row.count);
    known.total += Number(row.count);
    units.set(row.org_unit_id, known);
  }
  return {
    report_version: "ticket-organization-raw-count.v1",
    as_of: new Date().toISOString(),
    timezone,
    scope: "organization_authorized",
    authorization: {
      mode: authorization.mode,
      companies: authorization.companies,
      root_units: authorization.rootUnits,
    },
    source: "postgresql_formal_tickets",
    note: "仅展示 PostgreSQL 正式工单的当前原始计数与受理组织分布；不定义 SLA、绩效、排名或生产率指标。",
    total_authorized: Object.values(byStatus).reduce((sum, count) => sum + count, 0),
    by_status: byStatus,
    by_assignee_unit: [...units.values()],
  };
}
