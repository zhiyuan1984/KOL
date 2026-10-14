import type { PoolClient } from "pg";
import type {
  AgentBindingRow,
  OrganizationMembershipRow,
  OrganizationPersonRow,
  OrganizationUnitRow,
  ScopeMembershipRow,
} from "../runtime/organization-tree.js";
import type { Row } from "../types.js";
import { postgresQuery, postgresTransaction } from "./pool.js";

const activeNow = "(effective_from IS NULL OR effective_from <= $1) AND (effective_to IS NULL OR effective_to > $1)";

export type OrganizationUserInput = {
  id: string; username: string; name: string; passwordHash: string; roles: string[]; brands: string[];
  site: string; position: string; managerUserId: string | null; active: boolean; email: string; phone: string; now: string;
};

export async function pgCountUsers(): Promise<number> {
  const [row] = await postgresQuery<{ n: string }>("SELECT COUNT(*)::text AS n FROM users");
  return Number(row?.n || 0);
}
export async function pgUserById(id: string): Promise<Row | undefined> {
  const [row] = await postgresQuery<Row>("SELECT * FROM users WHERE id=$1", [id]);
  return row;
}
export async function pgListUsers(): Promise<Row[]> {
  return postgresQuery<Row>("SELECT * FROM users ORDER BY created_at");
}
export async function pgCreateOrganizationUser(input: OrganizationUserInput): Promise<Row> {
  return postgresTransaction(async (client) => {
    const result = await client.query<Row>(`INSERT INTO users (id,username,name,password_hash,roles,brands,site,position,manager_user_id,active,created_at,updated_at,email,phone)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12,$13) RETURNING *`, [
      input.id, input.username, input.name, input.passwordHash, JSON.stringify(input.roles), JSON.stringify(input.brands),
      input.site || null, input.position || null, input.managerUserId, input.active ? 1 : 0, input.now, input.email || null, input.phone || null,
    ]);
    return result.rows[0]!;
  });
}
export async function pgUpdateOrganizationUser(id: string, changes: Record<string, unknown>): Promise<Row | undefined> {
  const allowed = new Set(["email", "name", "site", "position", "manager_user_id", "roles", "brands", "active", "password_hash"]);
  const entries = Object.entries(changes).filter(([key]) => allowed.has(key));
  if (!entries.length) return pgUserById(id);
  const values = entries.map(([, value]) => value);
  const sets = entries.map(([key], index) => `${key}=$${index + 1}`);
  sets.push(`updated_at=$${values.length + 1}`);
  values.push(new Date().toISOString(), id);
  const rows = await postgresQuery<Row>(`UPDATE users SET ${sets.join(",")} WHERE id=$${values.length} RETURNING *`, values);
  return rows[0];
}
export async function pgDeactivateOrganizationUser(id: string, now: string): Promise<void> {
  await postgresTransaction(async (client) => {
    await client.query("UPDATE users SET active=0,updated_at=$2 WHERE id=$1", [id, now]);
    await client.query("DELETE FROM auth_sessions WHERE user_id=$1", [id]);
  });
}
export async function pgUpdatePasswordAndRevokeSessions(id: string, passwordHash: string, now: string): Promise<void> {
  await postgresTransaction(async (client) => {
    await client.query("UPDATE users SET password_hash=$2,updated_at=$3 WHERE id=$1", [id, passwordHash, now]);
    await client.query("DELETE FROM auth_sessions WHERE user_id=$1", [id]);
  });
}
export async function pgRevokeUserSessions(id: string): Promise<void> {
  await postgresQuery("DELETE FROM auth_sessions WHERE user_id=$1", [id]);
}

/** All organization writes take this transaction-scoped advisory lock before allocating a version. */
export async function pgLockOrganization(client: PoolClient, companyId: string): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`organization:${companyId}`]);
}

