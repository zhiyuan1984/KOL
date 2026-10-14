-- A reply context rejected before provider IO is recoverable, not an unknown send.
-- Preserve the original send idempotency ledger and all reply_send_basis history.
ALTER TABLE mail_send_attempts DROP CONSTRAINT IF EXISTS mail_send_attempts_status_check;
ALTER TABLE mail_send_attempts ADD CONSTRAINT mail_send_attempts_status_check
  CHECK (status IN ('sending', 'sent', 'unknown', 'reply_stale'));
