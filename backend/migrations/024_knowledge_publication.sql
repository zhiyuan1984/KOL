CREATE TABLE IF NOT EXISTS knowledge_publications (
  tenant TEXT NOT NULL, instance_id TEXT NOT NULL, document_id TEXT NOT NULL,
  actor TEXT NOT NULL, snapshot TEXT NOT NULL, fingerprint TEXT NOT NULL,
  release_note TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'waiting'
    CHECK(status IN ('waiting','published','rejected','withdrawn','failed')),
  receipt TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY(tenant,instance_id),
  FOREIGN KEY(tenant,instance_id) REFERENCES review_instances(tenant,id),
  FOREIGN KEY(document_id) REFERENCES knowledge_documents(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_publications_one_active
  ON knowledge_publications(document_id) WHERE status='waiting';
CREATE INDEX IF NOT EXISTS knowledge_publications_document ON knowledge_publications(document_id,created_at);
CREATE TABLE IF NOT EXISTS knowledge_publication_confirmations (
  id TEXT PRIMARY KEY, tenant TEXT NOT NULL, actor TEXT NOT NULL,
  document_id TEXT NOT NULL, digest TEXT NOT NULL, expires_at TEXT NOT NULL,
  operation TEXT NOT NULL DEFAULT 'submit' CHECK(operation IN ('submit','recover')),
  request_digest TEXT NOT NULL DEFAULT '',
  consumed INTEGER NOT NULL DEFAULT 0, idempotency_key TEXT, receipt TEXT
);

-- The review decision and its execution event commit together. A crash or a
-- closed browser cannot lose publication; transport only carries the job ID.
CREATE OR REPLACE FUNCTION enqueue_knowledge_publication() RETURNS trigger AS $$
DECLARE binding knowledge_publications%ROWTYPE; job_id TEXT; stamp TEXT; key TEXT;
BEGIN
  IF NEW.status NOT IN ('approved','rejected','withdrawn') OR NEW.status=OLD.status THEN RETURN NEW; END IF;
  SELECT * INTO binding FROM knowledge_publications WHERE tenant=NEW.tenant AND instance_id=NEW.id AND status='waiting';
  IF NOT FOUND THEN RETURN NEW; END IF;
  key := 'knowledge-publication:' || NEW.tenant || ':' || NEW.id || ':' || NEW.version;
  job_id := 'kp_' || md5(key);
  stamp := to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  INSERT INTO execution_jobs(id,job_type,tenant_ref,actor_ref,idempotency_key,object_ref_json,scope_snapshot_json,
    risk_level,max_attempts,next_attempt_at,payload_json,created_at,updated_at)
  VALUES(job_id,'knowledge.publication',NEW.tenant,binding.actor,key,
    json_build_object('instanceId',NEW.id)::text,json_build_object('tenant',NEW.tenant,'documentId',binding.document_id)::text,
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
