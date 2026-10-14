-- 20261014_knowledge_skill_presentation_and_ontology_ledger
-- PostgreSQL-native schema for knowledge/skill presentation state and release facts.
-- Register in scripts/apply-postgres-schema.ts with a new immutable migration id.

CREATE TABLE IF NOT EXISTS skill_presentation_overlays (
  skill_id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ontology_release_ledger (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  registry_version BIGINT NOT NULL,
  base_version TEXT NOT NULL,
  content_digest TEXT NOT NULL,
  git_commit TEXT,
  approval_id TEXT,
  bootstrap BOOLEAN NOT NULL,
  deployed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ontology_release_ledger_scope_deployed_idx
  ON ontology_release_ledger (scope, deployed_at DESC, id DESC);

CREATE OR REPLACE FUNCTION ontology_release_ledger_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'ontology_release_ledger is append-only';
END;
$$;

DROP TRIGGER IF EXISTS prevent_immutable_row_change ON ontology_release_ledger;
CREATE TRIGGER prevent_immutable_row_change
BEFORE UPDATE OR DELETE ON ontology_release_ledger
FOR EACH ROW EXECUTE FUNCTION ontology_release_ledger_reject_mutation();

DROP TRIGGER IF EXISTS prevent_immutable_table_truncate ON ontology_release_ledger;
CREATE TRIGGER prevent_immutable_table_truncate
BEFORE TRUNCATE ON ontology_release_ledger
FOR EACH STATEMENT EXECUTE FUNCTION ontology_release_ledger_reject_mutation();
