-- 20261016_domain_confirmations：业务域地图的域确认记录（轻量标记，不是审批）。
-- 域主/管理员确认“当前展示的域地图内容正确”，绑定展示内容的 map_digest；
-- 注册表内容变化后 digest 不匹配，确认即过期（待更新），需重新确认。
-- 确认只追加记录，不改注册表、不绕过审批（审批仍走 ontology_change）。

CREATE TABLE IF NOT EXISTS public.domain_confirmations (
  id TEXT PRIMARY KEY,
  domain_code TEXT NOT NULL,
  confirmed_by TEXT NOT NULL,
  confirmed_by_name TEXT NOT NULL,
  map_digest TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS domain_confirmations_domain_idx
  ON public.domain_confirmations(domain_code, created_at DESC);
