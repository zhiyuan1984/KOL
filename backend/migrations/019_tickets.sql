-- 工单表（tickets）：work_items 的工单层（独立表，2026-10-01 决策）。
-- db.ts applies the same idempotent migration for embedded deployments.
-- 分类只来自 config/ticket-types.yaml；票面镜像列由触发器从 work_items 同步；
-- 设计 docs/superpowers/specs/2026-10-01-ontology-three-tables-design.md。
CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  work_item_id TEXT,
  kind TEXT NOT NULL DEFAULT 'general',
  channel TEXT NOT NULL DEFAULT 'human',
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  priority TEXT NOT NULL DEFAULT 'normal',
  requester_type TEXT NOT NULL DEFAULT 'human',
  requester_id TEXT,
  assignee_user_id TEXT,
  object_type TEXT,
  object_id TEXT,
  collaboration_id TEXT,
  project_id TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  due_at TEXT,
  risk_level TEXT NOT NULL DEFAULT 'none',
  kind_version INTEGER NOT NULL DEFAULT 1,
  data_version INTEGER NOT NULL DEFAULT 1,
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  status_updated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(work_item_id) REFERENCES work_items(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS tickets_work_item
  ON tickets(work_item_id) WHERE work_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tickets_status_updated
  ON tickets(status, updated_at);
CREATE INDEX IF NOT EXISTS tickets_assignee_status
  ON tickets(assignee_user_id, status);
CREATE INDEX IF NOT EXISTS tickets_kind
  ON tickets(kind);
CREATE INDEX IF NOT EXISTS tickets_channel
  ON tickets(channel);

CREATE TRIGGER IF NOT EXISTS work_items_ticket_mirror
AFTER UPDATE OF status, priority, due_at, risk_level, title, owner_user_id ON work_items
BEGIN
  UPDATE tickets SET
    title = NEW.title,
    priority = NEW.priority,
    due_at = NEW.due_at,
    risk_level = NEW.risk_level,
    assignee_user_id = NEW.owner_user_id,
    status = CASE NEW.status
      WHEN 'pending' THEN 'open'
      WHEN 'needs_clarification' THEN 'open'
      WHEN 'queued' THEN 'in_progress'
      WHEN 'starting' THEN 'in_progress'
      WHEN 'running' THEN 'in_progress'
      WHEN 'in_progress' THEN 'in_progress'
      WHEN 'waiting' THEN 'waiting'
      WHEN 'waiting_approval' THEN 'waiting'
      WHEN 'completed' THEN 'done'
      WHEN 'done' THEN 'done'
      WHEN 'failed' THEN 'failed'
      WHEN 'cancelled' THEN 'cancelled'
      WHEN 'stopped' THEN 'cancelled'
      ELSE status END,
    status_updated_at = CASE WHEN NEW.status <> OLD.status THEN NEW.updated_at ELSE status_updated_at END,
    closed_at = CASE
      WHEN NEW.status IN ('completed','done','cancelled','stopped','failed') THEN COALESCE(closed_at, NEW.updated_at)
      ELSE NULL END,
    data_version = data_version + 1,
    updated_at = NEW.updated_at
  WHERE work_item_id = NEW.id;
END;
