-- 知识治理阶段 1：范围授权（按对象收窄）、引用绑定、到期字段、反馈处置列。
-- 本文件按仓库惯例留档；实际应用在 db.ts 的 initSchema / migrateSchema（add() 幂等）。格式对齐 011。

ALTER TABLE knowledge ADD COLUMN effective_at TEXT;
ALTER TABLE knowledge ADD COLUMN expires_at TEXT;

ALTER TABLE knowledge_deprecations ADD COLUMN handled_at TEXT;
ALTER TABLE knowledge_deprecations ADD COLUMN handled_by TEXT;
ALTER TABLE knowledge_deprecations ADD COLUMN handle_action TEXT;
ALTER TABLE knowledge_deprecations ADD COLUMN handle_note TEXT;

CREATE TABLE IF NOT EXISTS knowledge_grants (
  id TEXT PRIMARY KEY, knowledge_id TEXT NOT NULL, scope TEXT NOT NULL, scope_id TEXT NOT NULL,
  granted_by TEXT, granted_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_bindings (
  id TEXT PRIMARY KEY, skill_id TEXT NOT NULL, selector TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
  note TEXT, created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
