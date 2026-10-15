/**
 * 组织树、人员外部引用、成员关系、范围关系与 Agent 资格。
 *
 * PostgreSQL 是唯一运行时权威：本模块只使用 postgres/pool 的异步查询及
 * PoolClient 事务；配置 registry 仅用作一次性、可显式重放的声明数据源。
 */
import fs from "node:fs";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { HttpFail } from "../host/errors.js";
import {
  pgAvatarUrlForUser,
  pgBumpOrgVersion,
  pgCreateAgentBinding,
  pgCreateAgentBindingInTransaction,
  pgCurrentOrgVersion,
  pgListAgentBindings,
  pgListAgentBindingsInTransaction,
  pgListOrganizationMemberships,
  pgListOrganizationPeople,
  pgListOrganizationUnits,
  pgListScopeMemberships,
  pgLockAgentBindings,
  pgLockOrganization,
  pgOrganizationCoverageSource,
  pgOrganizationCoverageSourceInTransaction,
  pgPersonRefForUser,
  pgRevokeAgentBinding,
  pgSyncOrganizationMembership,
  pgSyncOrganizationMembershipInTransaction,
  type AgentBindingInput,
} from "../postgres/organization-repository.js";
import { pgUserCanUseAgent, pgUserCanUseSkill, pgVisibleSkillIdsForUser } from "../postgres/auth-pg.js";
import { postgresQuery, postgresTransaction } from "../postgres/pool.js";
import { isPlatformAgent } from "./platform-principal.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SEED_KEY = "org_registry_v1";
const USER_PERSON_PREFIX = "person:user:";
let initializedFor: string | null = null;
let initialization: Promise<void> | null = null;

type RegistryPerson = {
  person_ref?: string; display_name?: string; role?: string | null; title?: string | null;
  org_unit?: string | null; user_ref?: string | null; account_username?: string | null;
  avatar?: string | null; starry_open_id?: string | null; email?: string | null;
  employee_no?: string | null; brand_scope?: string[]; region_scope?: string[]; source?: string;
};
type RegistryUnit = {
  id?: string; display_name?: string; type?: string; parent?: string | null; head?: string | null;
  head_person_ref?: string | null; brand_scope?: string[];
};
type RegistryBinding = {
  agent_id?: string; target_type?: "organization_unit" | "person"; target_id?: string;
  reason?: string | null; source?: string | null;
};
type OrgRegistry = {
  revision?: string; companies?: { id?: string; display_name?: string }[];
  organization_units?: RegistryUnit[]; confirmed_people?: RegistryPerson[]; agent_bindings?: RegistryBinding[];
};

export type OrganizationUnitRow = {
  id: string; company_id: string; display_name: string; type: string; parent_id: string | null;
  level: number; head_person_ref: string | null; head_display_name: string | null; status: string;
  org_version: number; source: string | null;
};
export type OrganizationPersonRow = {
  person_ref: string; display_name: string; user_ref: string | null; user_id: string | null;
  starry_open_id: string | null; email: string | null; employee_no: string | null;
  avatar_url: string | null; status: string; source: string | null;
};
export type OrganizationMembershipRow = {
  id: string; person_ref: string; company_id: string; org_unit_id: string; relation: string;
  position: string | null; status: string; effective_from: string | null; effective_to: string | null; source: string | null;
};
export type ScopeMembershipRow = {
  id: string; subject_type: string; subject_id: string; company_id: string; brand_id: string | null;
  region_id: string | null; status: string; effective_from: string | null; effective_to: string | null; source: string | null;
};
export type AgentBindingRow = {
  id: string; agent_id: string; target_type: "organization_unit" | "person"; target_id: string;
  company_id: string; status: string; binding_version: number; org_version: number; created_by: string | null;
  reason: string | null; effective_from: string | null; effective_to: string | null; source: string | null;
};
export type EffectiveUserSource = {
  via: "binding_target" | "unit_head" | "unit_member" | "ancestor_head";
  via_unit_id: string; via_unit_display_name: string | null; binding_id: string;
  binding_target_type: "organization_unit" | "person"; binding_target_id: string; binding_target_display_name: string | null;
};
export type EffectiveUser = {
  person_ref: string; user_id: string | null; display_name: string | null;
  via: EffectiveUserSource["via"]; via_unit_id: string; via_unit_display_name: string | null;
  binding_id: string; sources: EffectiveUserSource[];
};
export type EffectiveAgentUsers = {
  agent_id: string; org_version: number; users: EffectiveUser[]; person_refs: string[]; user_ids: string[];
};
export type OrganizationCoverageSource = {
  units: OrganizationUnitRow[]; people: OrganizationPersonRow[]; memberships: OrganizationMembershipRow[];
  versions: Array<{ company_id: string; version: number }>;
};

