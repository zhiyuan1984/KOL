/**
 * 组织树、人员外部引用、成员关系、品牌/区域范围关系与 Agent 使用绑定。
 *
 * 法条：`docs/CONSTITUTION.md` CONST-05、`docs/DECISIONS.md` ADR-2026-10-03 与（之二）；
 * 实施细则见 `docs/org-permissions.md`（含「组织系统未接入前必须用外部引用表」）。
 * 声明来源是 `config/org-registry.yaml`：一次性回填（app_state 门控）之后，
 * 运行时权威在本文件的表里，registry 只作声明、来源凭证与待补字段登记。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { getConn, nowIso, type SqliteConn } from "../db.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SEED_KEY = "org_registry_v1";
const initialized = new WeakSet<object>();

type RegistryPerson = {
  person_ref?: string;
  display_name?: string;
  role?: string | null;
  title?: string | null;
  org_unit?: string | null;
  user_ref?: string | null;
  account_username?: string | null;
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
  companies?: { id?: string; display_name?: string }[];
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
export type EffectiveUser = {
  person_ref: string;
  user_id: string | null;
  display_name: string | null;
  via: "binding_target" | "unit_head" | "unit_member" | "ancestor_head";
  via_unit_id: string;
  via_unit_display_name: string | null;
  binding_id: string;
};

export type EffectiveAgentUsers = {
  agent_id: string;
  org_version: number;
  users: EffectiveUser[];
  person_refs: string[];
  user_ids: string[];
};

export function ensureOrganizationTree(): void {
  const db = getConn();
  if (initialized.has(db)) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS organization_units (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      type TEXT NOT NULL,
      parent_id TEXT,
      level INTEGER NOT NULL CHECK (level >= 1),
      head_person_ref TEXT,
      head_display_name TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
      org_version INTEGER NOT NULL DEFAULT 1 CHECK (org_version >= 1),
      source TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS organization_units_parent_idx
      ON organization_units(company_id, parent_id, level);

    CREATE TABLE IF NOT EXISTS organization_people (
      person_ref TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      user_ref TEXT,
      user_id TEXT,
      starry_open_id TEXT,
      email TEXT,
      employee_no TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'left')),
      source TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS organization_memberships (
      id TEXT PRIMARY KEY,
      person_ref TEXT NOT NULL,
      company_id TEXT NOT NULL,
      org_unit_id TEXT NOT NULL,
      relation TEXT NOT NULL DEFAULT 'primary' CHECK (relation IN ('primary', 'collaborative')),
      position TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
      effective_from TEXT,
      effective_to TEXT,
      source TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS organization_memberships_active_uniq
      ON organization_memberships(person_ref, org_unit_id, relation) WHERE status = 'active';

    CREATE TABLE IF NOT EXISTS scope_memberships (
      id TEXT PRIMARY KEY,
      subject_type TEXT NOT NULL CHECK (subject_type IN ('person', 'organization_unit')),
      subject_id TEXT NOT NULL,
      company_id TEXT NOT NULL,
      brand_id TEXT,
      region_id TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
      effective_from TEXT,
      effective_to TEXT,
      source TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS scope_memberships_subject_idx
      ON scope_memberships(subject_type, subject_id, status);

    CREATE TABLE IF NOT EXISTS agent_bindings (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      target_type TEXT NOT NULL CHECK (target_type IN ('organization_unit', 'person')),
      target_id TEXT NOT NULL,
      company_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
      binding_version INTEGER NOT NULL DEFAULT 1 CHECK (binding_version >= 1),
      org_version INTEGER NOT NULL CHECK (org_version >= 1),
      created_by TEXT,
      reason TEXT,
      effective_from TEXT,
      effective_to TEXT,
      source TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS agent_bindings_active_uniq
      ON agent_bindings(agent_id, target_type, target_id) WHERE status = 'active';

    CREATE TABLE IF NOT EXISTS org_versions (
      company_id TEXT NOT NULL,
      version INTEGER NOT NULL CHECK (version >= 1),
      effective_at TEXT NOT NULL,
      note TEXT,
      source TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (company_id, version)
    );
  `);
  // 已存在的库补列。必须用 conn.pragma()：Postgres 侧把它翻译成 information_schema，
  // 而 prepare().all() 在 PG 上不翻译 PRAGMA（PG 引擎不跑 initSchema/migrateSchema）。
  const personColumns = new Set(
    ((db.pragma("table_info(organization_people)") as { name?: string }[]) || []).map((row) => String(row.name)),
  );
  for (const [column, ddl] of [
    ["starry_open_id", "TEXT"],
    ["email", "TEXT"],
    ["employee_no", "TEXT"],
  ] as const) {
    if (!personColumns.has(column)) db.exec(`ALTER TABLE organization_people ADD COLUMN ${column} ${ddl}`);
  }
  // 先登记再回填：seed → reseed → ensure 的重入必须立刻短路，否则会无限递归。
  initialized.add(db);
  seedOnce(db);
}

function readRegistry(): OrgRegistry {
  const text = fs.readFileSync(path.join(repoRoot, "config", "org-registry.yaml"), "utf8").replace(/^\uFEFF/, "");
  const parsed = parseYaml(text) as OrgRegistry | null;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("org registry root must be a mapping");
  return parsed;
}

/** 深度：直属公司为一级，其余按 parent 链加一。 */
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

