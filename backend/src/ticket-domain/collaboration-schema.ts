/** PostgreSQL source events, written by the authority transaction itself.
 * No worker, model or browser callback is needed to recover these facts. */
export const collaborationSchema = `
CREATE TABLE IF NOT EXISTS collaboration_source_events (
  sequence BIGSERIAL PRIMARY KEY,
  source_type TEXT NOT NULL CHECK (source_type IN ('review','work_order')),
  source_id TEXT NOT NULL,
  company_id TEXT,
  source_version INTEGER NOT NULL,
  actor_id TEXT,
  event_type TEXT NOT NULL,
  before_state JSONB,
  after_state JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(source_type,source_id,company_id,source_version,event_type)
);
CREATE INDEX IF NOT EXISTS collaboration_source_events_object ON collaboration_source_events(source_type,source_id,sequence);
CREATE OR REPLACE FUNCTION capture_collaboration_review_event() RETURNS trigger AS $$
DECLARE source_event review_events%ROWTYPE; previous_state JSONB;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
    IF NEW.version<=OLD.version THEN RAISE EXCEPTION 'review changes require a newer version'; END IF;
    previous_state=jsonb_build_object('status',OLD.status,'version',OLD.version,
      'round',COALESCE((OLD.payload::jsonb->>'round')::integer,1),'template_id',OLD.template_id,'template_version',OLD.template_version);
  END IF;
  SELECT * INTO source_event FROM review_events WHERE tenant=NEW.tenant AND resource_id=NEW.id AND version=NEW.version
    ORDER BY created_at DESC LIMIT 1;
  INSERT INTO collaboration_source_events(source_type,source_id,company_id,source_version,actor_id,event_type,before_state,after_state,occurred_at)
    VALUES ('review',NEW.id,NEW.tenant,NEW.version,source_event.actor,'review.'||COALESCE(source_event.action,'state_changed'),previous_state,
      jsonb_build_object('status',NEW.status,'version',NEW.version,
        'round',COALESCE((NEW.payload::jsonb->>'round')::integer,1),
        'template_id',NEW.template_id,'template_version',NEW.template_version),NEW.updated_at::timestamptz)
    ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS collaboration_review_event ON review_instances;
CREATE CONSTRAINT TRIGGER collaboration_review_event AFTER INSERT OR UPDATE ON review_instances DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION capture_collaboration_review_event();
CREATE OR REPLACE FUNCTION capture_collaboration_work_order_event() RETURNS trigger AS $$
DECLARE prior JSONB; event_name TEXT;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
    IF NEW.data_version<=OLD.data_version THEN
      RAISE EXCEPTION 'work order changes require a newer data_version';
    END IF;
    prior=jsonb_build_object('status',OLD.status,'version',OLD.data_version,'stage_code',OLD.stage_code,'task_id',OLD.task_id);
    event_name='work_order.changed';
  ELSE event_name='work_order.created'; END IF;
  INSERT INTO collaboration_source_events(source_type,source_id,source_version,actor_id,event_type,before_state,after_state)
    VALUES ('work_order',NEW.id,NEW.data_version,
      COALESCE(NULLIF(current_setting('app.actor_id',true),''),CASE WHEN TG_OP='INSERT' THEN NEW.created_by ELSE NULL END),event_name,prior,
      jsonb_build_object('status',NEW.status,'version',NEW.data_version,'stage_code',NEW.stage_code,'task_id',NEW.task_id));
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS collaboration_work_order_event ON work_orders;
CREATE TRIGGER collaboration_work_order_event AFTER INSERT OR UPDATE ON work_orders
  FOR EACH ROW EXECUTE FUNCTION capture_collaboration_work_order_event();
CREATE OR REPLACE FUNCTION prevent_collaboration_source_event_mutation() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'collaboration source events are immutable'; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS collaboration_source_events_no_mutation ON collaboration_source_events;
CREATE TRIGGER collaboration_source_events_no_mutation BEFORE UPDATE OR DELETE ON collaboration_source_events
  FOR EACH ROW EXECUTE FUNCTION prevent_collaboration_source_event_mutation();
`;
