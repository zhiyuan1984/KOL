import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import type { PoolClient } from "pg";
import { HttpFail } from "../host/errors.js";
import { nid } from "../ids.js";
import { postgresPool, postgresTransaction } from "../postgres/pool.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ORG_SEED_KEY = "ticket-domain-org-v1";

export type OrgUnitOption = {
  id: string;
  display_name: string;
  type: string;
  parent_id: string | null;
  level: number;
  head_person_ref: string | null;
  head_display_name: string | null;
};

export type OrgPersonOption = {
  person_ref: string;
  display_name: string;
  user_id: string | null;
  org_unit_id: string | null;
  position: string | null;
  assignable: boolean;
  quality_issue: string | null;
};

type RegistryUnit = {
  id?: string;
  display_name?: string;
  type?: string;
  parent?: string | null;
  head?: string | null;
  head_person_ref?: string | null;
  brand_scope?: string[];
};

type RegistryPerson = {
  person_ref?: string;
  display_name?: string;
  role?: string | null;
  title?: string | null;
  org_unit?: string | null;
  user_ref?: string | null;
  account_username?: string | null;
  starry_open_id?: string | null;
  brand_scope?: string[];
  region_scope?: string[];
  source?: string;
};

type Registry = {
  revision?: string;
  companies?: Array<{ id?: string; display_name?: string }>;
  organization_units?: RegistryUnit[];
  confirmed_people?: RegistryPerson[];
};

type OrgPersonRow = {
  person_ref: string;
  display_name: string;
  user_id: string | null;
  org_unit_id: string | null;
  position: string | null;
  status: string;
};

function readRegistry(): Registry {
  const file = path.join(repoRoot, "config", "org-registry.yaml");
  const parsed = parseYaml(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")) as Registry | null;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpFail(503, { code: "organization_registry_unavailable", message: "组织注册表不可用" });
  }
  return parsed;
}

function unitLevels(units: RegistryUnit[]): Map<string, number> {
  const byId = new Map(units.map((unit) => [String(unit.id), unit]));
  const result = new Map<string, number>();
  const levelOf = (id: string, chain: Set<string>): number => {
    const known = result.get(id);
    if (known) return known;
    if (chain.has(id)) throw new Error(`organization cycle at ${id}`);
    chain.add(id);
    const parent = String(byId.get(id)?.parent || "");
    const level = parent && byId.has(parent) ? levelOf(parent, chain) + 1 : 1;
    result.set(id, level);
    return level;
  };
  for (const unit of units) levelOf(String(unit.id), new Set());
  return result;
}

async function accountId(client: PoolClient, username: string | null | undefined): Promise<string | null> {
  if (!username) return null;
  const result = await client.query<{ id: string }>("SELECT id FROM ticket_accounts WHERE lower(username)=lower($1) AND active=true", [username]);
  return result.rows[0]?.id || null;
}

/**
 * Copies the declared organization registry to PostgreSQL once per registry
 * revision. The PostgreSQL rows are the runtime authority; the registry remains
 * provenance and a controlled reseed input, never a per-request UI directory.
 */
