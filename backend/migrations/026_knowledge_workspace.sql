-- Existing applications retain automatic publication. New workspace applications
-- explicitly opt into a separate, confirmed manual publication command.
ALTER TABLE knowledge_publication_applications ALTER COLUMN document_id DROP NOT NULL;
ALTER TABLE knowledge_publication_applications ADD COLUMN entry_id TEXT REFERENCES knowledge(id);
ALTER TABLE knowledge_publication_applications ADD COLUMN asset_key TEXT;
UPDATE knowledge_publication_applications SET asset_key=document_id;
ALTER TABLE knowledge_publication_applications ALTER COLUMN asset_key SET NOT NULL;
ALTER TABLE knowledge_publication_applications ADD COLUMN release_mode TEXT NOT NULL DEFAULT 'automatic' CHECK(release_mode IN ('automatic','manual'));
ALTER TABLE knowledge_publication_applications ADD COLUMN publication_requested INTEGER NOT NULL DEFAULT 0;
ALTER TABLE knowledge_publication_applications ADD CONSTRAINT knowledge_application_asset CHECK ((document_id IS NOT NULL)::int + (entry_id IS NOT NULL)::int = 1);
CREATE UNIQUE INDEX knowledge_publication_one_active_asset ON knowledge_publication_applications(asset_key) WHERE status='waiting';
ALTER TABLE knowledge_publication_confirmations DROP CONSTRAINT knowledge_publication_confirmations_operation_check;
ALTER TABLE knowledge_publication_confirmations ADD CONSTRAINT knowledge_publication_confirmations_operation_check CHECK(operation IN ('submit','recover','publish'));
ALTER TABLE knowledge_versions ADD COLUMN IF NOT EXISTS structured TEXT;
ALTER TABLE knowledge_versions ADD COLUMN IF NOT EXISTS source_body TEXT;
ALTER TABLE knowledge_versions ADD COLUMN IF NOT EXISTS base_id TEXT;
-- Fill only a version that is still the effective current material. Never copy
-- a newer draft's fields into an older published snapshot.
UPDATE knowledge_versions v SET structured=k.structured,source_body=k.source_body,base_id=k.base_id
  FROM knowledge k WHERE v.knowledge_id=k.id AND v.version=k.published_version AND k.current_version=k.published_version;
CREATE OR REPLACE FUNCTION enqueue_knowledge_publication() RETURNS trigger AS $$
DECLARE binding knowledge_publication_applications%ROWTYPE; job_id TEXT; stamp TEXT; key TEXT;
BEGIN
  IF NEW.status NOT IN ('approved','rejected','withdrawn') OR NEW.status=OLD.status THEN RETURN NEW; END IF;
  SELECT * INTO binding FROM knowledge_publication_applications WHERE tenant=NEW.tenant AND instance_id=NEW.id AND status='waiting';
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF binding.release_mode='manual' AND NEW.status='approved' THEN RETURN NEW; END IF;
  key := 'knowledge-publication:' || NEW.tenant || ':' || NEW.id || ':' || NEW.version;
  job_id := 'kp_' || md5(key);
  stamp := to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  INSERT INTO execution_jobs(id,job_type,tenant_ref,actor_ref,idempotency_key,object_ref_json,scope_snapshot_json,
    risk_level,max_attempts,next_attempt_at,payload_json,created_at,updated_at)
  VALUES(job_id,'knowledge.publication',NEW.tenant,binding.actor,key,
    json_build_object('instanceId',NEW.id)::text,json_build_object('tenant',NEW.tenant,'documentId',binding.asset_key)::text,
    'high',5,stamp,json_build_object('instanceId',NEW.id)::text,stamp,stamp)
  ON CONFLICT(idempotency_key) DO NOTHING;
  INSERT INTO execution_outbox(id,job_id,event_type,aggregate_type,aggregate_id,payload_json,idempotency_key,available_at,created_at,updated_at)
  VALUES('kpo_' || md5(key),job_id,'execution_job.queued','execution_job',job_id,
    json_build_object('execution_job_id',job_id)::text,key || ':dispatch',stamp,stamp,stamp)
  ON CONFLICT(idempotency_key) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS knowledge_publication_decision ON review_instances;
CREATE TRIGGER knowledge_publication_decision AFTER UPDATE OF status ON review_instances
  FOR EACH ROW EXECUTE FUNCTION enqueue_knowledge_publication();


CREATE OR REPLACE FUNCTION protect_knowledge_entry_approval() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.published_version IS NOT NULL OR EXISTS(SELECT 1 FROM knowledge_publication_applications WHERE entry_id=OLD.id) THEN
      RAISE EXCEPTION 'knowledge_entry_history_retained' USING ERRCODE='23514';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.published_version IS DISTINCT FROM OLD.published_version AND NEW.published_version IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM knowledge_publication_applications p JOIN review_instances i ON i.tenant=p.tenant AND i.id=p.instance_id
      WHERE p.entry_id=OLD.id AND p.instance_id=current_setting('knowledge.native_publication_instance',true)
      AND p.status='waiting' AND i.status='approved' AND (p.release_mode='automatic' OR p.publication_requested=1)) THEN
      RAISE EXCEPTION 'knowledge_approved_publication_required' USING ERRCODE='23514';
    END IF;
  END IF;
  IF ROW(NEW.title,NEW.body,NEW.structured,NEW.base_id,NEW.brand,NEW.stage_codes,NEW.kind,NEW.updated_at) IS DISTINCT FROM
     ROW(OLD.title,OLD.body,OLD.structured,OLD.base_id,OLD.brand,OLD.stage_codes,OLD.kind,OLD.updated_at)
     AND COALESCE(current_setting('knowledge.native_publication_instance',true),'')=''
     AND EXISTS(SELECT 1 FROM knowledge_publication_applications WHERE entry_id=OLD.id AND status='waiting') THEN
    RAISE EXCEPTION 'knowledge_entry_frozen' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER knowledge_entry_approval_guard BEFORE UPDATE OR DELETE ON knowledge FOR EACH ROW EXECUTE FUNCTION protect_knowledge_entry_approval();
