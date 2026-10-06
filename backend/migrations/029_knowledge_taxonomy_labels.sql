-- 2026-10-07：管理端知识分类主数据展示名统一。
-- 保留 code/id，避免破坏知识条目、权限和 Agent 绑定。
UPDATE knowledge_domains SET name='产品与解决方案', updated_at=NOW()::text
 WHERE code='ipd' AND level='family';
UPDATE knowledge_domains SET name='品牌与用户增长中心', updated_at=NOW()::text
 WHERE code='ipms' AND level='family';
UPDATE knowledge_domains SET name='产品管理', updated_at=NOW()::text
 WHERE code='ipd_battery' AND level='domain';
UPDATE knowledge_domains SET name='推广', updated_at=NOW()::text
 WHERE code='marketing' AND level='domain';
UPDATE knowledge_bases SET name='电池', updated_at=NOW()::text
 WHERE code='ipd_battery_product_specs';
