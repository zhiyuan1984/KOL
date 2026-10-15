-- Native credential/mailbox binding hardening. Apply through the normal PostgreSQL migration runner.
-- The cleanup retains the most recently updated explicit default per account.
WITH ranked AS (
  SELECT user_id, mailbox_email,
         row_number() OVER (PARTITION BY user_id ORDER BY updated_at DESC, mailbox_email) AS ordinal
  FROM user_starry_bindings WHERE is_default=1
)
UPDATE user_starry_bindings b SET is_default=0
FROM ranked r
WHERE b.user_id=r.user_id AND b.mailbox_email=r.mailbox_email AND r.ordinal > 1;
CREATE UNIQUE INDEX IF NOT EXISTS user_starry_bindings_one_default_idx
  ON user_starry_bindings(user_id) WHERE is_default=1;
