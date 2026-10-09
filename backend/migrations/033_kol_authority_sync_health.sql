CREATE TABLE IF NOT EXISTS starry_ownership_sync_state (
  company_id TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('ready','failed')),
  source_version TEXT NOT NULL,
  profile_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  updated_at TEXT NOT NULL
);
