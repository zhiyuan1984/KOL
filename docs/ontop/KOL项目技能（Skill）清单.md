# KOL 项目技能（Skill）清单

> **2026-10-03 口径更新：** 下文关于「人员授权只对技能」的 2026-10-01 快照已被 [ADR-2026-10-03](../DECISIONS.md) 取代；人员使用资格现由 Agent 绑定决定，技能仍为 Agent 可复用能力，MCP/API/知识库由技能调用。本清单不代表迁移已实施。

> 整理时间：2026-10-01
> 承接：[《Skill-定义与分层关系》](Skill-定义与分层关系.md)（Skill 口径）与[《概念落地对照表-总表》](概念落地对照表-总表.md)（载体）。对象、属性、关系、事件、规则、动作与智能体清单见本目录同系列文件（[《智能体（Agent）清单与定义》](智能体-清单与定义.md)、[《KOL业务对象-动作（Action）清单》](KOL业务对象-动作（Action）清单.md) 等）；本清单补上「Skill 层」的完整盘点。
> 对照来源：[CONSTITUTION.md](../CONSTITUTION.md)（v2.1）、[PRODUCT.md](../PRODUCT.md)、[BUSINESS.md](../BUSINESS.md)、[TECHNOLOGY.md](../TECHNOLOGY.md)、[domain-objects.md](../domain-objects.md)（Skill 最低契约）、[07-mcp-data-contract.md](../07-mcp-data-contract.md)、[org-permissions.md](../org-permissions.md)、[ia-information-architecture.md](../ia-information-architecture.md)、[skill-runtime-operations.md](../skill-runtime-operations.md)（实施说明，非规范正文）。
> **定位声明：本文是整理与对照材料，不是规范正文，不建立法律层级（[CONST-09](../CONSTITUTION.md)）。** 与 `docs/` 正文冲突时以正文为准；实现资产只作证据（[CONST-10](../CONSTITUTION.md)）；发布、授权与挂载等运行状态以运行时治理数据为准，本文不访问生产库。

**审宪记录（CONST-08）**

| 项 | 内容 |
|---|---|
| 需求 | 按《Skill-定义与分层关系》口径整理 KOL 项目技能（Skill）清单，并对照宪法、三部基本法与实施细则 |
| 主责角色 | 平台产品经理（能力资产与技能市场，PROD-PLAT-02/04/05）；KOL 业务专家（SOP 与业务入口口径，CONST-04）；智能体产品经理（Agent 交互口径）。本文由平台侧整理，只登记不裁决 |
| 宪法条款 | CONST-02（对外能力面只有技能，人员授权只对技能）、CONST-03（已发布技能组合、规则由程序执行）、CONST-05（读 / 草稿 / 正式动作分清）、CONST-06（知识与记忆）、CONST-07（两类入口）、CONST-08（本审宪）、CONST-09（层级：本文非规范正文）、CONST-10（不得伪造、缺口如实） |
| 基本法条款 | PROD-PLAT-02/04/05/06、PROD-AGENT-01/02/03/04/06/07/08/09；BIZ-02/03/04/06/08/09/10/11/12/13/14/16/17/18；TECH-ARCH-03/04、TECH-BE-01/02/07；细则：domain-objects（Skill 最低契约）、07-mcp-data-contract、org-permissions、ia-information-architecture |
| 结论与证据 | **符合**：清单与 `backend/skills/` 49 项实况逐项一致（ID 集合脚本核对，49=49）；「41 登记 + 8 待补齐」与 BUSINESS 覆盖表一致；发信 / 阶段 / 解密 / 导入等闸门与 07 文档、BIZ-14 一致；发现的字段缺口与规则空白如实登记于 §7，未新增口径 |
| 下一步 | Skill 最低契约缺口交对应实施角色核对登记；8 项入口口径交 KOL 业务专家补齐；本清单随技能增删维护（§8） |

---

## 一、口径与位置

### 1.1 Skill 定义（承接 ontop 笔记）

- **Skill 是打包好的「手艺包」**：怎么做（操作指令与流程）＋用什么工具（调用哪几个动作、按什么顺序）＋好坏样例（示例、质量标准、常见错误）。
- **Skill 被调用，不是最简单的智能体**：它不感知环境、不自主规划、不维持任务循环；是组成智能体的最小「能力原子」。
- **四组区分**：vs 动作（原子操作 vs 编排动作的 know-how）；vs 任务（要干的活 vs 干这类活的本事，匹配逻辑：任务 → 所需 skill → 装备该 skill 的 agent）；vs 本体（陈述性知识 vs 程序性知识）；vs 事件（事件是扳机，skill 是弹药）。
- 仓内三层职责口径（[知识库治理与使用设计规格](../superpowers/specs/2026-09-26-knowledge-base-skill-agent-design.md)）：**知识库＝事实素材源；Skill＝动作与规则；智能体＝组合体**——本清单按此口径盘点。