function nowIso(): string { return new Date().toISOString(); }
function readRegistry(): OrgRegistry {
  const text = fs.readFileSync(path.join(repoRoot, "config", "org-registry.yaml"), "utf8").replace(/^\uFEFF/, "");
  const parsed = parseYaml(text) as OrgRegistry | null;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("org registry root must be a mapping");
  return parsed;
}
/** Company names are presentation metadata, never an authorization grant. */
export function organizationCompanyName(id: string): string {
  return readRegistry().companies?.find((company) => company.id === id)?.display_name || id;
}
function unitLevels(units: RegistryUnit[]): Map<string, number> {
  const byId = new Map(units.map((unit) => [String(unit.id), unit]));
  const levels = new Map<string, number>();
  const levelOf = (id: string, chain: Set<string>): number => {
    const known = levels.get(id);
    if (known) return known;
    if (chain.has(id)) throw new Error(`organization cycle at ${id}`);
    chain.add(id);
    const parent = byId.get(id)?.parent ? String(byId.get(id)?.parent) : "";
    const level = parent && byId.has(parent) ? levelOf(parent, chain) + 1 : 1;
    levels.set(id, level);
    return level;
  };
  for (const unit of units) levelOf(String(unit.id), new Set());
  return levels;
}

async function upsertRegistry(client: Parameters<typeof postgresTransaction>[0] extends (client: infer T) => Promise<unknown> ? T : never, registry: OrgRegistry): Promise<void> {
  const company = String((registry.companies || [])[0]?.id || "");
  if (!company) throw new Error("org registry has no company");
  const units = (registry.organization_units || []).filter((unit) => typeof unit?.id === "string");
  const levels = unitLevels(units);
  const stamp = nowIso();
  const source = registry.revision || "config/org-registry.yaml";
  await pgLockOrganization(client, company);
  for (const unit of units) {
    const id = String(unit.id);
    await client.query(`INSERT INTO organization_units
      (id,company_id,display_name,type,parent_id,level,head_person_ref,head_display_name,status,org_version,source,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,'active',1,$9,$10,$10)
      ON CONFLICT(id) DO UPDATE SET company_id=EXCLUDED.company_id,display_name=EXCLUDED.display_name,type=EXCLUDED.type,
        parent_id=EXCLUDED.parent_id,level=EXCLUDED.level,head_person_ref=EXCLUDED.head_person_ref,
        head_display_name=EXCLUDED.head_display_name,source=EXCLUDED.source,updated_at=EXCLUDED.updated_at`,
    [id, company, unit.display_name || id, unit.type || "department", unit.parent && unit.parent !== company ? String(unit.parent) : null,
      levels.get(id) || 1, unit.head_person_ref || null, unit.head || null, source, stamp]);
    for (const brandId of (unit.brand_scope || []).map(String)) {
      const scopeId = `scope:org_unit:${id}:brand:${brandId}:region:*`;
      await client.query(`INSERT INTO scope_memberships
        (id,subject_type,subject_id,company_id,brand_id,region_id,status,effective_from,effective_to,source,created_at,updated_at)
        VALUES($1,'organization_unit',$2,$3,$4,NULL,'active',NULL,NULL,$5,$6,$6)
        ON CONFLICT(id) DO UPDATE SET company_id=EXCLUDED.company_id,brand_id=EXCLUDED.brand_id,status='active',
          effective_to=NULL,source=EXCLUDED.source,updated_at=EXCLUDED.updated_at`, [scopeId, id, company, brandId, source, stamp]);
    }
  }
  for (const person of registry.confirmed_people || []) {
    const personRef = person.person_ref;
    if (!personRef) throw new Error(`confirmed person without person_ref: ${person.display_name || "unknown"}`);
    const account = person.account_username ? (await client.query<{ id: string }>("SELECT id FROM users WHERE username=$1", [person.account_username])).rows[0] : undefined;
    const linked = (await client.query<{ user_id: string | null; email: string | null }>(
      "SELECT user_id,email FROM organization_people WHERE person_ref=$1 FOR UPDATE", [personRef],
    )).rows[0];
    const linkedUser = linked?.user_id ? (await client.query<{ id: string }>("SELECT id FROM users WHERE id=$1", [linked.user_id])).rows[0] : undefined;
    await client.query(`INSERT INTO organization_people
      (person_ref,display_name,user_ref,user_id,starry_open_id,email,employee_no,avatar_url,status,source,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,'active',$9,$10,$10)
      ON CONFLICT(person_ref) DO UPDATE SET display_name=EXCLUDED.display_name,user_ref=EXCLUDED.user_ref,
        user_id=EXCLUDED.user_id,starry_open_id=EXCLUDED.starry_open_id,email=EXCLUDED.email,employee_no=EXCLUDED.employee_no,
        avatar_url=EXCLUDED.avatar_url,status='active',source=EXCLUDED.source,updated_at=EXCLUDED.updated_at`,
    [personRef, person.display_name || personRef, person.user_ref || null, account?.id || linkedUser?.id || null,
      person.starry_open_id || null, person.email || linked?.email || null, person.employee_no || null,
      person.avatar ? `/avatars/${person.avatar}` : null, person.source || source, stamp]);
    const orgUnit = person.org_unit ? String(person.org_unit) : null;
    if (orgUnit) {
      const membershipId = `member:${personRef}:${orgUnit}:primary`;
      await client.query(`INSERT INTO organization_memberships
        (id,person_ref,company_id,org_unit_id,relation,position,status,effective_from,effective_to,source,created_at,updated_at)
        VALUES($1,$2,$3,$4,'primary',$5,'active',NULL,NULL,$6,$7,$7)
        ON CONFLICT(id) DO UPDATE SET company_id=EXCLUDED.company_id,org_unit_id=EXCLUDED.org_unit_id,position=EXCLUDED.position,
          status='active',effective_to=NULL,source=EXCLUDED.source,updated_at=EXCLUDED.updated_at`,
      [membershipId, personRef, company, orgUnit, person.title || null, person.source || source, stamp]);
    }
    for (const brandId of (person.brand_scope || []).map(String)) for (const regionId of (person.region_scope || []).map(String)) {
      const scopeId = `scope:person:${personRef}:brand:${brandId}:region:${regionId}`;
      await client.query(`INSERT INTO scope_memberships
        (id,subject_type,subject_id,company_id,brand_id,region_id,status,effective_from,effective_to,source,created_at,updated_at)
        VALUES($1,'person',$2,$3,$4,$5,'active',NULL,NULL,$6,$7,$7)
        ON CONFLICT(id) DO UPDATE SET company_id=EXCLUDED.company_id,brand_id=EXCLUDED.brand_id,region_id=EXCLUDED.region_id,
          status='active',effective_to=NULL,source=EXCLUDED.source,updated_at=EXCLUDED.updated_at`,
      [scopeId, personRef, company, brandId, regionId, person.source || source, stamp]);
    }
  }
  if (await pgCurrentOrgVersion(company, client) === 0) {
    await client.query("INSERT INTO org_versions(company_id,version,effective_at,note,source,created_at) VALUES($1,1,$2,$3,$4,$2)",
      [company, stamp, "组织事实首次落库：三级组织单元、人员外部引用、成员关系与范围关系", source]);
  }
  for (const declared of registry.agent_bindings || []) {
    if (!declared?.agent_id || !declared.target_type || !declared.target_id) continue;
    await pgCreateAgentBindingInTransaction(client, {
      agent_id: String(declared.agent_id), target_type: declared.target_type, target_id: String(declared.target_id), company_id: company,
      reason: declared.reason || null, source: declared.source || source,
    }, stamp);
  }
}

