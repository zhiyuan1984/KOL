-- Official open-pool profile (table A) vs exclusive follow (table B).
-- Discovery candidate ≠ kol_profile_index ≠ kol_follow_index.active.
-- Aligns with kol A/B model: A = formal pool profile, B = owner claim.
-- db.ts applies the same CREATE TABLE IF NOT EXISTS for embedded deployments.

CREATE TABLE IF NOT EXISTS kol_profile_index (
  kol_uid TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  platform_creator_id TEXT NOT NULL,
  pool_status TEXT NOT NULL DEFAULT 'open' CHECK (pool_status IN ('open', 'held')),
  handle TEXT,
  display_name TEXT,
  source TEXT NOT NULL DEFAULT 'discovery',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS kol_profile_index_external
  ON kol_profile_index(platform, platform_creator_id);

CREATE INDEX IF NOT EXISTS kol_profile_index_pool
  ON kol_profile_index(pool_status, updated_at);

CREATE TABLE IF NOT EXISTS kol_follow_index (
  id TEXT PRIMARY KEY,
  kol_uid TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'released')),
  claimed_at TEXT,
  released_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(kol_uid, owner_user_id),
  FOREIGN KEY(kol_uid) REFERENCES kol_profile_index(kol_uid) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS kol_follow_index_active
  ON kol_follow_index(kol_uid) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS kol_follow_index_owner
  ON kol_follow_index(owner_user_id, status);
