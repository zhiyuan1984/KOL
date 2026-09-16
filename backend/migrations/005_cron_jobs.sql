-- Persistent published cron jobs (TECH-BE-04). db.ts applies the same
-- CREATE TABLE IF NOT EXISTS for embedded deployments.
-- Determined handlers MUST NOT create sessions/threads/turns.
-- Unique (job_id, scheduled_for) = one successful enqueue per slot.
-- Multi-worker claim: BEGIN IMMEDIATE + queued→running status flip.

CREATE TABLE IF NOT EXISTS cron_jobs (
  id TEXT PRIMARY KEY,
  job_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  owner_account_id TEXT,
  execute_as TEXT NOT NULL,
  capability_expert_id TEXT,
  handler_key TEXT NOT NULL,
  scope_json TEXT NOT NULL DEFAULT '{}',
  condition_json TEXT NOT NULL DEFAULT '{}',
  cron_expr TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  status TEXT NOT NULL DEFAULT 'draft',
  retry_policy_json TEXT NOT NULL DEFAULT '{}',
  takeover_policy_json TEXT NOT NULL DEFAULT '{}',
  published_rev INTEGER NOT NULL DEFAULT 1,
  next_run_at TEXT,
  last_run_at TEXT,
  last_terminal_status TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cron_runs (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES cron_jobs(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  scheduled_for TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  error_code TEXT,
  error_summary TEXT,
  receipt_json TEXT,
  artifact_refs TEXT,
  session_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(job_id, scheduled_for)
);

CREATE INDEX IF NOT EXISTS cron_jobs_status_next
  ON cron_jobs(status, next_run_at);
CREATE INDEX IF NOT EXISTS cron_runs_job
  ON cron_runs(job_id, created_at);
CREATE INDEX IF NOT EXISTS cron_runs_status
  ON cron_runs(status, scheduled_for);
