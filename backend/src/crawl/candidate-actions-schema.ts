export const candidateActionsSchema = `
CREATE TABLE IF NOT EXISTS discovery_runtime_decisions (
  actor_id TEXT NOT NULL, action_id TEXT NOT NULL REFERENCES runtime_actions(id), candidate_id TEXT NOT NULL,
  ignored BOOLEAN NOT NULL DEFAULT false, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(actor_id,action_id,candidate_id)
);
CREATE TABLE IF NOT EXISTS discovery_runtime_imports (
  company_id TEXT NOT NULL, platform TEXT NOT NULL, creator_id TEXT NOT NULL,
  action_id TEXT NOT NULL REFERENCES runtime_actions(id), actor_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('dispatching','succeeded','uncertain')),
  kol_uid TEXT, receipt JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(company_id,platform,creator_id)
);
CREATE INDEX IF NOT EXISTS discovery_profile_identity ON kol_profile_index(company_id,platform,platform_creator_id);
CREATE TABLE IF NOT EXISTS discovery_runtime_ownership (
  company_id TEXT NOT NULL, platform TEXT NOT NULL, creator_id TEXT NOT NULL,
  follow_id TEXT NOT NULL REFERENCES kol_follow_index(id), PRIMARY KEY(company_id,platform,creator_id)
);
-- All follow entry points share this lock when a stable platform identity is available.
-- A direct discovery assignment must not be bypassed by claiming a second formal UID.
CREATE OR REPLACE FUNCTION enforce_discovery_ownership() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p record; reserved record;
BEGIN
  IF NEW.status <> 'active' THEN RETURN NEW; END IF;
  SELECT platform,platform_creator_id INTO p FROM kol_profile_index
    WHERE company_id=NEW.company_id AND kol_uid=NEW.kol_uid LIMIT 1;
  IF p.platform_creator_id IS NULL OR p.platform_creator_id='' THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('discovery:' || NEW.company_id || ':' || lower(p.platform) || ':' || p.platform_creator_id,0));
  SELECT f.employee_id,f.id INTO reserved FROM discovery_runtime_ownership o JOIN kol_follow_index f ON f.id=o.follow_id
    WHERE o.company_id=NEW.company_id AND o.platform=lower(p.platform) AND o.creator_id=p.platform_creator_id AND f.status='active';
  IF reserved.id IS NOT NULL AND reserved.id<>NEW.id THEN
    RAISE EXCEPTION 'discovery_follow_conflict' USING ERRCODE='23505';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS discovery_ownership_guard ON kol_follow_index;
CREATE TRIGGER discovery_ownership_guard BEFORE INSERT OR UPDATE OF status,employee_id,kol_uid ON kol_follow_index
  FOR EACH ROW EXECUTE FUNCTION enforce_discovery_ownership();
`;