export async function ensurePostgresOrganizationSeed(): Promise<void> {
  const registry = readRegistry();
  const revision = String(registry.revision || "config/org-registry.yaml");
  const companyId = String(registry.companies?.[0]?.id || "");
  if (!companyId) throw new HttpFail(503, { code: "organization_registry_invalid", message: "组织注册表缺少公司标识" });

  await postgresTransaction(async (client) => {
    const seeded = await client.query<{ registry_revision: string }>(
      "SELECT registry_revision FROM ticket_org_seed_state WHERE seed_key=$1 FOR UPDATE",
      [ORG_SEED_KEY],
    );

    const units = (registry.organization_units || []).filter((unit): unit is RegistryUnit & { id: string } => Boolean(unit?.id));
    const levels = unitLevels(units);
    const now = new Date().toISOString();
    if (seeded.rows[0]?.registry_revision !== revision) {
      for (const unit of units) {
        const id = String(unit.id);
        const parent = unit.parent && unit.parent !== companyId ? String(unit.parent) : null;
        await client.query(
          `INSERT INTO organization_units
           (id,company_id,display_name,type,parent_id,level,head_person_ref,head_display_name,status,org_version,source,created_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',1,$9,$10,$10)
           ON CONFLICT (id) DO UPDATE SET
             company_id=EXCLUDED.company_id,display_name=EXCLUDED.display_name,type=EXCLUDED.type,parent_id=EXCLUDED.parent_id,
             level=EXCLUDED.level,head_person_ref=EXCLUDED.head_person_ref,head_display_name=EXCLUDED.head_display_name,
             source=EXCLUDED.source,updated_at=EXCLUDED.updated_at`,
          [id, companyId, String(unit.display_name || id), String(unit.type || "department"), parent, levels.get(id) || 1,
            unit.head_person_ref || null, unit.head || null, revision, now],
        );
        for (const brandId of (unit.brand_scope || []).map(String)) {
          const scopeId = `scope:org_unit:${id}:brand:${brandId}:region:*`;
          await client.query(
            `INSERT INTO scope_memberships
             (id,subject_type,subject_id,company_id,brand_id,region_id,status,source,created_at,updated_at)
             VALUES ($1,'organization_unit',$2,$3,$4,NULL,'active',$5,$6,$6)
             ON CONFLICT (id) DO UPDATE SET status='active',source=EXCLUDED.source,updated_at=EXCLUDED.updated_at`,
            [scopeId, id, companyId, brandId, revision, now],
          );
        }
      }
    }

    // Account bindings are intentionally refreshed on every access. Creating
    // a new PostgreSQL account must make the controlled organization registry
    // usable without changing the registry revision or inventing a person.
    for (const person of registry.confirmed_people || []) {
      const personRef = String(person.person_ref || "");
      if (!personRef) continue;
      const userId = await accountId(client, person.account_username);
      await client.query(
        `INSERT INTO organization_people
         (person_ref,display_name,user_ref,user_id,starry_open_id,status,source,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,'active',$6,$7,$7)
         ON CONFLICT (person_ref) DO UPDATE SET
           display_name=EXCLUDED.display_name,user_ref=EXCLUDED.user_ref,
           user_id=CASE WHEN EXCLUDED.user_id IS NULL THEN organization_people.user_id ELSE EXCLUDED.user_id END,
           starry_open_id=EXCLUDED.starry_open_id,status='active',source=EXCLUDED.source,updated_at=EXCLUDED.updated_at`,
        [personRef, String(person.display_name || personRef), person.user_ref || null, userId, person.starry_open_id || null, person.source || revision, now],
      );
      const orgUnitId = person.org_unit ? String(person.org_unit) : null;
      if (orgUnitId) {
        const membershipId = `member:${personRef}:${orgUnitId}:primary`;
        await client.query(
          `INSERT INTO organization_memberships
           (id,person_ref,company_id,org_unit_id,relation,position,status,source,created_at,updated_at)
           VALUES ($1,$2,$3,$4,'primary',$5,'active',$6,$7,$7)
           ON CONFLICT (id) DO UPDATE SET person_ref=EXCLUDED.person_ref,company_id=EXCLUDED.company_id,
             org_unit_id=EXCLUDED.org_unit_id,relation='primary',position=EXCLUDED.position,status='active',
             source=EXCLUDED.source,updated_at=EXCLUDED.updated_at`,
          [membershipId, personRef, companyId, orgUnitId, person.title || null, person.source || revision, now],
        );
      }
      for (const brandId of (person.brand_scope || []).map(String)) {
        for (const regionId of (person.region_scope || []).map(String)) {
          const scopeId = `scope:person:${personRef}:brand:${brandId}:region:${regionId}`;
          await client.query(
            `INSERT INTO scope_memberships
             (id,subject_type,subject_id,company_id,brand_id,region_id,status,source,created_at,updated_at)
             VALUES ($1,'person',$2,$3,$4,$5,'active',$6,$7,$7)
             ON CONFLICT (id) DO UPDATE SET status='active',source=EXCLUDED.source,updated_at=EXCLUDED.updated_at`,
            [scopeId, personRef, companyId, brandId, regionId, person.source || revision, now],
          );
        }
      }
    }

    await client.query(
      `INSERT INTO org_versions (company_id,version,effective_at,note,source,created_at)
       SELECT $1,1,$2,'组织事实首次进入 PostgreSQL 权威库',$3,$2
       WHERE NOT EXISTS (SELECT 1 FROM org_versions WHERE company_id=$1)`,
      [companyId, now, revision],
    );
    await client.query(
      `INSERT INTO ticket_org_seed_state (seed_key,registry_revision,seeded_at,seeded_by)
       VALUES ($1,$2,$3,'registry-seed')
       ON CONFLICT (seed_key) DO UPDATE SET registry_revision=EXCLUDED.registry_revision,seeded_at=EXCLUDED.seeded_at,seeded_by=EXCLUDED.seeded_by`,
      [ORG_SEED_KEY, revision, now],
    );
  }, { isolation: "SERIALIZABLE" });
}

