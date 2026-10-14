/**
 * 组织树、人员外部引用、成员关系、品牌/区域范围关系与 Agent 使用绑定。
 *
 * 法条：`docs/CONSTITUTION.md` CONST-05、`docs/DECISIONS.md` ADR-2026-10-03 与（之二）；
 * 实施细则见 `docs/org-permissions.md`（含「组织系统未接入前必须用外部引用表」）。
 * 声明来源是 `config/org-registry.yaml`：一次性回填（app_state 门控）之后，
 * 运行时权威在本文件的表里，registry 只作声明、来源凭证与待补字段登记。
 */
import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { onDatabaseReset, postgresDb, nowIso, type PgRepository } from "../postgres/access.js";
import { HttpFail } from "../host/errors.js";
import { agentIsPublished } from "./managed-agents.js";
import { isPlatformAgent } from "./platform-principal.js";
import { pgPlaceholders, requireRuntimeIdentityTables } from "./schema.js";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SEED_KEY = "org_registry_v1";
let organizationSchemaReady = false;
let organizationSchemaInitialization: Promise<void> | undefined;
onDatabaseReset(() => {
  organizationSchemaReady = false;
  organizationSchemaInitialization = undefined;
});
type RegistryPerson = {
  person_ref?: string;
  display_name?: string;
  role?: string | null;
  title?: string | null;
  org_unit?: string | null;
  user_ref?: string | null;
  account_username?: string | null;
  avatar?: string | null;
  starry_open_id?: string | null;
  email?: string | null;
  employee_no?: string | null;
  brand_scope?: string[];
  region_scope?: string[];
  source?: string;
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

type RegistryBinding = {
  agent_id?: string;
  target_type?: "organization_unit" | "person";
  target_id?: string;
  reason?: string | null;
  source?: string | null;
};
type OrgRegistry = {
  revision?: string;
  companies?: {
    id?: string;
    display_name?: string;
  }[];
  organization_units?: RegistryUnit[];
  confirmed_people?: RegistryPerson[];
  agent_bindings?: RegistryBinding[];
};

export type OrganizationUnitRow = {
  id: string;
  company_id: string;
  display_name: string;
  type: string;
  parent_id: string | null;
  level: number;
  head_person_ref: string | null;
  head_display_name: string | null;
  status: string;
  org_version: number;
  source: string | null;
};

export type OrganizationPersonRow = {
  person_ref: string;
  display_name: string;
  user_ref: string | null;
  user_id: string | null;
  starry_open_id: string | null;
  email: string | null;
  employee_no: string | null;
  avatar_url: string | null;
  status: string;
  source: string | null;
};

export type OrganizationMembershipRow = {
  id: string;
  person_ref: string;
  company_id: string;
  org_unit_id: string;
  relation: string;
  position: string | null;
  status: string;
  effective_from: string | null;
  effective_to: string | null;
  source: string | null;
};

export type ScopeMembershipRow = {
  id: string;
  subject_type: string;
  subject_id: string;
  company_id: string;
  brand_id: string | null;
  region_id: string | null;
  status: string;
  effective_from: string | null;
  effective_to: string | null;
  source: string | null;
};

export type AgentBindingRow = {
  id: string;
  agent_id: string;
  target_type: "organization_unit" | "person";
  target_id: string;
  company_id: string;
  status: string;
  binding_version: number;
  org_version: number;
  created_by: string | null;
  reason: string | null;
  effective_from: string | null;
  effective_to: string | null;
  source: string | null;
};

/** 覆盖项：说明某人为什么获得资格，供管理端区分「直接覆盖」与「负责人继承」。 */
export type EffectiveUserSource = {
  via: "binding_target" | "unit_head" | "unit_member" | "ancestor_head";
  via_unit_id: string;
  via_unit_display_name: string | null;
  binding_id: string;
  binding_target_type: "organization_unit" | "person";
  binding_target_id: string;
  binding_target_display_name: string | null;
};

export type EffectiveUser = {
  person_ref: string;
  user_id: string | null;
  display_name: string | null;
  via: "binding_target" | "unit_head" | "unit_member" | "ancestor_head";
  via_unit_id: string;
  via_unit_display_name: string | null;
  binding_id: string;
  /** Every binding that covers this person (one entry per binding); `via` above is the strongest one. */
  sources: EffectiveUserSource[];
};

export type EffectiveAgentUsers = {
  agent_id: string;
  org_version: number;
  users: EffectiveUser[];
  person_refs: string[];
  user_ids: string[];
};
export async function ensureOrganizationTree(): Promise<void> {
  if (organizationSchemaReady)
    return;
  if (!organizationSchemaInitialization) {
    organizationSchemaInitialization = (async () => {
      await requireRuntimeIdentityTables("organization tree", [
        "organization_units", "organization_people", "organization_memberships", "scope_memberships", "agent_bindings", "org_versions",
      ]);
      // 先置位再回填：seed → reseed → ensure 的重入必须立刻短路。
      organizationSchemaReady = true;
      await seedOnce(postgresDb());
    })();
  }
  try {
    await organizationSchemaInitialization;
  }
  catch (error) {
    organizationSchemaReady = false;
    organizationSchemaInitialization = undefined;
    throw error;
  }
}
function readRegistry(): OrgRegistry {
  const text = fs.readFileSync(path.join(repoRoot, "config", "org-registry.yaml"), "utf8").replace(/^\uFEFF/, "");
  const parsed = parseYaml(text) as OrgRegistry | null;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("org registry root must be a mapping");
  return parsed;
}
/** Company names are registry metadata, not a grant of membership or authority. */
export function organizationCompanyName(id: string): string {
  return readRegistry().companies?.find(company => company.id === id)?.display_name || id;
}

/** 深度：直属公司为一级，其余按 parent 链加一。 */
function unitLevels(units: RegistryUnit[]): Map<string, number> {
  const byId = new Map(units.map((unit) => [String(unit.id), unit]));
  const levels = new Map<string, number>();
  const levelOf = (id: string, chain: Set<string>): number => {
    const known = levels.get(id);
    if (known)
      return known;
    if (chain.has(id))
      throw new Error(`organization cycle at ${id}`);
    chain.add(id);
    const parent = byId.get(id)?.parent ? String(byId.get(id)?.parent) : "";
    const level = parent && byId.has(parent) ? levelOf(parent, chain) + 1 : 1;
    levels.set(id, level);
    return level;
  };
  for (const unit of units)
    levelOf(String(unit.id), new Set());
  return levels;
}
async function seedOnce(db: PgRepository): Promise<void> {
  if ((await db.one("SELECT 1 FROM app_state WHERE key = $1", SEED_KEY)))
    return;
  (await reseedOrganizationTreeFromRegistry());
  (await db.execute("INSERT INTO app_state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", SEED_KEY, nowIso()));
}
/**
 * 把 `config/org-registry.yaml` 的组织事实写进表里：幂等，按 canonical id 覆盖。
 * 启动只跑一次（app_state 门控）；之后组织事实由管理端维护，需要重放时显式调用本函数。
 */
export async function reseedOrganizationTreeFromRegistry(): Promise<void> {
  const db = postgresDb();
  const registry = readRegistry();
  const company = String((registry.companies || [])[0]?.id || "");
  if (!company)
    throw new Error("org registry has no company");
  const units = (registry.organization_units || []).filter((unit) => typeof unit?.id === "string");
  const levels = unitLevels(units);
  const stamp = nowIso();
  const source = registry.revision || "config/org-registry.yaml";
  for (const unit of units) {
    const id = String(unit.id);
    (await upsert(db, "organization_units", "id", id, {
        company_id: company,
        display_name: unit.display_name || id,
        type: unit.type || "department",
        parent_id: unit.parent && unit.parent !== company ? String(unit.parent) : null,
        level: levels.get(id) || 1,
        head_person_ref: unit.head_person_ref || null,
        head_display_name: unit.head || null,
        source,
    }, stamp));
    for (const brandId of (unit.brand_scope || []).map(String)) {
      (await upsert(db, "scope_memberships", "id", `scope:org_unit:${id}:brand:${brandId}:region:*`, {
          subject_type: "organization_unit",
          subject_id: id,
          company_id: company,
          brand_id: brandId,
          region_id: null,
          source,
      }, stamp));
    }
  }
  for (const person of registry.confirmed_people || []) {
    const personRef = person.person_ref;
    if (!personRef)
      throw new Error(`confirmed person without person_ref: ${person.display_name || "unknown"}`);
    const account = person.account_username
      ? ((await db.one("SELECT id FROM users WHERE username = $1", person.account_username)) as {
        id?: string;
      } | undefined)
      : undefined;
    const linked = (await db.one("SELECT user_id,email FROM organization_people WHERE person_ref = $1", personRef)) as {
      user_id?: string | null;
      email?: string | null;
    } | undefined;
    const linkedUser = linked?.user_id
      ? (await db.one("SELECT id FROM users WHERE id = $1", linked.user_id)) as {
        id?: string;
      } | undefined
      : undefined;
    (await upsert(db, "organization_people", "person_ref", personRef, {
        display_name: person.display_name || personRef,
        user_ref: person.user_ref || null,
        user_id: account?.id || linkedUser?.id || null,
        starry_open_id: person.starry_open_id || null,
        email: person.email || linked?.email || null,
        employee_no: person.employee_no || null,
        avatar_url: person.avatar ? `/avatars/${person.avatar}` : null,
        source: person.source || source,
    }, stamp));
    const orgUnit = person.org_unit ? String(person.org_unit) : null;
    if (orgUnit) {
      (await upsert(db, "organization_memberships", "id", `member:${personRef}:${orgUnit}:primary`, {
          person_ref: personRef,
          company_id: company,
          org_unit_id: orgUnit,
          relation: "primary",
          position: person.title || null,
          source: person.source || source,
      }, stamp));
    }
    const brands = (person.brand_scope || []).map(String);
    const regions = (person.region_scope || []).map(String);
    for (const brandId of brands) {
      for (const regionId of regions) {
        (await upsert(db, "scope_memberships", "id", `scope:person:${personRef}:brand:${brandId}:region:${regionId}`, {
            subject_type: "person",
            subject_id: personRef,
            company_id: company,
            brand_id: brandId,
            region_id: regionId,
            source: person.source || source,
        }, stamp));
      }
    }
  }
  if (!(await currentOrgVersion(company))) {
    (await db.execute("INSERT INTO org_versions (company_id, version, effective_at, note, source, created_at) VALUES ($1, 1, $2, $3, $4, $5)", company, stamp, "组织事实首次落库：三级组织单元、人员外部引用、成员关系与范围关系", source, stamp));
  }
  // 组织版本就位后再落声明式绑定点，绑定行才能带上有效的 org_version。
  for (const declared of registry.agent_bindings || []) {
    if (!declared?.agent_id || !declared.target_type || !declared.target_id)
      continue;
    (await createAgentBinding({
      agent_id: String(declared.agent_id),
      target_type: declared.target_type,
      target_id: String(declared.target_id),
      company_id: company,
      reason: declared.reason || null,
      source: declared.source || source,
    }));
  }
}
async function upsert(db: PgRepository, table: string, keyColumn: string, id: string, values: Record<string, unknown>, stamp: string): Promise<void> {
  const columns = Object.keys(values);
  const existing = (await db.one(`SELECT 1 FROM ${table} WHERE ${keyColumn} = $1`, id));
  if (existing) {
    const assignments = columns.map((column, index) => `${column} = $${index + 1}`).join(", ");
    (await db.execute(`UPDATE ${table} SET ${assignments}, updated_at = $${columns.length + 1} WHERE ${keyColumn} = $${columns.length + 2}`, ...columns.map((column) => values[column] as never), stamp, id));
    return;
  }
  const placeholders = pgPlaceholders(columns.length, 2);
  (await db.execute(`INSERT INTO ${table} (${keyColumn}, ${columns.join(", ")}, created_at, updated_at) VALUES ($1, ${placeholders}, $${columns.length + 2}, $${columns.length + 3})`, id, ...columns.map((column) => values[column] as never), stamp, stamp));
}
function ascendants(units: OrganizationUnitRow[], unitId: string): OrganizationUnitRow[] {
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const chain: OrganizationUnitRow[] = [];
  const seen = new Set<string>();
  let current: string | null = byId.get(unitId)?.parent_id ?? null;
  while (current && !seen.has(current)) {
    seen.add(current);
    const unit = byId.get(current);
    if (!unit)
      break;
    chain.push(unit);
    current = unit.parent_id;
  }
  return chain;
}

function descendants(units: OrganizationUnitRow[], unitId: string): OrganizationUnitRow[] {
  const out: OrganizationUnitRow[] = [];
  let frontier = [unitId];
  const seen = new Set(frontier);
  while (frontier.length) {
    const children = units.filter((unit) => unit.parent_id && frontier.includes(unit.parent_id));
    frontier = [];
    for (const child of children) {
      if (seen.has(child.id))
        continue;
      seen.add(child.id);
      out.push(child);
      frontier.push(child.id);
    }
  }
  return out;
}
export async function listOrganizationUnits(companyId?: string): Promise<OrganizationUnitRow[]> {
  (await ensureOrganizationTree());
  const rows = companyId
    ? (await postgresDb().many("SELECT * FROM organization_units WHERE company_id = $1 ORDER BY level, display_name", companyId)) : (await postgresDb().many("SELECT * FROM organization_units ORDER BY level, display_name"));
  return rows as unknown as OrganizationUnitRow[];
}
export async function listOrganizationPeople(): Promise<OrganizationPersonRow[]> {
  (await ensureOrganizationTree());
  return (await postgresDb().many("SELECT * FROM organization_people ORDER BY display_name")) as unknown as OrganizationPersonRow[];
}
/** 个人头像公开 URL；未关联账号或该人员没有头像时返回 null。 */
export async function avatarUrlForUser(userId: string | null | undefined): Promise<string | null> {
  if (!userId)
    return null;
  (await ensureOrganizationTree());
  const row = (await postgresDb().one("SELECT avatar_url FROM organization_people WHERE user_id = $1", userId)) as {
    avatar_url?: string | null;
  } | undefined;
  return row?.avatar_url || null;
}
export async function listOrganizationMemberships(companyId?: string): Promise<OrganizationMembershipRow[]> {
  (await ensureOrganizationTree());
  const rows = companyId
    ? (await postgresDb().many("SELECT * FROM organization_memberships WHERE status = 'active' AND company_id = $1", companyId)) : (await postgresDb().many("SELECT * FROM organization_memberships WHERE status = 'active'"));
  return rows as unknown as OrganizationMembershipRow[];
}
export async function listScopeMemberships(subjectType?: string, subjectId?: string): Promise<ScopeMembershipRow[]> {
  (await ensureOrganizationTree());
  const db = postgresDb();
  if (subjectType && subjectId) {
    return (await db.many("SELECT * FROM scope_memberships WHERE status = 'active' AND subject_type = $1 AND subject_id = $2", subjectType, subjectId)) as unknown as ScopeMembershipRow[];
  }
  return (await db.many("SELECT * FROM scope_memberships WHERE status = 'active'")) as unknown as ScopeMembershipRow[];
}
export async function listAgentBindings(agentId?: string): Promise<AgentBindingRow[]> {
  (await ensureOrganizationTree());
  const db = postgresDb();
  const rows = agentId
    ? (await db.many("SELECT * FROM agent_bindings WHERE status = 'active' AND agent_id = $1 ORDER BY target_type, target_id", agentId)) : (await db.many("SELECT * FROM agent_bindings WHERE status = 'active' ORDER BY agent_id, target_type, target_id"));
  return rows as unknown as AgentBindingRow[];
}
export async function createAgentBinding(input: {
  agent_id: string;
  target_type: "organization_unit" | "person";
  target_id: string;
  company_id: string;
  created_by?: string | null;
  reason?: string | null;
  effective_from?: string | null;
  source?: string | null;
}): Promise<AgentBindingRow> {
  if (isPlatformAgent(input.agent_id)) {
    throw new HttpFail(409, { code: "platform_agent_not_bindable", message: "平台系统智能体不对应人员，不能绑定组织或人员。" });
  }
  (await ensureOrganizationTree());
  const db = postgresDb();
  const target = input.target_id;
  if (input.target_type === "organization_unit") {
    const unit = (await db.one("SELECT company_id FROM organization_units WHERE id = $1", target)) as {
      company_id: string;
    } | undefined;
    if (!unit)
      throw new Error(`unknown organization unit: ${target}`);
    if (unit.company_id !== input.company_id)
      throw new Error("binding target is outside the company");
  }
  else if (!(await db.one("SELECT 1 FROM organization_people WHERE person_ref = $1", target))) {
    throw new Error(`unknown person: ${target}`);
  }
  const id = `binding:${input.agent_id}:${input.target_type}:${target}`;
  const existing = (await db.one("SELECT * FROM agent_bindings WHERE id = $1 AND status = 'active'", id)) as AgentBindingRow | undefined;
  if (existing)
    return existing;
  const stamp = nowIso();
  const revoked = (await db.one("SELECT id FROM agent_bindings WHERE id = $1 AND status = 'revoked'", id));
  if (revoked) {
    (await db.execute(`UPDATE agent_bindings SET status='active',binding_version=binding_version+1,org_version=$1,
      created_by=$2,reason=$3,effective_from=$4,effective_to=NULL,source=$5,updated_at=$6 WHERE id=$7`, (await currentOrgVersion(input.company_id)), input.created_by || null, input.reason || null, input.effective_from || stamp, input.source || "admin", stamp, id));
    return (await db.one("SELECT * FROM agent_bindings WHERE id = $1", id)) as AgentBindingRow;
  }
  (await db.execute(`INSERT INTO agent_bindings
       (id, agent_id, target_type, target_id, company_id, status, binding_version, org_version, created_by, reason, effective_from, effective_to, source, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'active', 1, $6, $7, $8, $9, NULL, $10, $11, $12)`, id, input.agent_id, input.target_type, target, input.company_id, (await currentOrgVersion(input.company_id)), input.created_by || null, input.reason || null, input.effective_from || stamp, input.source || "admin", stamp, stamp));
  return (await db.one("SELECT * FROM agent_bindings WHERE id = $1", id)) as unknown as AgentBindingRow;
}
export async function revokeAgentBinding(bindingId: string, input?: {
  reason?: string | null;
}): Promise<boolean> {
  (await ensureOrganizationTree());
  const db = postgresDb();
  const row = (await db.one("SELECT 1 FROM agent_bindings WHERE id = $1 AND status = 'active'", bindingId));
  if (!row)
    return false;
  (await db.execute("UPDATE agent_bindings SET status = 'revoked', binding_version=binding_version+1, reason = $1, effective_to=$2, updated_at = $3 WHERE id = $4", input?.reason || "revoked", nowIso(), nowIso(), bindingId));
  return true;
}
export async function currentOrgVersion(companyId: string): Promise<number> {
  (await ensureOrganizationTree());
  const row = (await postgresDb().one("SELECT MAX(version) AS version FROM org_versions WHERE company_id = $1", companyId)) as {
    version?: number;
  } | undefined;
  return row?.version || 0;
}
/** 组织事实变化后调用：版本加一，旧授权按新版本复核（CONST-05）。 */
export async function bumpOrgVersion(companyId: string, note: string, source?: string): Promise<number> {
  (await ensureOrganizationTree());
  const db = postgresDb();
  const next = (await currentOrgVersion(companyId)) + 1;
  const stamp = nowIso();
  (await db.execute("INSERT INTO org_versions (company_id, version, effective_at, note, source, created_at) VALUES ($1, $2, $3, $4, $5, $6)", companyId, next, stamp, note, source || "admin", stamp));
  return next;
}
/**
 * 已发布 Agent 的有效人员集合入口（CONST-05）；计算内核见 computeEffectiveAgentUsers。
 * 绑定目标为组织单元（任意层级）或人员；覆盖与继承规则由内核实现，跨公司、旁支一律不放行。
 */
export async function effectiveAgentUsers(agentId: string): Promise<EffectiveAgentUsers> {
  return (await computeEffectiveAgentUsers(agentId, (await listAgentBindings(agentId))));
}
export type SimulatedPerson = {
  person: OrganizationPersonRow;
  membership: OrganizationMembershipRow | null;
};

/**
 * 覆盖计算内核（CONST-05）：绑定组织单元 → 该单元负责人、该单元及其全部下级成员、逐级上级负责人；
 * 绑定人员 → 本人及其所属各级上级负责人。
 * `simulatePerson` 仅供预览路径（previewAgentBinding）：person 尚未同步组织关系时按 users.site 模拟，不写库。
 */
export type OrganizationCoverageSource = {
  units: OrganizationUnitRow[];
  people: OrganizationPersonRow[];
  memberships: OrganizationMembershipRow[];
  versions: Array<{
    company_id: string;
    version: number;
  }>;
};
export async function computeEffectiveAgentUsers(agentId: string, bindings: AgentBindingRow[], simulatePerson?: (personRef: string, companyId: string) => SimulatedPerson | null | Promise<SimulatedPerson | null>, source?: OrganizationCoverageSource): Promise<EffectiveAgentUsers> {
  if (!source)
    (await ensureOrganizationTree());
  // 绑定列表由调用方给出：实时集合来自 listAgentBindings；预览传入含虚拟绑定的列表。
  const byRef = new Map<string, EffectiveUser>();
  const rank: Record<EffectiveUser["via"], number> = { binding_target: 0, unit_head: 1, unit_member: 2, ancestor_head: 3 };
  let orgVersion = 0;
  const seenCompany = new Set<string>();
  for (const companyId of new Set(bindings.map((binding) => binding.company_id))) {
    const units = source ? source.units.filter(unit => unit.company_id === companyId) : (await listOrganizationUnits(companyId));
    const byId = new Map(units.map((unit) => [unit.id, unit]));
    const memberships = source ? source.memberships.filter(row => row.company_id === companyId) : (await listOrganizationMemberships(companyId));
    const people = new Map((source?.people || (await listOrganizationPeople())).map((person) => [person.person_ref, person]));
    if (!seenCompany.has(companyId)) {
      seenCompany.add(companyId);
      orgVersion = Math.max(orgVersion, source ? Number(source.versions.find(row => row.company_id === companyId)?.version || 0) : (await currentOrgVersion(companyId)));
    }
    const add = (personRef: string, via: EffectiveUser["via"], unitId: string, binding: AgentBindingRow): void => {
      const unit = byId.get(unitId);
      const person = people.get(personRef);
      const source: EffectiveUserSource = {
        via,
        via_unit_id: unitId,
        via_unit_display_name: unit ? unit.display_name : null,
        binding_id: binding.id,
        binding_target_type: binding.target_type,
        binding_target_id: binding.target_id,
        binding_target_display_name: binding.target_type === "person"
          ? people.get(binding.target_id)?.display_name || null
          : byId.get(binding.target_id)?.display_name || null,
      };
      const existing = byRef.get(personRef);
      const sources = existing?.sources || [];
      const sameBinding = sources.findIndex((row) => row.binding_id === binding.id);
      if (sameBinding < 0)
        sources.push(source);
      else if (rank[via] < rank[sources[sameBinding].via])
        sources[sameBinding] = source;
      if (existing && rank[via] >= rank[existing.via])
        return;
      byRef.set(personRef, {
        person_ref: personRef,
        user_id: person?.user_id || null,
        display_name: person?.display_name || null,
        via,
        via_unit_id: unitId,
        via_unit_display_name: source.via_unit_display_name,
        binding_id: binding.id,
        sources,
      });
    };

    for (const binding of bindings.filter((row) => row.company_id === companyId)) {
      if (binding.target_type === "person") {
        // 预览模拟：该 person 尚无权威成员关系时，按 users.site 等价 syncUserOrganization 的规则参与计算。
        const simulated = memberships.some((row) => row.person_ref === binding.target_id)
          ? null
          : (await simulatePerson?.(binding.target_id, companyId)) || null;
        if (simulated && !people.has(simulated.person.person_ref))
          people.set(simulated.person.person_ref, simulated.person);
        const membership = memberships.find((row) => row.person_ref === binding.target_id)
          || (simulated?.membership && simulated.membership.company_id === companyId ? simulated.membership : undefined);
        // 绑定人员覆盖本人；本人所属单元及其各级上级单元的负责人一并覆盖（CONST-05「各级上级负责人」）。
        add(binding.target_id, "binding_target", membership?.org_unit_id || "", binding);
        if (membership) {
          const own = byId.get(membership.org_unit_id);
          if (own?.head_person_ref)
            add(own.head_person_ref, "unit_head", own.id, binding);
          for (const unit of ascendants(units, membership.org_unit_id)) {
            if (unit.head_person_ref)
              add(unit.head_person_ref, "ancestor_head", unit.id, binding);
          }
        }
        continue;
      }
      const unitId = binding.target_id;
      const unit = byId.get(unitId);
      if (!unit)
        continue;
      if (unit.head_person_ref)
        add(unit.head_person_ref, "unit_head", unit.id, binding);
      for (const scopeUnit of [unit, ...descendants(units, unitId)]) {
        for (const membership of memberships.filter((row) => row.org_unit_id === scopeUnit.id)) {
          add(membership.person_ref, "unit_member", scopeUnit.id, binding);
        }
        if (scopeUnit.id !== unit.id && scopeUnit.head_person_ref) {
          add(scopeUnit.head_person_ref, "unit_head", scopeUnit.id, binding);
        }
      }
      for (const ancestor of ascendants(units, unitId)) {
        if (ancestor.head_person_ref)
          add(ancestor.head_person_ref, "ancestor_head", ancestor.id, binding);
      }
    }
  }

  const users = [...byRef.values()];
  return {
    agent_id: agentId,
    org_version: orgVersion,
    users,
    person_refs: users.map((user) => user.person_ref),
    user_ids: users.map((user) => user.user_id).filter((id): id is string => Boolean(id)),
  };
}

export type AgentBindingPreview = {
  agent_id: string;
  preview_signature: string;
  org_version: number;
  before: {
    person_refs: string[];
    user_ids: string[];
  };
  after: {
    person_refs: string[];
    user_ids: string[];
  };
  added: EffectiveUser[];
  removed: EffectiveUser[];
};
export type AgentBindingChange = {
  add: {
    target_type: "organization_unit" | "person";
    target_id: string;
    company_id: string;
  };
} | {
  add_many: Array<{
    target_type: "organization_unit" | "person";
    target_id: string;
    company_id: string;
  }>;
} | {
  remove: string;
};
const USER_PERSON_PREFIX = "person:user:";
/** 账号外部引用：已同步的 person_ref，否则按 syncUserOrganization 的约定由 user_id 推导；不写库。 */
export async function personRefForUser(userId: string): Promise<string | null> {
  const db = postgresDb();
  const row = (await db.one("SELECT person_ref FROM organization_people WHERE user_id=$1", userId)) as {
    person_ref: string;
  } | undefined;
  if (row?.person_ref)
    return row.person_ref;
  return (await db.one("SELECT 1 FROM users WHERE id=$1", userId)) ? `${USER_PERSON_PREFIX}${userId}` : null;
}
/**
 * 预览模拟（等价 syncUserOrganization 的规则，不写库）：person 尚无权威成员关系时按 users.site
 * 映射到同公司 active 单元；site 为空或不属该公司则仅覆盖本人，不虚构上级负责人。
 */
async function simulatePersonFromSite(personRef: string, companyId: string): Promise<SimulatedPerson | null> {
  const db = postgresDb();
  const row = (await db.one("SELECT * FROM organization_people WHERE person_ref=$1", personRef)) as OrganizationPersonRow | undefined;
  const userId = row?.user_id || (personRef.startsWith(USER_PERSON_PREFIX) ? personRef.slice(USER_PERSON_PREFIX.length) : "");
  if (!userId)
    return null;
  const user = (await db.one("SELECT id,name,site,active FROM users WHERE id=$1", userId)) as {
    id: string;
    name: string;
    site: string | null;
    active: number;
  } | undefined;
  if (!user)
    return null;
  const person: OrganizationPersonRow = row ? { ...row, user_id: userId } : {
    person_ref: personRef,
    display_name: user.name,
    user_ref: userId,
    user_id: userId,
    starry_open_id: null,
    email: null,
    employee_no: null,
    avatar_url: null,
    status: Number(user.active) === 1 ? "active" : "left",
    source: "preview",
  };
  const site = String(user.site || "").trim();
  const unit = site
    ? (await db.one("SELECT * FROM organization_units WHERE id=$1 AND status='active'", site)) as OrganizationUnitRow | undefined
    : undefined;
  if (!unit || unit.company_id !== companyId)
    return { person, membership: null };
  return {
    person,
    membership: {
      id: `preview:${personRef}:${unit.id}`,
      person_ref: personRef,
      company_id: unit.company_id,
      org_unit_id: unit.id,
      relation: "primary",
      position: null,
      status: "active",
      effective_from: null,
      effective_to: null,
      source: "preview",
    },
  };
}
/** 变更影响预览（CONST-05）：add 以虚拟绑定、remove 剔除现有绑定，走同一覆盖内核；不落库、不写 users/site。 */
export async function previewAgentBinding(agentId: string, change: AgentBindingChange): Promise<AgentBindingPreview> {
  (await ensureOrganizationTree());
  const db = postgresDb();
  const current = (await listAgentBindings(agentId));
  const before = (await computeEffectiveAgentUsers(agentId, current));
  let bindings = current;
  let simulatePerson: ((personRef: string, companyId: string) => SimulatedPerson | null | Promise<SimulatedPerson | null>) | undefined;
  if ("remove" in change) {
    if (!current.some((row) => row.id === change.remove))
      throw new Error(`unknown binding: ${change.remove}`);
    bindings = current.filter((row) => row.id !== change.remove);
  }
  else {
    const targets = "add_many" in change ? change.add_many : [change.add];
    const seen = new Set<string>();
    const virtual: AgentBindingRow[] = [];
    for (const target of targets) {
      const key = `${target.target_type}:${target.target_id}`;
      if (seen.has(key))
        continue;
      seen.add(key);
      if (target.target_type === "organization_unit") {
        const unit = (await db.one("SELECT id,company_id,status FROM organization_units WHERE id=$1", target.target_id)) as {
          id: string;
          company_id: string;
          status: string;
        } | undefined;
        if (!unit || unit.status !== "active")
          throw new Error(`unknown organization unit: ${target.target_id}`);
        if (unit.company_id !== target.company_id)
          throw new Error("binding target is outside the company");
      }
      else {
        const known = (await db.one("SELECT 1 FROM organization_people WHERE person_ref=$1", target.target_id)) || (target.target_id.startsWith(USER_PERSON_PREFIX)
          ? (await db.one("SELECT 1 FROM users WHERE id=$1", target.target_id.slice(USER_PERSON_PREFIX.length))) : undefined);
        if (!known)
          throw new Error(`unknown person: ${target.target_id}`);
      }
      const duplicate = current.some((row) => row.target_type === target.target_type && row.target_id === target.target_id);
      if (!duplicate)
        virtual.push({
        id: `preview:${key}`, agent_id: agentId, target_type: target.target_type, target_id: target.target_id,
        company_id: target.company_id, status: "active", binding_version: 0,
          org_version: (await currentOrgVersion(target.company_id)), created_by: null, reason: null,
        effective_from: null, effective_to: null, source: "preview",
      });
      if (target.target_type === "person")
        simulatePerson = simulatePersonFromSite;
    }
    bindings = [...current, ...virtual];
  }
  const after = (await computeEffectiveAgentUsers(agentId, bindings, simulatePerson));
  const beforeRefs = new Set(before.person_refs);
  const afterRefs = new Set(after.person_refs);
  const versions = await Promise.all([...new Set([...current, ...bindings].map((row) => row.company_id))]
    .sort()
    .map(async (company_id) => ({ company_id, version: await currentOrgVersion(company_id) })));
  return {
    agent_id: agentId,
    org_version: Math.max(before.org_version, after.org_version),
    preview_signature: createHash('sha256').update(JSON.stringify({ current, change, versions, before, after })).digest('hex'),
    before: { person_refs: before.person_refs, user_ids: before.user_ids },
    after: { person_refs: after.person_refs, user_ids: after.user_ids },
    added: after.users.filter((user) => !beforeRefs.has(user.person_ref)),
    removed: before.users.filter((user) => !afterRefs.has(user.person_ref)),
  };
}
export async function canUseAgent(userId: string | null | undefined, agentId: string): Promise<boolean> {
  if (!userId)
    return false;
  if (!(await agentIsPublished(agentId)))
    return false;
  const account = (await postgresDb().one("SELECT active FROM users WHERE id=$1", userId)) as {
    active?: number;
  } | undefined;
  if (!account || Number(account.active) !== 1)
    return false;
  return (await effectiveAgentUsers(agentId)).user_ids.includes(userId);
}
/** 管理员维护账号的组织归属时同步权威成员关系；不按姓名推断身份。 */
export async function syncUserOrganization(userId: string, unitId: string | null | undefined): Promise<string> {
  (await ensureOrganizationTree());
  const db = postgresDb();
  const user = (await db.one("SELECT id,name,username,email FROM users WHERE id=$1", userId)) as {
    id: string;
    name: string;
    username: string;
    email: string | null;
  } | undefined;
  if (!user)
    throw new Error("unknown user");
  const target = unitId ? (await db.one("SELECT id,company_id,status FROM organization_units WHERE id=$1", unitId)) as {
    id: string;
    company_id: string;
    status: string;
  } | undefined : undefined;
  if (unitId && (!target || target.status !== "active"))
    throw new Error("unknown active organization unit");
  const personRef = (await personRefForUser(userId)) ?? `${USER_PERSON_PREFIX}${userId}`;
  const stamp = nowIso();
  (await db.execute(`INSERT INTO organization_people
    (person_ref,display_name,user_ref,user_id,email,status,source,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,'active','admin',$6,$7)
    ON CONFLICT (person_ref) DO UPDATE SET display_name=excluded.display_name,user_id=excluded.user_id,
      email=excluded.email,status='active',updated_at=excluded.updated_at`, personRef, user.name, userId, userId, user.email || (user.username.includes("@") ? user.username : ""), stamp, stamp));
  const old = (await db.many("SELECT id,company_id,org_unit_id FROM organization_memberships WHERE person_ref=$1 AND relation='primary' AND status='active'", personRef)) as Array<{
    id: string;
    company_id: string;
    org_unit_id: string;
  }>;
  for (const row of old) {
    if (row.org_unit_id === unitId)
      continue;
    (await db.execute("UPDATE organization_memberships SET status='ended',effective_to=$1,updated_at=$2 WHERE id=$3", stamp, stamp, row.id));
    (await bumpOrgVersion(row.company_id, `员工 ${userId} 离开 ${row.org_unit_id}`, "admin"));
  }
  if (target && !old.some((row) => row.org_unit_id === target.id)) {
    const id = `member:${personRef}:${target.id}:primary`;
    (await db.execute(`INSERT INTO organization_memberships
      (id,person_ref,company_id,org_unit_id,relation,status,effective_from,effective_to,source,created_at,updated_at)
      VALUES ($1,$2,$3,$4,'primary','active',$5,NULL,'admin',$6,$7)
      ON CONFLICT (id) DO UPDATE SET status='active',effective_from=excluded.effective_from,
        effective_to=NULL,updated_at=excluded.updated_at`, id, personRef, target.company_id, target.id, stamp, stamp, stamp));
    (await bumpOrgVersion(target.company_id, `员工 ${userId} 加入 ${target.id}`, "admin"));
  }
  return personRef;
}
/** 人员可见技能：属于某个本人有资格使用的 Agent 且已启用的技能。 */
export async function canUseSkill(userId: string | null | undefined, skillId: string): Promise<boolean> {
  if (!userId)
    return false;
  (await ensureOrganizationTree());
  const rows = (await postgresDb().many("SELECT agent_id FROM runtime_agent_skills WHERE skill_id = $1 AND enabled = 1", skillId)) as {
    agent_id: string;
  }[];
  return (await Promise.all(rows.map(async (row) => (await canUseAgent(userId, row.agent_id))))).some(Boolean);
}
export async function visibleSkillIdsForUser(userId: string | null | undefined): Promise<string[]> {
  if (!userId)
    return [];
  (await ensureOrganizationTree());
  const agents = (await postgresDb().many("SELECT DISTINCT agent_id FROM runtime_agent_skills WHERE enabled = 1")) as {
    agent_id: string;
  }[];
  const usableIds = (await Promise.all(agents.map(async (agent) => (await canUseAgent(userId, agent.agent_id) ? agent.agent_id : null)))).filter((agentId): agentId is string => agentId !== null);
  if (!usableIds.length)
    return [];
  const placeholders = pgPlaceholders(usableIds.length);
  const rows = (await postgresDb().many(`SELECT DISTINCT skill_id FROM runtime_agent_skills WHERE enabled = 1 AND agent_id IN (${placeholders})`, ...usableIds)) as {
    skill_id: string;
  }[];
  return rows.map((row) => row.skill_id);
}
export type LeaderScope = {
  /** 是否为组长：其 person_ref 是任一 active 组织单元的 head（department_head 即组长，不限层级）。 */
  isLeader: boolean;
  /** 组长直管单元（含所有下级单元）id；非组长为空。 */
  unitIds: string[];
  /** 上述单元内成员映射到的 user id（含组长本人）；非组长为空。 */
  memberUserIds: string[];
};

/**
 * 组长数据范围（2026-10-08 用户规则）：组长 = 任一层级组织单元的 head；
 * 范围 = 本单元 + 全部下级单元；组长的上级（父单元 head）范围更大（父子树为超集）。
 */
export async function leaderScopeForUser(userId: string | null | undefined): Promise<LeaderScope> {
  const empty: LeaderScope = { isLeader: false, unitIds: [], memberUserIds: [] };
  if (!userId)
    return empty;
  (await ensureOrganizationTree());
  const db = postgresDb();
  const personRef = (await personRefForUser(userId));
  if (!personRef)
    return empty;
  const headed = (await db.many("SELECT id FROM organization_units WHERE head_person_ref = $1 AND status = 'active'", personRef)) as {
    id: string;
  }[];
  if (!headed.length)
    return empty;
  // BFS 收下级单元（含自身）。
  const allUnits = (await db.many("SELECT id, parent_id FROM organization_units WHERE status = 'active'")) as {
    id: string;
    parent_id: string | null;
  }[];
  const children = new Map<string, string[]>();
  for (const unit of allUnits) {
    if (!unit.parent_id)
      continue;
    const list = children.get(unit.parent_id) ?? [];
    list.push(unit.id);
    children.set(unit.parent_id, list);
  }
  const unitIds = new Set<string>();
  const queue = headed.map((row) => row.id);
  while (queue.length) {
    const current = queue.shift()!;
    if (unitIds.has(current))
      continue;
    unitIds.add(current);
    queue.push(...(children.get(current) ?? []));
  }
  const unitList = [...unitIds];
  const placeholders = pgPlaceholders(unitList.length);
  const memberRefs = (await db.many(`SELECT DISTINCT person_ref FROM organization_memberships WHERE status = 'active' AND org_unit_id IN (${placeholders})`, ...unitList)) as {
    person_ref: string;
  }[];
  const refList = memberRefs.map((row) => row.person_ref);
  let memberUserIds: string[] = [];
  if (refList.length) {
    const refPlaceholders = pgPlaceholders(refList.length);
    const people = (await db.many(`SELECT user_id FROM organization_people WHERE person_ref IN (${refPlaceholders}) AND user_id IS NOT NULL AND user_id <> ''`, ...refList)) as {
      user_id: string;
    }[];
    memberUserIds = people.map((row) => row.user_id);
  }
  if (!memberUserIds.includes(userId))
    memberUserIds.push(userId);
  return { isLeader: true, unitIds: unitList, memberUserIds };
}
