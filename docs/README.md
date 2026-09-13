# 灵工数字员工中台文档体系

本目录只有一条现行规范主线。阅读顺序从宪法、组织与领域，到功能规格、体验、Agent 契约、执行内核、测试和运营；新增 Agent 默认不新增一套调度器或业务规范。

## 现行主线阅读顺序

1. `00-platform-charter.md`：愿景、不变量和共创角色
2. `01-organization-tenancy.md`：公司、组织、品牌、角色和数据范围
3. `02-domain-model.md`：数字员工、Agent、Skill、Task 和 WorkItem
4. `03-prd-and-functional-spec.md`：概念、PRD、功能规格和需求追踪
5. `04-ux-ui-system.md`：双端、任务驱动、等待态、L1-L3 和无障碍；产品级体验宪法见 `19-ui-ux-constitution.md`；工作台视觉/token 默认见 `20-visual-design-system.md`
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
20. `19-ui-ux-constitution.md`：员工端体验宪法（核心闭环、四页分工、Agent 表面、结果优先）
21. `20-visual-design-system.md`：KOL-UI 工作台视觉/token 默认（Linear 密度、shadcn 基底、indigo 主色）
22. `90-codebase-handbook.md`：代码地图和修改归属

## 事实来源

- `starry-kol-mcp-server.md`：Starry KOL MCP 的物理工具目录
- `median_mcp_server.md`：MediaCrawler MCP 的物理工具和异步作业
- `DATA_DICTIONARY.md`：真实字典、阶段和风险配置
- `codex/`：Codex app-server 版本对应的协议 schema

这些文件描述外部事实，不负责业务编排。若物理接口与业务文档冲突，先记录接口漂移，再由适配层处理，禁止在 Skill 或前端偷偷复制一套映射。

## 模板与决策

- `SPEC-TEMPLATE.md`：功能规格模板。
- `EVAL-TEMPLATE.md`：Agent 评价样例模板。
- `DECISIONS.md`：跨文档架构决策记录。

历史重复规范已删除；追溯使用 Git 历史。业务规则只在功能规格/Skill/Workflow/Policy 的 canonical 位置维护；物理接口只在物理资料维护；平台硬规则只在 Host/内核契约维护。任何冲突必须写决策记录并更新追踪矩阵。

## 可执行资产与证据入口

- `../config/org-registry.yaml`、`../config/brand-registry.yaml`：公司、组织、品牌、区域和 PEP 范围事实。
- `../agents/kol/manifest.yaml`：KOL Agent 唯一发布包入口；当前明确为未发布，员工提交被阻断。
- `../workflows/`、`../policies/`、`../schemas/`、`../evals/`：运行契约、写入闸门、输入输出 schema 和评价样例。
- `../specs/traceability.json`、`../specs/ux-traceability.json`：FS/BR/TEST/EVAL 与 UX/测试/E2E 追踪。
- `../backend/scripts/validate-contracts.mjs`：唯一契约校验入口；同时校验 UX 追踪，不另建编译器。
- `../backend/scripts/validate-tb-binding.mjs`：TB 本地字典、远端品牌字典和邮箱品牌列表三方绑定校验。
- `../backend/scripts/release-gate.mjs`、`../.github/workflows/release-gate.yml`：本地和 CI 的统一发布门禁。
- `evidence-kol-stage-write-2026-09-12.md`：阶段写入与邮件发送分离的真实验证证据。
- `evidence-release-gate-2026-09-13.md`：`main` @ `9f9c5a8` stub production `release:gate` PASS（TB 豁免；非生产上线）。
- `evidence-kb-acceptance-2026-09-13.md`：`/kb` 验收 FAIL（邮件模板资产中心可试点；企业 KB / Agent RAG / 生产资格不通过）。
