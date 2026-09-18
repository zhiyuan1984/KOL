-- Host discovery ingest receipts / L3 confirms / memory facts.
-- A/B/C stay in 007_kol_memory.sql. This is operational, not a third memory model.

CREATE TABLE IF NOT EXISTS discovery_ingest_receipts (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  source_batch TEXT NOT NULL,
  platform TEXT NOT NULL,
  platform_creator_id TEXT NOT NULL,
  kol_uid TEXT NOT NULL,
  candidate_id TEXT,
  run_id TEXT,
  status TEXT NOT NULL DEFAULT 'imported',
  created_at TEXT NOT NULL,
  UNIQUE(company_id, source_batch, platform, platform_creator_id)
);

CREATE TABLE IF NOT EXISTS discovery_ingest_confirms (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  source_batch TEXT NOT NULL,
  expected_brief_version INTEGER NOT NULL,
  candidate_ids TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  actor_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS discovery_memory_facts (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  fact_kind TEXT NOT NULL DEFAULT 'fact',
  visibility TEXT NOT NULL DEFAULT 'public_sea',
  payload TEXT NOT NULL DEFAULT '{}',
  source_version TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS discovery_memory_facts_object
  ON discovery_memory_facts(company_id, object_type, object_id, kind);
