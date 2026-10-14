-- PostgreSQL-only durable idempotency ledger for confirmed mail sends.
-- Applied before the host starts; runtime code must not create application schema.
CREATE TABLE IF NOT EXISTS mail_send_attempts (
  draft_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  actor_id TEXT NOT NULL,
  confirmation_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sending', 'sent', 'unknown')),
  result_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS mail_send_attempts_request_id_idx
  ON mail_send_attempts(request_id);
