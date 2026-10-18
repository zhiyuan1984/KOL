/** Platform capability configuration; it grants no person, Agent or tool permission. */
export const operationSchema = `
CREATE TABLE IF NOT EXISTS capability_operation_documents (
 id text NOT NULL, version integer NOT NULL CHECK(version>0), revision integer NOT NULL CHECK(revision>0),
 draft jsonb, published jsonb, disabled boolean NOT NULL DEFAULT false,
 updated_at text NOT NULL, PRIMARY KEY(id,version)
);
CREATE TABLE IF NOT EXISTS capability_operation_versions (
 receipt_id text PRIMARY KEY, id text NOT NULL, version integer NOT NULL, revision integer NOT NULL,
 action text NOT NULL CHECK(action IN ('publish','disable','restore')), definition jsonb,
 actor text NOT NULL, reason text NOT NULL, command_id text NOT NULL, command_hash text NOT NULL,
 created_at text NOT NULL, UNIQUE(id,version,revision), UNIQUE(actor,command_id)
);
CREATE TABLE IF NOT EXISTS capability_operation_confirmations (
 token text PRIMARY KEY, actor text NOT NULL, command jsonb NOT NULL, fingerprint text NOT NULL,
 expires_at text NOT NULL, consumed boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS capability_operation_history ON capability_operation_versions(id,version,revision DESC);
CREATE OR REPLACE FUNCTION capability_operation_keep_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'capability history is immutable'; END $$;
DROP TRIGGER IF EXISTS capability_operation_history_immutable ON capability_operation_versions;
CREATE TRIGGER capability_operation_history_immutable BEFORE UPDATE OR DELETE ON capability_operation_versions
 FOR EACH ROW EXECUTE FUNCTION capability_operation_keep_history();
`;
