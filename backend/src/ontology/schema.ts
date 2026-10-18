export const ontologySchema = `
CREATE TABLE IF NOT EXISTS ontology_documents (
 company_id text NOT NULL, code text NOT NULL, revision integer NOT NULL CHECK(revision>0),
 draft jsonb, published jsonb, disabled boolean NOT NULL DEFAULT false,
 updated_at text NOT NULL, PRIMARY KEY(company_id,code)
);
CREATE TABLE IF NOT EXISTS ontology_versions (
 id text PRIMARY KEY, company_id text NOT NULL, code text NOT NULL, revision integer NOT NULL,
 action text NOT NULL, actor text NOT NULL, reason text NOT NULL, definition jsonb, created_at text NOT NULL,
 UNIQUE(company_id,code,revision)
);
CREATE TABLE IF NOT EXISTS ontology_confirmations (
 id text PRIMARY KEY, company_id text NOT NULL, actor text NOT NULL, code text NOT NULL,
 revision integer NOT NULL, action text NOT NULL, target_version text, source_version text NOT NULL,
 expires_at text NOT NULL, consumed boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS ontology_receipts (
 company_id text NOT NULL, actor text NOT NULL, command_id text NOT NULL, command_hash text NOT NULL,
 receipt jsonb NOT NULL, PRIMARY KEY(company_id,actor,command_id)
);
CREATE INDEX IF NOT EXISTS ontology_versions_object ON ontology_versions(company_id,code,revision DESC);
CREATE OR REPLACE FUNCTION ontology_keep_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'ontology history is immutable'; END $$;
DROP TRIGGER IF EXISTS ontology_versions_immutable ON ontology_versions;
CREATE TRIGGER ontology_versions_immutable BEFORE UPDATE OR DELETE ON ontology_versions
 FOR EACH ROW EXECUTE FUNCTION ontology_keep_history();
DROP TRIGGER IF EXISTS ontology_receipts_immutable ON ontology_receipts;
CREATE TRIGGER ontology_receipts_immutable BEFORE UPDATE OR DELETE ON ontology_receipts
 FOR EACH ROW EXECUTE FUNCTION ontology_keep_history();
`;
