# 业务对象与关系

> **定位：实施细则。** 本文件收敛核心对象与关系、Agent 包、数据字典与枚举，落实 PRODUCT 与 BUSINESS，不建立额外法律层级。
>
> 产品是智能体中台。本文件的对象层（DigitalEmployee / Agent / Skill / Task）是平台模型；`expert:kol` 只是首个已发布岗位专家，不是产品壳。能力范围见 [PRODUCT.md](PRODUCT.md) PROD-PLAT-02，信息架构见 [ia-information-architecture.md](ia-information-architecture.md)。
>
> 谁可以转哪一阶段见 E；交互原则见 G；物理 request 形状见 K。本文件不定义那些。

---

## 核心对象与关系

- `DigitalEmployee`：岗位身份、目标、知识范围、权限和可用 Agent。员工端文案是「数字员工」/「岗位专家」。首版机器可读发布资产是 `ExpertManifest`（API `/api/experts`，`expert:kol`）；不要把岗位对象塞进 Agent `employee_views.entries[].skillId`，也不要用 `/profiles` + `/skills` + `/connectors` 拼员工专家页。无专家团 API。
- `Agent`：面向一个业务目标的可发布能力组合。
- `Workflow`：多个 Skill、人工决策和外部动作组成的业务流程。
- `Skill`：一个可复用业务意图的输入、输出和禁止事项契约。
- `Task`：用户或系统提出的业务目标。
- `WorkItem`：Task 中可追踪、可暂停、可重试的工作项。
- `Artifact`：草稿、报告、建议、回执、计划等结构化产物。
- `Policy`：权限、风险、审批、重试和数据范围规则。

Agent 不拥有独立运行时。所有 Agent 共用同一个平台内核和 Codex harness，只通过配置改变能力、数据范围和策略。

### Expert / DigitalEmployee 发布资产

`experts/<id>/manifest.yaml` 是首版岗位专家发布包（当前仅 `expert:kol`）。员工端字段锁定为：`id` / `version` / `status` / `display_name` / `profession` / `description` / `avatar` / `category` / `tags` / `mission` / `quick_prompts` / `entry_skill`。`agents/<id>/manifest.yaml` 仍是 Agent 发布包（内部依赖，由后端解析）。`POST /api/experts/:id/summon` 只创建绑定会话并持久化 `expert_id` + `expert_version`，返回 `{ session_id, expert_id, expert_version, intro }`；不发信、不写阶段、不自动做高风险动作。无专家团 API。本阶段不做组织/部门/品牌授权、审批模型或专家团队成员。员工专家中心不拥有并列能力面。

安培时代已确认部门负责人公司级范围：`张慧玲`（品牌与用户增长中心）和 `刘敏`（推广部）自动获得全部品牌、全部区域和普通业务数据 `read/write`；发送、阶段变更、导入、解密等高风险动作仍由 Host Gateway 和确认/审批控制。

### Skill 最低契约

每个 Skill 必须声明：`id`、`version`、`description`、`profile`、`output`、`mcp`、`required_inputs`、`permissions`、`actions`、`risk_level`、`approval_policy`、`in_market`、`scope_inputs` 和 `output_schema`。正文必须说明示例输入、禁止事项、是否产生副作用和失败后的下一步。`scope_inputs` 必须引用 [`org-permissions.md`](org-permissions.md) 的公司/组织/品牌/区域范围，不得写自由文本名称。

---

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

发布校验必须拒绝未注册的组织、品牌或关系（见 [`org-permissions.md`](org-permissions.md)）。

---

## 数据字典与枚举

本文档汇总 email-agent 模块使用的枚举与下拉选项，来源：**test-mysql `data_dictionary` 实查** + **代码/SQL 定义** + **配置表**。

> 核实时间：2026-08-27  
> 统一查询接口：`GET /api/kol/dictionaries/options?parentKey={parentKey}`（需登录）

### 1. 通用字典接口

#### 1.1 请求