function seedOnce(db: SqliteConn): void {
  if (db.prepare("SELECT 1 FROM app_state WHERE key = ?").get(SEED_KEY)) return;
  reseedOrganizationTreeFromRegistry();
  db.prepare("INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)").run(SEED_KEY, nowIso());
}

/**
 * 把 `config/org-registry.yaml` 的组织事实写进表里：幂等，按 canonical id 覆盖。
 * 启动只跑一次（app_state 门控）；之后组织事实由管理端维护，需要重放时显式调用本函数。
 */
export function reseedOrganizationTreeFromRegistry(): void {
  const db = getConn();
  const registry = readRegistry();
  const company = String((registry.companies || [])[0]?.id || "");
  if (!company) throw new Error("org registry has no company");
  const units = (registry.organization_units || []).filter((unit) => typeof unit?.id === "string");
  const levels = unitLevels(units);
  const stamp = nowIso();
  const source = registry.revision || "config/org-registry.yaml";

  for (const unit of units) {
    const id = String(unit.id);
    upsert(
      db,
      "organization_units",
      "id",
      id,
      {
        company_id: company,
        display_name: unit.display_name || id,
        type: unit.type || "department",
        parent_id: unit.parent && unit.parent !== company ? String(unit.parent) : null,
        level: levels.get(id) || 1,
        head_person_ref: unit.head_person_ref || null,
        head_display_name: unit.head || null,
        source,
      },
      stamp,
    );
    for (const brandId of (unit.brand_scope || []).map(String)) {
      upsert(
        db,
        "scope_memberships",
        "id",
        `scope:org_unit:${id}:brand:${brandId}:region:*`,
        {
          subject_type: "organization_unit",
          subject_id: id,
          company_id: company,
          brand_id: brandId,
          region_id: null,
          source,
        },
        stamp,
      );
    }
  }

  for (const person of registry.confirmed_people || []) {
    const personRef = person.person_ref;
    if (!personRef) throw new Error(`confirmed person without person_ref: ${person.display_name || "unknown"}`);
    const account = person.account_username
      ? (db.prepare("SELECT id FROM users WHERE username = ?").get(person.account_username) as { id?: string } | undefined)
      : undefined;
    upsert(
      db,
      "organization_people",
      "person_ref",
      personRef,
      {
        display_name: person.display_name || personRef,
        user_ref: person.user_ref || null,
        user_id: account?.id || null,
        starry_open_id: person.starry_open_id || null,
        email: person.email || null,
        employee_no: person.employee_no || null,
        source: person.source || source,
      },
      stamp,
    );
    const orgUnit = person.org_unit ? String(person.org_unit) : null;
    if (orgUnit) {
      upsert(
        db,
        "organization_memberships",
        "id",
        `member:${personRef}:${orgUnit}:primary`,
        {
          person_ref: personRef,
          company_id: company,
          org_unit_id: orgUnit,
          relation: "primary",
          position: person.title || null,
          source: person.source || source,
        },
        stamp,
      );
    }
    const brands = (person.brand_scope || []).map(String);
    const regions = (person.region_scope || []).map(String);
    for (const brandId of brands) {
      for (const regionId of regions) {
        upsert(
          db,
          "scope_memberships",
          "id",
          `scope:person:${personRef}:brand:${brandId}:region:${regionId}`,
          {
            subject_type: "person",
            subject_id: personRef,
            company_id: company,
            brand_id: brandId,
            region_id: regionId,
            source: person.source || source,
          },
          stamp,
        );
      }
    }
  }

  if (!currentOrgVersion(company)) {
    db.prepare("INSERT INTO org_versions (company_id, version, effective_at, note, source, created_at) VALUES (?, 1, ?, ?, ?, ?)").run(
      company,
      stamp,
      "组织事实首次落库：三级组织单元、人员外部引用、成员关系与范围关系",
      source,
      stamp,
    );
  }

  // 组织版本就位后再落声明式绑定点，绑定行才能带上有效的 org_version。
  for (const declared of registry.agent_bindings || []) {
    if (!declared?.agent_id || !declared.target_type || !declared.target_id) continue;
    createAgentBinding({
      agent_id: String(declared.agent_id),
      target_type: declared.target_type,
      target_id: String(declared.target_id),
      company_id: company,
      reason: declared.reason || null,
      source: declared.source || source,
    });
  }
}

