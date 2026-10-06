CREATE TABLE knowledge_document_scopes (
  document_id TEXT PRIMARY KEY REFERENCES knowledge_documents(id) ON DELETE CASCADE, tenant TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1, explanation TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'empty' CHECK(state IN ('empty','candidate','checked','published')),
  scope JSONB, fingerprint TEXT NOT NULL, source_fingerprint TEXT,
  job_id TEXT REFERENCES execution_jobs(id), checked_by TEXT, checked_at TEXT,
  updated_at TEXT NOT NULL, CHECK(state='empty' OR scope IS NOT NULL)
);
CREATE TABLE skill_knowledge_configs (
  skill_id TEXT PRIMARY KEY, tenant TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
  selector JSONB NOT NULL, update_policy TEXT NOT NULL CHECK(update_policy IN ('follow_published','fixed_documents')),
  published_revision INTEGER, published_selector JSONB, published_policy TEXT,
  generation_hash TEXT, generation_job_id TEXT REFERENCES execution_jobs(id), published_hash TEXT, test_job_id TEXT REFERENCES execution_jobs(id), test_signature TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE agent_knowledge_skill_releases (
  agent_id TEXT NOT NULL,skill_id TEXT NOT NULL REFERENCES skill_knowledge_configs(skill_id) ON DELETE CASCADE,
  skill_hash TEXT NOT NULL,config_revision INTEGER NOT NULL,confirmed_by TEXT NOT NULL,confirmed_at TEXT NOT NULL,
  PRIMARY KEY(agent_id,skill_id)
);
CREATE OR REPLACE FUNCTION protect_knowledge_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE doc knowledge_documents%ROWTYPE;
BEGIN
  SELECT * INTO doc FROM knowledge_documents WHERE id=COALESCE(NEW.document_id,OLD.document_id) FOR UPDATE;
  IF TG_OP='UPDATE' AND NEW.state='published' AND OLD.state='checked'
    AND NEW.scope=OLD.scope AND NEW.explanation=OLD.explanation AND NEW.fingerprint=OLD.fingerprint
    AND doc.status='published' THEN RETURN NEW; END IF;
  IF doc.status IN ('published','archived')
    OR EXISTS(SELECT 1 FROM knowledge_publications WHERE document_id=doc.id)
    OR EXISTS(SELECT 1 FROM knowledge_publication_applications WHERE document_id=doc.id AND status='waiting')
    OR EXISTS(SELECT 1 FROM knowledge_publication_requests WHERE document_id=doc.id AND instance_id IS NOT NULL) THEN
    RAISE EXCEPTION 'knowledge_scope_frozen_create_revision' USING ERRCODE='23514';
  END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER knowledge_scope_material_guard BEFORE INSERT OR UPDATE OR DELETE ON knowledge_document_scopes
  FOR EACH ROW EXECUTE FUNCTION protect_knowledge_scope();
CREATE OR REPLACE FUNCTION publish_knowledge_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='published' AND OLD.status<>'published' THEN
    IF EXISTS(SELECT 1 FROM knowledge_document_scopes WHERE document_id=NEW.id AND state<>'checked') THEN
      RAISE EXCEPTION 'knowledge_scope_not_checked' USING ERRCODE='23514';
    END IF;
    UPDATE knowledge_document_scopes SET state='published' WHERE document_id=NEW.id AND state='checked';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER knowledge_scope_publication AFTER UPDATE OF status ON knowledge_documents
  FOR EACH ROW EXECUTE FUNCTION publish_knowledge_scope();
CREATE OR REPLACE FUNCTION invalidate_knowledge_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status NOT IN ('published','archived') AND
    (NEW.source_path IS DISTINCT FROM OLD.source_path OR NEW.artifacts IS DISTINCT FROM OLD.artifacts OR (NEW.status='uploaded' AND OLD.status<>'uploaded')) THEN
    UPDATE knowledge_document_scopes SET state='empty',scope=NULL,source_fingerprint=NULL,job_id=NULL,checked_by=NULL,checked_at=NULL,
      revision=revision+1,fingerprint='invalidated:' || NEW.updated_at,updated_at=NEW.updated_at WHERE document_id=NEW.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER knowledge_scope_source_changed AFTER UPDATE OF source_path,artifacts,status ON knowledge_documents
  FOR EACH ROW EXECUTE FUNCTION invalidate_knowledge_scope();
