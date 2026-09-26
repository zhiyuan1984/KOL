-- Public-profile enrichment and bounded Jev assessment cache.
-- db.ts migrateSchema() applies these columns idempotently for embedded deployments.

ALTER TABLE kol_profile_index ADD COLUMN avatar_checked_at TEXT;
ALTER TABLE kol_profile_index ADD COLUMN avatar_error TEXT;
ALTER TABLE kol_profile_index ADD COLUMN potential_score INTEGER;
ALTER TABLE kol_profile_index ADD COLUMN potential_confidence REAL;
ALTER TABLE kol_profile_index ADD COLUMN risk_score INTEGER;
ALTER TABLE kol_profile_index ADD COLUMN risk_confidence REAL;
ALTER TABLE kol_profile_index ADD COLUMN assessment_model TEXT;
ALTER TABLE kol_profile_index ADD COLUMN assessment_version TEXT;
ALTER TABLE kol_profile_index ADD COLUMN assessed_at TEXT;
ALTER TABLE kol_profile_index ADD COLUMN assessment_error TEXT;
