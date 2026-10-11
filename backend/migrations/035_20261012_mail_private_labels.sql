-- 20261012_mail_private_labels：人员私有的邮箱会话手工整理标签。
-- 字典、赋标和邮箱版本状态均按 (user_id, mailbox) 隔离；不写 collaboration/stage。

CREATE TABLE IF NOT EXISTS public.mail_private_label_states (
  user_id TEXT NOT NULL,
  mailbox TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, mailbox)
);

CREATE TABLE IF NOT EXISTS public.mail_private_labels (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  mailbox TEXT NOT NULL,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  normalized_name TEXT NOT NULL CHECK (char_length(normalized_name) BETWEEN 1 AND 40),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  UNIQUE (user_id, mailbox, normalized_name),
  UNIQUE (user_id, mailbox, id)
);

CREATE INDEX IF NOT EXISTS mail_private_labels_scope_name_idx
  ON public.mail_private_labels(user_id, mailbox, normalized_name, id);

CREATE TABLE IF NOT EXISTS public.mail_private_label_assignments (
  user_id TEXT NOT NULL,
  mailbox TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  label_id TEXT NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_by TEXT NOT NULL,
  PRIMARY KEY (user_id, mailbox, conversation_id, label_id),
  CONSTRAINT mail_private_label_assignments_label_scope_fk
    FOREIGN KEY (user_id, mailbox, label_id)
    REFERENCES public.mail_private_labels(user_id, mailbox, id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS mail_private_label_assignments_scope_conversation_idx
  ON public.mail_private_label_assignments(user_id, mailbox, conversation_id, label_id);

CREATE INDEX IF NOT EXISTS mail_private_label_assignments_scope_label_idx
  ON public.mail_private_label_assignments(user_id, mailbox, label_id, conversation_id);
