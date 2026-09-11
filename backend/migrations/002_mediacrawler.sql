ALTER TABLE claw_creators ADD COLUMN platform_creator_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS claw_creators_platform_identity
  ON claw_creators(platform, platform_creator_id) WHERE platform_creator_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS crawl_jobs (
  id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE, owner_user_id TEXT NOT NULL,
  work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL, platform TEXT NOT NULL,
  mode TEXT NOT NULL, parameters TEXT NOT NULL, remote_task_id TEXT, status TEXT NOT NULL,
  upload_error TEXT, error TEXT, data_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, started_at TEXT, last_checked_at TEXT, updated_at TEXT NOT NULL, completed_at TEXT
);
DROP INDEX IF EXISTS crawl_jobs_one_active;
CREATE UNIQUE INDEX IF NOT EXISTS crawl_jobs_one_active
  ON crawl_jobs((1)) WHERE status IN ('queued','crawling','uploading','analyzing','starting','running','stopping');

CREATE TABLE IF NOT EXISTS crawl_job_events (
  id TEXT PRIMARY KEY, crawl_job_id TEXT NOT NULL REFERENCES crawl_jobs(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL, event_type TEXT NOT NULL, status TEXT NOT NULL, summary TEXT,
  payload TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, UNIQUE(crawl_job_id, sequence)
);

CREATE TABLE IF NOT EXISTS ingestion_batches (
  id TEXT PRIMARY KEY, source TEXT NOT NULL, task_id TEXT,
  crawl_job_id TEXT REFERENCES crawl_jobs(id) ON DELETE SET NULL,
  accepted INTEGER NOT NULL, inserted INTEGER NOT NULL, updated INTEGER NOT NULL,
  rejected INTEGER NOT NULL, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS creator_snapshots (
  id TEXT PRIMARY KEY, creator_id TEXT NOT NULL REFERENCES claw_creators(id) ON DELETE CASCADE,
  ingestion_batch_id TEXT, crawl_job_id TEXT REFERENCES crawl_jobs(id) ON DELETE SET NULL,
  platform TEXT NOT NULL, platform_creator_id TEXT NOT NULL, nickname TEXT NOT NULL,
  followers INTEGER NOT NULL DEFAULT 0, recent_views TEXT NOT NULL DEFAULT '[]',
  score REAL NOT NULL DEFAULT 0, score_details TEXT NOT NULL DEFAULT '{}', source TEXT,
  task_id TEXT, collected_at TEXT NOT NULL, created_at TEXT NOT NULL
);
