# 灵工数字员工中台文档体系

本文件是项目规范的唯一使用入口。不要从文件编号顺序开始全量阅读；先确定任务类型，再按下列流程加载最少的权威上下文。

## 最终使用方法

### UI 设计或前端实现

```text
CONSTITUTION.md
→ 对应 FS / UX-KOL 验收条目
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

只有需要回答“为什么这样设计”时才读取 `DECISIONS.md`、证据文档或 `references/`。它们不能覆盖现行契约。

### 文档裁决

| 问题 | 读取并服从 |
|---|---|
| 安全、权限、数据事实 | FS、Policy、数据契约 |
| 产品闭环与表面职责 | `CONSTITUTION.md` |
| 可执行交互与发布验收 | `specs/UX-KOL.md`、追踪矩阵 |
| 全局视觉与组件 | `design-system/kol-workbench/MASTER.md` |
| 单页布局与状态 | 对应 `pages/*.md` |

详细按需路由见 `CONTEXT-MANIFEST.md`。给 Codex 下达任务时，可以直接要求：“先按 `docs/README.md` 判断任务类型并加载所需规范，再实施和验证。”

`references/` 只用于研究和追溯，默认不进入实现上下文。

## 现行主线阅读顺序

1. `00-platform-charter.md`：愿景、不变量和共创角色
2. `01-organization-tenancy.md`：公司、组织、品牌、角色和数据范围
3. `02-domain-model.md`：数字员工、Agent、Skill、Task 和 WorkItem
4. `03-prd-and-functional-spec.md`：概念、PRD、功能规格和需求追踪
5. `04-ux-ui-system.md`：双端、任务驱动、等待态、L1-L3 和无障碍；仅在交互、风险或验收任务中按需读取
6. `05-agent-workflow-skill-policy.md`：Agent、Workflow、Skill、Policy、8/15 阶段
7. `06-codex-harness.md`：Codex app-server、Host 边界和 Stub
8. `07-mcp-data-contract.md`：真实 MCP、数据字典和适配规则
9. `08-permission-approval-audit.md`：权限、审批、副作用、幂等和审计
10. `09-development-method.md`：氛围/规约/测试/评价驱动开发
11. `10-test-evaluation.md`：测试分层、评价集、红线和验收证据
12. `11-release-operations.md`：版本、灰度、回滚、监控和运营
13. `12-kol-agent.md`：KOL 试点和报价邮件闭环
14. `13-migration-roadmap.md`：Host 硬编码退场路线
15. `14-implementation-contract.md`：Markdown 到代码、Skill、知识库和前后端的落地契约
16. `15-conformance-gaps.md`：当前实现与目标规范的符合度和缺口
17. `16-production-test-plan.md`：功能、红线、真实链路和发布门禁测试
18. `17-code-conformance-scan.md`：前后端代码违宪扫描报告
19. `18-mcp-master-data-assessment.md`：MCP 主数据能力与组织主数据边界
20. `employee-surface-contracts.md`：员工核心工作表面与支撑能力面的详细契约；`19-ui-ux-constitution.md` 只保留历史链接兼容
21. `20-visual-design-system.md`：旧视觉方案与 token 迁移依据；现行视觉入口为 `design-system/kol-workbench/MASTER.md`
22. `21-admin-employee-page-roles.md`：管理端 ↔ 员工端边界（连接器治理 vs 员工使用、员工 `/kb` vs 管理知识治理、`/admin/agents` vs 员工专家中心）
23. `90-codebase-handbook.md`：代码地图和修改归属

## 事实来源

- `starry-kol-mcp-server.md`：Starry KOL MCP 的物理工具目录
- `median_mcp_server.md`：MediaCrawler MCP 的物理工具和异步作业
- `DATA_DICTIONARY.md`：真实字典、阶段和风险配置
- `codex/`：Codex app-server 版本对应的协议 schema

这些文件描述外部事实，不负责业务编排。若物理接口与业务文档冲突，先记录接口漂移，再由适配层处理，禁止在 Skill 或前端偷偷复制一套映射。

## 模板与决策

- `SPEC-TEMPLATE.md`：功能规格模板。
- `EVAL-TEMPLATE.md`：Agent 评价样例模板。
- `DECISIONS.md`：跨文档架构决策记录（近期：ADR-018 Home 内四模式；ADR-019 AI发现条件区；ADR-020 工作台正文 16px；ADR-021 员工 `/kb` 知识库立法；ADR-022 MediaCrawler → Starry 跟进桥）。

历史重复规范已删除；追溯使用 Git 历史。业务规则只在功能规格/Skill/Workflow/Policy 的 canonical 位置维护；物理接口只在物理资料维护；平台硬规则只在 Host/内核契约维护。任何冲突必须写决策记录并更新追踪矩阵。

## 可执行资产与证据入口

- `../config/org-registry.yaml`、`../config/brand-registry.yaml`：公司、组织、品牌、区域和 PEP 范围事实。
- `../agents/kol/manifest.yaml`：KOL Agent 唯一发布包入口。
- `../experts/kol/manifest.yaml`：数字员工发布资产（API `/api/experts`，`expert:kol`）；员工字段锁定见 `evidence-expert-manifest-2026-09-14.md`。
- `../workflows/`、`../policies/`、`../schemas/`、`../evals/`：运行契约、写入闸门、输入输出 schema 和评价样例。
- `../specs/traceability.json`、`../specs/ux-traceability.json`：FS/BR/TEST/EVAL 与 UX/测试/E2E 追踪。
- `../backend/scripts/validate-contracts.mjs`：唯一契约校验入口；同时校验 UX 追踪，不另建编译器。
- `../backend/scripts/validate-tb-binding.mjs`：TB 本地字典、远端品牌字典和邮箱品牌列表三方绑定校验。
- `../backend/scripts/release-gate.mjs`、`../.github/workflows/release-gate.yml`：本地和 CI 的统一发布门禁。
- `evidence-kol-stage-write-2026-09-12.md`：阶段写入与邮件发送分离的真实验证证据。
- `evidence-release-gate-2026-09-13.md`：`main` @ `9f9c5a8` stub production `release:gate` PASS（TB 豁免；非生产上线）。
- `evidence-kb-acceptance-2026-09-13.md`：`/kb` 验收 FAIL（邮件模板资产中心可试点；企业 KB / Agent RAG / 生产资格不通过）。
- `evidence-e2e-stub-pipeline-pr24-2026-09-13.md`：PR #24 Pipeline 生命周期清理后 stub E2E 3/3 PASS（`cd6ab81c9194a9ed3cc00aa9d0dbf648c3ba634b`；非 LIVE）。
- `evidence-mail-digest-analysis-plan-2026-09-13.md`：邮件往来摘要 sticky fail / 可观测性只读审查；产品只批准冷却恢复与失败字段。后续小修：Codex digest 不传 `gpt-5.6-luna`；Luna digest 需要 `OPENAI_BASE_URL`。
- `evidence-followed-kol-card-acceptance-2026-09-13.md`：首页「我跟进的红人」卡——改版前 FAIL 基线；PR #31 已在 Home 落地工作卡；residual 补齐 mailbox / 状态带 / 首页标签 / Journey copy。契约见 `../specs/UX-FOLLOWED-KOL-CARD.md`。未写入 `ux-traceability.json` 前仍不能当体验验收通过。
- `evidence-expert-manifest-2026-09-14.md`：首版 `/api/experts` 落实 ADR-016；仅已发布岗位专家；召唤只绑定会话。
- `evidence-adr022-p0-follow-import-stub-2026-09-14.md`：ADR-022 P0 stub PASS——单个加入跟进确认后单行 `importKolProfilesFromCrawler`，成功才回填真实 `kolUid`；非 LIVE。
- `evidence-adr022-p1-batch-follow-stub-2026-09-14.md`：ADR-022 P1 stub——勾选批量 / 条件批量加入跟进（粉丝 / 近10均播 / 评分 / 计划平台地区），部分成功不整批标已跟进；非 LIVE。
