-- Native PostgreSQL runtime-identity schema.
-- Register this file in scripts/apply-postgres-schema.ts before deploying; request paths only verify it.

CREATE TABLE IF NOT EXISTS managed_agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('draft','published','disabled')),
  version INTEGER NOT NULL CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runtime_agent_skills (
  agent_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  version INTEGER NOT NULL CHECK (version >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (agent_id, skill_id)
);
CREATE TABLE IF NOT EXISTS runtime_skill_connectors (
  skill_id TEXT NOT NULL,
  connector_id TEXT NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  version INTEGER NOT NULL CHECK (version >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (skill_id, connector_id)
);
CREATE TABLE IF NOT EXISTS runtime_skill_tools (
  skill_id TEXT NOT NULL,
  connector_id TEXT NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  version INTEGER NOT NULL CHECK (version >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (skill_id, connector_id, tool_name)
);
CREATE TABLE IF NOT EXISTS runtime_connector_config (
  connector_id TEXT PRIMARY KEY REFERENCES connectors(id) ON DELETE CASCADE,
  config_json TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 0),
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runtime_tool_policies (
  connector_id TEXT NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  risk TEXT NOT NULL CHECK (risk IN ('L1', 'L2', 'L3')),
  access TEXT NOT NULL CHECK (access IN ('read', 'write')),
  schema_hash TEXT NOT NULL CHECK (schema_hash ~ '^[0-9a-fA-F]{64}$'),
  version INTEGER NOT NULL CHECK (version >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (connector_id, tool_name)
);
CREATE TABLE IF NOT EXISTS runtime_bootstrap_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runtime_connector_organization_sync (
  connector_id TEXT PRIMARY KEY REFERENCES connectors(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  synced_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runtime_connector_organization_nodes (
  connector_id TEXT NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  parent_id TEXT,
  name TEXT NOT NULL,
  level INTEGER NOT NULL CHECK (level IN (1,2,3)),
  is_person INTEGER NOT NULL DEFAULT 0 CHECK (is_person IN (0,1)),
  external_id TEXT NOT NULL,
  local_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  synced_at TEXT NOT NULL,
  PRIMARY KEY (connector_id,id)
);
CREATE INDEX IF NOT EXISTS runtime_connector_org_nodes_parent_idx
  ON runtime_connector_organization_nodes(connector_id,parent_id,level);
CREATE TABLE IF NOT EXISTS runtime_tool_scope_bindings (
  connector_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  node_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (connector_id,tool_name,node_id),
  FOREIGN KEY (connector_id,node_id) REFERENCES runtime_connector_organization_nodes(connector_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS runtime_tool_scope_bindings_tool_idx ON runtime_tool_scope_bindings(connector_id,tool_name);
CREATE TABLE IF NOT EXISTS runtime_tool_global_scopes (
  connector_id TEXT NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (connector_id,tool_name)
);
CREATE TABLE IF NOT EXISTS runtime_connector_scope_modes (
  connector_id TEXT PRIMARY KEY REFERENCES connectors(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runtime_connector_tool_inventory (
  connector_id TEXT NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  schema_hash TEXT NOT NULL,
  input_schema TEXT NOT NULL,
  discovered_at TEXT NOT NULL,
  PRIMARY KEY (connector_id,tool_name)
);
CREATE TABLE IF NOT EXISTS runtime_connector_scope_policies (
  connector_id TEXT PRIMARY KEY REFERENCES connectors(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('all','selected')),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runtime_connector_scope_bindings (
  connector_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  access TEXT NOT NULL CHECK (access IN ('read','write')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (connector_id,node_id),
  FOREIGN KEY (connector_id,node_id) REFERENCES runtime_connector_organization_nodes(connector_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS runtime_connector_scope_bindings_idx ON runtime_connector_scope_bindings(connector_id);

CREATE TABLE IF NOT EXISTS runtime_credentials (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('organization_secret', 'user_account')),
  owner_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  label TEXT NOT NULL DEFAULT '',
  purpose TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  ciphertext TEXT NOT NULL,
  nonce TEXT NOT NULL,
  auth_tag TEXT NOT NULL,
  key_version INTEGER NOT NULL CHECK (key_version >= 1),
  version INTEGER NOT NULL CHECK (version >= 1),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((type = 'organization_secret' AND owner_user_id IS NULL)
    OR (type = 'user_account' AND owner_user_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS runtime_credentials_owner_idx ON runtime_credentials(owner_user_id, status, updated_at);

-- Existing organization tables were introduced before these identity fields.
ALTER TABLE organization_people ADD COLUMN IF NOT EXISTS starry_open_id TEXT;
ALTER TABLE organization_people ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE organization_people ADD COLUMN IF NOT EXISTS employee_no TEXT;
ALTER TABLE organization_people ADD COLUMN IF NOT EXISTS avatar_url TEXT;
