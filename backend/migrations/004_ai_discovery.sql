-- Home AI发现 first-class discovery pipeline.
-- db.ts applies the same CREATE TABLE IF NOT EXISTS for embedded deployments.
-- DiscoveryRequest = employee/system intent (overseas platforms only).
-- DiscoveryRun = one async MediaCrawler execution (reuses crawl_jobs).
-- CreatorCandidate = normalized crawl creator; Collaboration is created only on
-- employee confirm-follow. Crawl completion never auto-creates Collaboration,
-- never sends mail, and never writes/advances official stage.

CREATE TABLE IF NOT EXISTS discovery_requests (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  keywords TEXT NOT NULL,
  platforms TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'search',
  filters TEXT NOT NULL DEFAULT '{}',
  brand TEXT,
  scope TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'open',
  latest_run_id TEXT,
  error TEXT,
  data_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS discovery_runs (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES discovery_requests(id) ON DELETE CASCADE,
  owner_user_id TEXT NOT NULL,
  crawl_job_id TEXT REFERENCES crawl_jobs(id) ON DELETE SET NULL,
  work_item_id TEXT REFERENCES work_items(id) ON DELETE SET NULL,
  platform TEXT NOT NULL,
  mode TEXT NOT NULL,
  parameters TEXT NOT NULL DEFAULT '{}',
  remote_task_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued',
  error TEXT,
  candidate_count INTEGER NOT NULL DEFAULT 0,
  data_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  started_at TEXT,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS creator_candidates (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES discovery_requests(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL REFERENCES discovery_runs(id) ON DELETE CASCADE,
  owner_user_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  platform_creator_id TEXT NOT NULL,
  claw_creator_id TEXT,
  handle TEXT,
  nickname TEXT,
  followers INTEGER NOT NULL DEFAULT 0,
  score REAL NOT NULL DEFAULT 0,
  signals TEXT NOT NULL DEFAULT '{}',
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'suggested',
  collaboration_id TEXT,
  dismissed_at TEXT,
  followed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(request_id, platform, platform_creator_id)
);

CREATE INDEX IF NOT EXISTS discovery_requests_owner
  ON discovery_requests(owner_user_id, updated_at);
CREATE INDEX IF NOT EXISTS discovery_runs_request
  ON discovery_runs(request_id, created_at);
CREATE INDEX IF NOT EXISTS creator_candidates_owner_status
  ON creator_candidates(owner_user_id, status, score);
CREATE INDEX IF NOT EXISTS creator_candidates_run
  ON creator_candidates(run_id, status);
