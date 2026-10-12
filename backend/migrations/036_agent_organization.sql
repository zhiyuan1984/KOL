-- Digital employee organizational ownership is independent of human membership and usage grants.
CREATE UNIQUE INDEX IF NOT EXISTS organization_units_company_id_unique ON organization_units(company_id,id);
CREATE TABLE IF NOT EXISTS agent_organization_memberships (
  id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES managed_agents(id),
  company_id TEXT NOT NULL, org_unit_id TEXT NOT NULL,
  revision BIGINT NOT NULL CHECK(revision>0),
  status TEXT NOT NULL CHECK(status IN ('active','ended')),
  assigned_by TEXT NOT NULL, effective_from TEXT NOT NULL, effective_to TEXT,
  FOREIGN KEY(company_id,org_unit_id) REFERENCES organization_units(company_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_organization_primary_active ON agent_organization_memberships(agent_id) WHERE status='active';
CREATE TABLE IF NOT EXISTS agent_organization_preparations (
  id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES managed_agents(id), actor TEXT NOT NULL,
  revision BIGINT NOT NULL, company_id TEXT, org_unit_id TEXT, fingerprint TEXT NOT NULL,
  expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_organization_receipts (
  id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES managed_agents(id), actor TEXT NOT NULL,
  revision BIGINT NOT NULL CHECK(revision>0), request_id TEXT NOT NULL,
  preparation_id TEXT NOT NULL UNIQUE REFERENCES agent_organization_preparations(id),
  before_state JSONB, after_state JSONB, reason TEXT NOT NULL, changed_at TEXT NOT NULL,
  UNIQUE(actor,request_id), UNIQUE(agent_id,revision)
);
CREATE INDEX IF NOT EXISTS agent_organization_history ON agent_organization_memberships(agent_id,revision DESC);