### 1.2 五层位置对照（ontop 五层 ↔ 本项目载体）

| 层 | 本项目载体 | 证据 |
|---|---|---|
| 本体层 | 对象 / 属性 / 关系 / 事件 / 规则见同系列清单；对象与字典 [domain-objects.md](../domain-objects.md)、阶段图 [stage-transitions.md](../business-rules/stage-transitions.md)；KOL 权威数据在 Starry（BIZ-02） | 同系列清单 |
| 动作层 | MCP 工具目录（Starry KOL 62 个 `@Tool`、MediaCrawler、KOL Claw）＋ Host 受控动作（网关统一提交闸门） | 07 文档；TECH-BE-02 |
| **Skill 层** | `backend/skills/`（bundled 49 份 `SKILL.md`）＋管理端发布 pack（`<data>/published-skills`，免重启生效，带 `skill_versions` 版本记录）＋技能市场（`in_market`） | `backend/src/tasks/registry.ts`、`backend/src/host/skill-publish.ts` |
| Agent 层 | Codex harness 运行体：`agent:kol`（KOL 业务，声明 14 项技能、3 个 workflows、3 项 policies）、`agent:workspace-planner`（平台侧，装备 `today_plan` / `todo_plan` / `today_analyze`，对外写入拒绝）；岗位身份 `expert:kol`、`expert:approver`、`expert:crawler`（口径与计数见[《智能体（Agent）清单与定义》](智能体-清单与定义.md)） | `agents/kol/manifest.yaml`、`agents/workspace-planner/manifest.yaml`、`experts/*/manifest.yaml` |
| 调度层 | 任务注册表 / 工单 / 待办面；自动任务与后台作业（今日规划、邮件总结 / 翻译等） | PROD-PLAT-06、PROD-AGENT-08 |

### 1.3 范围与字段口径

- **范围**：产品技能面＝`backend/skills/` 全部 49 份 `SKILL.md`。另有框架元技能 `backend/wikiskill/SKILL.md`（WikiSkill Maintainer / Proposer 说明书，不进技能市场、不被任务注册表扫描），见 §6.3。仓库根 `.agents/skills/` 等开发工具链技能不在本清单范围。
- **字段**：front-matter（`id` / `title` / `description` / `category` / `profile` / `funnel` / `mcp` / `actions` / `permissions` / `aliases` / `in_market` / `employee_visible` / `employee_quick` / `employee_agent` 等）＋正文（「是否发信 / 是否改阶段」两段必答）。工具与动作全名以各 `SKILL.md` 为准。
- **默认值**（注册表口径，`backend/src/tasks/registry.ts`）：`employee_visible` 缺省 true；`in_market` 缺省 true。
- **员工面三态口径**：**可选 / 内部**＝是否进入员工「可选技能」清单（`employee_visible`，内部技能不在该清单出现）；**已登记 / 待补齐**＝员工两段口径（`employee_quick` / `employee_agent`）是否登记；**上架 / 未上架**＝`in_market`。

## 二、清单总览

### 2.1 构成（49 = 16 + 33）

| 组 | 数量 | 说明 |
|---|---|---|
| 阶段 SOP 技能 | 16 | 15 个主阶段各 1（BIZ-08）＋ `stage_sop`（八段轨道入口）；均为版本化 SOP |
| 能力技能 | 33 | 线索 / 发现 / 画像 / 邮件 / 阶段 / 审批 / 风险 / 报表 / 后台作业等 |

漏斗分布（与员工端技能目录同一口径）：建联 19、评估报价 13、意向 6、内容 4、寄样测评 3、结算 2、异常 2。

### 2.2 通用安全口径（全量 49）

- **发信**：48 项明文「不发信」；唯一例外 `email_compose`——仅人核对完整当前快照并确认后由网关发送（预览、提交草稿、自然语言指令均不等于发送授权；Worker 不调用发送工具）。
- **阶段**：48 项明文「不改（官方 / 正式）阶段」；唯一例外 `confirm_stage`——只提案，仅人在会话确认后写入。
- **工具体系**：40 项技能声明 `mcp` 工具（9 项为 `[]`：business_approval、creator_discovery、discovery_brief、discovery_plan、mail_summary、stage_sop、today_analyze、today_plan、todo_plan）；共 32 个工具名——`starrykol.*` 23 个、`kolclaw.*` 6 个、`starry.*` 3 个（**遗留名**，无对应连接器，见 §7-3）。
- **权限声明**：`starrykol:read` 32 项、`starrykol:write` 5 项、`kolclaw:read` 4 项、`claw:write` 1 项、空 7 项。
- **受控动作（`actions`）**：16 种——`analyze` 23 项、`present_sop` 16 项；其余 14 种各 1–2 项（`update` 2 项，其余各 1 项）：`create_draft`、`propose_stage`、`create_approval`、`sync`、`update`、`claim_follow`、`compose_draft`、`confirm_send`、`confirm_stage`、`open_thread`、`release_follow`、`handoff`、`retry_sync`、`none`。`actions` 是技能产出的登记动作标识（候选或受控动作入口）；副作用一律由 Host 受控动作与 Gateway 执行，技能自身不执行副作用。

