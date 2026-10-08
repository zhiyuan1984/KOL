-- 029: AI发现去重池 + 线索 Jev 评分列（2026-10-08）
-- kol_creator_pool：跨运行去重的基准池。精确键 = (platform, normalized_creator_id)，
-- BIZ-15：只认平台+稳定外部 ID，不认昵称/邮箱相似。

CREATE TABLE IF NOT EXISTS kol_creator_pool (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  platform_creator_id TEXT NOT NULL,
  normalized_creator_id TEXT NOT NULL,
  handle TEXT,
  display_name TEXT,
  profile_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  seen_count INTEGER NOT NULL DEFAULT 1,
  UNIQUE (platform, normalized_creator_id)
);
CREATE INDEX IF NOT EXISTS idx_creator_pool_lookup
  ON kol_creator_pool (platform, normalized_creator_id);
CREATE INDEX IF NOT EXISTS idx_creator_pool_last_seen
  ON kol_creator_pool (last_seen_at DESC);

-- kol_leads：线索阶段 Jev 评分列。公海复用时以 assessment_version + assessment_criteria
-- 判断口径可比性（"口径不同的两次评分不该看起来一样"）。
ALTER TABLE kol_leads
  ADD COLUMN IF NOT EXISTS potential_score INTEGER,
  ADD COLUMN IF NOT EXISTS potential_confidence DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS risk_score INTEGER,
  ADD COLUMN IF NOT EXISTS risk_confidence DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS assessment_version TEXT,
  ADD COLUMN IF NOT EXISTS assessment_criteria TEXT,
  ADD COLUMN IF NOT EXISTS assessed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS assessment_error TEXT;