/** Seed declaration data once without runtime DDL. The lock prevents duplicate concurrent initialization. */
export async function ensureOrganizationTree(): Promise<void> {
  const database = String(process.env.DATABASE_URL || "");
  if (initializedFor === database) return;
  if (!initialization) initialization = postgresTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [SEED_KEY]);
    const existing = (await client.query("SELECT 1 FROM app_state WHERE key=$1 FOR UPDATE", [SEED_KEY])).rows[0];
    if (!existing) {
      await upsertRegistry(client, readRegistry());
      await client.query("INSERT INTO app_state(key,value) VALUES($1,$2)", [SEED_KEY, nowIso()]);
    }
    initializedFor = database;
  }, { isolation: "SERIALIZABLE" }).finally(() => { initialization = null; });
  await initialization;
}
/** Explicit administrative re-import. This is idempotent and uses the migrated schema; it never issues DDL. */
export async function reseedOrganizationTreeFromRegistry(): Promise<void> {
  await postgresTransaction(async (client) => (await upsertRegistry(client, readRegistry())), { isolation: "SERIALIZABLE" });
}

export async function listOrganizationUnits(companyId?: string): Promise<OrganizationUnitRow[]> {
  await ensureOrganizationTree();
  return pgListOrganizationUnits(companyId);
}
export async function listOrganizationPeople(): Promise<OrganizationPersonRow[]> {
  await ensureOrganizationTree();
  return pgListOrganizationPeople();
}
export async function avatarUrlForUser(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  await ensureOrganizationTree();
  return pgAvatarUrlForUser(userId);
}
export async function listOrganizationMemberships(companyId?: string): Promise<OrganizationMembershipRow[]> {
  await ensureOrganizationTree();
  return pgListOrganizationMemberships(companyId);
}
export async function listScopeMemberships(subjectType?: string, subjectId?: string): Promise<ScopeMembershipRow[]> {
  await ensureOrganizationTree();
  return pgListScopeMemberships(subjectType, subjectId);
}
export async function listAgentBindings(agentId?: string): Promise<AgentBindingRow[]> {
  await ensureOrganizationTree();
  return pgListAgentBindings(agentId);
}
export async function createAgentBinding(input: AgentBindingInput): Promise<AgentBindingRow> {
  if (isPlatformAgent(input.agent_id)) throw new HttpFail(409, { code: "platform_agent_not_bindable", message: "平台系统智能体不对应人员，不能绑定组织或人员。" });
  await ensureOrganizationTree();
  return pgCreateAgentBinding(input);
}
export async function revokeAgentBinding(bindingId: string, input?: { reason?: string | null }): Promise<boolean> {
  await ensureOrganizationTree();
  return pgRevokeAgentBinding(bindingId, input?.reason || "revoked");
}
export async function currentOrgVersion(companyId: string): Promise<number> {
  await ensureOrganizationTree();
  return pgCurrentOrgVersion(companyId);
}
/** Fact versions are incremented in one native transaction under a company advisory lock. */
export async function bumpOrgVersion(companyId: string, note: string, source = "admin"): Promise<number> {
  await ensureOrganizationTree();
  return postgresTransaction((client) => pgBumpOrgVersion(client, companyId, note, source, nowIso()), { isolation: "SERIALIZABLE" });
}

