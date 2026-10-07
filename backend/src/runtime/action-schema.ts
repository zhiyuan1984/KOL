/** Versioned by apply-postgres-schema; shared with isolated integration fixtures. */
export const runtimeActionSchema = `
CREATE TABLE IF NOT EXISTS runtime_actions (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  session_id TEXT,
  context_json JSONB NOT NULL,
  connector_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  args_json JSONB NOT NULL,
  snapshot TEXT NOT NULL,
  proposal_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('pending','dispatching','succeeded','rejected','uncertain','cancelled')),
  receipt_json JSONB,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS runtime_actions_owner_session ON runtime_actions(actor_id,session_id,created_at);
CREATE TABLE IF NOT EXISTS runtime_crawl_jobs (
  id TEXT PRIMARY KEY,
  instance_key TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  context_json JSONB NOT NULL,
  config_version INTEGER NOT NULL,
  args_json JSONB NOT NULL,
  remote_task_id TEXT,
  state TEXT NOT NULL CHECK (state IN ('starting','running','stopping','succeeded','failed','cancelled','uncertain')),
  receipt_json JSONB,
  status_json JSONB,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS runtime_crawl_instance_active ON runtime_crawl_jobs(instance_key)
  WHERE state IN ('starting','running','stopping','uncertain');
`;

/**
 * 增量迁移 20261007_crawl_queue_state 的语句体。
 * 注意：不要直接改上面的 runtimeActionSchema 常量——20261004_runtime_actions 已在生产执行，
 * 常量变化会触发 checksum mismatch 导致部署失败。CHECK 变更只走增量迁移。
 */
export const crawlQueueStateMigration: string[] = [
  "ALTER TABLE runtime_crawl_jobs DROP CONSTRAINT IF EXISTS runtime_crawl_jobs_state_check",
  "ALTER TABLE runtime_crawl_jobs ADD CONSTRAINT runtime_crawl_jobs_state_check CHECK (state IN ('starting','running','stopping','succeeded','failed','cancelled','uncertain','queued'))",
];
