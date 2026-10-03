-- 工单验收事实：验收时间、验收时负责人、实际验收人和证据均为不可回写快照。
-- 运行成功仍只保留在 task_runs / task_events，绝不能作为工单完成统计来源。
CREATE TABLE IF NOT EXISTS ticket_acceptances (
  ticket_id TEXT PRIMARY KEY,
  acceptance_event_id TEXT,
  accepted_at TEXT NOT NULL,
  owner_user_id_at_acceptance TEXT NOT NULL,
  accepted_by_user_id TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  rules_version TEXT NOT NULL DEFAULT 'ticket-acceptance.v1',
  created_at TEXT NOT NULL,
  FOREIGN KEY(ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ticket_acceptances_accepted_at
  ON ticket_acceptances(accepted_at DESC, ticket_id);
CREATE INDEX IF NOT EXISTS ticket_acceptances_owner_accepted_at
  ON ticket_acceptances(owner_user_id_at_acceptance, accepted_at DESC);
