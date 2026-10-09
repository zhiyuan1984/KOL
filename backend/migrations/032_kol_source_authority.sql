-- Source evidence is not an exclusive follow: no kol_follow_index backfill.
ALTER TABLE user_starry_bindings ADD COLUMN IF NOT EXISTS owner_open_id TEXT;
ALTER TABLE user_starry_bindings ADD COLUMN IF NOT EXISTS owner_verified_at TEXT;
CREATE TABLE IF NOT EXISTS starry_profile_ownership (
  company_id TEXT NOT NULL,
  kol_uid TEXT NOT NULL,
  owner_open_id TEXT NOT NULL DEFAULT '',
  owner_mailbox TEXT NOT NULL DEFAULT '',
  brand TEXT NOT NULL DEFAULT '',
  source_version TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  PRIMARY KEY (company_id, kol_uid)
);
CREATE INDEX IF NOT EXISTS starry_profile_ownership_owner_idx
  ON starry_profile_ownership(company_id, owner_open_id, kol_uid);
CREATE INDEX IF NOT EXISTS starry_profile_ownership_mailbox_idx
  ON starry_profile_ownership(company_id, owner_mailbox, kol_uid);
-- Historical canonicalization is explicit and auditable, never name based.
CREATE TABLE IF NOT EXISTS kol_identity_repairs (
  repair_key TEXT PRIMARY KEY,
  legacy_user_id TEXT NOT NULL,
  canonical_user_id TEXT NOT NULL,
  follow_ids JSONB NOT NULL,
  actor TEXT NOT NULL,
  repaired_at TEXT NOT NULL
);
