-- 030: 公海品牌可见性 —— 跟进（建线索）后，同品牌用户在公海不可见该 KOL
--
-- 规则（用户 2026-10-08）：
--   1. 跟进用户是 LT 品牌 → LT 用户在公海看不到该 KOL，RG 等其他品牌仍可见；
--   2. 推广组组长（及平台管理员/公司级部门负责人）看全量，不受此限。
-- 实现：kol_leads 加 brand + platform_creator_id；品牌锁表 kol_pool_brand_locks
-- 按 (platform, platform_creator_id, brand) 记锁，公海读取时按查看者品牌排除。

ALTER TABLE kol_leads ADD COLUMN IF NOT EXISTS brand TEXT NOT NULL DEFAULT '';
ALTER TABLE kol_leads ADD COLUMN IF NOT EXISTS platform_creator_id TEXT;

CREATE TABLE IF NOT EXISTS kol_pool_brand_locks (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  platform_creator_id TEXT NOT NULL,
  brand TEXT NOT NULL,
  lead_id TEXT NOT NULL REFERENCES kol_leads(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (platform, platform_creator_id, brand)
);
CREATE INDEX IF NOT EXISTS kol_pool_brand_locks_identity_idx
  ON kol_pool_brand_locks (platform, platform_creator_id);
CREATE INDEX IF NOT EXISTS kol_pool_brand_locks_lead_idx
  ON kol_pool_brand_locks (lead_id);
