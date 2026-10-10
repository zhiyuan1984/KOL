-- 20261010_skill_biz_taxonomy：管理侧技能治理 —— 技能业务族 / 业务域（复用知识侧字典，不另建字典）。
ALTER TABLE public.skill_lifecycle ADD COLUMN IF NOT EXISTS biz_family text;
ALTER TABLE public.skill_lifecycle ADD COLUMN IF NOT EXISTS biz_domain text;
