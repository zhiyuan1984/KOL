-- 知识分层（主题域族 → 主题域 → 知识库）与结构化条目。
-- db.ts applies the same idempotent migration for embedded deployments.
-- 设计 docs/superpowers/specs/2026-09-26-knowledge-base-skill-agent-design.md §4.3；决策 docs/DECISIONS.md ADR-2026-10-01（三）。
CREATE TABLE IF NOT EXISTS knowledge_domains (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  level TEXT NOT NULL,
  parent_id TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  note TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_domains_code
  ON knowledge_domains(IFNULL(parent_id, ''), code);
CREATE INDEX IF NOT EXISTS knowledge_domains_parent
  ON knowledge_domains(parent_id, sort);

CREATE TABLE IF NOT EXISTS knowledge_bases (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  domain_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'structured',
  description TEXT,
  owner_user_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  settings TEXT NOT NULL DEFAULT '{}',
  external_ref TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS knowledge_bases_domain
  ON knowledge_bases(domain_id, status);

-- knowledge 增列（老库由 db.ts migrateSchema 幂等 ALTER）：
--   base_id TEXT; structured TEXT; source_body TEXT
-- knowledge_versions 增列（同理）：
--   tags TEXT; in_market INTEGER; effective_at TEXT; expires_at TEXT
-- 历史数据迁移（只跑一次，app_state 键 knowledge_taxonomy_v1）：
--   1) 默认 族 uncategorized → 域 legacy → 库 历史知识（code=legacy, kind=structured）
--   2) UPDATE knowledge SET base_id='kbase_legacy' WHERE base_id IS NULL OR base_id=''
--   3) UPDATE knowledge SET source_body=body WHERE source_body IS NULL OR source_body=''
--   4) knowledge_versions 四列按所属 knowledge 当前值回填
