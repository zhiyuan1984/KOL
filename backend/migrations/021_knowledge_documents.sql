-- 非结构化资料流水线（P1）：knowledge_documents（资料）＋ knowledge_document_jobs（加工作业）。
-- db.ts 的 initSchema 为内嵌部署应用同一段幂等建表；本文件只作镜像留档。
-- 设计 docs/superpowers/specs/2026-10-02-knowledge-unstructured-pageindex-design.md §4；
-- 计划 docs/superpowers/plans/2026-10-02-knowledge-unstructured-pageindex-implementation.md。
CREATE TABLE IF NOT EXISTS knowledge_documents (
  id TEXT PRIMARY KEY,
  base_id TEXT NOT NULL,
  title TEXT NOT NULL,
  filename TEXT NOT NULL,
  media_type TEXT NOT NULL,
  mime TEXT,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  source_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'uploaded',
  error TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  artifacts TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_by TEXT,
  published_at TEXT
);
CREATE INDEX IF NOT EXISTS knowledge_documents_base
  ON knowledge_documents(base_id, status);
CREATE INDEX IF NOT EXISTS knowledge_documents_updated
  ON knowledge_documents(updated_at DESC);

CREATE TABLE IF NOT EXISTS knowledge_document_jobs (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  progress_done INTEGER NOT NULL DEFAULT 0,
  progress_total INTEGER NOT NULL DEFAULT 0,
  detail TEXT,
  error TEXT,
  attempt INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS knowledge_document_jobs_doc
  ON knowledge_document_jobs(document_id, created_at DESC);
CREATE INDEX IF NOT EXISTS knowledge_document_jobs_status
  ON knowledge_document_jobs(status);

-- 状态枚举（代码强制，不建 CHECK 以保持与既有表风格一致）：
--   documents.status: uploaded|normalizing|indexing|pending_review|published|archived|failed|cancelled
--   jobs.kind: normalize|index        jobs.status: queued|running|done|failed|cancelled
