-- PostgreSQL-only. Deliberately creates no bindings for historical bases:
-- a binding is an explicit planning classification, not a synthetic knowledge
-- container or a migration of legacy family/domain placement.
CREATE TABLE IF NOT EXISTS knowledge_ontology_theme_bindings (
  base_id TEXT PRIMARY KEY REFERENCES knowledge_bases(id) ON DELETE RESTRICT,
  theme_id TEXT NOT NULL CHECK (length(btrim(theme_id)) > 0),
  source_version TEXT NOT NULL CHECK (length(btrim(source_version)) > 0),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A theme intentionally accepts many bases. The index supports workspace
-- subtree filters while the primary key enforces one primary theme per base.
CREATE INDEX IF NOT EXISTS knowledge_ontology_theme_bindings_theme_idx
  ON knowledge_ontology_theme_bindings(theme_id, base_id);