### 2.3 员工面三态

| 状态 | 数量 | 名单 / 说明 |
|---|---|---|
| 可选（`employee_visible` ≠ false） | 21 | 员工可选清单内 |
| 内部（`employee_visible` = false） | 28 | 含全部 16 项 SOP；不在员工可选清单出现（注册表注释口径） |
| 员工口径已登记（`employee_quick` + `employee_agent` 齐备） | 41 | 与 BUSINESS 覆盖表登记的 41 项一致 |
| 员工口径待补齐 | 8 | `discovery_plan`、`discovery_brief`、`kol_analyze`、`today_plan`、`today_analyze`、`todo_plan`、`mail_summary`、`mail_translate`（BUSINESS 覆盖表原文；待 KOL 业务专家补齐） |
| 未上架（`in_market` = false） | 7 | 均为内部·待补齐技能（discovery_brief、discovery_plan、mail_summary、mail_translate、today_analyze、today_plan、todo_plan）；`kol_analyze` 已上架但口径待补齐 |

## 三、阶段 SOP 技能（16）

> 对应 BIZ-08 的 15 个正式主阶段（另有异常节点，不设独立技能）与 BIZ-09 的「每阶段说明目标、前置事实、所需资料、允许动作、完成证据、风险、审批、失败处理及人工接管」。
> 统一口径：`output: task_result`、`actions: [present_sop]`、`permissions: ["starrykol:read"]`、正文「不发信 / 不改正式阶段」（只展示当前步骤、输入、证据与下一步）；`mcp` 均为 `["starry.get_collaboration"]`（`stage_sop` 为 `[]`）。员工面口径（已登记）：快捷＝已发布 SOP 的索引、适用说明；Agent＝结合当前 KOL 选择做法、分析缺口及生成行动方案走 AI 助理。

| 技能 ID | `sop_id`（＝阶段码） | 名称 | 类别 | 漏斗 | 版本 |
|---|---|---|---|---|---|
| `sop_initial_contact` | INITIAL_CONTACT | SOP · 初步接触 | 线索 | reach | 2026-09-08.1 |
| `sop_interested` | INTERESTED | SOP · 已回复-有兴趣 | 商机 | intent | 2026-09-08.1 |
| `sop_evaluating` | EVALUATING | SOP · 合作评估 | 商机 | intent | 2026-09-08.1 |
| `sop_quote_pending` | QUOTE_PENDING | SOP · 报价待确认 | 商务 | biz | 2026-09-08.1 |
| `sop_negotiating` | NEGOTIATING | SOP · 商务谈判 | 商务 | biz | 2026-09-08.1 |
| `sop_plan_pending` | PLAN_PENDING | SOP · 方案待确认 | 商务 | biz | 2026-09-08.1 |
| `sop_contracting` | CONTRACTING | SOP · 合同签署 | 商务 | biz | 2026-09-08.1 |
| `sop_sample_pending` | SAMPLE_PENDING | SOP · 待寄样 | 寄测 | sample | 2026-09-08.1 |
| `sop_shipped` | SHIPPED | SOP · 已发货 | 寄测 | sample | 2026-09-08.1 |
| `sop_testing` | TESTING | SOP · 已签收-测试中 | 寄测 | sample | 2026-09-08.1 |
| `sop_content_planning` | CONTENT_PLANNING | SOP · 内容策划 | 内容 | content | 2026-09-08.1 |
| `sop_content_review` | CONTENT_REVIEW | SOP · 内容审核 | 内容 | content | 2026-09-08.1 |
| `sop_publish_pending` | PUBLISH_PENDING | SOP · 待发布 | 内容 | content | 2026-09-08.1 |
| `sop_published` | PUBLISHED | SOP · 已发布 | 内容 | content | 2026-09-08.1 |
| `sop_settling` | SETTLING | SOP · 结算中 / 已付款 | 结算 | settle | 2026-09-08.1 |
| `stage_sop` | STAGE_SOP | 阶段 SOP | 线索 | intent | 2026-09-08.1 |

补充：`stage_sop` 是轨道总入口（别名含「八个阶段」「异常SOP」），只展示八段轨道与当前 SOP；进入 PLAN_PENDING、CONTRACTING、CONTENT_REVIEW、PUBLISH_PENDING、SETTLING 阶段的正式写入另需相应审批（BIZ-12）。

## 四、能力技能（33）