export async function postgresOrganizationUnits(): Promise<OrgUnitOption[]> {
  await ensurePostgresOrganizationSeed();
  const rows = await postgresPool().query<OrgUnitOption>(
    `SELECT id,display_name,type,parent_id,level,head_person_ref,head_display_name
     FROM organization_units WHERE status='active' ORDER BY level,display_name,id`,
  );
  return rows.rows;
}

export async function postgresOrganizationPeople(): Promise<OrgPersonOption[]> {
  await ensurePostgresOrganizationSeed();
  const rows = await postgresPool().query<OrgPersonRow>(
    `SELECT p.person_ref,p.display_name,p.user_id,m.org_unit_id,m.position,p.status
     FROM organization_people p
     LEFT JOIN organization_memberships m
       ON m.person_ref=p.person_ref AND m.status='active' AND m.relation='primary'
     WHERE p.status='active'
     ORDER BY p.display_name,p.person_ref`,
  );
  return rows.rows.map((row) => ({
    person_ref: row.person_ref,
    display_name: row.display_name,
    user_id: row.user_id,
    org_unit_id: row.org_unit_id,
    position: row.position,
    assignable: Boolean(row.user_id && row.org_unit_id),
    quality_issue: !row.user_id ? "员工账号未绑定，不能分派正式工单" : !row.org_unit_id ? "员工未绑定三级组织，不能分派正式工单" : null,
  }));
}

export type CreatorOrgContext = {
  person_ref: string | null;
  org_unit_id: string | null;
  company_id: string | null;
  org_version: number | null;
  supervisor_person_ref: string | null;
  supervisor_user_id: string | null;
  quality_issues: string[];
};

export async function postgresCreatorOrgContext(userId: string, options: { ensureSeed?: boolean } = {}): Promise<CreatorOrgContext> {
  if (options.ensureSeed !== false) await ensurePostgresOrganizationSeed();
  const pool = postgresPool();
  const person = await pool.query<{ person_ref: string }>(
    "SELECT person_ref FROM organization_people WHERE user_id=$1 AND status='active' ORDER BY person_ref LIMIT 1",
    [userId],
  );
  const personRef = person.rows[0]?.person_ref || null;
  if (!personRef) {
    return { person_ref: null, org_unit_id: null, company_id: null, org_version: null, supervisor_person_ref: null, supervisor_user_id: null, quality_issues: ["当前账号未绑定组织人员，不能创建正式工单"] };
  }
  const membership = await pool.query<{ org_unit_id: string; company_id: string }>(
    `SELECT org_unit_id,company_id FROM organization_memberships
     WHERE person_ref=$1 AND status='active' AND relation='primary' ORDER BY created_at DESC LIMIT 1`,
    [personRef],
  );
  const current = membership.rows[0];
  if (!current) {
    return { person_ref: personRef, org_unit_id: null, company_id: null, org_version: null, supervisor_person_ref: null, supervisor_user_id: null, quality_issues: ["当前员工未绑定三级组织，不能创建正式工单"] };
  }
  const units = await pool.query<OrgUnitOption>(
    "SELECT id,display_name,type,parent_id,level,head_person_ref,head_display_name FROM organization_units WHERE company_id=$1 AND status='active'",
    [current.company_id],
  );
  const byId = new Map(units.rows.map((unit) => [unit.id, unit]));
  let cursor: string | null = current.org_unit_id;
  let supervisorRef: string | null = null;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const unit = byId.get(cursor);
    if (!unit) break;
    if (unit.head_person_ref && unit.head_person_ref !== personRef) {
      supervisorRef = unit.head_person_ref;
      break;
    }
    cursor = unit.parent_id;
  }
  const supervisor = supervisorRef
    ? await pool.query<{ user_id: string | null }>("SELECT user_id FROM organization_people WHERE person_ref=$1 AND status='active'", [supervisorRef])
    : { rows: [] as Array<{ user_id: string | null }> };
  const version = await pool.query<{ version: number }>("SELECT MAX(version)::int AS version FROM org_versions WHERE company_id=$1", [current.company_id]);
  const issues: string[] = [];
  if (!supervisorRef) issues.push("创建人所属组织链未解析到负责人，不能创建正式工单");
  else if (!supervisor.rows[0]?.user_id) issues.push("组织负责人未绑定登录账号，不能创建正式工单");
  return {
    person_ref: personRef,
    org_unit_id: current.org_unit_id,
    company_id: current.company_id,
    org_version: version.rows[0]?.version || null,
    supervisor_person_ref: supervisorRef,
    supervisor_user_id: supervisor.rows[0]?.user_id || null,
    quality_issues: issues,
  };
}