function ascendants(units: OrganizationUnitRow[], unitId: string): OrganizationUnitRow[] {
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const chain: OrganizationUnitRow[] = [];
  const seen = new Set<string>();
  let current = byId.get(unitId)?.parent_id ?? null;
  while (current && !seen.has(current)) { seen.add(current); const unit = byId.get(current); if (!unit) break; chain.push(unit); current = unit.parent_id; }
  return chain;
}
function descendants(units: OrganizationUnitRow[], unitId: string): OrganizationUnitRow[] {
  const out: OrganizationUnitRow[] = []; let frontier = [unitId]; const seen = new Set(frontier);
  while (frontier.length) { const children = units.filter((unit) => unit.parent_id && frontier.includes(unit.parent_id)); frontier = [];
    for (const child of children) if (!seen.has(child.id)) { seen.add(child.id); out.push(child); frontier.push(child.id); } }
  return out;
}
export type SimulatedPerson = { person: OrganizationPersonRow; membership: OrganizationMembershipRow | null };

/** Pure coverage kernel; storage callers provide an effective (time-filtered) source. */
function computeCoverage(
  agentId: string, bindings: AgentBindingRow[], source: OrganizationCoverageSource,
  simulatePerson?: (personRef: string, companyId: string) => SimulatedPerson | null,
): EffectiveAgentUsers {
  const byRef = new Map<string, EffectiveUser>();
  const rank: Record<EffectiveUser["via"], number> = { binding_target: 0, unit_head: 1, unit_member: 2, ancestor_head: 3 };
  let orgVersion = 0;
  for (const companyId of new Set(bindings.map((binding) => binding.company_id))) {
    const units = source.units.filter((unit) => unit.company_id === companyId && unit.status === "active");
    const byId = new Map(units.map((unit) => [unit.id, unit]));
    const memberships = source.memberships.filter((row) => row.company_id === companyId && row.status === "active");
    const people = new Map(source.people.map((person) => [person.person_ref, person]));
    orgVersion = Math.max(orgVersion, Number(source.versions.find((row) => row.company_id === companyId)?.version || 0));
    const add = (personRef: string, via: EffectiveUser["via"], unitId: string, binding: AgentBindingRow): void => {
      const unit = byId.get(unitId); const person = people.get(personRef);
      // Revoked/left organization facts must never keep an authorization alive.
      if (person && person.status !== "active") return;
      const item: EffectiveUserSource = { via, via_unit_id: unitId, via_unit_display_name: unit?.display_name || null,
        binding_id: binding.id, binding_target_type: binding.target_type, binding_target_id: binding.target_id,
        binding_target_display_name: binding.target_type === "person" ? people.get(binding.target_id)?.display_name || null : byId.get(binding.target_id)?.display_name || null };
      const existing = byRef.get(personRef); const sources = existing?.sources || []; const same = sources.findIndex((row) => row.binding_id === binding.id);
      if (same < 0) sources.push(item); else if (rank[via] < rank[sources[same].via]) sources[same] = item;
      if (existing && rank[via] >= rank[existing.via]) return;
      byRef.set(personRef, { person_ref: personRef, user_id: person?.user_id || null, display_name: person?.display_name || null,
        via, via_unit_id: unitId, via_unit_display_name: item.via_unit_display_name, binding_id: binding.id, sources });
    };
    for (const binding of bindings.filter((row) => row.company_id === companyId)) {
      if (binding.target_type === "person") {
        const simulated = memberships.some((row) => row.person_ref === binding.target_id) ? null : simulatePerson?.(binding.target_id, companyId) || null;
        if (simulated && !people.has(simulated.person.person_ref)) people.set(simulated.person.person_ref, simulated.person);
        const membership = memberships.find((row) => row.person_ref === binding.target_id) || (simulated?.membership?.company_id === companyId ? simulated.membership : undefined);
        add(binding.target_id, "binding_target", membership?.org_unit_id || "", binding);
        if (membership) { const own = byId.get(membership.org_unit_id); if (own?.head_person_ref) add(own.head_person_ref, "unit_head", own.id, binding);
          for (const unit of ascendants(units, membership.org_unit_id)) if (unit.head_person_ref) add(unit.head_person_ref, "ancestor_head", unit.id, binding); }
        continue;
      }
      const unit = byId.get(binding.target_id); if (!unit) continue;
      if (unit.head_person_ref) add(unit.head_person_ref, "unit_head", unit.id, binding);
      for (const scoped of [unit, ...descendants(units, unit.id)]) {
        for (const membership of memberships.filter((row) => row.org_unit_id === scoped.id)) add(membership.person_ref, "unit_member", scoped.id, binding);
        if (scoped.id !== unit.id && scoped.head_person_ref) add(scoped.head_person_ref, "unit_head", scoped.id, binding);
      }
      for (const ancestor of ascendants(units, unit.id)) if (ancestor.head_person_ref) add(ancestor.head_person_ref, "ancestor_head", ancestor.id, binding);
    }
  }
  const users = [...byRef.values()];
  return { agent_id: agentId, org_version: orgVersion, users, person_refs: users.map((user) => user.person_ref), user_ids: users.map((user) => user.user_id).filter((id): id is string => Boolean(id)) };
}
export async function computeEffectiveAgentUsers(
  agentId: string, bindings: AgentBindingRow[], simulatePerson?: (personRef: string, companyId: string) => Promise<SimulatedPerson | null>, source?: OrganizationCoverageSource,
): Promise<EffectiveAgentUsers> {
  await ensureOrganizationTree();
  const facts = source || await pgOrganizationCoverageSource();
  if (!simulatePerson) return computeCoverage(agentId, bindings, facts);
  // Preview only has at most a bounded number of person targets; resolve before pure computation.
  const resolved = new Map<string, SimulatedPerson | null>();
  for (const binding of bindings.filter((binding) => binding.target_type === "person" && !facts.memberships.some((row) => row.person_ref === binding.target_id))) {
    if (!resolved.has(binding.target_id)) resolved.set(binding.target_id, await simulatePerson(binding.target_id, binding.company_id));
  }
  return computeCoverage(agentId, bindings, facts, (personRef) => resolved.get(personRef) || null);
}
export async function effectiveAgentUsers(agentId: string): Promise<EffectiveAgentUsers> {
  await ensureOrganizationTree();
  const [bindings, source] = await Promise.all([pgListAgentBindings(agentId), pgOrganizationCoverageSource()]);
  return computeCoverage(agentId, bindings, source);
}

