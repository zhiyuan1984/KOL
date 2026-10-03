-- 组织单元（三级）、人员外部引用、成员关系、品牌/区域范围关系与 Agent 使用绑定。
-- 实际应用：backend/src/runtime/organization-tree.ts 的 ensureOrganizationTree()（幂等建表 + app_state 门控回填）；
-- 本文件只作镜像留档（与 018/019/021 同口径）。
-- 法条：docs/CONSTITUTION.md CONST-05；docs/DECISIONS.md ADR-2026-10-03 与（之二）；
-- 实施细则 docs/org-permissions.md；声明来源 config/org-registry.yaml。
-- 品牌与区域字典仍以 config/brand-registry.yaml 为权威，本层只存关系（用户 2026-10-03 裁决）。
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
CREATE INDEX IF NOT EXISTS organization_units_parent_idx ON organization_units(company_id, parent_id, level);

CREATE TABLE IF NOT EXISTS organization_people (
  person_ref TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  user_ref TEXT,
  user_id TEXT,
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
CREATE INDEX IF NOT EXISTS scope_memberships_subject_idx ON scope_memberships(subject_type, subject_id, status);

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
