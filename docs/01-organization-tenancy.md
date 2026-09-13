# 组织、租户与数据范围

## 层级

```text
Platform
└── Company / Tenant
    ├── OrganizationUnit（人员与职责归属树）
    │   └── OrganizationMembership → User
    ├── Brand（业务经营维度）
    │   └── BrandScope / RegionScope
    ├── ResponsibilityAssignment（业务负责人/品牌负责人/审批人）
    ├── DigitalEmployee / Agent
    └── Task / WorkItem
```

人员不是组织树节点。`User` 通过 `CompanyMembership` 隶属于公司，再通过 `OrganizationMembership` 归属主组织和协作组织；公司级管理员、审计员或共享服务人员可以没有普通部门归属，但必须有明确的公司级数据范围。跨部门人员通过成员关系表达，不复制用户记录。安培时代当前组织政策已确认：部门负责人自动拥有本公司全部品牌、全部区域和普通业务数据读写范围；高风险副作用仍必须经过 Host Gateway、确认和审批。

## Canonical 标识与 KOL 试点注册表

以下标识是规范 ID，不是前端展示名称。真实公司 ID、用户 ID 和部门成员由组织系统绑定；在组织系统尚未接入前，必须用外部引用表，不得把姓名直接当主键。

```yaml
tenant: company:amperetime
organization_units:
  - id: org:brand_user_growth_center
    type: center
    parent: company:amperetime
  - id: org:brand_project_group
    display_name: 品牌项目组
    type: project_group
    parent: org:brand_user_growth_center
  - id: org:market_department
    display_name: 市场部
    type: department
    parent: org:brand_user_growth_center
  - id: org:promotion_department
    display_name: 推广部
    type: department
    parent: org:brand_user_growth_center
  - id: org:lt_team
    type: team
    parent: org:promotion_department
    brand_scope: [brand:lt]
  - id: org:pq_ro_tb_team
    type: team
    parent: org:promotion_department
    brand_scope: [brand:pq, brand:ro, brand:tb]
brands: [brand:lt, brand:pq, brand:ro, brand:tb]
regions: [region:eu, region:us, region:ca_au]
responsibilities:
  - id: resp:kol_business_owner
    domain: kol
    principal_ref: user:<liu_min>
    org_unit: org:promotion_department
    decision_rights: [business_goal, workflow, acceptance, escalation]
```

`company:amperetime`、`user:liu_min` 是当前试点的 canonical 引用；张慧玲的正式外部 user_ref、双方邮箱、工号、任职时间以及普通成员的品牌/区域明细仍记录在非阻断待办中。张慧玲、刘敏的部门负责人关系以已确认组织证据和 registry 绑定为准，不再等待额外组织系统接入才能执行 PEP。

## 关系模型

| 关系 | 主体 | 目标 | 含义 |
|---|---|---|---|
| `company_membership` | User | Company | 用户属于哪个租户 |
| `organization_membership` | User | OrganizationUnit | 主组织/协作组织、任期和岗位 |
| `brand_scope_membership` | User/OrganizationUnit | Brand + Region | 可服务哪些品牌和区域；部门负责人按公司政策自动为全部范围 |
| `responsibility_assignment` | User/Role | Domain/Brand/Campaign | 对目标和规则负责 |
| `task_assignment` | User/Team | Task/WorkItem | 当前执行责任 |
| `approval_assignment` | User/Role | Action/Policy | 某次高风险动作的审批权 |

这些关系不能合并成 `owner_id`。一个人可以是 KOL 业务负责人、某品牌执行人和某封邮件的审批人，但三者是不同关系、不同授权和不同审计记录。

## 角色

- `platform_admin`：平台级配置和运维。
- `company_admin`：公司组织、资产、连接器和 Agent 发布。
- `department_admin`：部门范围内的 Agent、知识、审批和任务配置。
- `agent_operator`：运行和接管指定 Agent 任务。
- `employee`：使用已发布 Agent、补充信息和确认高风险动作。
- `auditor`：只读审计和运行记录。

角色不是数据范围。安培时代的部门负责人是已确认的范围授予关系，但不等同于平台管理员；普通数据读写可覆盖公司全部品牌和区域，高风险动作仍检查角色、公司、对象、确认和 Gateway 闸门。

## KOL 归属

KOL 是跨租户的外部画像；价格、阶段、邮箱、合同、负责人和 ROI 不应挂在全局 KOL 上，而应挂在合作关系上：

```text
Company + Brand + Campaign + KOL = Collaboration
```

同一 KOL 可与多个公司、品牌或活动存在多条独立 Collaboration。所有读写必须带 `company_id`、`organization_scope`、`brand_id` 和必要的 `region_id`。

## Agent 数据范围

每个 Agent 发布版本必须声明：可用公司、组织、品牌、区域、知识库、对象类型、可用工具和可见字段。Codex Turn 的 CONTEXT 必须包含这些范围，不能让模型自行推断。部门负责人还必须携带公司级 `all` 品牌/区域范围和普通数据 `read/write` 策略。未注册的组织、品牌或关系不能出现在 Agent 包中。

## KOL 试点唯一映射

KOL Agent 的组织映射只能写成：

```yaml
agent: agent:kol
business_domain: kol
business_owner_ref: resp:kol_business_owner
execution_org_units: [org:lt_team, org:pq_ro_tb_team]
brand_scope: [brand:lt, brand:pq, brand:ro, brand:tb]
region_scope: [region:eu, region:us, region:ca_au]
```

`12-kol-agent.md` 只描述业务流程和能力，不得再次定义组织层级、人员归属或品牌主数据。