> 分组按漏斗；「员工面」三态口径见 §1.3。「总口径」：全部技能不发信、不自动改阶段（例外仅 §2.2 所列两项），副作用走 Host 受控动作与 Gateway。

### 4.1 建联（reach，18 项）

| 技能 ID | 名称 | 类别 | 用途 | 声明工具（`mcp`） | 输出／动作 | 员工面 | 条款依据 |
|---|---|---|---|---|---|---|---|
| `creator_contact_decrypt` | 解密达人联系方式 | 线索 | 按达人 UID 解密联系方式（敏感操作） | `starrykol.decryptKolContact` | `task_result`｜analyze | 可选·已登记 | BIZ-14；07（解密按 L3 / 敏感闸门） |
| `creator_daily_tasks` | 今日 KOL 任务 | 线索 | 汇总待打招呼、待跟进、待报价与谈判中达人 | `kolclaw.get_daily_tasks` | `task_result`｜analyze | 可选·已登记 | BIZ-16；PROD-AGENT-02 |
| `creator_discovery` | 达人发现 | 线索 | 搜索并筛选新的候选达人；只出采集计划，不建联 | —（权限 `claw:write`） | `crawl_plan`｜— | 可选·已登记 | BIZ-10；07（MediaCrawler 异步、单任务；采集只形成候选） |
| `creator_filter_options` | 达人筛选字典 | 线索 | 查询合作阶段、风险标签与达人相关字典选项 | `starrykol.listDictionaryOptions`、`starrykol.listCooperationStageOptions`、`starrykol.listRiskTagOptions` | `task_result`｜analyze | 内部·已登记 | BIZ-10（选项取自实际字典） |
| `creator_library_all` | 达人库全量 | 线索 | 按当前账号可见范围列出全部红人画像 | `starrykol.listAllKolProfiles` | `task_result`｜analyze | 内部·已登记 | BIZ-02、BIZ-18；TECH-BE-01 |
| `creator_library_query` | 达人库查询 | 线索 | 按关键词、合作阶段、风险标签分页查询红人库 | `starrykol.pageKolProfiles`、`starrykol.getKolProfileSidebarMetrics` | `task_result`｜analyze | 可选·已登记 | BIZ-02、BIZ-18 |
| `creator_library_sync` | 达人同步入库 | 线索 | 将候选达人幂等同步到红人库 | `starrykol.pageKolProfiles`、`starrykol.addKolProfile` | `task_result`｜sync | 可选·已登记 | BIZ-10（去重；正式导入独立确认） |
| `creator_outreach` | 达人建联话术 | 线索 | 基于达人数据生成私信和加微信话术 | `kolclaw.generate_outreach_script`、`kolclaw.list_creators` | `task_result`｜analyze | 可选·已登记 | BIZ-11（方案 / 草稿；发送独立确认） |
| `creator_owner_update` | 更新红人负责人 | 线索 | 更新红人画像上的负责人绑定 | `starrykol.getKolProfileDetail`、`starrykol.updateKolProfile` | `task_result`｜update | 可选·已登记 | BIZ-03、BIZ-07（归属） |
| `creator_profile` | 达人画像 | 线索 | 查看红人详情、平台数据和绑定的负责人 | `starrykol.pageKolProfiles`、`starrykol.getKolProfileDetail`、`starrykol.listKolPlatformData`、`starrykol.pageEmailConversations` | `task_result`｜analyze | 可选·已登记 | BIZ-02、BIZ-10 |
| `creator_scoring` | 达人评分 | 线索 | 根据影响力与合作适配度生成评分 | `kolclaw.analyze_creator`、`kolclaw.analyze_creators` | `task_result`｜analyze | 可选·已登记 | BIZ-10（注明依据、版本和不确定性） |
| `creator_status_update` | 达人状态更新 | 线索 | 更新备注、确认或跟进字段；不写官方合作阶段 | `starrykol.getKolProfileDetail`、`starrykol.updateKolProfile` | `task_result`｜update | 可选·已登记 | BIZ 覆盖表（备注 ≠ 正式阶段） |
| `discovery_brief` | 发现简报 | 线索 | 采集后按 Host 已过滤候选人写 `discovery_brief/v1`；不入库、不建联 | — | `task_result`｜— | 内部·待补齐·未上架 | BIZ-10；入口口径待业务专家补齐 |
| `discovery_plan` | 发现计划 | 线索 | 把找人的方向整理成可确认的发现计划；只写草稿，不采集 | — | `task_result`｜— | 内部·待补齐·未上架 | 同上 |
| `kol_analyze` | 红人分析简报 | 线索 | 只读分析公海或跟进红人，产出 `kol_analyze_brief` | `starrykol.pageKolProfiles`、`starrykol.getKolProfileDetail` | `kol_analyze_brief`｜claim_follow、compose_draft、confirm_send、confirm_stage、open_thread、release_follow、handoff、retry_sync、none | 可选·待补齐（已上架） | PROD-AGENT-03；入口口径待补齐 |
| `today_analyze` | 今日对象分析 | 线索 | 分析已选对象并建议下一步；不自动写状态 | — | `task_result`｜analyze | 内部·待补齐·未上架 | PROD-AGENT-08；入口口径待补齐 |
| `today_plan` | 今日规划 | 线索 | 按「今日任务」面产出 `today_brief` 与 `display_tasks`；不写正式待办 | — | `today_brief`｜analyze | 内部·待补齐·未上架 | PROD-AGENT-08、PROD-PLAT-06；入口口径待补齐 |
| `todo_plan` | 待办规划 | 线索 | 按「我的待办」面产出 `today_brief` 与 `display_tasks` | — | `today_brief`｜analyze | 内部·待补齐·未上架 | 同上 |