function upsert(
  db: SqliteConn,
  table: string,
  keyColumn: string,
  id: string,
  values: Record<string, unknown>,
  stamp: string,
): void {
  const columns = Object.keys(values);
  const existing = db.prepare(`SELECT 1 FROM ${table} WHERE ${keyColumn} = ?`).get(id);
  if (existing) {
    const assignments = columns.map((column) => `${column} = ?`).join(", ");
    db.prepare(`UPDATE ${table} SET ${assignments}, updated_at = ? WHERE ${keyColumn} = ?`).run(
      ...columns.map((column) => values[column] as never),
      stamp,
      id,
    );
    return;
  }
  const placeholders = columns.map(() => "?").join(", ");
  db.prepare(
    `INSERT INTO ${table} (${keyColumn}, ${columns.join(", ")}, created_at, updated_at) VALUES (?, ${placeholders}, ?, ?)`,
  ).run(id, ...columns.map((column) => values[column] as never), stamp, stamp);
}

function ascendants(units: OrganizationUnitRow[], unitId: string): OrganizationUnitRow[] {
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const chain: OrganizationUnitRow[] = [];
  const seen = new Set<string>();
  let current: string | null = byId.get(unitId)?.parent_id ?? null;
  while (current && !seen.has(current)) {
    seen.add(current);
    const unit = byId.get(current);
    if (!unit) break;
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
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      out.push(child);
      frontier.push(child.id);
    }
  }
  return out;
}

export function listOrganizationUnits(companyId?: string): OrganizationUnitRow[] {
  ensureOrganizationTree();
  const rows = companyId
    ? getConn().prepare("SELECT * FROM organization_units WHERE company_id = ? ORDER BY level, display_name").all(companyId)
    : getConn().prepare("SELECT * FROM organization_units ORDER BY level, display_name").all();
  return rows as unknown as OrganizationUnitRow[];
}

export function listOrganizationPeople(): OrganizationPersonRow[] {
  ensureOrganizationTree();
  return getConn().prepare("SELECT * FROM organization_people ORDER BY display_name").all() as unknown as OrganizationPersonRow[];
}

export function listOrganizationMemberships(companyId?: string): OrganizationMembershipRow[] {
  ensureOrganizationTree();
  const rows = companyId
    ? getConn().prepare("SELECT * FROM organization_memberships WHERE status = 'active' AND company_id = ?").all(companyId)
    : getConn().prepare("SELECT * FROM organization_memberships WHERE status = 'active'").all();
  return rows as unknown as OrganizationMembershipRow[];
}

export function listScopeMemberships(subjectType?: string, subjectId?: string): ScopeMembershipRow[] {
  ensureOrganizationTree();
  const db = getConn();
  if (subjectType && subjectId) {
    return db
      .prepare("SELECT * FROM scope_memberships WHERE status = 'active' AND subject_type = ? AND subject_id = ?")
      .all(subjectType, subjectId) as unknown as ScopeMembershipRow[];
  }
  return db.prepare("SELECT * FROM scope_memberships WHERE status = 'active'").all() as unknown as ScopeMembershipRow[];
}

