-- Agent content/assembly releases do not snapshot personnel authorization.
ALTER TABLE managed_agents ADD COLUMN IF NOT EXISTS published_revision BIGINT;
ALTER TABLE managed_agents ADD COLUMN IF NOT EXISTS workspace_managed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE runtime_agent_skills ADD COLUMN IF NOT EXISTS release_hash TEXT;
UPDATE managed_agents SET published_revision=version WHERE published_revision IS NULL AND status IN ('published','disabled');
CREATE TABLE IF NOT EXISTS agent_workspace_drafts (
  agent_id TEXT PRIMARY KEY REFERENCES managed_agents(id), revision BIGINT NOT NULL CHECK(revision>0),
  content JSONB NOT NULL, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_workspace_versions (
  agent_id TEXT NOT NULL REFERENCES managed_agents(id), version BIGINT NOT NULL CHECK(version>0),
  content JSONB NOT NULL, published_by TEXT NOT NULL, published_at TEXT NOT NULL, receipt_id TEXT,
  PRIMARY KEY(agent_id,version)
);
CREATE TABLE IF NOT EXISTS agent_release_preparations (
  id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES managed_agents(id), actor TEXT NOT NULL,
  revision BIGINT NOT NULL, fingerprint TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_release_preparations_agent ON agent_release_preparations(agent_id,created_at);
CREATE TABLE IF NOT EXISTS agent_release_receipts (
  id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES managed_agents(id), actor TEXT NOT NULL,
  preparation_id TEXT NOT NULL UNIQUE REFERENCES agent_release_preparations(id), request_id TEXT NOT NULL,
  version BIGINT NOT NULL, published_at TEXT NOT NULL, UNIQUE(actor,request_id)
);
