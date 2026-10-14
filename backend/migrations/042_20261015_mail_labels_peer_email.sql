-- 20261015_mail_labels_peer_email：标签跟人走（peer_email 级），不再按会话。
-- 字典 (mail_private_labels) 仍按 (user_id, mailbox) 隔离；指派键从 conversation_id
-- 改为对方邮箱 peer_email：同一对方的多会话共享同一组标签。
-- 回填：首选 kol_mail_threads.peer_email；旧行 peer 可能是自己（发件会话 peer
-- 曾被错写为 from），此时按该会话最新邮件方向推导（发件取收件人，收件取发件人）。
-- 同一对方多会话的指派合并为一行，保留最早 assigned_at；找不到会话的行删除
--（信封查询本来就 JOIN 会话，这类行此前不可见）。

ALTER TABLE public.mail_private_label_assignments ADD COLUMN IF NOT EXISTS peer_email TEXT;

UPDATE public.mail_private_label_assignments a
SET peer_email = lower(sub.peer)
FROM (
  SELECT a2.user_id, a2.mailbox, a2.conversation_id, a2.label_id,
    CASE
      WHEN t.peer_email IS NOT NULL AND t.peer_email <> '' AND lower(t.peer_email) <> lower(a2.mailbox)
        THEN lower(t.peer_email)
      ELSE lower(COALESCE((
        SELECT CASE WHEN lower(i.direction) = 'outbound' THEN i.to_addr ELSE i.from_addr END
          FROM public.kol_mail_items i WHERE i.thread_id = t.id
          ORDER BY i.occurred_at DESC NULLS LAST, i.created_at DESC LIMIT 1
      ), t.peer_email))
    END AS peer
  FROM public.mail_private_label_assignments a2
  LEFT JOIN public.kol_mail_threads t
    ON t.conversation_id = a2.conversation_id AND lower(t.mailbox) = lower(a2.mailbox)
) sub
WHERE a.user_id = sub.user_id AND a.mailbox = sub.mailbox
  AND a.conversation_id = sub.conversation_id AND a.label_id = sub.label_id;

DELETE FROM public.mail_private_label_assignments WHERE peer_email IS NULL OR peer_email = '';

DELETE FROM public.mail_private_label_assignments a
USING public.mail_private_label_assignments b
WHERE a.user_id = b.user_id AND a.mailbox = b.mailbox
  AND a.peer_email = b.peer_email AND a.label_id = b.label_id
  AND (a.assigned_at, a.ctid) > (b.assigned_at, b.ctid);

ALTER TABLE public.mail_private_label_assignments DROP CONSTRAINT IF EXISTS mail_private_label_assignments_pkey;
ALTER TABLE public.mail_private_label_assignments DROP COLUMN IF EXISTS conversation_id;
ALTER TABLE public.mail_private_label_assignments ALTER COLUMN peer_email SET NOT NULL;
ALTER TABLE public.mail_private_label_assignments
  ADD CONSTRAINT mail_private_label_assignments_pkey PRIMARY KEY (user_id, mailbox, peer_email, label_id);

DROP INDEX IF EXISTS public.mail_private_label_assignments_scope_conversation_idx;
DROP INDEX IF EXISTS public.mail_private_label_assignments_scope_label_idx;
CREATE INDEX IF NOT EXISTS mail_private_label_assignments_scope_peer_idx
  ON public.mail_private_label_assignments(user_id, mailbox, peer_email, label_id);
CREATE INDEX IF NOT EXISTS mail_private_label_assignments_scope_label_idx
  ON public.mail_private_label_assignments(user_id, mailbox, label_id, peer_email);
