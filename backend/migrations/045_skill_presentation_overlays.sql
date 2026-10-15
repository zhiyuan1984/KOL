-- Registered versioned schema, not a host request-time initializer.
-- Built-in skill IDs are package IDs, so there is no invented users/skills FK.
CREATE TABLE IF NOT EXISTS skill_presentation_overlays (
  skill_id TEXT PRIMARY KEY,
  payload TEXT NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(payload::jsonb) = 'object'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
