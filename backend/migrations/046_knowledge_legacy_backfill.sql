-- PostgreSQL-native replacement for the retired startup-only taxonomy backfill.
-- Native taxonomy seed precedes this migration. Fill missing fields only; never
-- overwrite a material body, version, publication state, actor, or approval.
UPDATE knowledge
SET base_id = 'kbase_legacy'
WHERE (base_id IS NULL OR base_id = '')
  AND EXISTS (SELECT 1 FROM knowledge_bases WHERE id = 'kbase_legacy');
UPDATE knowledge
SET source_body = body
WHERE (source_body IS NULL OR source_body = '') AND body IS NOT NULL;
UPDATE knowledge_versions AS version
SET tags = COALESCE(version.tags, entry.tags),
    in_market = COALESCE(version.in_market, entry.in_market),
    effective_at = COALESCE(version.effective_at, entry.effective_at),
    expires_at = COALESCE(version.expires_at, entry.expires_at),
    source_body = COALESCE(NULLIF(version.source_body, ''), version.body, entry.source_body),
    base_id = COALESCE(NULLIF(version.base_id, ''), entry.base_id)
FROM knowledge AS entry
WHERE version.knowledge_id = entry.id
  AND (version.tags IS NULL OR version.in_market IS NULL
       OR version.source_body IS NULL OR version.source_body = ''
       OR version.base_id IS NULL OR version.base_id = '');