export function listAgentBindings(agentId?: string): AgentBindingRow[] {
  ensureOrganizationTree();
  const db = getConn();
  const rows = agentId
    ? db.prepare("SELECT * FROM agent_bindings WHERE status = 'active' AND agent_id = ? ORDER BY target_type, target_id").all(agentId)
    : db.prepare("SELECT * FROM agent_bindings WHERE status = 'active' ORDER BY agent_id, target_type, target_id").all();
  return rows as unknown as AgentBindingRow[];
}

export function createAgentBinding(input: {
  agent_id: string;
  target_type: "organization_unit" | "person";
  target_id: string;
  company_id: string;
  created_by?: string | null;
  reason?: string | null;
  effective_from?: string | null;
  source?: string | null;
}): AgentBindingRow {
  ensureOrganizationTree();
  const db = getConn();
  const target = input.target_id;
  if (input.target_type === "organization_unit") {
    const unit = db.prepare("SELECT company_id FROM organization_units WHERE id = ?").get(target) as { company_id: string } | undefined;
    if (!unit) throw new Error(`unknown organization unit: ${target}`);
    if (unit.company_id !== input.company_id) throw new Error("binding target is outside the company");
  } else if (!db.prepare("SELECT 1 FROM organization_people WHERE person_ref = ?").get(target)) {
    throw new Error(`unknown person: ${target}`);
  }
  const id = `binding:${input.agent_id}:${input.target_type}:${target}`;
  const existing = db.prepare("SELECT * FROM agent_bindings WHERE id = ? AND status = 'active'").get(id) as AgentBindingRow | undefined;
  if (existing) return existing;
  const stamp = nowIso();
  db.prepare(
    `INSERT INTO agent_bindings
       (id, agent_id, target_type, target_id, company_id, status, binding_version, org_version, created_by, reason, effective_from, effective_to, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'active', 1, ?, ?, ?, ?, NULL, ?, ?, ?)`,
  ).run(
    id,
    input.agent_id,
    input.target_type,
    target,
    input.company_id,
    currentOrgVersion(input.company_id),
    input.created_by || null,
    input.reason || null,
    input.effective_from || stamp,
    input.source || "admin",
    stamp,
    stamp,
  );
  return db.prepare("SELECT * FROM agent_bindings WHERE id = ?").get(id) as unknown as AgentBindingRow;
}

export function revokeAgentBinding(bindingId: string, input?: { reason?: string | null }): boolean {
  ensureOrganizationTree();
  const db = getConn();
  const row = db.prepare("SELECT 1 FROM agent_bindings WHERE id = ? AND status = 'active'").get(bindingId);
  if (!row) return false;
  db.prepare("UPDATE agent_bindings SET status = 'revoked', reason = ?, updated_at = ? WHERE id = ?").run(
    input?.reason || "revoked",
    nowIso(),
    bindingId,
  );
  return true;
}

export function currentOrgVersion(companyId: string): number {
  ensureOrganizationTree();
  const row = getConn()
    .prepare("SELECT MAX(version) AS version FROM org_versions WHERE company_id = ?")
    .get(companyId) as { version?: number } | undefined;
  return row?.version || 0;
}

/** 组织事实变化后调用：版本加一，旧授权按新版本复核（CONST-05）。 */
export function bumpOrgVersion(companyId: string, note: string, source?: string): number {
  ensureOrganizationTree();
  const db = getConn();
  const next = currentOrgVersion(companyId) + 1;
  const stamp = nowIso();
  db.prepare("INSERT INTO org_versions (company_id, version, effective_at, note, source, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
    companyId,
    next,
    stamp,
    note,
    source || "admin",
    stamp,
  );
  return next;
}

/**
 * 服务端唯一的覆盖计算（CONST-05）：绑定组织单元 → 该单元负责人、该单元及其全部下级成员、逐级上级负责人；
 * 绑定人员 → 本人及其所属各级上级负责人。跨公司、旁支与无证据关系一律不放行。
 */
