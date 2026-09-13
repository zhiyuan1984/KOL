# 文档到实现的落地契约

本文件回答“Markdown 如何指导代码、Skill、知识库、前端和后端”。Markdown 不是代码本身；只有能被校验、生成、测试或追踪的内容才算实现契约。

## 文档类型与落点

| 主线文档 | 必须落到的实现资产 | 责任人 |
|---|---|---|
| `00-platform-charter` | 评审门禁、角色签署、CI 发布规则 | 产品/工程/测试/SRE |
| `01-organization-tenancy` | 组织主数据、关系表、权限上下文、Admin API | 后端/安全 |
| `02-domain-model` | 领域 schema、实体迁移、Agent manifest | 后端/产品 |
| `03-prd-and-functional-spec` | `specs/FS-*.md`、用户故事、API/事件契约、验收测试 | 产品/测试 |
| `04-ux-ui-system` | 前端页面、组件、状态机映射、无障碍测试 | 前端/UED |
| `05-agent-workflow-skill-policy` | `agents/*.yaml`、`workflows/*.yaml`、`skills/*/SKILL.md`、`policies/*.yaml` | 产品/业务/工程 |
| `06-codex-harness` | app-server adapter、Thread/Turn runner、Item 校验、Host 闸门 | 后端 |
| `07-mcp-data-contract` | MCP catalog、adapter、请求/响应 schema、契约测试 | 后端/接口负责人 |
| `08-permission-approval-audit` | PEP、审批服务、Gateway、幂等、审计表和脱敏策略 | 后端/安全 |
| `09-development-method` | Codex 任务模板、PR 检查、决策记录 | 全员 |
| `10-test-evaluation` | 单测/集成/E2E、`evals/*.jsonl`、评分器和红线流水线 | 测试/评价 |
| `11-release-operations` | CI/CD、配置锁定、灰度、监控、告警和回滚脚本 | SRE |
| `12-kol-agent` | KOL Agent manifest、Skill、Workflow、知识库和业务评价集 | 刘敏/产品/运营 |
| `13-migration-roadmap` | 可执行迁移任务、删除清单和完成证据 | 工程/产品 |

## 必备机器可读资产

```text
config/org-registry.yaml
config/brand-registry.yaml
agents/<agent-id>/manifest.yaml
agents/<agent-id>/workflows/<workflow-id>.yaml
agents/<agent-id>/skills/<skill-id>/SKILL.md
agents/<agent-id>/policies/<policy-id>.yaml
schemas/<entity-or-output>.schema.json
evals/<agent-id>/<scenario>.jsonl
knowledge/<domain>/manifest.yaml
```

若仓库还没有这些目录，必须先创建骨架；不能只凭本文件中的 YAML 示例运行生产系统。

## Agent 发布包最低结构

```yaml
id: agent:kol
version: 1.0.0
owner_ref: resp:kol_business_owner
organization_scope: [org:lt_team, org:pq_ro_tb_team]
brand_scope: [brand:lt, brand:pq, brand:ro, brand:tb]
region_scope: [region:eu, region:us, region:ca_au]
skills: [creator_discovery, email_compose, reply_analysis, confirm_stage]
workflows: [creator_to_outreach, email_follow_up, campaign_delivery]
policies: [send_email, change_stage, import_creator]
mcp_servers: [starry_kol, mediacrawler]
knowledge_manifest: knowledge/kol/manifest.yaml
```

发布校验必须拒绝：未注册的组织/品牌/区域、缺少 Skill schema、MCP 工具未列白名单、Policy 没有副作用规则、没有评价集或没有回滚方案。

## 前后端契约

后端负责返回 `Task`、`WorkItem`、`Artifact`、`ApprovalRequest`、`AuditEvent` 的版本化 schema 和事件流；前端只根据状态和 schema 渲染，不重新判断权限、阶段、金额或副作用。员工端消费业务字段，管理端消费执行 Trace；同一 WorkItem 必须能用 `task_id`、`thread_id`、`turn_id`、`skill_version` 和 `policy_version` 追溯。

组织范围契约还必须输出 `department_head_scope_policy`。安培时代部门负责人拥有全部品牌、区域和普通数据 `read/write`；`send_email`、`change_stage`、`import_creator`、`decrypt_contact` 等高风险动作仍必须输出确认/审批状态并由 Host Gateway 提交。

## 知识库契约

知识条目必须带 `tenant_id`、`organization_scope`、`brand_scope`、`region_scope`、`effective_from/to`、来源、版本和敏感级别。检索结果必须返回来源和范围；知识只能补充事实、模板和制度，不能覆盖 Host 状态机、权限、审批或接口 schema。

## 可执行性判定

一份功能规格只有同时具备以下内容才算“可开发”：

1. 唯一业务 ID、参与者、组织/品牌/区域范围；
2. 输入、输出 schema 和状态转移；
3. Skill、Workflow、Policy、MCP 的明确引用；
4. 后端 API/事件、前端状态和管理端 Trace 定义；
5. Given/When/Then、单测/集成测试和 Agent 评价样例；
6. 权限、审批、审计、幂等、超时、重试和人工接管；
7. 发布、监控、灰度和回滚证据。

缺少任一项只能作为讨论稿，不能指导 Codex 编码或生产配置。
