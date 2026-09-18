-- Home discovery harness extras. db.ts migrateSchema also applies these.
-- kind=home runs own the crawl-idle → discovery_brief path and never write Starry.
-- 007_kol_memory / 008_discovery_ingest already landed on main.

ALTER TABLE discovery_runs ADD COLUMN session_id TEXT;
ALTER TABLE discovery_runs ADD COLUMN kind TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE creator_candidates ADD COLUMN order_index INTEGER;
ALTER TABLE creator_candidates ADD COLUMN metrics_missing INTEGER NOT NULL DEFAULT 0;
ALTER TABLE creator_candidates ADD COLUMN avg_views_10 REAL;