### 4.2 评估报价（biz，9 项）

| 技能 ID | 名称 | 类别 | 用途 | 声明工具（`mcp`） | 输出／动作 | 员工面 | 条款依据 |
|---|---|---|---|---|---|---|---|
| `business_approval` | 费用审批 | 商务 | 写明申请人、金额和币种，按公布汇率和费用档算出审批人 | — | `task_result`｜create_approval | 可选·已登记 | BIZ-14（模型不得代人批准） |
| `deal_memory` | 谈判纪要 | 谈判 | 整理谈判事实、约束和待确认事项 | `starry.deal_memory`、`starry.get_collaboration`、`starrykol.updateKolProfile` | `task_result`｜analyze | 可选·已登记 | BIZ-18；PROD-AGENT-04/05（本地记忆与远端档案分列） |
| `email_app_conversation_list` | 应用邮件会话 | 线索 | 按关键词、风险标签或达人 UID 查询应用侧邮件会话 | `starrykol.pageAppEmailConversations` | `task_result`｜analyze | 内部·已登记 | BIZ-04；PROD-AGENT-02（读敏感正文仍执行权限规则） |
| `email_compose` | 写合作邮件 | 线索 | 按正式阶段选已发布知识模板，保留人工编辑草稿；右栏独立确认后才发送 | `starry.get_collaboration`、`starrykol.pageMailboxes`、`starrykol.previewEmailDraft` | `task_result`｜create_draft | 可选·已登记 | BIZ-11；07（发送经网关）；CONST-05 |
| `email_conversation_list` | 邮件会话列表 | 线索 | 按关键词或状态分页查询邮件会话 | `starrykol.pageEmailConversations` | `task_result`｜analyze | 可选·已登记 | BIZ-04；PROD-AGENT-02 |
| `email_conversation_read` | 邮件会话详情 | 线索 | 按会话 ID 读取邮件会话正文和消息 | `starrykol.getEmailConversation` | `task_result`｜analyze | 内部·已登记 | 同上 |
| `email_mailbox_list` | 品牌邮箱列表 | 管理 | 查询品牌邮箱和 Nylas 授权状态 | `starrykol.pageMailboxes`、`starrykol.listNylasAccounts` | `task_result`｜analyze | 内部·已登记 | BIZ-04（身份与邮箱） |
| `mail_summary` | 邮件总结 | 邮件 | 后台增量补齐中文总结并写回本地记忆；不发信、不改阶段、不写远端 | — | `task_result`｜analyze | 内部·待补齐·未上架 | PROD-AGENT-07、BIZ-18；入口口径待补齐 |
| `mail_translate` | 邮件翻译 | 邮件 | 后台增量补中文译文并写回记忆；不回写 SMTP | `starrykol.translateEmailToChinese` | `task_result`｜analyze | 内部·待补齐·未上架 | 同上 |

### 4.3 意向（intent，3 项）

| 技能 ID | 名称 | 类别 | 用途 | 声明工具（`mcp`） | 输出／动作 | 员工面 | 条款依据 |
|---|---|---|---|---|---|---|---|
| `confirm_stage` | 提出阶段变更 | 商机 | 按 Starry 阶段定义提出指针变更，等人在会话里确认后再写入 | `starry.get_collaboration` | `propose_stage`｜propose_stage | 可选·已登记 | BIZ-12；07（Host 写入；跨段 / 回退 / 异常须原因） |
| `creator_lifecycle_kanban` | 合作生命周期看板 | 线索 | 按合作生命周期查看达人合作进展 | `starrykol.pageLifecycleKanban` | `task_result`｜analyze | 可选·已登记 | BIZ-08（阶段索引） |
| `reply_analysis` | 回复分析 | 商机 | 按十五阶段核对来信事实，给出指针与下一步；不改阶段、不发信 | `starrykol` ×9（pageEmailConversations、getEmailConversation、translateEmailToChinese、getStageRiskMatrix、pageLifecycleKanban、pageRiskConversations 等） | `task_result`｜analyze | 可选·已登记 | BIZ-13（证据优先；建议不改状态）；BIZ-12（人确认后才走 confirm_stage） |

