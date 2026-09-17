-- Exam + qualification law-v2 (PROD-PLAT-04 / 05 / 07).
-- db.ts migrateSchema applies the same CREATE / ALTER for embedded deployments.
-- Papers default to draft. Only POST publish writes a snapshot and bumps version.
-- Generated items are proposed candidates, not live papers.

ALTER TABLE exams ADD COLUMN status TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE exams ADD COLUMN pass_score INTEGER NOT NULL DEFAULT 80;
ALTER TABLE exams ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE exams ADD COLUMN effects TEXT NOT NULL DEFAULT '{}';
ALTER TABLE exams ADD COLUMN published_at TEXT;

ALTER TABLE exam_attempts ADD COLUMN status TEXT NOT NULL DEFAULT 'graded';
ALTER TABLE exam_attempts ADD COLUMN score INTEGER;
ALTER TABLE exam_attempts ADD COLUMN total INTEGER;
ALTER TABLE exam_attempts ADD COLUMN paper_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE exam_attempts ADD COLUMN idempotency_key TEXT;
ALTER TABLE exam_attempts ADD COLUMN started_at TEXT;
ALTER TABLE exam_attempts ADD COLUMN breakdown_json TEXT;

CREATE TABLE IF NOT EXISTS exam_items (
  id TEXT PRIMARY KEY,
  exam_id TEXT NOT NULL,
  knowledge_id TEXT,
  prompt TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'true_false',
  options_json TEXT NOT NULL DEFAULT '[]',
  answer TEXT NOT NULL,
  accepted INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL,
  FOREIGN KEY(exam_id) REFERENCES exams(id)
);

CREATE TABLE IF NOT EXISTS exam_snapshots (
  id TEXT PRIMARY KEY,
  exam_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  pass_score INTEGER NOT NULL,
  items_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(exam_id, version),
  FOREIGN KEY(exam_id) REFERENCES exams(id)
);

CREATE TABLE IF NOT EXISTS exam_qualifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  exam_id TEXT NOT NULL,
  assignment_id TEXT,
  attempt_id TEXT,
  paper_version INTEGER NOT NULL,
  passed INTEGER NOT NULL,
  score INTEGER,
  total INTEGER,
  awarded_at TEXT NOT NULL,
  UNIQUE(user_id, exam_id, paper_version),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(exam_id) REFERENCES exams(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS exam_attempts_idempotency
  ON exam_attempts(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND idempotency_key != '';
