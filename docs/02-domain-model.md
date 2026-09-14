# 数字员工与领域模型

## 核心对象

- `DigitalEmployee`：岗位身份、目标、知识范围、权限和可用 Agent。机器可读发布资产是 `ExpertManifest`（API / 路径命名 `expert` / `expert:kol`）；不要把岗位对象塞进 Agent `employee_views.entries[].skillId`。
- `Agent`：面向一个业务目标的可发布能力组合。
- `Workflow`：多个 Skill、人工决策和外部动作组成的业务流程。
- `Skill`：一个可复用业务意图的输入、输出和禁止事项契约。
- `Task`：用户或系统提出的业务目标。
- `WorkItem`：Task 中可追踪、可暂停、可重试的工作项。
- `Artifact`：草稿、报告、建议、回执、计划等结构化产物。
- `Policy`：权限、风险、审批、重试和数据范围规则。

## Agent 包

```yaml
id: kol_agent
version: 1.0.0
business_domain: kol
business_owner_ref: resp:kol_business_owner
execution_org_units: [org:lt_team, org:pq_ro_tb_team]
brand_scope: [brand:lt, brand:pq, brand:ro, brand:tb]
region_scope: [region:eu, region:us, region:ca_au]
skills: [creator_discovery, email_compose, reply_analysis, confirm_stage]
workflows: [creator_to_outreach, email_follow_up, campaign_delivery]
mcp_servers: [starry_kol, mediacrawler]
policies: [send_email, change_stage, import_creator]
```

Agent 不拥有独立运行时。所有 Agent 共用同一个平台内核和 Codex harness，只通过配置改变能力、数据范围和策略。

## Expert / DigitalEmployee 发布资产

`experts/<id>/manifest.yaml` 是 DigitalEmployee 的发布包（当前仅 `expert:kol`）。它声明岗位身份、目标、只读权限引用和 `available_agents`（如 `agent:kol`）。`agents/<id>/manifest.yaml` 仍是 Agent 发布包。召唤 `POST /api/experts/:id/summon` 只创建绑定会话，不发信、不写阶段。知识范围、LIVE 健康、运行投影等尚未落地的字段见 manifest `missing_fields`，API 不伪造。

安培时代已确认部门负责人公司级范围：`张慧玲`（品牌与用户增长中心）和 `刘敏`（推广部）自动获得全部品牌、全部区域和普通业务数据 `read/write`；发送、阶段变更、导入、解密等高风险动作仍由 Host Gateway 和确认/审批控制。

## Skill 最低契约

每个 Skill 必须声明：`id`、`version`、`description`、`profile`、`output`、`mcp`、`required_inputs`、`permissions`、`actions`、`risk_level`、`approval_policy`、`in_market`、`scope_inputs` 和 `output_schema`。正文必须说明示例输入、禁止事项、是否产生副作用和失败后的下一步。`scope_inputs` 必须引用 `01-organization-tenancy.md` 的公司/组织/品牌/区域范围，不得写自由文本名称。
