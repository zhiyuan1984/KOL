export const replyContextSchema = `
CREATE TABLE IF NOT EXISTS reply_mail_revisions (
  sequence BIGSERIAL PRIMARY KEY,
  mail_item_id TEXT NOT NULL REFERENCES kol_mail_items(id) ON DELETE CASCADE,
  mailbox TEXT NOT NULL,
  collaboration_id TEXT,
  provider_message_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  source_updated_at TIMESTAMPTZ,
  occurred_at TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  snapshot JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS reply_mail_revisions_context ON reply_mail_revisions(collaboration_id,mailbox,sequence);
CREATE INDEX IF NOT EXISTS reply_mail_revisions_item ON reply_mail_revisions(mail_item_id,sequence DESC);
CREATE TABLE IF NOT EXISTS reply_mail_quarantine (
  identity_hash TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS reply_send_basis (
  request_id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL,
  confirmation_version TEXT NOT NULL,
  legacy_confirmation_version TEXT NOT NULL,
  context_version TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'confirmed' CHECK (state IN ('confirmed','rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  rejected_at TIMESTAMPTZ
);
ALTER TABLE reply_send_basis ADD COLUMN IF NOT EXISTS rejected_attempt JSONB;
`;
