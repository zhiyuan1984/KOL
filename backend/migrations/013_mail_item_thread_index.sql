-- 通讯列表延迟：会话列表按 thread_id 聚合每会话邮件数，kol_mail_items 需要
-- kol_mail_items(thread_id) 索引，否则每条线程都全表扫描一次。
-- db.ts migrateSchema 也会为内嵌部署建同一索引（add-if-missing 风格）。

CREATE INDEX IF NOT EXISTS kol_mail_items_thread ON kol_mail_items(thread_id);