export async function pgCurrentOrgVersion(companyId: string, client?: PoolClient): Promise<number> {
  const query = client ? client.query.bind(client) : undefined;
  const result = query
    ? await query<{ version: number }>("SELECT COALESCE(MAX(version),0)::int AS version FROM org_versions WHERE company_id=$1", [companyId])
    : { rows: await postgresQuery<{ version: number }>("SELECT COALESCE(MAX(version),0)::int AS version FROM org_versions WHERE company_id=$1", [companyId]) };
  return Number(result.rows[0]?.version || 0);
}

/** Increment exactly once while holding a per-company transaction advisory lock. */
export async function pgBumpOrgVersion(
  client: PoolClient,
  companyId: string,
  note: string,
  source: string,
  stamp: string,
): Promise<number> {
  await pgLockOrganization(client, companyId);
  const current = await pgCurrentOrgVersion(companyId, client);
  const version = current + 1;
  await client.query(
    "INSERT INTO org_versions (company_id,version,effective_at,note,source,created_at) VALUES ($1,$2,$3,$4,$5,$3)",
    [companyId, version, stamp, note, source],
  );
  return version;
}

export async function pgListOrganizationUnits(companyId?: string): Promise<OrganizationUnitRow[]> {
  return postgresQuery<OrganizationUnitRow>(
    companyId
      ? "SELECT * FROM organization_units WHERE company_id=$1 ORDER BY level,display_name"
      : "SELECT * FROM organization_units ORDER BY level,display_name",
    companyId ? [companyId] : [],
  );
}
export async function pgListOrganizationPeople(): Promise<OrganizationPersonRow[]> {
  return postgresQuery<OrganizationPersonRow>("SELECT * FROM organization_people ORDER BY display_name");
}
export async function pgListOrganizationMemberships(companyId?: string, stamp = new Date().toISOString()): Promise<OrganizationMembershipRow[]> {
  return postgresQuery<OrganizationMembershipRow>(
    companyId
      ? `SELECT * FROM organization_memberships WHERE status='active' AND ${activeNow} AND company_id=$2`
      : `SELECT * FROM organization_memberships WHERE status='active' AND ${activeNow}`,
    companyId ? [stamp, companyId] : [stamp],
  );
}
export async function pgListScopeMemberships(subjectType?: string, subjectId?: string, stamp = new Date().toISOString()): Promise<ScopeMembershipRow[]> {
  return postgresQuery<ScopeMembershipRow>(
    subjectType && subjectId
      ? `SELECT * FROM scope_memberships WHERE status='active' AND ${activeNow} AND subject_type=$2 AND subject_id=$3`
      : `SELECT * FROM scope_memberships WHERE status='active' AND ${activeNow}`,
    subjectType && subjectId ? [stamp, subjectType, subjectId] : [stamp],
  );
}
export async function pgListAgentBindings(agentId?: string, stamp = new Date().toISOString()): Promise<AgentBindingRow[]> {
  return postgresQuery<AgentBindingRow>(
    agentId
      ? `SELECT * FROM agent_bindings WHERE status='active' AND ${activeNow} AND agent_id=$2 ORDER BY target_type,target_id`
      : `SELECT * FROM agent_bindings WHERE status='active' AND ${activeNow} ORDER BY agent_id,target_type,target_id`,
    agentId ? [stamp, agentId] : [stamp],
  );
}

export async function pgOrganizationCoverageSource(stamp = new Date().toISOString()): Promise<{
  units: OrganizationUnitRow[]; people: OrganizationPersonRow[]; memberships: OrganizationMembershipRow[];
  versions: Array<{ company_id: string; version: number }>;
}> {
  const [units, people, memberships, versions] = await Promise.all([
    pgListOrganizationUnits(),
    pgListOrganizationPeople(),
    pgListOrganizationMemberships(undefined, stamp),
    postgresQuery<{ company_id: string; version: number }>(
      "SELECT DISTINCT ON (company_id) company_id,version FROM org_versions ORDER BY company_id,version DESC",
    ),
  ]);
  return { units, people, memberships, versions };
}

