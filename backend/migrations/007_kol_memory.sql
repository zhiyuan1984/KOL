-- KOL follow / pool memory indexes (BIZ-01/05/06/07/18, TECH-BE-06).
-- A public profile, B exclusive follow, C thread summary.
-- At most one status=active per (company_id, kol_uid, scope_brand).
-- Applied from db.ts migrateSchema for embedded deployments.

CREATE TABLE IF NOT EXISTS kol_profile_index (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  kol_uid TEXT NOT NULL,
  handle TEXT,
  display_name TEXT,
  platform TEXT,
  homepage_url TEXT,
  followers TEXT,
  avg_plays TEXT,
  engagement TEXT,
  direction TEXT,
  region TEXT,
  style TEXT,
  ingest_source TEXT,
  ingested_at TEXT,
  public_stage TEXT,
  pool_status TEXT NOT NULL DEFAULT 'open',
  idle INTEGER NOT NULL DEFAULT 0,
  source_version TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, kol_uid)
);

CREATE TABLE IF NOT EXISTS kol_follow_index (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  kol_uid TEXT NOT NULL,
  scope_brand TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  employee_name TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  claimed_at TEXT NOT NULL,
  last_effective_mail_at TEXT,
  release_due_at TEXT,
  released_at TEXT,
  release_reason TEXT,
  collaboration_id TEXT,
  data_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS kol_follow_index_active_uniq
  ON kol_follow_index(company_id, kol_uid, scope_brand)
  WHERE status='active';

CREATE INDEX IF NOT EXISTS kol_follow_index_employee
  ON kol_follow_index(employee_id, status);

CREATE TABLE IF NOT EXISTS kol_thread_summary (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  follow_id TEXT NOT NULL,
  kol_uid TEXT NOT NULL,
  conversation_id TEXT,
  subject TEXT,
  participants TEXT,
  time_range TEXT,
  last_at TEXT,
  effective INTEGER NOT NULL DEFAULT 0,
  key_agreements TEXT,
  open_questions TEXT,
  next_step TEXT,
  mail_refs TEXT,
  source_version TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS kol_thread_summary_follow
  ON kol_thread_summary(follow_id, effective);
