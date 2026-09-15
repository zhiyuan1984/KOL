# 智能体中台技术宪法

> **Class J 权威。** 本文件是 Host / Codex / MCP / Gateway / TypeScript 仓库边界的最终权威。所有内核、编排、连接器和仓库边界工作必须读取。
>
> 产品闭环与页面职责服从 `CONSTITUTION.md`。本文件**不**包含业务阶段邻接或产品转移规则；那些住在业务规则阶段图（sibling track；现行操作细则见 `05-agent-workflow-skill-policy.md` 与 `policies/change_stage.yaml`，待业务规则宪法落地后改指）。
>
> Starry 等物理限制不是产品法：细节在 `07-mcp-data-contract.md`，本文件只保留短节「物理适配」。
>
> ADR-001 / ADR-005 / ADR-006 的精神折叠于此；长文与历史只读 `DECISIONS.md`，不得用 ADR 散文覆盖本宪法。

## 1. 位阶与领域裁决

不存在一份文档覆盖所有领域。发生冲突时先判断问题属于哪个领域：

| 冲突领域 | 最终权威 |
|---|---|
| 产品闭环、页面职责、跨页面边界 | `CONSTITUTION.md` |
| Host、Codex、MCP、Gateway、TypeScript 仓库边界 | **本文件（class J）** |
| 业务阶段邻接、产品转移、`legalTargets` / 展示 8 段 | 业务规则阶段图（sibling）；现行 `05` + Policy |
| 安全、权限、租户、数据事实的可执行细则 | FS、Policy、数据契约；闸门仍由 Host 强制 |
| 物理工具、参数、错误、限流、原生码形状 | `07-mcp-data-contract.md` 与物理资料 |
| 历史为何这样设计 | `DECISIONS.md`（不能覆盖现行法） |

低层文档不能改写 class J。本文件也不能越权改写产品表面或业务阶段图。重大冲突先登记 `DECISIONS.md`，再同步 canonical 文档。

细则入口（服从本宪法，不另立法）：

- Codex / Host 执行流程 → `06-codex-harness.md`
- MCP 物理契约与工具风险目录 → `07-mcp-data-contract.md`
- Markdown 到代码的落点 → `14-implementation-contract.md`
- 权限 / 审批 / 审计记录形态 → `org-permissions.md`
- 代码地图（不定义规则）→ `90-codebase-handbook.md`

## 2. 五层架构

与 `00-platform-charter.md` 对齐。层可以协作，不能互换职责：

```text
平台内核（Host）：租户、权限、任务、状态、审批、事务、幂等、审计、副作用提交
声明式业务层：Digital Employee、Agent、Workflow、Skill、Policy
Codex harness：thread、turn、Skill 选择、MCP 调用、事件和模型输出
物理连接层：Starry、MediaCrawler、邮件、CRM、ERP、OA 等真实接口
体验层：员工端业务工作台、管理端资产/Trace 工作台
```

不变量：

- 模型不能越过租户、品牌、用户和工具权限边界。
- 高风险外部副作用必须经过运行时确认 / 审批，并由 Host 提交。
- 发送、阶段变更、导入、解密和删除是不同动作，不能隐式合并。
- 每个结果必须可追溯到任务、Thread、Turn、Skill、工具调用和审批。
- 业务语义由 Skill 和 Workflow 描述；安全和一致性由 Host 强制执行。
- Stub 只用于测试；生产与真实验收必须使用真实 Codex app-server 和授权 MCP。

新增普通 Agent 时，平台代码不随 Agent 数量线性增长（ADR-006 精神）：通常只加配置、Skill、Workflow、Policy、MCP 白名单、数据范围和审批策略。配置化不代表零代码，更不代表可以绕过内核。

## 3. Host：唯一闸门执行者

Host 是平台内核，**不是**业务调度器（ADR-001 精神）。

Host **单独**强制：

- 权限与 PEP（公司 / 部门 / 品牌 / 区域 / 对象 / 动作 / 版本）
- 状态、版本冲突（含 `expected_version`）与非法转移否决
- 幂等、超时、熔断、重试与人工接管
- 副作用闸门：确认 →（如需）组织审批 → Gateway 提交 → 持久回执 / 审计

Host **只能否决**越权、非法状态、缺审批、版本冲突、未知 Item 和重复副作用。不得复制业务目录、信件种类、缺口文案、推荐表、金额语义、Skill 选择或模型结果组合。

前端、Prompt、Skill、Worker 和 MCP **不得**直接发信或写正式阶段。体验层只提交确认意图；员工端根据 Host 返回的状态与 schema 渲染，不重新判定权限、阶段合法性或副作用。管理端进入治理面也不等于旁路 Host。

三类执行（细则 C `org-permissions.md`）：`agent_authorized`（低风险读 / 草稿）、`agent_proposed`（结构化提案）、`host_committed`（确认后由平台提交）。管理员和部门负责人的公司级数据范围不等于跳过发送、阶段、导入、解密、删除闸门。

## 4. Codex：语义编排

Codex harness **唯一**指 Codex app-server（ADR-001）。它负责意图理解、Skill 选择、字段抽取、Workflow 编排、授权 MCP 调用、Item / 草稿 / 建议和继续执行。

Host 负责会话 HTTP、CONTEXT / 权限快照、schema 校验、WorkItem 持久化和闸门。未锁 Skill 时由 commander profile 在当前线程选择能力；已锁 Skill 的快捷入口只预填并锁定，**不另建 Host 调度器**。

生产读写走 Codex turn 调用授权远程 MCP。确认发送的那一次提交走 Gateway；确认阶段走 `hostConfirmStage`。Worker turn 的 `approvalPolicy: "never"` 不能变成「模型自己点确认」。L1 只读补读不得代发信、不得改阶段、不得解密、不得调用 `changeLifecycleStage`。写 Skill 在 real 模式保持 Codex-strict，Host 不代填业务结果。

