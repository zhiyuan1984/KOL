-- Native mail confirmation authority; owned by formal migration tooling.
CREATE TABLE IF NOT EXISTS mail_send_attempts (
 draft_id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, actor_id TEXT NOT NULL,
 confirmation_version TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('sending','sent','unknown')),
 result_json TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
