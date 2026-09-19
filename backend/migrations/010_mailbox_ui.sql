-- Mailbox UI redesign extras. db.ts migrateSchema also applies these (add-if-missing).
-- translation_zh/translation_source carry the per-message Chinese translation of
-- kol_mail_items.body_text; starred flags a conversation in kol_mail_threads.

ALTER TABLE kol_mail_items ADD COLUMN translation_zh TEXT;
ALTER TABLE kol_mail_items ADD COLUMN translation_source TEXT;
ALTER TABLE kol_mail_threads ADD COLUMN starred INTEGER NOT NULL DEFAULT 0;