### Stub 与验收（ADR-005 精神）

Stub（`CODEX_MODE=stub` / `runStub`）只用于 CI 与确定性内核测试：状态机、权限、幂等、错误和回滚。它不代表模型质量、Skill 选择、MCP 连通或员工 UX。

生产禁止 stub、Host 直出业务结果和旁路 REST 编排。真实业务与员工端验收必须使用真实 app-server + 授权 MCP。本轮文档不 LIVE。

## 5. MCP / Gateway

物理连接层描述真实接口，不描述员工体验或业务编排。生产 IO 只能由已授权路径到达远程 MCP；不得再包一层本地业务工具或 Host 代调作为第二真相源。

**写入走 Gateway。** `sendEmailNow`、`changeLifecycleStage`、正式导入、解密、删除不能由 Worker / Skill / 前端直接调用。用户确认后由 Host 经 Gateway 提交；阶段提案走 `confirm_stage`，再由 Host 写入。

每个工具必须标记风险类：`read_only`、`draft`、`reversible_write`、`external_side_effect`、`destructive`、`requires_confirmation`、`requires_admin`、`idempotent`。画像 / 邮件读取 / 爬虫状态为 L1；草稿 / 预览为 L2；外发、改正式阶段、解密、导入、删除按 L3 / 敏感闸门。L1–L3 是风险标签，不等于每个动作都要组织审批。

**密钥永不出现在员工 UI。** 密钥只引用环境变量或 Secret 名称；不得写入 Markdown、Skill、日志、提交记录或员工表面。管理端连接器治理只持凭据**引用**，永不回显原文。员工连接器使用面可以看「我被授权可用什么」，不能看密钥、组织策略编辑或授权矩阵。

MediaCrawler 是异步作业（`start_crawl → get_crawl_status → get_creators → upload_creators`），不得伪装成同步 Skill。采集完成只入库线索；正式写入仍走 Host Gateway。跟进路径禁止顺带发信、改阶段、解密或编造邮箱。

## 6. TypeScript / 仓库边界

| 位置 | 只做什么 | 禁止 |
|---|---|---|
| `backend/` Host 内核 | PEP、状态、幂等、审批、Gateway、审计、Codex adapter | 复制 Skill 目录；旁路 REST 发信 / 改阶段；用正则补业务语义 |
| `frontend/` 工作台 | 按 schema / 事件渲染；提交确认意图 | 本地判定权限或阶段合法性；直调 MCP；在 Prompt 里「顺便发送」 |
| `agents/` `workflows/` `skills/` `policies/` `experts/` | 声明式业务：意图、步骤、闸门声明、岗位发布 | 用 YAML 关闭 Host 闸门或新增副作用类型 |
| `config/` | 组织 / 品牌 / 范围事实 | **配置不能绕过内核** |
| `schemas/` `evals/` `specs/` | 契约、评价、追踪 | 把未校验的 Markdown 当运行时代码 |
| `docs/codex/` 与物理 MCP 资料 | 协议与外部事实 | 在 Skill 或前端复制第二套映射 |

唯一契约校验入口是 `backend/scripts/validate-contracts.mjs`（`npm run validate:contracts`）。同时校验 UX 追踪，不另建编译器。发布门禁走 `release-gate.mjs`。未通过契约编译的配置不能指导生产。

知识只能补充事实、模板和制度，不能覆盖 Host 状态机、权限、审批或接口 schema。员工「用于当前任务」只产未发送草稿。

新增 Agent 分级（ADR-006 / ADR-007 精神，细则 `DECISIONS.md`）：

| 级别 | 允许 | 必须门禁 |
|---|---|---|
| 配置型 | manifest / Skill / Policy / 知识 | 契约编译、评价、范围校验 |
| Skill 型 | 新业务意图，工具已存在 | 不得新增 Host 调度器 |
| MCP 型 | 新外部 API / 工具 | 写工具必须 Gateway / 风险分类 |
| 内核型 | 新主数据、状态机或副作用类型 | 平台代码 + 安全评审；不得用配置绕过 |

## 7. 物理适配

本节只记录**物理连接层**对 Host 的约束，**不是**产品法，也不是业务阶段邻接。产品「人可以跳到哪」由业务规则阶段图决定；远程系统「一次写能否落地」由物理接口决定。二者不得互相升格。

现行 Starry 适配（细节与证据链在 `07` / ADR-011，此处不展开）：

- 读取归一成 Host canonical code；写入输出 Starry **原生码**。
- 远程 `changeLifecycleStage` 只要相邻前进；跨段由 Host 适配层 walk，失败即停。
- 人跳过 / 纠正的语义只记在 Host 确认卡、审计和本地协作，不要求 Starry 理解 skip。
- 请求形状与字段名以物理契约为准，不在前端或 Skill 另造一套。

物理接口与业务文档冲突时：先记录接口漂移，再由适配层处理。禁止把 Starry 邻接、原生码或 allowlist 写成「员工不能跳阶段」的产品规则。

## 8. 变更门槛

只有同时影响 Host 闸门、Codex / Stub 边界、Gateway 写路径、密钥暴露或仓库边界的规则才能加入本文件。

不要写入本文件的内容：

- 业务阶段邻接、展示 8 段 / 写入 15 段的产品枚举、`legalTargets` 名单
- 页面职责、一等能力清单、视觉 token
- 某个 MCP 工具的完整参数表或长 ADR 复述
- LIVE 操作步骤或生产放行声明（本文件不 LIVE）

页面、业务转移和物理参数分别进入产品宪法、业务规则阶段图和 `07`。文字澄清直接改对应文档；架构取舍先登记 `DECISIONS.md`。