export type AgentBindingPreview = {
  agent_id: string; preview_signature: string; org_version: number;
  before: { person_refs: string[]; user_ids: string[] }; after: { person_refs: string[]; user_ids: string[] };
  added: EffectiveUser[]; removed: EffectiveUser[];
};
export type AgentBindingChange =
  | { add: { target_type: "organization_unit" | "person"; target_id: string; company_id: string } }
  | { add_many: Array<{ target_type: "organization_unit" | "person"; target_id: string; company_id: string }> }
  | { remove: string };

async function simulatePersonFromSite(personRef: string, companyId: string, client?: PoolClient): Promise<SimulatedPerson | null> {
  const people = client
    ? (await client.query<OrganizationPersonRow>("SELECT * FROM organization_people WHERE person_ref=$1", [personRef])).rows
    : await postgresQuery<OrganizationPersonRow>("SELECT * FROM organization_people WHERE person_ref=$1", [personRef]);
  const row = people[0];
  const userId = row?.user_id || (personRef.startsWith(USER_PERSON_PREFIX) ? personRef.slice(USER_PERSON_PREFIX.length) : "");
  if (!userId) return null;
  const users = client
    ? (await client.query<{ id: string; name: string; site: string | null; active: number }>("SELECT id,name,site,active FROM users WHERE id=$1", [userId])).rows
    : await postgresQuery<{ id: string; name: string; site: string | null; active: number }>("SELECT id,name,site,active FROM users WHERE id=$1", [userId]);
  const user = users[0];
  if (!user) return null;
  const person = row ? { ...row, user_id: userId } : { person_ref: personRef, display_name: user.name, user_ref: userId, user_id: userId,
    starry_open_id: null, email: null, employee_no: null, avatar_url: null, status: Number(user.active) === 1 ? "active" : "left", source: "preview" };
  const units = user.site
    ? (client
      ? (await client.query<OrganizationUnitRow>("SELECT * FROM organization_units WHERE id=$1 AND status='active'", [user.site])).rows
      : await postgresQuery<OrganizationUnitRow>("SELECT * FROM organization_units WHERE id=$1 AND status='active'", [user.site]))
    : [];
  const unit = units[0];
  if (!unit || unit.company_id !== companyId) return { person, membership: null };
  return { person, membership: { id: `preview:${personRef}:${unit.id}`, person_ref: personRef, company_id: unit.company_id, org_unit_id: unit.id,
    relation: "primary", position: null, status: "active", effective_from: null, effective_to: null, source: "preview" } };
}