### 4.4 结算（settle，1 项）

| 技能 ID | 名称 | 类别 | 用途 | 声明工具（`mcp`） | 输出／动作 | 员工面 | 条款依据 |
|---|---|---|---|---|---|---|---|
| `creator_budget_report` | KOL 预算报告 | 增长 | 查询当前或指定投放项目的达人预算报告 | `kolclaw.get_budget_report` | `task_result`｜analyze | 可选·已登记 | BIZ-17（报表口径；不执行付款或预算调整） |

### 4.5 异常（exception，2 项）

| 技能 ID | 名称 | 类别 | 用途 | 声明工具（`mcp`） | 输出／动作 | 员工面 | 条款依据 |
|---|---|---|---|---|---|---|---|
| `creator_risk_conversations` | 达人风险会话 | 异常 | 查询并汇总与达人相关的风险会话 | `starrykol.pageRiskConversations`、`starrykol.summarizeRiskConversations` | `task_result`｜analyze | 内部·已登记 | BIZ-13 |
| `risk_scan` | 超时 / 风险扫描 | 异常 | 扫描红人风险会话，并列出失联、延期合作 | `starrykol.pageRiskConversations`、`starrykol.summarizeRiskConversations`、`starry.list_collaborations` | `task_result`｜analyze | 可选·已登记 | BIZ-13、BIZ-06（风险状态与归属到期分别判断） |

## 五、风险分层与物理闸门

### 5.1 L1 / L2 / L3 口径（07 文档；ADR-2026-09-28）

- **07 原文**：画像读取、邮件读取、爬虫状态为 **L1**；草稿 / 预览为 **L2**；`sendEmailNow`、`changeLifecycleStage`、联系方式解密、导入和删除按 **L3 / 敏感动作闸门**处理。
- **工具档推导**（测试即登记）：命中物理控制名单或 `^(send|delete|decrypt|import|upload|clear|confirm)` 前缀 → L3；只读前缀（`page|list|get|read|search|query|status|summarize|translate|download|count|fetch|check`）→ L1；其余 → L2。推导不能替代对具体工具副作用的审查，管理员可按需收紧（诚实：管理员把 Host 专属动作重标也不会进入代理）。
- **L3 约束**：L3 可登记但不进入 Worker 工具目录、不能直接执行（`skill-runtime-operations.md`）。

### 5.2 本清单涉及的闸门核对

| 闸门 | 涉及技能 | 规则口径 |
|---|---|---|
| 发送（`sendEmailNow`） | `email_compose`（草稿 → 确认 → 网关） | 人确认后由 Gateway 提交；Worker 不调用发送工具；发送不改变正式阶段（07、BIZ-11） |
| 阶段写入（`changeLifecycleStage`） | `confirm_stage`（提案） | 由 Host 写入；明确目标码、证据与预期版本；管理员同样必须等人确认（BIZ-12、07） |
| 解密（`decryptKolContact`） | `creator_contact_decrypt` | 按 L3 / 敏感动作闸门（07、BIZ-14） |
| 导入（`importKolProfilesFromCrawler` 等） | `creator_discovery` → 内核采集；`creator_library_sync`（幂等查重） | 采集完成只形成候选；每个 `source_batch` 独立确认；禁止编造邮箱、禁止只落本地（BIZ-10、07） |
| 异步作业（MediaCrawler） | `creator_discovery`（只出 `crawl_plan`） | 单任务、进度 / 取消 / 重试；不得伪装成同步 Skill（07、根 AGENTS 不变量） |
| 记忆写入（本地） | `mail_summary`、`mail_translate`、`deal_memory` | 只写本地记忆 / 记忆服务；不写远端、不改阶段；正式档案备注属业务写入，与本地记忆分列（技能正文、覆盖表） |

> 技能不执行副作用：技能编排与建议，副作用由 Host 受控动作执行；L3 物理控制名单见[《KOL业务对象动作清单》](KOL业务对象-动作（Action）清单.md)附录 B。

## 六、宪法法规对照

### 6.1 条款映射