```http
GET /api/kol/dictionaries/options?parentKey={parentKey}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| parentKey | string | 是 | 父节点编码，最长 100 字符 |

#### 1.2 响应字段

| 字段 | 类型 | 说明 |
|------|------|------|
| parentKey | string | 父节点编码 |
| dictionaryKey | string | **存库/提交值** |
| dictionaryValue | string | **前端展示文案** |
| sort | integer | 排序，越小越靠前 |
| application | string | 所属应用 |
| scene | string \| null | 业务场景 |

#### 1.3 代码入口

| 类型 | 路径 |
|------|------|
| Controller | `src/main/java/com/starry/emailagent/controller/DictionaryController.java` |
| Service | `src/main/java/com/starry/emailagent/service/DictionaryService.java` |
| 初始化 SQL | `src/main/resources/db/email-agent-prod-init.sql`（1292 行起） |
| OpenAPI | `apifox/email-agent-openapi.yaml` → `/api/kol/dictionaries/options` |

### 2. `data_dictionary` 枚举项

#### 2.1 `kol_primary_platform` — 网红主平台

- **用途**：画像 `platformCode`、导入模板主平台列
- **代码**：`KolProfileService.PRIMARY_PLATFORM_DICTIONARY_PARENT_KEY`
- **查询**：`GET /api/kol/dictionaries/options?parentKey=kol_primary_platform`

| dictionaryKey | dictionaryValue | sort (test) | 映射字段 |
|---------------|-----------------|-------------|----------|
| YOUTUBE | YouTube | 10 | `platformCode` |
| INSTAGRAM | Instagram | 20 | |
| TIKTOK | TikTok | 30 | |
| FACEBOOK | Facebook | 40 | |
| OTHER | 其他 | 50 | |

#### 2.2 `kol_email_ai_language` — 商务语言 / AI 改写语言

- **用途**：画像 `businessLanguage`、Chat 助手语言
- **代码**：`KolProfileService.BUSINESS_LANGUAGE_DICTIONARY_PARENT_KEY`、`KolEmailAssistantService.AI_LANGUAGE_PARENT_KEY`
- **查询**：`GET /api/kol/dictionaries/options?parentKey=kol_email_ai_language`

| dictionaryKey | dictionaryValue | sort |
|---------------|-----------------|------|
| EN_US | English · 英语 | 10 |
| DE_DE | Deutsch · 德语 | 20 |
| FR_FR | Français · 法语 | 30 |
| ES_ES | Español · 西班牙语 | 40 |
| IT_IT | Italiano · 意大利语 | 50 |
| JA_JP | 日本語 · 日语 | 60 |

#### 2.3 `kol_email_ai_adjust_type` — Chat 助手 AI 改写类型

- **用途**：邮件助手 AI 调教/改写
- **代码**：`KolEmailAssistantService.AI_ADJUST_TYPE_PARENT_KEY`
- **查询**：`GET /api/kol/dictionaries/options?parentKey=kol_email_ai_adjust_type`
- **初始化 SQL**：`src/main/resources/db/kol_email_ai_dictionary.sql`

| dictionaryKey | dictionaryValue | sort |
|---------------|-----------------|------|
| SOFT_TONE | 邀和版 | 10 |
| CONCISE | 简洁版 | 20 |
| FORMAL_BUSINESS | 正式商务版 | 30 |
| RISK_CHECK | 检查风险 | 40 |

#### 2.4 `mailbox_brand_affiliation` — 邮箱品牌归属

- **用途**：邮箱权限 `brandCode`
- **代码**：`MailboxPermissionService.BRAND_DICTIONARY_PARENT_KEY`
- **查询**：`GET /api/kol/dictionaries/options?parentKey=mailbox_brand_affiliation`
- **初始化 SQL**：`src/main/resources/db/mailbox_brand_affiliation_dictionary.sql`

| dictionaryKey | dictionaryValue | sort |
|---------------|-----------------|------|
| LT | LT品牌 | 10 |
| RO | RO品牌 | 20 |
| PQ | PQ品牌 | 30 |

#### 2.5 `mailbox_responsible_status` — 邮箱负责人状态

- **用途**：邮箱列表/编辑 `responsibleStatus`
- **查询**：`GET /api/kol/dictionaries/options?parentKey=mailbox_responsible_status`
- **初始化 SQL**：`src/main/resources/db/mailbox_responsible_status_dictionary.sql`
- **注意**：API 字段 `responsibleStatus` 为 **整数**，与字典 `sort` 一致（1/2/3）

| dictionaryKey | dictionaryValue | sort | responsibleStatus |
|---------------|-----------------|------|-------------------|
| ACTIVE | 在职 | 1 | 1 |
| TRANSFERRED | 已移交 | 2 | 2 |
| DISABLED | 停用 | 3 | 3 |

> **test-mysql 现状（2026-08-27）**：仅有 ACTIVE、TRANSFERRED，**缺少 DISABLED**。生产/SQL 脚本为完整 3 项。

#### 2.6 `kol_crawler_sync_status` — 爬虫拉取状态

- **用途**：画像爬虫同步状态、导入模板
- **代码**：`KolProfileService`（`FETCHING` / `FETCH_DONE` / `PENDING_SUPPLEMENT`）
- **查询**：`GET /api/kol/dictionaries/options?parentKey=kol_crawler_sync_status`

| dictionaryKey | dictionaryValue | sort (代码/SQL) | 导入中文别名 |
|---------------|-----------------|-----------------|--------------|
| FETCHING | 获取中 | 1 | 获取中 |
| FETCH_DONE | 获取完成 | 2 | 获取完成 |
| PENDING_SUPPLEMENT | 待补充 | 3 | 待补充 |

> **test-mysql 现状（2026-08-27）**：仅有 FETCHING、FETCH_DONE（sort 10/20），**缺少 PENDING_SUPPLEMENT**。

### 3. 配置表枚举（非 `data_dictionary`）

以下枚举存储在独立配置表，**不走** `/api/kol/dictionaries/options`。

#### 3.1 合作阶段 — `kol_cooperation_stage_config`

- **接口**：`GET /api/v1/kol/config/cooperation-stages/options`
- **用途**：画像 `currentStageCode`、生命周期看板、会话阶段筛选
- **SQL**：`src/main/resources/db/kol_stage_risk_config.sql`

| stage_code | stage_name | stage_order |
|------------|------------|-------------|
| INITIAL_CONTACT | 初步接触 | 1 |
| INTEREST_CONFIRMED | 已回复-有兴趣 | 2 |
| COOPERATION_EVALUATION | 合作评估 | 3 |
| QUOTE_PENDING | 报价待确认 | 4 |
| BUSINESS_NEGOTIATION | 商务谈判 | 5 |
| PLAN_PENDING | 方案待确认 | 6 |
| CONTRACT_SIGNING | 合同签署 | 7 |
| SAMPLE_PENDING | 待寄样 | 8 |
| SHIPPED | 已发货 | 9 |
| DELIVERED_TESTING | 已签收-测试中 | 10 |
| CONTENT_PLANNING | 内容策划 | 11 |
| CONTENT_REVIEW | 内容审核 | 12 |
| PENDING_PUBLISH | 待发布 | 13 |
| PUBLISHED | 已发布 | 14 |
| SETTLING_PAID | 结算中/已付款 | 15 |
| EXCEPTION_HANDLING | 异常处理 | 16 |

#### 3.2 风险标签 — `kol_risk_tag_config`

- **用途**：生命周期风险实例、看板筛选 `riskTagCode`
- **SQL**：`src/main/resources/db/kol_stage_risk_config.sql`

| risk_tag_code | risk_tag_name | risk_tag_type |
|---------------|---------------|---------------|
| DELAY_RISK | 延期风险 | DELAY |
| CONTENT_RISK | 内容风险 | CONTENT |
| LOST_CONTACT_RISK | 失联风险 | LOST_CONTACT |
| NO_RISK | 无风险 | NO_RISK |

### 4. 代码引用速查

| parentKey / 配置 | 主要使用位置 | 业务字段 |
|------------------|--------------|----------|
| kol_primary_platform | KolProfileService, KolEmailAssistantService | platformCode |
| kol_email_ai_language | KolProfileService, KolEmailAssistantService | businessLanguage |
| kol_email_ai_adjust_type | KolEmailAssistantService | AI 改写类型 |
| mailbox_brand_affiliation | MailboxPermissionService | brandCode |
| mailbox_responsible_status | 字典 API + MailboxPermissionService | responsibleStatus (1/2/3) |
| kol_crawler_sync_status | KolProfileService, 导入 | crawlerSyncStatus |
| kol_cooperation_stage_config | KolCooperationLifecycleService, KolProfileService | currentStageCode |
| kol_risk_tag_config | 生命周期风险服务 | riskTagCode |

### 5. 初始化脚本索引

| 内容 | SQL 路径 |
|------|----------|
| 全量生产初始化（含字典） | `src/main/resources/db/email-agent-prod-init.sql` |
| AI 调教/语言字典 | `src/main/resources/db/kol_email_ai_dictionary.sql` |
| 邮箱负责人状态 | `src/main/resources/db/mailbox_responsible_status_dictionary.sql` |
| 邮箱品牌归属 | `src/main/resources/db/mailbox_brand_affiliation_dictionary.sql` |
| 合作阶段 + 风险标签 | `src/main/resources/db/kol_stage_risk_config.sql` |

### 6. test-mysql 与代码/SQL 差异

| parentKey | test 库状态 | 代码/SQL 期望 |
|-----------|-------------|---------------|
| mailbox_responsible_status | 缺 DISABLED | ACTIVE / TRANSFERRED / DISABLED |
| kol_crawler_sync_status | 缺 PENDING_SUPPLEMENT | FETCHING / FETCH_DONE / PENDING_SUPPLEMENT |
| kol_primary_platform | key 一致，sort 为 10/20/… | prod-init sort 为 1/2/3/4/999 |

对齐 test 环境可依次执行 §5 中对应 SQL 脚本。

### 7. 相关 Markdown / OpenAPI

| 文档 | 说明 |
|------|------|
| `MAILBOX_PERMISSION_API.md` §3.9 | 通用字典接口 + mailbox_responsible_status 示例 |
| `KOL_PROFILE_API.md` §4.11 / §4.11.1 | 主平台、商务语言字典 |
| `KOL_PROFILE_IMPORT_API.md` | 导入字段与字典映射 |
| `apifox/email-agent-openapi.yaml` | OpenAPI 契约（含 DictionaryOptionResponse） |

### 8. 前端对接约定

1. **下拉选项**：调用 `/api/kol/dictionaries/options`，展示 `dictionaryValue`，提交 `dictionaryKey`。
2. **合作阶段**：调用 `/api/v1/kol/config/cooperation-stages/options`，提交 `stage_code`。
3. **负责人状态**：可复用字典，也可直接使用整数 `responsibleStatus`（1=在职，2=已移交，3=停用）。
4. **导入模板**：主平台、商务语言、爬虫状态支持字典 key 或中文文案（见 `KOL_PROFILE_IMPORT_API.md`）。
