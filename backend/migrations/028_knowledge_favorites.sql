CREATE TABLE IF NOT EXISTS knowledge_favorites (
  user_id TEXT NOT NULL,
  knowledge_id TEXT NOT NULL,
  saved_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, knowledge_id)
);

CREATE INDEX IF NOT EXISTS knowledge_favorites_user_updated_idx
  ON knowledge_favorites(user_id, updated_at DESC);