| 条款 | 要求（摘） | 本清单对应 |
|---|---|---|
| CONST-02 | 平台提供技能等能力；业务经技能接入；**对外能力面只有技能，人员授权只对技能**（2026-09-27 修订） | 49 项技能＝对外能力面；连接器 / MCP 工具仅平台内核（PROD-PLAT-04、TECH-BE-07） |
| CONST-03 | Agent 由模型结合**已发布技能**、知识和工具编排；确定规则由程序执行 | 技能→连接器 / 工具绑定与闸门在运行时程序化执行（§5） |
| CONST-05 | 读数据、写草稿、执行正式动作分清；管理员不能绕过 | §2.2 通用安全口径；发送 / 阶段 / 解密 / 导入为受控动作 |
| CONST-06 | 事实权威源、知识与记忆分离，保留来源、版本与时间 | `mail_summary` / `mail_translate` 只写本地记忆；`deal_memory` 本地记忆与远端档案分列 |
| CONST-07 | 两类入口、两类界面；快捷指令直接存取记忆 | 技能 front-matter 两段入口口径 + 四类入口登记（PROD-AGENT-01） |
| CONST-08 / 09 / 10 | 先审宪；本文非规范正文；缺口如实 | 本文首部审宪记录与 §7；不新增口径、不冒充完成 |
| PROD-PLAT-02 | 能力资产＝数字员工、Agent、数字团队、技能及技能市场、知识库；四者不得互相替代 | §1.2 分层对照；TECH-ARCH-03「数字员工不等于 Skill」 |
| PROD-PLAT-04 | 员工使用已发布 Agent / 技能 / 知识；连接器与工具不对员工暴露；管理员管理发布版本与状态 | `employee_visible` / `in_market` / 发布 pack（§2.3、§1.2） |
| PROD-PLAT-05 | 人员授权只对技能；治理配置仅用于内核边界 | 技能级授权（`user_skill_grants`）；技能→连接器 / 工具绑定（skill-runtime-operations） |
| PROD-AGENT-01 / 02 | 四类入口显式登记；快捷指令声明名称、动作、输入、结果、权限、读写范围与失败处理 | front-matter（`aliases` / `actions` / `output` / `permissions`）+ 两段员工口径；8 项待补齐（§2.3） |
| PROD-AGENT-03 | 回答区分事实、推断、建议与缺失；模型不给自己授权 | 分析类技能（`kol_analyze`、`reply_analysis`）「建议不改状态」「候选动作」 |
| PROD-AGENT-08 | 任务与对象分开；AI 推荐是候选任务 | `today_plan` / `todo_plan`「不写正式待办」 |
| BIZ-08 / 09 | 15 个正式主阶段；每阶段 SOP 内容与知识 | §3（16 项阶段 SOP） |
| BIZ-10 / 11 / 12 / 13 / 14 | 发现与导入 / 草稿与发送 / 正式阶段变更 / 回复理解与风险 / 业务审批与敏感动作 | `creator_discovery` + `creator_library_sync` / `email_compose` / `confirm_stage` / `reply_analysis` / `business_approval` + `creator_contact_decrypt` |
| BIZ-16 / 17 / 18 | 任务与跟进 / 报表与效果 / KOL 记忆索引 | `creator_daily_tasks` / `creator_budget_report` / `deal_memory`、`mail_*` |
| TECH-ARCH-03 / 04 | 业务包声明对象、规则、技能、流程、数据源、工具；发布资产声明 ID / 版本 / 责任人 / 范围 / 依赖 / 输入输出 / 工具权限与所需审批 | 技能＝业务包声明；发布治理（`skill-publish.ts`、`skill_versions`）；字段缺口见 §6.2 |
| TECH-BE-07 | 连接器登记端点和风险；工具不对员工暴露；真实执行 | `mcp` 只对技能开放；`starry.*` 遗留名按适配处理（§7-3） |
| 07 文档 | 工具风险目录、真实调用规则、物理闸门、异步契约 | §5 全节 |
| domain-objects | Skill 最低契约（14 字段）与正文要求 | §6.2 逐字段核对 |
| ia-information-architecture / org-permissions | 使用面与治理面分离；技能授权单位为技能 | §2.3 三态；管理端技能页（上架 / 下架 / 发布 / 回滚） |

### 6.2 `domain-objects.md`「Skill 最低契约」逐字段核对（49 项全量扫描）

最低契约 14 字段：`id`、`version`、`description`、`profile`、`output`、`mcp`、`required_inputs`、`permissions`、`actions`、`risk_level`、`approval_policy`、`in_market`、`scope_inputs`、`output_schema`。

| 字段 | 声明数 / 49 | 说明 |
|---|---|---|
| id、description、profile、output、mcp、required_inputs、permissions、actions、in_market | 各 49/49 | 齐备 |
| version | 16/49 | 仅 16 项版本化 SOP（`2026-09-08.1`）；管理端发布侧另有 `skill_versions` 记录 |
| risk_level | 0/49 | **缺口**：风险档现由工具层自动推导（ADR-2026-09-28），未在技能层声明 |
| approval_policy | 0/49 | **缺口** |
| scope_inputs | 0/49 | **缺口**：范围由 Host 注入 CONTEXT 及服务端二次校验承载（TECH-BE-01） |
| output_schema | 0/49 | **缺口**：输出类型以 `output` 字段承载；部分技能另有 `input_schema` / `spec.yaml` |

