export const crawlResultSchema = `
ALTER TABLE runtime_crawl_jobs ADD COLUMN IF NOT EXISTS result_state TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE runtime_crawl_jobs ADD COLUMN IF NOT EXISTS result_json JSONB;
ALTER TABLE runtime_crawl_jobs ADD COLUMN IF NOT EXISTS result_error TEXT;
`;
