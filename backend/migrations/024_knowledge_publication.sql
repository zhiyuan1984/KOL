-- PostgreSQL-only knowledge publication adapter. Review decisions and durable
-- dispatch are joined by database triggers so a process exit cannot split them.
CREATE TABLE IF NOT EXISTS knowledge_publication_bindings (
  base_id TEXT PRIMARY KEY REFERENCES knowledge_bases(id), tenant TEXT NOT NULL,
  template_id TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY(tenant,template_id) REFERENCES review_templates(tenant,id)
);
CREATE TABLE IF NOT EXISTS knowledge_document_lineage (
  document_id TEXT PRIMARY KEY REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  root_id TEXT NOT NULL REFERENCES knowledge_documents(id),
  version INTEGER NOT NULL, expected_active_id TEXT,
  UNIQUE(root_id,version)
);
CREATE TABLE IF NOT EXISTS knowledge_publication_requests (
  id TEXT PRIMARY KEY, tenant TEXT NOT NULL, document_id TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  actor TEXT NOT NULL, template_id TEXT NOT NULL, template_version INTEGER NOT NULL,
  binding_version INTEGER NOT NULL, snapshot JSONB NOT NULL, review_values JSONB NOT NULL,
  expires_at TEXT NOT NULL, instance_id TEXT, created_at TEXT NOT NULL,
  UNIQUE(tenant,instance_id),
  FOREIGN KEY(tenant,template_id,template_version) REFERENCES review_versions(tenant,template_id,version)
);
CREATE TABLE IF NOT EXISTS knowledge_publications (
  document_id TEXT PRIMARY KEY REFERENCES knowledge_documents(id),
  tenant TEXT NOT NULL, instance_id TEXT NOT NULL, request_id TEXT NOT NULL REFERENCES knowledge_publication_requests(id),
  review_status TEXT NOT NULL, publication_status TEXT NOT NULL DEFAULT 'unpublished',
  error TEXT, receipt JSONB, updated_at TEXT NOT NULL,
  UNIQUE(tenant,instance_id),
  FOREIGN KEY(tenant,instance_id) REFERENCES review_instances(tenant,id)
);

CREATE OR REPLACE FUNCTION knowledge_review_link() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE req knowledge_publication_requests%ROWTYPE; doc knowledge_documents%ROWTYPE;
  binding knowledge_publication_bindings%ROWTYPE; body JSONB; job TEXT; stamp TEXT;