export async function pgAvatarUrlForUser(userId: string): Promise<string | null> {
  const [row] = await postgresQuery<{ avatar_url: string | null }>(
    "SELECT avatar_url FROM organization_people WHERE user_id=$1 AND status='active'", [userId],
  );
  return row?.avatar_url || null;
}

export async function pgPersonRefForUser(userId: string): Promise<string | null> {
  const [linked] = await postgresQuery<{ person_ref: string }>("SELECT person_ref FROM organization_people WHERE user_id=$1", [userId]);
  if (linked?.person_ref) return linked.person_ref;
  const [user] = await postgresQuery<{ id: string }>("SELECT id FROM users WHERE id=$1", [userId]);
  return user ? `person:user:${userId}` : null;
}

export type AgentBindingInput = {
  agent_id: string; target_type: "organization_unit" | "person"; target_id: string; company_id: string;
  created_by?: string | null; reason?: string | null; effective_from?: string | null; source?: string | null;
};

async function assertBindingTarget(client: PoolClient, input: AgentBindingInput, stamp: string): Promise<void> {
  if (input.target_type === "organization_unit") {
    const unit = (await client.query<{ company_id: string; status: string }>(
      "SELECT company_id,status FROM organization_units WHERE id=$1 FOR KEY SHARE", [input.target_id],
    )).rows[0];
    if (!unit || unit.status !== "active") throw new Error(`unknown active organization unit: ${input.target_id}`);
    if (unit.company_id !== input.company_id) throw new Error("binding target is outside the company");
    return;
  }
  const person = (await client.query<{ person_ref: string; status: string }>(
    "SELECT person_ref,status FROM organization_people WHERE person_ref=$1 FOR KEY SHARE", [input.target_id],
  )).rows[0];
  if (!person || person.status !== "active") throw new Error(`unknown active person: ${input.target_id}`);
  const membership = (await client.query(
    `SELECT 1 FROM organization_memberships WHERE person_ref=$1 AND company_id=$2 AND status='active'
       AND (effective_from IS NULL OR effective_from<=$3) AND (effective_to IS NULL OR effective_to>$3) LIMIT 1 FOR KEY SHARE`,
    [input.target_id, input.company_id, stamp],
  )).rows[0];
  if (!membership) throw new Error("binding target is outside the company");
}

export async function pgCreateAgentBindingInTransaction(client: PoolClient, input: AgentBindingInput, stamp: string): Promise<AgentBindingRow> {
  await pgLockOrganization(client, input.company_id);
  await assertBindingTarget(client, input, stamp);
  const id = `binding:${input.agent_id}:${input.target_type}:${input.target_id}`;
  const existing = (await client.query<AgentBindingRow>("SELECT * FROM agent_bindings WHERE id=$1 FOR UPDATE", [id])).rows[0];
  if (existing?.status === "active" && (!existing.effective_to || existing.effective_to > stamp)) return existing;
  const version = await pgCurrentOrgVersion(input.company_id, client);
  if (version < 1) throw new Error(`organization version is not initialized for ${input.company_id}`);
  if (existing) {
    const result = await client.query<AgentBindingRow>(`UPDATE agent_bindings SET status='active',binding_version=binding_version+1,org_version=$2,
      created_by=$3,reason=$4,effective_from=$5,effective_to=NULL,source=$6,updated_at=$7 WHERE id=$1 RETURNING *`,
      [id, version, input.created_by || null, input.reason || null, input.effective_from || stamp, input.source || "admin", stamp]);
    return result.rows[0]!;
  }
  const result = await client.query<AgentBindingRow>(`INSERT INTO agent_bindings
    (id,agent_id,target_type,target_id,company_id,status,binding_version,org_version,created_by,reason,effective_from,effective_to,source,created_at,updated_at)
    VALUES($1,$2,$3,$4,$5,'active',1,$6,$7,$8,$9,NULL,$10,$11,$11) RETURNING *`,
    [id, input.agent_id, input.target_type, input.target_id, input.company_id, version, input.created_by || null,
      input.reason || null, input.effective_from || stamp, input.source || "admin", stamp]);
  return result.rows[0]!;
}

