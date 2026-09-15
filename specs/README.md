# KOL 可开发规格

每份 `FS-*` 必须同时具备范围、输入输出、状态、BR、Skill/Policy/MCP、GWT、测试 ID 和 EVAL ID。规格只描述可开发行为；安全不变量仍以 Host/PEP/Gateway 为最终裁决。

阶段写入与 Pipeline 表面以 `docs/CONSTITUTION.md` §4.2 / §5 与 `policies/change_stage.yaml` 为准，不再另立 `FS-KOL-006` / `FS-KOL-010`。管理端配套套件见 `docs/org-permissions.md`；本目录不新增 Admin UX ID。

员工体验验收走从宪法派生的 [`UX-EMPLOYEE.md`](UX-EMPLOYEE.md)（位阶低于 `CONSTITUTION.md` §4–5）。硬不变量 ID 仅 `SEND_NE_STAGE`、`L3_CONFIRM`，绑定见 [`ux-traceability.json`](ux-traceability.json)。
