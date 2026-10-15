-- PostgreSQL-native replacement for the retired startup-only taxonomy backfill.
-- Fill missing CURRENT entry fields from its own stored facts only.
-- Existing knowledge_versions are immutable historical snapshots: null legacy
-- metadata is unknown, not permission to reconstruct it from today's entry.
UPDATE knowledge
SET base_id = 'kbase_legacy'
WHERE (base_id IS NULL OR base_id = '')
  AND EXISTS (SELECT 1 FROM knowledge_bases WHERE id = 'kbase_legacy');
UPDATE knowledge
SET source_body = body
WHERE (source_body IS NULL OR source_body = '') AND body IS NOT NULL;
-- Never UPDATE/DELETE an existing knowledge_versions row during this migration.
