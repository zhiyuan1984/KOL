-- P0: 公海 Starry 全量同步批次与可观测健康状态。
CREATE TABLE IF NOT EXISTS kol_pool_sync_runs (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (running,succeeded,failed)),
  source_version TEXT NOT NULL,
  expected_count INTEGER,
  fetched_count INTEGER NOT NULL DEFAULT 0,
  upserted_count INTEGER NOT NULL DEFAULT 0,
  page_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  error TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS kol_pool_sync_runs_company_started
  ON kol_pool_sync_runs(company_id, started_at DESC);
CREATE INDEX IF NOT EXISTS kol_pool_sync_runs_status
  ON kol_pool_sync_runs(company_id, status, started_at DESC);
ALTER TABLE starry_ownership_sync_state ADD COLUMN IF NOT EXISTS last_success_at TEXT;
ALTER TABLE starry_ownership_sync_state ADD COLUMN IF NOT EXISTS last_attempt_at TEXT;
ALTER TABLE starry_ownership_sync_state ADD COLUMN IF NOT EXISTS last_run_id TEXT;
