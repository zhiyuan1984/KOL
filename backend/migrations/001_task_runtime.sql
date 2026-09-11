-- Task runtime schema. db.ts applies the same idempotent migration for embedded deployments.
CREATE TABLE IF NOT EXISTS work_items (
  id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, task_type TEXT NOT NULL, title TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual', status TEXT NOT NULL DEFAULT 'pending',
  priority TEXT NOT NULL DEFAULT 'normal', skill TEXT NOT NULL, profile TEXT NOT NULL,
  project_id TEXT, collaboration_id TEXT, session_id TEXT, due_at TEXT, started_at TEXT,
  completed_at TEXT, input TEXT NOT NULL DEFAULT '{}', entities TEXT NOT NULL DEFAULT '{}',
  data_version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_runs (
  id TEXT PRIMARY KEY, work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  session_id TEXT, thread_id TEXT, turn_id TEXT, worker_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending', input TEXT NOT NULL DEFAULT '{}',
  entities TEXT NOT NULL DEFAULT '{}', error TEXT, created_at TEXT NOT NULL,
  started_at TEXT, completed_at TEXT
);

CREATE TABLE IF NOT EXISTS task_events (
  id TEXT PRIMARY KEY, work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES task_runs(id) ON DELETE CASCADE, sequence INTEGER NOT NULL,
  event_type TEXT NOT NULL, label TEXT NOT NULL, status TEXT NOT NULL, safe_summary TEXT,
  time TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(work_item_id, sequence)
);

CREATE TABLE IF NOT EXISTS task_artifacts (
  id TEXT PRIMARY KEY, work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES task_runs(id) ON DELETE SET NULL, artifact_type TEXT NOT NULL,
  message_id TEXT, version INTEGER NOT NULL DEFAULT 1, payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