export async function ticketOrgFormBootstrap(userId: string) {
  // Each public reader self-heals the controlled registry projection. Keep the
  // bootstrap calls ordered: first access can seed a fresh PostgreSQL database,
  // and three SERIALIZABLE seed attempts in parallel can legitimately conflict.
  const creator = await postgresCreatorOrgContext(userId);
  const units = await postgresOrganizationUnits();
  const people = await postgresOrganizationPeople();
  return {
    creator,
    organization_units: units,
    assignee_candidates: people,
    formal_submission_enabled: creator.quality_issues.length === 0,
    quality_warnings: [
      ...creator.quality_issues,
      ...people.filter((person) => person.quality_issue).map((person) => `${person.display_name}：${person.quality_issue}`),
    ],
    source_refs: [{ type: "organization_postgres", version: creator.org_version }],
  };
}

export type TicketOrganizationQualityIssue = {
  type: "person_without_account" | "person_without_org" | "unit_head_without_account";
  subject_ref: string;
  display_name: string;
  org_unit_id: string | null;
  message: string;
};

export type TicketAccountOrganizationBindingInput = {
  person_ref: string;
  account_id: string;
  reason: string;
};

/**
 * A deliberate administration command, not a seed fallback: it binds a
 * PostgreSQL ticket account to one confirmed registry person. The immutable
 * audit row records the prior mapping so responsibility can be explained even
 * after a later reassignment.
 */
