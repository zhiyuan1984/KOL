-- PostgreSQL organization authority extension.
-- Applied only by the repository migration process / isolated test schema setup; never at runtime.
ALTER TABLE organization_people ADD COLUMN IF NOT EXISTS avatar_url TEXT;
