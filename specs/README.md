# KOL 可开发规格

每份 `FS-*` 必须同时具备范围、输入输出、状态、BR、Skill/Policy/MCP、GWT、测试 ID 和 EVAL ID。规格只描述可开发行为；安全不变量仍以 Host/PEP/Gateway 为最终裁决。

`FS-KOL-010` 锁定 Pipeline 作为正式生命周期资产页，禁止把 Home 待办或 Chat 技能入口再复制进 `/pipeline`。表面职责见 `docs/CONSTITUTION.md`，员工详细 IA 见 `docs/employee-surface-contracts.md`。管理端配套套件见 `docs/21-admin-employee-page-roles.md`；本目录不新增 Admin UX ID。

`UX-FOLLOWED-KOL-CARD` 锁定首页「我跟进的红人」工作卡的视图模型、四带结构、行动责任人 IA 与确定性排序。PR #31 已在 Home 按该契约从现有 board 投影工作卡（不把 `collab_summary` / `recent_followup` / `mail_threads` 当列）；本 residual 补齐 mailbox 芯片、状态带分离、首页去掉跟进风格标签与 Journey 通用 copy。该契约尚未写入 `ux-traceability.json`，本索引不把它当成已验收 UX ID。改版前 FAIL 基线见 `docs/evidence-followed-kol-card-acceptance-2026-09-13.md`。
