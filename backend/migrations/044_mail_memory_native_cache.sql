-- Native PostgreSQL storage for employee-triggered mail summary / translation receipts.
-- The cache is actor-scoped: a mailbox or cache key is never an authorization grant.
CREATE TABLE IF NOT EXISTS kol_mail_memory_cache (
  actor_id TEXT NOT NULL,
  memory_key TEXT NOT NULL,
  value_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, memory_key)
);

CREATE INDEX IF NOT EXISTS kol_mail_memory_cache_updated
  ON kol_mail_memory_cache(actor_id, updated_at DESC);