export async function pgCreateAgentBinding(input: AgentBindingInput, stamp = new Date().toISOString()): Promise<AgentBindingRow> {
  return postgresTransaction((client) => pgCreateAgentBindingInTransaction(client, input, stamp), { isolation: "SERIALIZABLE" });
}

export async function pgRevokeAgentBinding(bindingId: string, reason: string, stamp = new Date().toISOString()): Promise<boolean> {
  return postgresTransaction(async (client) => {
    const result = await client.query<{ id: string }>(`UPDATE agent_bindings SET status='revoked',binding_version=binding_version+1,
      reason=$2,effective_to=$3,updated_at=$3 WHERE id=$1 AND status='active' RETURNING id`, [bindingId, reason, stamp]);
    return result.rowCount === 1;
  }, { isolation: "SERIALIZABLE" });
}

/** Synchronize the durable person/membership projection and atomically record all organization fact changes. */
export async function pgSyncOrganizationMembership(userId: string, unitId: string | null, now: string): Promise<void> {
  await postgresTransaction(async (client) => {
    const user = (await client.query<Row>("SELECT id,name,username,email FROM users WHERE id=$1 FOR KEY SHARE", [userId])).rows[0];
    if (!user) throw new Error("unknown user");
    const target = unitId ? (await client.query<{ id: string; company_id: string; status: string }>(
      "SELECT id,company_id,status FROM organization_units WHERE id=$1 FOR KEY SHARE", [unitId],
    )).rows[0] : undefined;
    if (unitId && (!target || target.status !== "active")) throw new Error("unknown active organization unit");
    const current = (await client.query<{ person_ref: string }>(
      "SELECT person_ref FROM organization_people WHERE user_id=$1 LIMIT 1 FOR UPDATE", [userId],
    )).rows[0];
    const personRef = current?.person_ref || `person:user:${userId}`;
    await client.query(`INSERT INTO organization_people(person_ref,display_name,user_ref,user_id,email,status,source,created_at,updated_at)
      VALUES($1,$2,$3,$3,$4,'active','admin',$5,$5)
      ON CONFLICT(person_ref) DO UPDATE SET display_name=EXCLUDED.display_name,user_id=EXCLUDED.user_id,
        email=EXCLUDED.email,status='active',updated_at=EXCLUDED.updated_at`,
    [personRef, user.name, userId, String(user.email || (String(user.username).includes("@") ? user.username : "")), now]);
    const old = (await client.query<{ id: string; company_id: string; org_unit_id: string }>(
      "SELECT id,company_id,org_unit_id FROM organization_memberships WHERE person_ref=$1 AND relation='primary' AND status='active' FOR UPDATE", [personRef],
    )).rows;
    for (const row of old) {
      if (row.org_unit_id === unitId) continue;
      await pgLockOrganization(client, row.company_id);
      await client.query("UPDATE organization_memberships SET status='ended',effective_to=$2,updated_at=$2 WHERE id=$1", [row.id, now]);
      await pgBumpOrgVersion(client, row.company_id, `员工 ${userId} 离开 ${row.org_unit_id}`, "admin", now);
    }
    if (target && !old.some((row) => row.org_unit_id === target.id)) {
      await pgLockOrganization(client, target.company_id);
      const id = `member:${personRef}:${target.id}:primary`;
      await client.query(`INSERT INTO organization_memberships
        (id,person_ref,company_id,org_unit_id,relation,status,effective_from,effective_to,source,created_at,updated_at)
        VALUES($1,$2,$3,$4,'primary','active',$5,NULL,'admin',$5,$5)
        ON CONFLICT(id) DO UPDATE SET status='active',effective_from=EXCLUDED.effective_from,effective_to=NULL,updated_at=EXCLUDED.updated_at`,
      [id, personRef, target.company_id, target.id, now]);
      await pgBumpOrgVersion(client, target.company_id, `员工 ${userId} 加入 ${target.id}`, "admin", now);
    }
  }, { isolation: "SERIALIZABLE" });
}
