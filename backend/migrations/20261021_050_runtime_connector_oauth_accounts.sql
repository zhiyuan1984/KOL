CREATE TABLE IF NOT EXISTS runtime_connector_oauth_accounts (
  connector_id text NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id text NOT NULL UNIQUE REFERENCES runtime_credentials(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (connector_id, user_id)
);

CREATE TABLE IF NOT EXISTS runtime_connector_oauth_pending (
  state_hash text PRIMARY KEY,
  connector_id text NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id text NOT NULL UNIQUE REFERENCES runtime_credentials(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS runtime_connector_oauth_pending_expiry_idx
  ON runtime_connector_oauth_pending (expires_at);
