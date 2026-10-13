-- 20261014_native_business_repositories
-- Expand-only migration. No runtime cutover is performed by this migration.

ALTER TABLE kol_follow_index ADD COLUMN IF NOT EXISTS claimed_at_ts TIMESTAMPTZ;
ALTER TABLE kol_follow_index ADD COLUMN IF NOT EXISTS last_effective_mail_at_ts TIMESTAMPTZ;
ALTER TABLE kol_follow_index ADD COLUMN IF NOT EXISTS release_due_at_ts TIMESTAMPTZ;
ALTER TABLE kol_follow_index ADD COLUMN IF NOT EXISTS released_at_ts TIMESTAMPTZ;
ALTER TABLE kol_follow_index ADD COLUMN IF NOT EXISTS created_at_ts TIMESTAMPTZ;
ALTER TABLE kol_follow_index ADD COLUMN IF NOT EXISTS updated_at_ts TIMESTAMPTZ;
ALTER TABLE kol_profile_index ADD COLUMN IF NOT EXISTS updated_at_ts TIMESTAMPTZ;

UPDATE kol_follow_index
SET claimed_at_ts = CASE WHEN claimed_at_ts IS NULL AND NULLIF(trim(claimed_at),'') IS NOT NULL THEN NULLIF(trim(claimed_at),'')::timestamptz ELSE claimed_at_ts END,
    last_effective_mail_at_ts = CASE WHEN last_effective_mail_at_ts IS NULL AND NULLIF(trim(last_effective_mail_at),'') IS NOT NULL THEN NULLIF(trim(last_effective_mail_at),'')::timestamptz ELSE last_effective_mail_at_ts END,
    release_due_at_ts = CASE WHEN release_due_at_ts IS NULL AND NULLIF(trim(release_due_at),'') IS NOT NULL THEN NULLIF(trim(release_due_at),'')::timestamptz ELSE release_due_at_ts END,
    released_at_ts = CASE WHEN released_at_ts IS NULL AND NULLIF(trim(released_at),'') IS NOT NULL THEN NULLIF(trim(released_at),'')::timestamptz ELSE released_at_ts END,
    created_at_ts = CASE WHEN created_at_ts IS NULL AND NULLIF(trim(created_at),'') IS NOT NULL THEN NULLIF(trim(created_at),'')::timestamptz ELSE created_at_ts END,
    updated_at_ts = CASE WHEN updated_at_ts IS NULL AND NULLIF(trim(updated_at),'') IS NOT NULL THEN NULLIF(trim(updated_at),'')::timestamptz ELSE updated_at_ts END
WHERE claimed_at_ts IS NULL OR last_effective_mail_at_ts IS NULL OR release_due_at_ts IS NULL OR released_at_ts IS NULL OR created_at_ts IS NULL OR updated_at_ts IS NULL;

UPDATE kol_profile_index
SET updated_at_ts = CASE WHEN updated_at_ts IS NULL AND NULLIF(trim(updated_at),'') IS NOT NULL THEN NULLIF(trim(updated_at),'')::timestamptz ELSE updated_at_ts END
WHERE updated_at_ts IS NULL;

CREATE INDEX IF NOT EXISTS kol_follow_native_release_candidates
  ON kol_follow_index(company_id, status, last_effective_mail_at_ts, id)
  WHERE status='active' AND last_effective_mail_at_ts IS NOT NULL;

CREATE TABLE IF NOT EXISTS kol_ownership_release_decisions (
  id TEXT PRIMARY KEY,
  cron_run_id TEXT,
  follow_id TEXT NOT NULL,
  collaboration_id TEXT,
  decision TEXT NOT NULL CHECK (decision IN ('release','skip')),
  reason TEXT NOT NULL,
  expected_owner TEXT,
  expected_last_effective_mail_at TIMESTAMPTZ,
  observed_owner TEXT,
  observed_last_effective_mail_at TIMESTAMPTZ,
  policy_version TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kol_ownership_release_decisions_run ON kol_ownership_release_decisions(cron_run_id, created_at);
CREATE INDEX IF NOT EXISTS kol_ownership_release_decisions_follow ON kol_ownership_release_decisions(follow_id, created_at DESC);

ALTER TABLE kol_mail_items ADD COLUMN IF NOT EXISTS body_fingerprint TEXT;
ALTER TABLE kol_mail_items ADD COLUMN IF NOT EXISTS memory_generated_at_ts TIMESTAMPTZ;
ALTER TABLE kol_mail_items ADD COLUMN IF NOT EXISTS memory_next_retry_at TIMESTAMPTZ;
ALTER TABLE kol_mail_threads ADD COLUMN IF NOT EXISTS digest_generated_at_ts TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS kol_mail_person_memory (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL DEFAULT '',
  mailbox TEXT NOT NULL,
  peer_email TEXT NOT NULL,
  digest_text TEXT NOT NULL DEFAULT '',
  digest_source TEXT NOT NULL DEFAULT '',
  digest_fingerprint TEXT NOT NULL DEFAULT '',
  mail_count INTEGER NOT NULL DEFAULT 0,
  generated_at TIMESTAMPTZ,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(mailbox, peer_email)
);
CREATE INDEX IF NOT EXISTS kol_mail_person_memory_mailbox ON kol_mail_person_memory(mailbox, updated_at DESC);

CREATE TABLE IF NOT EXISTS kol_mail_memory_runs (
  id TEXT PRIMARY KEY,
  mailbox TEXT NOT NULL DEFAULT '*',
  status TEXT NOT NULL CHECK (status IN ('running','succeeded','failed')),
  scanned INTEGER NOT NULL DEFAULT 0,
  translated INTEGER NOT NULL DEFAULT 0,
  summarized INTEGER NOT NULL DEFAULT 0,
  digested INTEGER NOT NULL DEFAULT 0,
  persons INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  error TEXT
);
CREATE INDEX IF NOT EXISTS kol_mail_memory_runs_started ON kol_mail_memory_runs(started_at DESC);

CREATE TABLE IF NOT EXISTS kol_mail_memory_work (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES kol_mail_memory_runs(id) ON DELETE CASCADE,
  item_id TEXT,
  thread_id TEXT,
  mailbox TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('item','thread','person')),
  fingerprint TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('queued','leased','succeeded','failed')),
  lease_until TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kol_mail_memory_work_ready ON kol_mail_memory_work(status, lease_until, created_at);

-- Backfill deterministic item fingerprints without invoking a model.
UPDATE kol_mail_items
SET body_fingerprint = md5(COALESCE(body_text,''))
WHERE body_fingerprint IS NULL AND COALESCE(body_text,'') <> '';