export function effectiveAgentUsers(agentId: string): EffectiveAgentUsers {
  ensureOrganizationTree();
  const bindings = listAgentBindings(agentId);
  const byRef = new Map<string, EffectiveUser>();
  const rank: Record<EffectiveUser["via"], number> = { binding_target: 0, unit_head: 1, unit_member: 2, ancestor_head: 3 };
  let orgVersion = 0;
  const seenCompany = new Set<string>();

  for (const companyId of new Set(bindings.map((binding) => binding.company_id))) {
    const units = listOrganizationUnits(companyId);
    const byId = new Map(units.map((unit) => [unit.id, unit]));
    const memberships = listOrganizationMemberships(companyId);
    const people = new Map(listOrganizationPeople().map((person) => [person.person_ref, person]));
    if (!seenCompany.has(companyId)) {
      seenCompany.add(companyId);
      orgVersion = Math.max(orgVersion, currentOrgVersion(companyId));
    }

    const add = (personRef: string, via: EffectiveUser["via"], unitId: string, bindingId: string): void => {
      const unit = byId.get(unitId);
      const person = people.get(personRef);
      const candidate: EffectiveUser = {
        person_ref: personRef,
        user_id: person?.user_id || null,
        display_name: person?.display_name || null,
        via,
        via_unit_id: unitId,
        via_unit_display_name: unit ? unit.display_name : null,
        binding_id: bindingId,
      };
      const existing = byRef.get(personRef);
      if (!existing || rank[via] < rank[existing.via]) byRef.set(personRef, candidate);
    };

    for (const binding of bindings.filter((row) => row.company_id === companyId)) {
      if (binding.target_type === "person") {
        const membership = memberships.find((row) => row.person_ref === binding.target_id);
        // 绑定人员覆盖本人；本人所属单元及其各级上级单元的负责人一并覆盖（CONST-05「各级上级负责人」）。
        add(binding.target_id, "binding_target", membership?.org_unit_id || "", binding.id);
        if (membership) {
          const own = byId.get(membership.org_unit_id);
          if (own?.head_person_ref) add(own.head_person_ref, "unit_head", own.id, binding.id);
          for (const unit of ascendants(units, membership.org_unit_id)) {
            if (unit.head_person_ref) add(unit.head_person_ref, "ancestor_head", unit.id, binding.id);
          }
        }
        continue;
      }
      const unitId = binding.target_id;
      const unit = byId.get(unitId);
      if (!unit) continue;
      if (unit.head_person_ref) add(unit.head_person_ref, "unit_head", unit.id, binding.id);
      for (const scopeUnit of [unit, ...descendants(units, unitId)]) {
        for (const membership of memberships.filter((row) => row.org_unit_id === scopeUnit.id)) {
          add(membership.person_ref, "unit_member", scopeUnit.id, binding.id);
        }
        if (scopeUnit.id !== unit.id && scopeUnit.head_person_ref) {
          add(scopeUnit.head_person_ref, "unit_head", scopeUnit.id, binding.id);
        }
      }
      for (const ancestor of ascendants(units, unitId)) {
        if (ancestor.head_person_ref) add(ancestor.head_person_ref, "ancestor_head", ancestor.id, binding.id);
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

export function canUseAgent(userId: string | null | undefined, agentId: string): boolean {
  if (!userId) return false;
  return effectiveAgentUsers(agentId).user_ids.includes(userId);
}

/** 人员可见技能：属于某个本人有资格使用的 Agent 且已启用的技能。 */
export function canUseSkill(userId: string | null | undefined, skillId: string): boolean {
  if (!userId) return false;
  ensureOrganizationTree();
  const rows = getConn()
    .prepare("SELECT agent_id FROM runtime_agent_skills WHERE skill_id = ? AND enabled = 1")
    .all(skillId) as { agent_id: string }[];
  return rows.some((row) => canUseAgent(userId, row.agent_id));
}

export function visibleSkillIdsForUser(userId: string | null | undefined): string[] {
  if (!userId) return [];
  ensureOrganizationTree();
  const agents = getConn().prepare("SELECT DISTINCT agent_id FROM runtime_agent_skills WHERE enabled = 1").all() as { agent_id: string }[];
  const usable = agents.filter((row) => canUseAgent(userId, row.agent_id)).map((row) => row.agent_id);
  if (!usable.length) return [];
  const placeholders = usable.map(() => "?").join(", ");
  const rows = getConn()
    .prepare(`SELECT DISTINCT skill_id FROM runtime_agent_skills WHERE enabled = 1 AND agent_id IN (${placeholders})`)
    .all(...usable) as { skill_id: string }[];
  return rows.map((row) => row.skill_id);
}