async function previewAgentBindingFromBasis(
  agentId: string,
  change: AgentBindingChange,
  current: AgentBindingRow[],
  source: OrganizationCoverageSource,
  personExists: (personRef: string) => Promise<boolean>,
  simulatePerson: (personRef: string, companyId: string) => Promise<SimulatedPerson | null>,
): Promise<AgentBindingPreview> {
  const before = computeCoverage(agentId, current, source);
  let bindings = current;
  let needsSimulation = false;
  if ("remove" in change) {
    if (!current.some((row) => row.id === change.remove)) throw new Error(`unknown binding: ${change.remove}`);
    bindings = current.filter((row) => row.id !== change.remove);
  } else {
    const targets = "add_many" in change ? change.add_many : [change.add]; const seen = new Set<string>(); const virtual: AgentBindingRow[] = [];
    for (const target of targets) {
      const key = `${target.target_type}:${target.target_id}`; if (seen.has(key)) continue; seen.add(key);
      if (target.target_type === "organization_unit") {
        const unit = source.units.find((unit) => unit.id === target.target_id && unit.status === "active");
        if (!unit) throw new Error(`unknown organization unit: ${target.target_id}`);
        if (unit.company_id !== target.company_id) throw new Error("binding target is outside the company");
      } else {
        const known = source.people.some((person) => person.person_ref === target.target_id && person.status === "active")
          || (target.target_id.startsWith(USER_PERSON_PREFIX) && await personExists(target.target_id.slice(USER_PERSON_PREFIX.length)));
        if (!known) throw new Error(`unknown person: ${target.target_id}`);
        needsSimulation = true;
      }
      if (!current.some((row) => row.target_type === target.target_type && row.target_id === target.target_id)) virtual.push({
        id: `preview:${key}`, agent_id: agentId, target_type: target.target_type, target_id: target.target_id, company_id: target.company_id,
        status: "active", binding_version: 0, org_version: Number(source.versions.find((row) => row.company_id === target.company_id)?.version || 0),
        created_by: null, reason: null, effective_from: null, effective_to: null, source: "preview",
      });
    }
    bindings = [...current, ...virtual];
  }
  const after = needsSimulation ? await computeEffectiveAgentUsers(agentId, bindings, simulatePerson, source) : computeCoverage(agentId, bindings, source);
  const beforeRefs = new Set(before.person_refs); const afterRefs = new Set(after.person_refs);
  const versions = [...new Set(bindings.map((row) => row.company_id))].sort().map((company_id) => ({ company_id, version: Number(source.versions.find((row) => row.company_id === company_id)?.version || 0) }));
  return { agent_id: agentId, org_version: Math.max(before.org_version, after.org_version),
    preview_signature: createHash("sha256").update(JSON.stringify({ current, change, versions, before, after })).digest("hex"),
    before: { person_refs: before.person_refs, user_ids: before.user_ids }, after: { person_refs: after.person_refs, user_ids: after.user_ids },
    added: after.users.filter((user) => !beforeRefs.has(user.person_ref)), removed: before.users.filter((user) => !afterRefs.has(user.person_ref)) };
}

export async function previewAgentBinding(agentId: string, change: AgentBindingChange): Promise<AgentBindingPreview> {
  await ensureOrganizationTree();
  const [current, source] = await Promise.all([pgListAgentBindings(agentId), pgOrganizationCoverageSource()]);
  return previewAgentBindingFromBasis(
    agentId, change, current, source,
    async (userId) => (await postgresQuery("SELECT 1 FROM users WHERE id=$1", [userId])).length > 0,
    (personRef, companyId) => simulatePersonFromSite(personRef, companyId),
  );
}

/** Request shape accepted by the administrative bulk preview/apply endpoints. */
export type BulkAgentBindingTarget = {
  target_type?: "organization_unit" | "person";
  target_id?: string;
  user_id?: string;
};
type ResolvedBulkAgentBindingTarget = {
  target_type: "organization_unit" | "person";
  target_id: string;
  company_id: string;
  sync_user_id?: string;
  sync_user_site?: string | null;
};

/**
 * Resolve an administrative target using the transaction client.  The server,
 * never the caller, derives its company from authoritative organization facts.
 */
