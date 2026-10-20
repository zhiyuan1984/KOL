/**
 * Formal PostgreSQL migration asset for the WeCom ontology source.
 *
 * The only mutable source facts are a short-lived preview and the one-time
 * source/company binding. Imported snapshot headers, external references and
 * receipts are append-only. No organization, account, role or Agent table is
 * referenced or changed here.
 */
export const wecomOntologySourceSchema = `
CREATE TABLE IF NOT EXISTS ontology_wecom_source_bindings (
  source text PRIMARY KEY CHECK (source='wecom'),
  company_id text NOT NULL UNIQUE,
  connector_id text NOT NULL CHECK (connector_id='wecom-mcp'),
  configured_by text NOT NULL,
  configuration_fingerprint text NOT NULL,
  configured_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS ontology_wecom_source_previews (
  id text PRIMARY KEY,
  company_id text NOT NULL,
  actor_id text NOT NULL,
  content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[a-f0-9]{64}$'),
  binding_fingerprint text NOT NULL CHECK (binding_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  source_version_json jsonb NOT NULL CHECK (jsonb_typeof(source_version_json)='object'),
  root_department_external_ids jsonb NOT NULL CHECK (jsonb_typeof(root_department_external_ids)='array'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload)='object'),
  expires_at text NOT NULL,
  consumed_at text,
  created_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS ontology_wecom_source_previews_actor_idx
  ON ontology_wecom_source_previews(company_id,actor_id,expires_at DESC);

CREATE TABLE IF NOT EXISTS ontology_wecom_source_snapshots (
  id text PRIMARY KEY,
  company_id text NOT NULL,
  source text NOT NULL CHECK (source='wecom'),
  source_version_json jsonb NOT NULL CHECK (jsonb_typeof(source_version_json)='object'),
  content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[a-f0-9]{64}$'),
  binding_fingerprint text NOT NULL CHECK (binding_fingerprint ~ '^sha256:[a-f0-9]{64}$'),
  root_department_external_ids jsonb NOT NULL CHECK (jsonb_typeof(root_department_external_ids)='array'),
  imported_by text NOT NULL,
  created_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS ontology_wecom_source_snapshots_company_idx
  ON ontology_wecom_source_snapshots(company_id,created_at DESC,id DESC);

CREATE TABLE IF NOT EXISTS ontology_wecom_source_external_refs (
  snapshot_id text NOT NULL REFERENCES ontology_wecom_source_snapshots(id) ON DELETE RESTRICT,
  company_id text NOT NULL,
  source text NOT NULL CHECK (source='wecom'),
  kind text NOT NULL CHECK (kind IN ('department','person','membership')),
  object_code text NOT NULL CHECK (object_code IN ('org_unit','user','membership')),
  external_id text NOT NULL,
  upstream_id text NOT NULL,
  ontology_properties jsonb NOT NULL CHECK (jsonb_typeof(ontology_properties)='object'),
  attributes jsonb NOT NULL CHECK (jsonb_typeof(attributes)='object'),
  relations jsonb NOT NULL CHECK (jsonb_typeof(relations)='object'),
  created_at text NOT NULL,
  PRIMARY KEY(snapshot_id,kind,external_id),
  UNIQUE(snapshot_id,external_id)
);
CREATE INDEX IF NOT EXISTS ontology_wecom_source_external_refs_page_idx
  ON ontology_wecom_source_external_refs(snapshot_id,kind,external_id);
CREATE INDEX IF NOT EXISTS ontology_wecom_source_external_refs_identity_idx
  ON ontology_wecom_source_external_refs(company_id,source,kind,external_id);

CREATE TABLE IF NOT EXISTS ontology_wecom_source_receipts (
  company_id text NOT NULL,
  actor_id text NOT NULL,
  command_id text NOT NULL,
  command_hash text NOT NULL CHECK (command_hash ~ '^sha256:[a-f0-9]{64}$'),
  receipt jsonb NOT NULL CHECK (jsonb_typeof(receipt)='object'),
  created_at text NOT NULL,
  PRIMARY KEY(company_id,actor_id,command_id)
);

CREATE OR REPLACE FUNCTION ontology_wecom_source_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'wecom ontology source history is immutable';
END $$;
DROP TRIGGER IF EXISTS ontology_wecom_source_bindings_immutable ON ontology_wecom_source_bindings;
CREATE TRIGGER ontology_wecom_source_bindings_immutable BEFORE UPDATE OR DELETE ON ontology_wecom_source_bindings
  FOR EACH ROW EXECUTE FUNCTION ontology_wecom_source_history_immutable();
DROP TRIGGER IF EXISTS ontology_wecom_source_snapshots_immutable ON ontology_wecom_source_snapshots;
CREATE TRIGGER ontology_wecom_source_snapshots_immutable BEFORE UPDATE OR DELETE ON ontology_wecom_source_snapshots
  FOR EACH ROW EXECUTE FUNCTION ontology_wecom_source_history_immutable();
DROP TRIGGER IF EXISTS ontology_wecom_source_external_refs_immutable ON ontology_wecom_source_external_refs;
CREATE TRIGGER ontology_wecom_source_external_refs_immutable BEFORE UPDATE OR DELETE ON ontology_wecom_source_external_refs
  FOR EACH ROW EXECUTE FUNCTION ontology_wecom_source_history_immutable();
DROP TRIGGER IF EXISTS ontology_wecom_source_receipts_immutable ON ontology_wecom_source_receipts;
CREATE TRIGGER ontology_wecom_source_receipts_immutable BEFORE UPDATE OR DELETE ON ontology_wecom_source_receipts
  FOR EACH ROW EXECUTE FUNCTION ontology_wecom_source_history_immutable();
`;
