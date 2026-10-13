-- Personal browsing preferences, separate from Agent bindings and publication.
CREATE TABLE IF NOT EXISTS employee_agent_preferences (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expert_id TEXT NOT NULL,
  favorite BOOLEAN NOT NULL DEFAULT FALSE,
  viewed_at TEXT,
  PRIMARY KEY (user_id, expert_id)
);
CREATE INDEX IF NOT EXISTS employee_agent_preferences_user_viewed
  ON employee_agent_preferences(user_id, viewed_at DESC);