async function resolveBulkBindingTargetsInTransaction(client: PoolClient, rows: BulkAgentBindingTarget[]): Promise<ResolvedBulkAgentBindingTarget[]> {
  if (!rows.length || rows.length > 200) throw new HttpFail(400, "请选择 1 至 200 个绑定目标");
  const configuredCompanies = (await client.query<{ company_id: string }>(
    "SELECT DISTINCT company_id FROM organization_units WHERE status='active' ORDER BY company_id",
  )).rows.map((row) => row.company_id);
  const resolved: ResolvedBulkAgentBindingTarget[] = [];
  for (const row of rows) {
    if (row.target_type !== "organization_unit" && row.target_type !== "person") throw new HttpFail(400, "绑定类型无效");
    const targetType = row.target_type;
    let targetId = String(row.target_id || "").trim();
    let syncUserId: string | undefined;
    let syncUserSite: string | null | undefined;
    if (targetType === "person" && row.user_id) {
      const userId = String(row.user_id).trim();
      const user = (await client.query<{ id: string; site: string | null; active: number }>(
        "SELECT id,site,active FROM users WHERE id=$1 FOR KEY SHARE", [userId],
      )).rows[0];
      if (!user || Number(user.active) !== 1) throw new HttpFail(404, "员工不存在或已停用");
      const linked = (await client.query<{ person_ref: string }>(
        "SELECT person_ref FROM organization_people WHERE user_id=$1 FOR KEY SHARE", [user.id],
      )).rows[0];
      targetId = linked?.person_ref || `${USER_PERSON_PREFIX}${user.id}`;
      syncUserId = user.id;
      syncUserSite = user.site;
    }
    if (!targetId) throw new HttpFail(400, targetType === "organization_unit" ? "请选择有效的组织单元" : "请选择已确认的人员");
    if (targetType === "organization_unit") {
      const unit = (await client.query<{ company_id: string; status: string }>(
        "SELECT company_id,status FROM organization_units WHERE id=$1 FOR KEY SHARE", [targetId],
      )).rows[0];
      if (!unit || unit.status !== "active") throw new HttpFail(400, "请选择有效的组织单元");
      resolved.push({ target_type: targetType, target_id: targetId, company_id: unit.company_id });
      continue;
    }
    if (!syncUserId) {
      const person = (await client.query<{ status: string }>(
        "SELECT status FROM organization_people WHERE person_ref=$1 FOR KEY SHARE", [targetId],
      )).rows[0];
      if (!person || person.status !== "active") throw new HttpFail(400, "请选择已确认的人员");
    }
    const membership = (await client.query<{ company_id: string }>(
      `SELECT company_id FROM organization_memberships
       WHERE person_ref=$1 AND status='active' AND (effective_from IS NULL OR effective_from <= $2)
         AND (effective_to IS NULL OR effective_to > $2) ORDER BY company_id LIMIT 1 FOR KEY SHARE`,
      [targetId, nowIso()],
    )).rows[0];
    let companyId = membership?.company_id;
    if (!companyId && syncUserSite) {
      const unit = (await client.query<{ company_id: string; status: string }>(
        "SELECT company_id,status FROM organization_units WHERE id=$1 FOR KEY SHARE", [syncUserSite],
      )).rows[0];
      if (unit?.status === "active") companyId = unit.company_id;
    }
    if (!companyId && configuredCompanies.length !== 1) throw new HttpFail(409, "人员公司归属未确认");
    if (!companyId) companyId = configuredCompanies[0];
    if (!companyId) throw new HttpFail(409, "组织公司未配置");
    resolved.push({ target_type: targetType, target_id: targetId, company_id: companyId, sync_user_id: syncUserId, sync_user_site: syncUserSite });
  }
  return [...new Map(resolved.map((target) => [`${target.target_type}:${target.target_id}`, target])).values()];
}

async function previewBulkFromTransaction(
  client: PoolClient,
  agentId: string,
  targets: ResolvedBulkAgentBindingTarget[],
  current?: AgentBindingRow[],
  source?: OrganizationCoverageSource,
): Promise<AgentBindingPreview> {
  const bindings = current || await pgListAgentBindingsInTransaction(client, agentId);
  const coverage = source || await pgOrganizationCoverageSourceInTransaction(client);
  const change: AgentBindingChange = { add_many: targets.map(({ target_type, target_id, company_id }) => ({ target_type, target_id, company_id })) };
  return previewAgentBindingFromBasis(
    agentId, change, bindings, coverage,
    async (userId) => (await client.query("SELECT 1 FROM users WHERE id=$1", [userId])).rowCount > 0,
    (personRef, companyId) => simulatePersonFromSite(personRef, companyId, client),
  );
}

/** Native PostgreSQL preview. Apply recomputes this exact shape under locks before writing. */
export async function previewBulkAgentBindings(agentId: string, rows: BulkAgentBindingTarget[]): Promise<AgentBindingPreview> {
  await ensureOrganizationTree();
  return postgresTransaction(async (client) => {
    const targets = await resolveBulkBindingTargetsInTransaction(client, rows);
    return previewBulkFromTransaction(client, agentId, targets);
  }, { isolation: "REPEATABLE READ" });
}

export type ApplyBulkAgentBindingsInput = {
  agent_id: string;
  targets: BulkAgentBindingTarget[];
  expected_org_version: number;
  preview_signature: string;
  created_by: string;
  reason?: string | null;
};
export type AppliedBulkAgentBindings = { preview: AgentBindingPreview; bindings: AgentBindingRow[] };

/** Authorization is checked again from the authoritative user row within apply's transaction. */
async function assertBindingAdministratorInTransaction(client: PoolClient, actorId: string): Promise<void> {
  const actor = (await client.query<{ active: number; roles: string }>(
    "SELECT active,roles FROM users WHERE id=$1 FOR KEY SHARE", [actorId],
  )).rows[0];
  let roles: unknown = [];
  try { roles = JSON.parse(String(actor?.roles || "[]")); } catch { /* fail closed below */ }
  if (!actor || Number(actor.active) !== 1 || !Array.isArray(roles) || !roles.map(String).includes("admin")) {
    throw new HttpFail(403, "admin required");
  }
}

/**
 * Recompute and verify preview evidence on the same locked basis, then write
 * every target on this PoolClient.  No target may start its own transaction.
 */
