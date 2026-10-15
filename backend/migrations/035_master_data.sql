-- 035: 主数据记录表（master_data_records）。
-- 企业级业务本体 Track C（C1 Excel 导入链路）：主数据权威源为 Excel，
-- 导入链路为 上传 → 解析 → 校验 → 预览 → 确认导入 → 写入本表。
-- 通用 schema：一行 = 一个主数据条目（kind + code 唯一），attrs 存各域自定义属性。
CREATE TABLE IF NOT EXISTS master_data_records (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  attrs JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active',
  source TEXT NOT NULL DEFAULT 'excel_import',
  batch_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT master_data_records_kind_code_unique UNIQUE (kind, code)
);

CREATE INDEX IF NOT EXISTS master_data_records_kind
  ON master_data_records(kind, status);
CREATE INDEX IF NOT EXISTS master_data_records_batch
  ON master_data_records(batch_id) WHERE batch_id IS NOT NULL;
