-- Public pool page and latest release lookup. Run through the PostgreSQL migration ledger.
CREATE INDEX IF NOT EXISTS kol_profile_index_open_ingested
  ON kol_profile_index(company_id, ingested_at DESC, id) WHERE pool_status='open';
CREATE INDEX IF NOT EXISTS kol_profile_index_open_score
  ON kol_profile_index(company_id, (COALESCE(potential_score, 0)) DESC, id) WHERE pool_status='open';
CREATE INDEX IF NOT EXISTS kol_follow_index_latest_release
  ON kol_follow_index(company_id, kol_uid, released_at DESC, id DESC)
  INCLUDE (release_reason) WHERE status='released';
