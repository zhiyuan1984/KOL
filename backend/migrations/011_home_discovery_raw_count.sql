-- 运行级原始候选数：brief.counts.raw 在 rank_failed 时为 null，状态卡需要恒有数。
-- db.ts migrateSchema() 的 add() 负责实际落列（幂等）；本文件按仓库惯例留档。

ALTER TABLE discovery_runs ADD COLUMN raw_count INTEGER;