正文要求核对：禁止事项 49/49；示例输入 1/49（仅 `email_compose`）；失败后的下一步 6/49；「是否产生副作用」以「是否发信 / 是否改阶段」两段全量承载（49/49），未按字面单独成段。与[《KOL业务对象动作清单》](KOL业务对象-动作（Action）清单.md) §4.2 差距第 1 条一致，供实施角色核对登记。

### 6.3 与研究笔记目标形态的差异（对照说明，不裁决）

- **WikiSkill 进化闭环**：笔记描述 raw → wiki → skills 的自动编译生长；本仓实现为受控子集——`backend/wikiskill/SKILL.md`：抽取只产 `pending_review`，提案进审批队列，**禁止自动改生产 `SKILL.md`**；技能本体由人工 / 管理端发布维护。仓库内未见 `PURPOSE.md` 溯源文件（0 份）。
- **使用统计与质量评估**：笔记列为 skill 资产化要素；本仓已有审计事件（`runtime.tool.*` 等）、技能测试运行器（`skill-lifecycle.ts`）与管理端发布 / 上下架；质量指标的完备性不在本文评估范围。

## 七、对照发现：差距与空白（诚实记录）

| # | 事项 | 发现 | 依据 | 结论类型 |
|---|---|---|---|---|
| 1 | Skill 最低契约字段缺口 | `risk_level`、`approval_policy`、`scope_inputs`、`output_schema` 0/49；`version` 16/49（§6.2） | domain-objects「Skill 最低契约」 | 实施差距（供核对登记） |
| 2 | 8 项入口口径未登记 | `discovery_plan`、`discovery_brief`、`kol_analyze`、`today_plan`、`today_analyze`、`todo_plan`、`mail_summary`、`mail_translate`；员工端详情显示「待业务专家补齐」 | BUSINESS 覆盖表（2026-09-21/23 登记） | 规则空白（待 KOL 业务专家） |
| 3 | 旧供应商名（遗留工具声明） | `starry.get_collaboration`（18 项技能）、`starry.deal_memory`、`starry.list_collaborations`（各 1 项）当前无对应连接器，扫描标 `unknown_connector` 并跳过 | [DECISIONS.md](../DECISIONS.md) ADR（2026-09-28）；skill-runtime-operations 未承诺项「旧 Skill SOP 的供应商名称清理」 | 实施差距（迁移清理） |
| 4 | 技能来源副本 | 仓库内 `data/skills/`、`data-e2e*/skills/` 为残留副本；现行来源＝`backend/skills`（bundled）＋`<data>/published-skills`（发布 pack，bundled 优先）；未在 backend / frontend 源码中发现读取 `data/skills` 的路径 | `backend/src/config.ts`、`backend/src/tasks/registry.ts` | 实施说明（非规则） |
| 5 | 员工面说明书缺节 | 「`## 员工口径`」小节 0/49；`GET /skills/:id` 的说明书当前返回空串（机制读取该节，缺失即空） | `backend/src/host/skills-catalog.ts` | 实施观察（是否补齐由实施 / 业务角色定） |
| 6 | 履约链无独立技能 | 合同 / 样品 / 内容 / 结算的事实动作现由阶段 SOP 展示与阶段确认 / 审批承载，未设独立动作技能 | 与《动作清单》§4.2-2 一致 | 说明（非缺口） |

> 规则空白按 CONST-08 交所属角色补充，只暂停依赖该决定的部分；实施差距只作证据，交对应实施角色核对登记，不据此改法。

## 八、维护说明

- 本文为**非规范整理材料**，与 `docs/` 正文冲突时以正文为准；引用版本：CONSTITUTION v2.1（2026-09-27）、BUSINESS（2026-09-29 修订）、domain-objects（Skill 最低契约）、07-mcp-data-contract。
- 更新触发：`backend/skills/` 技能增删、管理端发布 / 下架、BUSINESS 覆盖表补齐、工具风险目录或物理控制名单变更。
- 更新方法：重扫 49 份 `SKILL.md` front-matter 与「是否发信 / 是否改阶段」两段；脚本核对 ID 集合（49=49）；运行态（发布 / 授权 / 挂载）另行以运行时治理数据为准。
- 相关文件：[Skill-定义与分层关系](Skill-定义与分层关系.md)、[概念落地对照表-总表](概念落地对照表-总表.md)、[智能体-清单与定义](智能体-清单与定义.md)、[《KOL业务对象动作清单》](KOL业务对象-动作（Action）清单.md)、[《KOL业务对象清单》](KOL业务对象清单.md)、[《KOL业务对象-规则（Rule）清单》](KOL业务对象-规则（Rule）清单.md)、[本体六构件-定义与实例](本体六构件-定义与实例.md)、[任务-定义与运作机制](任务-定义与运作机制.md)、[智能体-定义与权威观点](智能体-定义与权威观点.md)。
