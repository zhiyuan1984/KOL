-- Native PostgreSQL storage for generic review v2. This migration is additive;
-- it is applied only by normal migration tooling / isolated fresh test databases.
CREATE TABLE IF NOT EXISTS review_attachments (
  tenant TEXT NOT NULL, id TEXT NOT NULL, actor TEXT NOT NULL, name TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes > 0), sha256 TEXT NOT NULL,
  content_base64 TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (tenant,id)
);
CREATE TABLE IF NOT EXISTS review_timer_receipts (
  tenant TEXT NOT NULL, task_id TEXT NOT NULL, due_at TEXT NOT NULL, receipt TEXT NOT NULL,
  PRIMARY KEY (tenant,task_id,due_at)
);
CREATE TABLE IF NOT EXISTS review_drafts (
  tenant TEXT NOT NULL, id TEXT NOT NULL, actor TEXT NOT NULL, version INTEGER NOT NULL CHECK(version > 0),
  payload TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (tenant,id)
);
CREATE INDEX IF NOT EXISTS review_drafts_actor ON review_drafts(tenant,actor,updated_at DESC);
CREATE TABLE IF NOT EXISTS review_templates (
  tenant TEXT NOT NULL, id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version > 0), published_version INTEGER,
  definition TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (tenant,id)
);
CREATE TABLE IF NOT EXISTS review_template_lifecycle (
  tenant TEXT NOT NULL, template_id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version >= 0), enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  PRIMARY KEY(tenant,template_id), FOREIGN KEY(tenant,template_id) REFERENCES review_templates(tenant,id)
);
CREATE TABLE IF NOT EXISTS review_versions (
  tenant TEXT NOT NULL, template_id TEXT NOT NULL, version INTEGER NOT NULL, definition TEXT NOT NULL,
  published_by TEXT NOT NULL, published_at TEXT NOT NULL, PRIMARY KEY(tenant,template_id,version),
  FOREIGN KEY(tenant,template_id) REFERENCES review_templates(tenant,id)
);
CREATE TABLE IF NOT EXISTS review_instances (
  tenant TEXT NOT NULL, id TEXT NOT NULL, template_id TEXT NOT NULL, template_version INTEGER NOT NULL,
  version INTEGER NOT NULL CHECK(version > 0), requester TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY(tenant,id), FOREIGN KEY(tenant,template_id,template_version) REFERENCES review_versions(tenant,template_id,version)
);
CREATE INDEX IF NOT EXISTS review_instances_scope ON review_instances(tenant,requester,status);
CREATE TABLE IF NOT EXISTS review_attachment_refs (
  tenant TEXT NOT NULL, instance_id TEXT NOT NULL, round INTEGER NOT NULL, attachment_id TEXT NOT NULL,
  PRIMARY KEY(tenant,instance_id,round,attachment_id), FOREIGN KEY(tenant,instance_id) REFERENCES review_instances(tenant,id),
  FOREIGN KEY(tenant,attachment_id) REFERENCES review_attachments(tenant,id)
);
CREATE TABLE IF NOT EXISTS review_revisions (
  tenant TEXT NOT NULL, instance_id TEXT NOT NULL, round INTEGER NOT NULL, material TEXT NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY(tenant,instance_id,round), FOREIGN KEY(tenant,instance_id) REFERENCES review_instances(tenant,id)
);
CREATE TABLE IF NOT EXISTS review_notifications (
  id TEXT PRIMARY KEY, tenant TEXT NOT NULL, instance_id TEXT NOT NULL, user_id TEXT NOT NULL,
  message TEXT NOT NULL, created_at TEXT NOT NULL, read_at TEXT,
  FOREIGN KEY(tenant,instance_id) REFERENCES review_instances(tenant,id)
);
CREATE INDEX IF NOT EXISTS review_notifications_inbox ON review_notifications(tenant,user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS review_participants (
  tenant TEXT NOT NULL, instance_id TEXT NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY(tenant,instance_id,user_id),
  FOREIGN KEY(tenant,instance_id) REFERENCES review_instances(tenant,id)
);
CREATE INDEX IF NOT EXISTS review_participants_user ON review_participants(tenant,user_id,instance_id);
CREATE TABLE IF NOT EXISTS review_confirmations (
  id TEXT PRIMARY KEY, tenant TEXT NOT NULL, actor TEXT NOT NULL, command_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL, consumed INTEGER NOT NULL DEFAULT 0 CHECK(consumed IN (0,1))
);
CREATE TABLE IF NOT EXISTS review_commands (
  tenant TEXT NOT NULL, actor TEXT NOT NULL, idempotency_key TEXT NOT NULL, command_hash TEXT NOT NULL,
  receipt TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(tenant,actor,idempotency_key)
);
CREATE TABLE IF NOT EXISTS review_events (
  id TEXT PRIMARY KEY, tenant TEXT NOT NULL, resource_id TEXT NOT NULL, actor TEXT NOT NULL,
  action TEXT NOT NULL, version INTEGER NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS review_events_resource ON review_events(tenant,resource_id,created_at);
