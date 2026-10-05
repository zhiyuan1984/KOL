export const runtimeActionEventSchema = `
CREATE TABLE IF NOT EXISTS runtime_action_events (
  sequence BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  action_id TEXT NOT NULL REFERENCES runtime_actions(id), source TEXT NOT NULL,
  state TEXT NOT NULL, recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS runtime_action_event_order ON runtime_action_events(action_id,sequence);
CREATE OR REPLACE FUNCTION record_runtime_action_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' OR NEW.state IS DISTINCT FROM OLD.state THEN
    INSERT INTO runtime_action_events(action_id,source,state) SELECT NEW.id,TG_TABLE_NAME,NEW.state
      WHERE EXISTS (SELECT 1 FROM runtime_actions WHERE id=NEW.id);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS runtime_action_event ON runtime_actions;
CREATE TRIGGER runtime_action_event AFTER INSERT OR UPDATE OF state ON runtime_actions
  FOR EACH ROW EXECUTE FUNCTION record_runtime_action_event();
DROP TRIGGER IF EXISTS runtime_crawl_event ON runtime_crawl_jobs;
CREATE TRIGGER runtime_crawl_event AFTER INSERT OR UPDATE OF state ON runtime_crawl_jobs
  FOR EACH ROW EXECUTE FUNCTION record_runtime_action_event();
`;
