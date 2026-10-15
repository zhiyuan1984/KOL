-- Durable scope-extraction intent and honest per-batch progress.
-- PostgreSQL is the only runtime authority; this does not create a SQLite path.
ALTER TABLE knowledge_document_scopes
  ADD COLUMN IF NOT EXISTS scope_handoff_status TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS scope_handoff_requested_at TEXT,
  ADD COLUMN IF NOT EXISTS scope_handoff_actor TEXT,
  ADD COLUMN IF NOT EXISTS scope_handoff_error TEXT,
  ADD COLUMN IF NOT EXISTS scope_progress_done INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS scope_progress_total INTEGER,
  ADD COLUMN IF NOT EXISTS scope_progress_unit TEXT NOT NULL DEFAULT 'batches',
  ADD COLUMN IF NOT EXISTS scope_progress_attempt INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS scope_last_progress_at TEXT;

ALTER TABLE knowledge_document_scopes DROP CONSTRAINT IF EXISTS knowledge_document_scopes_handoff_status_check;
ALTER TABLE knowledge_document_scopes ADD CONSTRAINT knowledge_document_scopes_handoff_status_check
  CHECK (scope_handoff_status IN ('pending','queued','failed','none'));
ALTER TABLE knowledge_document_scopes DROP CONSTRAINT IF EXISTS knowledge_document_scopes_progress_done_check;
ALTER TABLE knowledge_document_scopes ADD CONSTRAINT knowledge_document_scopes_progress_done_check
  CHECK (scope_progress_done >= 0);
ALTER TABLE knowledge_document_scopes DROP CONSTRAINT IF EXISTS knowledge_document_scopes_progress_total_check;
ALTER TABLE knowledge_document_scopes ADD CONSTRAINT knowledge_document_scopes_progress_total_check
  CHECK (scope_progress_total IS NULL OR scope_progress_total >= 0);
ALTER TABLE knowledge_document_scopes DROP CONSTRAINT IF EXISTS knowledge_document_scopes_progress_unit_check;
ALTER TABLE knowledge_document_scopes ADD CONSTRAINT knowledge_document_scopes_progress_unit_check
  CHECK (scope_progress_unit = 'batches');
ALTER TABLE knowledge_document_scopes DROP CONSTRAINT IF EXISTS knowledge_document_scopes_progress_attempt_check;
ALTER TABLE knowledge_document_scopes ADD CONSTRAINT knowledge_document_scopes_progress_attempt_check
  CHECK (scope_progress_attempt >= 0);

-- A historical row which already points to a job did complete the enqueue handoff.
-- Rows without that evidence deliberately remain `none`: readers must not wait for
-- or infer a new automatic run for old material.
UPDATE knowledge_document_scopes
SET scope_handoff_status='queued',
    scope_handoff_requested_at=COALESCE(scope_handoff_requested_at,updated_at),
    scope_handoff_error=NULL
WHERE job_id IS NOT NULL AND scope_handoff_status='none';

-- Source invalidation creates a new material version, not permission to replay an
-- old automatic extraction intent. It also prevents old progress from being shown
-- for a later job attempt.
CREATE OR REPLACE FUNCTION invalidate_knowledge_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status NOT IN ('published','archived') AND
    (NEW.source_path IS DISTINCT FROM OLD.source_path OR NEW.artifacts IS DISTINCT FROM OLD.artifacts OR (NEW.status='uploaded' AND OLD.status<>'uploaded')) THEN
    UPDATE knowledge_document_scopes
    SET state='empty',scope=NULL,source_fingerprint=NULL,job_id=NULL,checked_by=NULL,checked_at=NULL,
        -- Artifact growth during the already-authorized initial processing run
        -- invalidates candidates, but must NOT erase its pending handoff intent.
        -- A replaced source or a later re-upload still clears the old intent.
        scope_handoff_status=CASE WHEN scope_handoff_status='pending' AND job_id IS NULL
          AND NEW.source_path IS NOT DISTINCT FROM OLD.source_path
          AND ((OLD.status='draft' AND NEW.status='uploaded') OR
            (OLD.status IN ('uploaded','normalizing','indexing')
              AND NEW.status IN ('normalizing','indexing','pending_review'))) THEN 'pending' ELSE 'none' END,
        scope_handoff_requested_at=CASE WHEN scope_handoff_status='pending' AND job_id IS NULL
          AND NEW.source_path IS NOT DISTINCT FROM OLD.source_path
          AND ((OLD.status='draft' AND NEW.status='uploaded') OR
            (OLD.status IN ('uploaded','normalizing','indexing')
              AND NEW.status IN ('normalizing','indexing','pending_review'))) THEN scope_handoff_requested_at ELSE NULL END,
        scope_handoff_actor=CASE WHEN scope_handoff_status='pending' AND job_id IS NULL
          AND NEW.source_path IS NOT DISTINCT FROM OLD.source_path
          AND ((OLD.status='draft' AND NEW.status='uploaded') OR
            (OLD.status IN ('uploaded','normalizing','indexing')
              AND NEW.status IN ('normalizing','indexing','pending_review'))) THEN scope_handoff_actor ELSE NULL END,
        scope_handoff_error=NULL,
        scope_progress_done=0,scope_progress_total=NULL,scope_progress_unit='batches',scope_progress_attempt=0,scope_last_progress_at=NULL,
        revision=revision+1,fingerprint='invalidated:' || NEW.updated_at,updated_at=NEW.updated_at
    WHERE document_id=NEW.id;
  END IF;
  RETURN NEW;
END $$;