export async function bindTicketAccountToOrganizationPerson(
  actorAccountId: string,
  raw: TicketAccountOrganizationBindingInput,
) {
  const personRef = String(raw.person_ref || "").trim();
  const accountId = String(raw.account_id || "").trim();
  const reason = String(raw.reason || "").trim();
  if (!personRef || !accountId) throw new HttpFail(422, { code: "binding_identity_required" });
  if (reason.length < 2 || reason.length > 500) throw new HttpFail(422, { code: "binding_reason_required" });
  await ensurePostgresOrganizationSeed();
  return postgresTransaction(async (client) => {
    const account = await client.query<{ id: string; username: string }>(
      "SELECT id,username FROM ticket_accounts WHERE id=$1 AND active=true FOR UPDATE",
      [accountId],
    );
    if (!account.rows[0]) throw new HttpFail(422, { code: "ticket_account_not_active" });
    const person = await client.query<{ person_ref: string; user_id: string | null }>(
      "SELECT person_ref,user_id FROM organization_people WHERE person_ref=$1 AND status='active' FOR UPDATE",
      [personRef],
    );
    if (!person.rows[0]) throw new HttpFail(422, { code: "organization_person_not_active" });
    const alreadyElsewhere = await client.query<{ person_ref: string }>(
      "SELECT person_ref FROM organization_people WHERE user_id=$1 AND person_ref<>$2 AND status='active' FOR UPDATE",
      [accountId, personRef],
    );
    if (alreadyElsewhere.rows[0]) {
      throw new HttpFail(409, { code: "ticket_account_already_bound", person_ref: alreadyElsewhere.rows[0].person_ref });
    }
    const previous = person.rows[0].user_id;
    if (previous === accountId) {
      return { person_ref: personRef, account_id: accountId, username: account.rows[0].username, changed: false, prior_account_id: previous };
    }
    const now = new Date().toISOString();
    await client.query("UPDATE organization_people SET user_id=$1,updated_at=$2 WHERE person_ref=$3", [accountId, now, personRef]);
    await client.query(
      `INSERT INTO ticket_account_organization_bindings
       (id,person_ref,account_id,prior_account_id,actor_account_id,reason,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [nid("toab"), personRef, accountId, previous, actorAccountId, reason, now],
    );
    return { person_ref: personRef, account_id: accountId, username: account.rows[0].username, changed: true, prior_account_id: previous };
  }, { isolation: "SERIALIZABLE" });
}

/** Management-only selection data for explicit account enrollment. It contains
 * stable IDs and current bindings, not inferred matching recommendations. */
export async function ticketAccountOrganizationBindingOptions() {
  await ensurePostgresOrganizationSeed();
  const [accounts, people] = await Promise.all([
    postgresPool().query<{ id: string; username: string; name: string; roles: unknown; bound_person_ref: string | null }>(
      `SELECT a.id,a.username,a.name,a.roles,p.person_ref AS bound_person_ref
         FROM ticket_accounts a
         LEFT JOIN organization_people p ON p.user_id=a.id AND p.status='active'
        WHERE a.active=true
        ORDER BY a.name,a.username,a.id`,
    ),
    postgresPool().query<{ person_ref: string; display_name: string; org_unit_id: string | null; user_id: string | null }>(
      `SELECT p.person_ref,p.display_name,m.org_unit_id,p.user_id
         FROM organization_people p
         LEFT JOIN organization_memberships m ON m.person_ref=p.person_ref AND m.status='active' AND m.relation='primary'
        WHERE p.status='active'
        ORDER BY p.display_name,p.person_ref`,
    ),
  ]);
  return {
    accounts: accounts.rows.map((row) => ({
      id: row.id,
      username: row.username,
      name: row.name,
      roles: Array.isArray(row.roles) ? row.roles.map(String) : [],
      bound_person_ref: row.bound_person_ref,
    })),
    people: people.rows,
  };
}

/**
 * Management-only evidence for the formal-ticket preflight. This deliberately
 * reports missing authority data instead of inventing a default assignee or a
 * supervisory watcher.
 */
export async function ticketOrganizationQualityReport() {
  await ensurePostgresOrganizationSeed();
  const pool = postgresPool();
  const [state, unitCount, personCount, people, headRows] = await Promise.all([
    pool.query<{ registry_revision: string; seeded_at: string }>("SELECT registry_revision,seeded_at FROM ticket_org_seed_state WHERE seed_key=$1", [ORG_SEED_KEY]),
    pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM organization_units WHERE status='active'"),
    pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM organization_people WHERE status='active'"),
    pool.query<{ person_ref: string; display_name: string; user_id: string | null; org_unit_id: string | null }>(
      `SELECT p.person_ref,p.display_name,p.user_id,m.org_unit_id
       FROM organization_people p
       LEFT JOIN organization_memberships m ON m.person_ref=p.person_ref AND m.status='active' AND m.relation='primary'
       WHERE p.status='active' ORDER BY p.display_name,p.person_ref`,
    ),
    pool.query<{ id: string; display_name: string; head_person_ref: string; user_id: string | null }>(
      `SELECT u.id,u.display_name,u.head_person_ref,p.user_id
       FROM organization_units u
       LEFT JOIN organization_people p ON p.person_ref=u.head_person_ref AND p.status='active'
       WHERE u.status='active' AND u.head_person_ref IS NOT NULL ORDER BY u.level,u.display_name`,
    ),
  ]);
  const issues: TicketOrganizationQualityIssue[] = [];
  for (const person of people.rows) {
    if (!person.user_id) issues.push({
      type: "person_without_account", subject_ref: person.person_ref, display_name: person.display_name, org_unit_id: person.org_unit_id,
      message: "员工未绑定登录账号，不能成为正式工单创建人、受理人或自动关注人",
    });
    if (!person.org_unit_id) issues.push({
      type: "person_without_org", subject_ref: person.person_ref, display_name: person.display_name, org_unit_id: null,
      message: "员工未绑定三级组织，不能获得正式工单范围或受理资格",
    });
  }
  for (const unit of headRows.rows) {
    if (!unit.user_id) issues.push({
      type: "unit_head_without_account", subject_ref: unit.head_person_ref, display_name: `${unit.display_name}负责人`, org_unit_id: unit.id,
      message: "组织负责人未绑定登录账号，相关创建人无法生成自动关注关系",
    });
  }
  return {
    registry_revision: state.rows[0]?.registry_revision || null,
    seeded_at: state.rows[0]?.seeded_at || null,
    active_unit_count: Number(unitCount.rows[0]?.count || 0),
    active_person_count: Number(personCount.rows[0]?.count || 0),
    issue_count: issues.length,
    issues,
  };
}
