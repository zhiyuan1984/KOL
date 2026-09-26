-- Polling-endpoint indexes (GET /api/sessions, GET /api/tasks, GET /api/home/board).
-- Archival only: migrations/*.sql are not executed. The same statements live in
-- backend/src/db.ts migrateSchema() and are applied with CREATE INDEX IF NOT EXISTS.
--
-- Evidence (EXPLAIN QUERY PLAN on a production-scale fixture: 397 sessions,
-- 370 work_items, 190,645 task_events, 400 workers, 200 drafts):
--   sessions list   : SCAN sessions + USE TEMP B-TREE FOR ORDER BY
--   worker by session: SCAN workers + USE TEMP B-TREE FOR ORDER BY   (x397)
--   draft by session : SCAN drafts  + USE TEMP B-TREE FOR ORDER BY   (x397)
--   work_items list  : SEARCH work_items USING INDEX work_items_owner_status
--                      (owner_user_id=?) + USE TEMP B-TREE FOR ORDER BY
--
-- task_events needs no new index: task_events_work_item(work_item_id, sequence)
-- already covers both the per-work-item tail read and the MAX(sequence)
-- aggregate in the board's last-event join.

-- Scoped session list: WHERE owner_user_id=? ... ORDER BY updated_at DESC.
CREATE INDEX IF NOT EXISTS sessions_owner_updated
    ON sessions(owner_user_id, updated_at DESC);

-- Unscoped (scope=all) session list: ORDER BY updated_at DESC.
CREATE INDEX IF NOT EXISTS sessions_updated
    ON sessions(updated_at DESC);

-- /api/home/board maps collaborations -> newest session.
CREATE INDEX IF NOT EXISTS sessions_collaboration_updated
    ON sessions(collaboration_id, updated_at DESC);

-- GET /api/sessions reads the newest worker row per session for agent_status.
CREATE INDEX IF NOT EXISTS workers_session_created
    ON workers(session_id, created_at DESC);

-- GET /api/sessions reads the newest draft row per session for agent_status.
CREATE INDEX IF NOT EXISTS drafts_session_id
    ON drafts(session_id, id DESC);

-- GET /api/tasks lists work items for one owner ordered by updated_at DESC.
-- work_items_owner_status(owner_user_id, status, updated_at) cannot serve that
-- ORDER BY, so every list request sorted into a temp b-tree.
CREATE INDEX IF NOT EXISTS work_items_owner_updated
    ON work_items(owner_user_id, updated_at DESC);