BEGIN
  body := NEW.payload::jsonb;
  IF body->'definition'->>'subjectType' IS DISTINCT FROM 'knowledge_publication' THEN RETURN NEW; END IF;
  SELECT * INTO req FROM knowledge_publication_requests
    WHERE id=body->'values'->>'knowledge_request' AND tenant=NEW.tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'knowledge_request_required' USING ERRCODE='23514'; END IF;
  SELECT * INTO doc FROM knowledge_documents WHERE id=req.document_id FOR UPDATE;
  SELECT * INTO binding FROM knowledge_publication_bindings WHERE base_id=doc.base_id;
  IF NEW.requester<>req.actor OR NEW.template_id<>req.template_id OR NEW.template_version<>req.template_version
    OR ((body->'values') - 'publication_note')<>(req.review_values - 'publication_note') THEN
    RAISE EXCEPTION 'knowledge_material_changed' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' THEN
    IF req.instance_id IS NOT NULL OR req.expires_at::timestamptz<=clock_timestamp()
      OR binding.tenant IS DISTINCT FROM req.tenant OR binding.version IS DISTINCT FROM req.binding_version
      OR binding.template_id IS DISTINCT FROM req.template_id OR doc.status<>'pending_review'
      OR doc.updated_at<>req.snapshot->>'updated_at' THEN
      RAISE EXCEPTION 'knowledge_request_expired_or_changed' USING ERRCODE='23514';
    END IF;
    IF EXISTS(SELECT 1 FROM knowledge_publications WHERE document_id=doc.id
      AND (review_status IN ('reviewing','blocked','awaiting_amendment','approved') OR publication_status='published')) THEN
      RAISE EXCEPTION 'knowledge_review_already_exists' USING ERRCODE='23514';
    END IF;
    -- Require an actual human decision on the selected route; an empty or
    -- condition-skipped workflow cannot publish knowledge.
    IF NEW.status='approved' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(body->'tasks') t WHERE t->>'duty'='review') THEN
      RAISE EXCEPTION 'knowledge_human_review_required' USING ERRCODE='23514';
    END IF;
    UPDATE knowledge_publication_requests SET instance_id=NEW.id WHERE id=req.id;
    INSERT INTO knowledge_publications(document_id,tenant,instance_id,request_id,review_status,updated_at)
      VALUES(doc.id,NEW.tenant,NEW.id,req.id,NEW.status,NEW.updated_at)
      ON CONFLICT(document_id) DO UPDATE SET tenant=EXCLUDED.tenant,instance_id=EXCLUDED.instance_id,
        request_id=EXCLUDED.request_id,review_status=EXCLUDED.review_status,publication_status='unpublished',
        error=NULL,receipt=NULL,updated_at=EXCLUDED.updated_at;
  ELSE
    IF req.instance_id IS DISTINCT FROM NEW.id THEN RAISE EXCEPTION 'knowledge_review_mismatch' USING ERRCODE='23514'; END IF;
    UPDATE knowledge_publications SET review_status=NEW.status,updated_at=NEW.updated_at
      WHERE document_id=doc.id AND instance_id=NEW.id;
  END IF;
  IF NEW.status='approved' AND (TG_OP='INSERT' OR OLD.status<>'approved') THEN
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(body->'tasks') t
      WHERE t->>'duty'='review' AND t->>'status'='approved' AND (t->>'round')::integer=COALESCE((body->>'round')::integer,1)) THEN
      RAISE EXCEPTION 'knowledge_human_approval_required' USING ERRCODE='23514';
    END IF;
    job := 'knowledge-publish:' || NEW.tenant || ':' || NEW.id;
    stamp := NEW.updated_at;
    INSERT INTO execution_jobs(id,job_type,tenant_ref,actor_ref,object_ref_json,risk_level,idempotency_key,
      scope_snapshot_json,status,max_attempts,payload_json,created_at,updated_at)
      VALUES(job,'knowledge.publish',NEW.tenant,req.actor,jsonb_build_object('document_id',doc.id),'high',job,
        jsonb_build_object('request_id',req.id,'instance_id',NEW.id),'queued',3,
        jsonb_build_object('document_id',doc.id,'instance_id',NEW.id,'request_id',req.id),stamp,stamp)
      ON CONFLICT(idempotency_key) DO NOTHING;
    INSERT INTO execution_outbox(id,job_id,event_type,aggregate_type,aggregate_id,payload_json,idempotency_key,
      status,available_at,created_at,updated_at)
      VALUES(job || ':dispatch',job,'execution.ready','knowledge',doc.id,jsonb_build_object('execution_job_id',job),
        job || ':dispatch','pending',stamp,stamp,stamp) ON CONFLICT(idempotency_key) DO NOTHING;
    UPDATE knowledge_publications SET publication_status='queued' WHERE document_id=doc.id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS knowledge_review_link_trigger ON review_instances;
CREATE TRIGGER knowledge_review_link_trigger AFTER INSERT OR UPDATE ON review_instances
  FOR EACH ROW EXECUTE FUNCTION knowledge_review_link();

CREATE OR REPLACE FUNCTION knowledge_document_publication_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pub knowledge_publications%ROWTYPE;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.status='published' THEN RAISE EXCEPTION 'knowledge_approved_publication_required' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO pub FROM knowledge_publications WHERE document_id=OLD.id;
  IF TG_OP='DELETE' THEN
    IF FOUND THEN
      RAISE EXCEPTION 'knowledge_document_frozen' USING ERRCODE='23514';
    END IF;
    RETURN OLD;
  END IF;
  IF (OLD.status='published' OR pub.document_id IS NOT NULL)
    AND (NEW.source_path IS DISTINCT FROM OLD.source_path OR NEW.artifacts IS DISTINCT FROM OLD.artifacts
      OR NEW.base_id<>OLD.base_id OR NEW.title<>OLD.title OR NEW.filename<>OLD.filename
      OR (NEW.status<>OLD.status AND NEW.status NOT IN ('published','archived'))) THEN
    RAISE EXCEPTION 'knowledge_document_frozen_create_revision' USING ERRCODE='23514';
  END IF;
  IF NEW.status='published' AND OLD.status<>'published' THEN
    IF pub.review_status IS DISTINCT FROM 'approved' OR pub.publication_status IS DISTINCT FROM 'publishing'
      OR current_setting('knowledge.publication_request',true) IS DISTINCT FROM pub.request_id THEN
      RAISE EXCEPTION 'knowledge_approved_publication_required' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS knowledge_document_publication_guard_trigger ON knowledge_documents;
CREATE TRIGGER knowledge_document_publication_guard_trigger BEFORE INSERT OR UPDATE OR DELETE ON knowledge_documents
  FOR EACH ROW EXECUTE FUNCTION knowledge_document_publication_guard();
