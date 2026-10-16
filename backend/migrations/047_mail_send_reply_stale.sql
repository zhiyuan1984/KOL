-- A reply-context change is a known pre-provider refusal, not an uncertain delivery.
-- Keep it distinct so a newly confirmed draft can be safely retried and audited.
DO $$
BEGIN
  IF to_regclass('public.mail_send_attempts') IS NOT NULL THEN
    ALTER TABLE mail_send_attempts DROP CONSTRAINT IF EXISTS mail_send_attempts_status_check;
    ALTER TABLE mail_send_attempts
      ADD CONSTRAINT mail_send_attempts_status_check
      CHECK (status IN ('sending','sent','unknown','reply_stale'));
  END IF;
END
$$;
