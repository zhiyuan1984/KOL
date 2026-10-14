-- Repair for production databases where 039_kol_pool_sync_runs.sql was not registered
-- in the PostgreSQL migration runner. Keep this additive and idempotent.
ALTER TABLE starry_ownership_sync_state ADD COLUMN IF NOT EXISTS last_success_at TEXT;
ALTER TABLE starry_ownership_sync_state ADD COLUMN IF NOT EXISTS last_attempt_at TEXT;
ALTER TABLE starry_ownership_sync_state ADD COLUMN IF NOT EXISTS last_run_id TEXT;
