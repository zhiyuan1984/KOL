# 灵工数字员工中台文档体系

本文件是项目规范的唯一使用入口。不要从文件编号顺序开始全量阅读；先确定任务类型，再按下列流程加载最少的权威上下文。

## 最终使用方法

### UI 设计或前端实现

```text
CONSTITUTION.md
→ 对应 FS / `UX-EMPLOYEE` 硬不变量（`SEND_NE_STAGE`、`L3_CONFIRM`）
→ design-system/kol-workbench/MASTER.md
→ design-system/kol-workbench/pages/<当前页面>.md
→ 仅针对未解决问题调用 ui-ux-pro-max
→ 实现并按 UX ID、视口和无障碍要求验证
```

### 业务、API 或后端实现

```text
CONSTITUTION.md 中相关边界
→ 对应 FS
→ 数据模型 / Policy / MCP 物理契约
→ traceability 中对应测试与红线
```

安全、权限、租户边界和真实数据永远以 FS、Policy 与数据契约为准，不能被体验原则覆盖。

### 验收或回归

```text
改动对应的 FS / UX ID
→ specs/traceability.json 或 specs/ux-traceability.json
→ 对应自动化测试、截图、回执或脱敏 Trace
```

没有追踪关系和证据的交互只能标记为“规格存在”，不能标记为“体验验收通过”。

### 研究、追溯和历史决策

只有需要回答“为什么这样设计”时才读取 `DECISIONS.md` 或 `references/`。它们不能覆盖现行契约。

### 文档裁决

| 问题 | 读取并服从 |
|---|---|
| 安全、权限、数据事实 | FS、Policy、数据契约 |
| 产品闭环与表面职责 | `CONSTITUTION.md` |
| 平台一等能力 vs KOL 试点壳 | `CONSTITUTION.md` §4.1–4.2（十六项清单；KOL=首个试点，ADR-023） |
| 可执行交互与发布验收 | 宪法 §4–5、派生的 `specs/UX-EMPLOYEE.md`、追踪矩阵 |
| 全局视觉与组件 | `design-system/kol-workbench/MASTER.md` |
| 单页布局与状态 | 对应 `pages/*.md` |

详细按需路由见 `CONTEXT-MANIFEST.md`。给 Codex 下达任务时，可以直接要求：“先按 `docs/README.md` 判断任务类型并加载所需规范，再实施和验证。”

`references/` 只用于研究和追溯，默认不进入实现上下文。

## 现行主线阅读顺序

1. `00-platform-charter.md`：愿景、不变量和共创角色
2. `01-organization-tenancy.md`：公司、组织、品牌、角色和数据范围
3. `02-domain-model.md`：数字员工、Agent、Skill、Task 和 WorkItem
4. `03-prd-and-functional-spec.md`：概念、PRD、功能规格和需求追踪
5. `05-agent-workflow-skill-policy.md`：Agent、Workflow、Skill、Policy、8/15 阶段
6. `06-codex-harness.md`：Codex app-server、Host 边界和 Stub
7. `07-mcp-data-contract.md`：真实 MCP、数据字典和适配规则
8. `08-permission-approval-audit.md`：权限、审批、副作用、幂等和审计
9. `09-development-method.md`：氛围/规约/测试/评价驱动开发
10. `10-test-evaluation.md`：测试分层、评价集、红线和验收证据
11. `11-release-operations.md`：版本、灰度、回滚、监控和运营
12. `12-kol-agent.md`：KOL 试点和报价邮件闭环
13. `13-migration-roadmap.md`：Host 硬编码退场路线
14. `14-implementation-contract.md`：Markdown 到代码、Skill、知识库和前后端的落地契约
15. `15-conformance-gaps.md`：当前实现与目标规范的符合度和缺口
16. `16-production-test-plan.md`：功能、红线、真实链路和发布门禁测试
17. `17-code-conformance-scan.md`：前后端代码违宪扫描报告
18. `18-mcp-master-data-assessment.md`：MCP 主数据能力与组织主数据边界
19. `20-visual-design-system.md`：旧视觉方案与 token 迁移依据；现行视觉入口为 `design-system/kol-workbench/MASTER.md`
20. `21-admin-employee-page-roles.md`：管理端 ↔ 员工端边界（使用 ≠ 治理）
21. `90-codebase-handbook.md`：代码地图和修改归属
22. `specs/UX-EMPLOYEE.md`：从宪法派生的瘦员工 UX；门禁只认 `SEND_NE_STAGE`、`L3_CONFIRM`

## 事实来源

- `starry-kol-mcp-server.md`：Starry KOL MCP 的物理工具目录
- `median_mcp_server.md`：MediaCrawler MCP 的物理工具和异步作业
- `DATA_DICTIONARY.md`：真实字典、阶段和风险配置
- `codex/`：Codex app-server 版本对应的协议 schema

这些文件描述外部事实，不负责业务编排。若物理接口与业务文档冲突，先记录接口漂移，再由适配层处理，禁止在 Skill 或前端偷偷复制一套映射。

## 模板与决策

- `SPEC-TEMPLATE.md`：功能规格模板。
- `EVAL-TEMPLATE.md`：Agent 评价样例模板。
- `DECISIONS.md`：跨文档架构决策记录（近期：ADR-023 十六项一等 / KOL=试点；ADR-024 删除过细 UX-KOL；ADR-025 删除 evidence/04/19/employee-surface/FS-006/010/ADR-018/022）。

### 平台能力 vs KOL 试点

| 问题 | 读取并服从 |
|---|---|
| 哪些面是一等能力、KOL 是否等于平台壳 | `CONSTITUTION.md` §4.1–4.2 十六项清单与试点元条款（ADR-023） |
| 能力面「只回答」与使用 ≠ 治理 | `CONSTITUTION.md` §4、`21-admin-employee-page-roles.md` |
| KOL 试点域（Pipeline、AI发现、我跟进的红人、报价邮件） | `CONSTITUTION.md` §4.2、`12-kol-agent.md`。Pipeline 页可深链 / CTA，不是必挂侧栏 |
| 连接器使用 ≠ 治理 | `21-admin-employee-page-roles.md`、ADR-013 |

历史重复规范已删除；追溯使用 Git 历史。业务规则只在功能规格/Skill/Workflow/Policy 的 canonical 位置维护；物理接口只在物理资料维护；平台硬规则只在 Host/内核契约维护。任何冲突必须写决策记录并更新追踪矩阵。

## 可执行资产

- `../config/org-registry.yaml`、`../config/brand-registry.yaml`：公司、组织、品牌、区域和 PEP 范围事实。
- `../agents/kol/manifest.yaml`：KOL Agent 唯一发布包入口。
- `../experts/kol/manifest.yaml`：数字员工发布资产（API `/api/experts`，`expert:kol`）。
- `../workflows/`、`../policies/`、`../schemas/`、`../evals/`：运行契约、写入闸门、输入输出 schema 和评价样例。
- `../specs/traceability.json`、`../specs/ux-traceability.json`：FS/BR/TEST/EVAL 与 UX/测试/E2E 追踪。
- `../backend/scripts/validate-contracts.mjs`：唯一契约校验入口；同时校验 UX 追踪，不另建编译器。
- `../backend/scripts/validate-tb-binding.mjs`：TB 本地字典、远端品牌字典和邮箱品牌列表三方绑定校验。
- `../backend/scripts/release-gate.mjs`、`../.github/workflows/release-gate.yml`：本地和 CI 的统一发布门禁。

`docs/evidence-*` 已全部删除（ADR-025）。历史快照只在 git。
