-- A stale reply is a durable rejected send attempt, never a provider receipt.
-- Do not rewrite 043's checksum: expand the original named CHECK in a new unit.
ALTER TABLE mail_send_attempts
  DROP CONSTRAINT IF EXISTS mail_send_attempts_status_check;
ALTER TABLE mail_send_attempts
  ADD CONSTRAINT mail_send_attempts_status_check
  CHECK (status IN ('sending', 'sent', 'unknown', 'reply_stale'));
