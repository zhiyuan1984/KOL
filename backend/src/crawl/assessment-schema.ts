export const candidateAssessmentSchema = `
CREATE TABLE IF NOT EXISTS kol_candidate_assessments (
  company_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  creator_id TEXT NOT NULL,
  assessment_key TEXT NOT NULL,
  source_action_id TEXT NOT NULL REFERENCES runtime_crawl_jobs(id),
  kol_uid TEXT,
  state TEXT NOT NULL CHECK (state IN ('queued','scoring','scored','failed')),
  evidence_json JSONB NOT NULL,
  criteria_json JSONB,
  result_json JSONB,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, platform, creator_id, assessment_key)
);
CREATE INDEX IF NOT EXISTS candidate_assessment_identity
  ON kol_candidate_assessments(company_id, platform, creator_id, updated_at DESC);
`;
