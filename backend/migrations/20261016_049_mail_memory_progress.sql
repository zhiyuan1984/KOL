-- Durable, scope-bound progress for the mail-memory increment.  This adds no
-- credential, role, employee, approval, ontology, or business-stage state.
CREATE TABLE IF NOT EXISTS kol_mail_memory_progress (
  mailbox TEXT PRIMARY KEY,
  next_phase TEXT NOT NULL DEFAULT 'items' CHECK (next_phase IN ('items','threads','persons')),
  item_cursor TEXT NOT NULL DEFAULT '',
  thread_cursor TEXT NOT NULL DEFAULT '',
  person_cursor TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kol_mail_memory_chunk_progress (
  item_id TEXT PRIMARY KEY REFERENCES kol_mail_items(id) ON DELETE CASCADE,
  mailbox TEXT NOT NULL,
  source_fingerprint TEXT NOT NULL,
  chunk_count INTEGER NOT NULL CHECK (chunk_count > 0),
  completed_chunks JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(completed_chunks)='array' AND jsonb_array_length(completed_chunks) <= chunk_count),
  last_error TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kol_mail_memory_chunk_progress_scope
  ON kol_mail_memory_chunk_progress(mailbox, source_fingerprint, updated_at DESC);