export async function applyBulkAgentBindings(input: ApplyBulkAgentBindingsInput): Promise<AppliedBulkAgentBindings> {
  if (!Number.isInteger(input.expected_org_version) || input.expected_org_version < 0 || !input.preview_signature) {
    throw new HttpFail(400, "org_version 和 preview_signature 必填");
  }
  await ensureOrganizationTree();
  return postgresTransaction(async (client) => {
    await assertBindingAdministratorInTransaction(client, input.created_by);
    await pgLockAgentBindings(client, input.agent_id);
    const targets = await resolveBulkBindingTargetsInTransaction(client, input.targets);
    const current = await pgListAgentBindingsInTransaction(client, input.agent_id);
    const companies = [...new Set([...current, ...targets].map((row) => row.company_id))].sort();
    for (const companyId of companies) await pgLockOrganization(client, companyId);
    const source = await pgOrganizationCoverageSourceInTransaction(client);
    const preview = await previewBulkFromTransaction(client, input.agent_id, targets, current, source);
    if (preview.org_version !== input.expected_org_version) throw new HttpFail(409, "组织版本已变化，请重新预览绑定影响");
    if (preview.preview_signature !== input.preview_signature) throw new HttpFail(409, "覆盖依据已变化，请重新预览绑定影响");

    const stamp = nowIso();
    for (const target of targets) {
      if (!target.sync_user_id) continue;
      const personRef = await pgSyncOrganizationMembershipInTransaction(client, target.sync_user_id, target.sync_user_site || null, stamp);
      if (personRef !== target.target_id) throw new Error("organization person reference changed while applying binding");
    }
    const bindings: AgentBindingRow[] = [];
    for (const target of targets) {
      bindings.push(await pgCreateAgentBindingInTransaction(client, {
        agent_id: input.agent_id,
        target_type: target.target_type,
        target_id: target.target_id,
        company_id: target.company_id,
        created_by: input.created_by,
        reason: input.reason || "管理侧批量绑定",
        source: "admin",
      }, stamp));
    }
    return { preview, bindings };
  }, { isolation: "SERIALIZABLE" });
}

export async function canUseAgent(userId: string | null | undefined, agentId: string): Promise<boolean> {
  if (!userId) return false;
  await ensureOrganizationTree();
  return pgUserCanUseAgent(userId, agentId, nowIso());
}
/** Account organization projection is changed and versioned atomically in the repository transaction. */
export async function syncUserOrganization(userId: string, unitId: string | null | undefined): Promise<string> {
  await ensureOrganizationTree();
  await pgSyncOrganizationMembership(userId, unitId || null, nowIso());
  return (await pgPersonRefForUser(userId)) || `${USER_PERSON_PREFIX}${userId}`;
}
export async function canUseSkill(userId: string | null | undefined, skillId: string): Promise<boolean> {
  if (!userId) return false;
  await ensureOrganizationTree();
  return pgUserCanUseSkill(userId, skillId, nowIso());
}
export async function visibleSkillIdsForUser(userId: string | null | undefined): Promise<string[]> {
  if (!userId) return [];
  await ensureOrganizationTree();
  return pgVisibleSkillIdsForUser(userId, nowIso());
}
export type LeaderScope = { isLeader: boolean; unitIds: string[]; memberUserIds: string[] };
export async function leaderScopeForUser(userId: string | null | undefined): Promise<LeaderScope> {
  const empty: LeaderScope = { isLeader: false, unitIds: [], memberUserIds: [] };
  if (!userId) return empty;
  await ensureOrganizationTree();
  const personRef = await pgPersonRefForUser(userId); if (!personRef) return empty;
  const [units, memberships] = await Promise.all([pgListOrganizationUnits(), pgListOrganizationMemberships()]);
  const headed = units.filter((unit) => unit.status === "active" && unit.head_person_ref === personRef).map((unit) => unit.id);
  if (!headed.length) return empty;
  const children = new Map<string, string[]>();
  for (const unit of units.filter((unit) => unit.status === "active" && unit.parent_id)) { const list = children.get(unit.parent_id!) || []; list.push(unit.id); children.set(unit.parent_id!, list); }
  const unitIds = new Set<string>(); const queue = [...headed];
  while (queue.length) { const current = queue.shift()!; if (unitIds.has(current)) continue; unitIds.add(current); queue.push(...(children.get(current) || [])); }
  const memberRefs = [...new Set(memberships.filter((row) => unitIds.has(row.org_unit_id)).map((row) => row.person_ref))];
  const people = memberRefs.length ? await postgresQuery<{ user_id: string | null }>("SELECT user_id FROM organization_people WHERE person_ref=ANY($1::text[]) AND user_id IS NOT NULL AND user_id<>'' AND status='active'", [memberRefs]) : [];
  const memberUserIds = people.map((row) => row.user_id).filter((id): id is string => Boolean(id));
  if (!memberUserIds.includes(userId)) memberUserIds.push(userId);
  return { isLeader: true, unitIds: [...unitIds], memberUserIds };
}
