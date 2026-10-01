-- 统一业务事件表（business_events）：不可变业务事实账本。
-- db.ts applies the same idempotent migration for embedded deployments.
-- 目录 config/event-catalog.yaml；服务 backend/src/business-events.ts；
-- 设计 docs/superpowers/specs/2026-10-01-ontology-three-tables-design.md。
CREATE TABLE IF NOT EXISTS business_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  source TEXT NOT NULL,
  source_version TEXT,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  action_ref TEXT,
  payload TEXT NOT NULL DEFAULT '{}',
  evidence TEXT NOT NULL DEFAULT '{}',
  receipt TEXT,
  diff TEXT,
  idempotency_key TEXT,
  correlation_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS business_events_object
  ON business_events(object_type, object_id, occurred_at);
CREATE INDEX IF NOT EXISTS business_events_type
  ON business_events(event_type, occurred_at);
CREATE INDEX IF NOT EXISTS business_events_correlation
  ON business_events(correlation_id);
CREATE UNIQUE INDEX IF NOT EXISTS business_events_idempotency
  ON business_events(idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS business_events_no_update
BEFORE UPDATE ON business_events
BEGIN
  SELECT RAISE(ABORT, 'business_events are immutable');
END;

CREATE TRIGGER IF NOT EXISTS business_events_no_delete
BEFORE DELETE ON business_events
BEGIN
  SELECT RAISE(ABORT, 'business_events are immutable');
END;
