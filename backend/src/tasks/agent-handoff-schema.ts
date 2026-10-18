export const taskAgentHandoffSchema=`
CREATE TABLE IF NOT EXISTS task_agent_handoffs (
 id text PRIMARY KEY, actor_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 task_id text NOT NULL REFERENCES tickets(id) ON DELETE RESTRICT,
 command_id text NOT NULL, command_hash text NOT NULL, source_version integer NOT NULL,
 target_agent_id text NOT NULL REFERENCES managed_agents(id) ON DELETE RESTRICT,
 target_skill_id text NOT NULL, package jsonb NOT NULL, fingerprint text NOT NULL,
 target_task_id text REFERENCES tickets(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(), accepted_at timestamptz,
 UNIQUE(actor_id,command_id), CHECK ((target_task_id IS NULL AND accepted_at IS NULL) OR (target_task_id IS NOT NULL AND accepted_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS task_agent_handoffs_task ON task_agent_handoffs(task_id,created_at DESC);
CREATE OR REPLACE FUNCTION task_handoff_keep_basis() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'handoff history is immutable'; END IF;
 IF (to_jsonb(NEW)-'target_task_id'-'accepted_at') IS DISTINCT FROM (to_jsonb(OLD)-'target_task_id'-'accepted_at')
  OR OLD.target_task_id IS NOT NULL THEN RAISE EXCEPTION 'handoff basis is immutable'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS task_handoff_immutable ON task_agent_handoffs;
CREATE TRIGGER task_handoff_immutable BEFORE UPDATE OR DELETE ON task_agent_handoffs FOR EACH ROW EXECUTE FUNCTION task_handoff_keep_basis();
`;
