# Codex KOL 编码规范

> 文档版本：**v1.3**  
> 基线：v1.1；v1.2 现网对齐；v1.2.1 并入《灵工 Agent 中台开发规范》；v1.3 拆开 Host 与 Codex harness  
> 修订日期：2026-09-10  
> 优先级：**第二**。第一为 `docs/灵工-Agent中台开发规范.md`。  
> 定位：需求评审、任务拆解、Skill 设计、编码、UI、提测、上线的落地细则。  
> 新人代码地图：`docs/新手入门代码使用手册.md`。  
> 功能变更必须先扫中台规范，再扫本文；冲突时以中台规范为准。

v1.3 口径：

| 主题 | 口径 |
|---|---|
| 新增 Skill | **允许**。必须同时进入 catalog + `SKILL.md` + 测试；**禁止旁路 API** |
| 管理端 / 员工端 | **绝对分裂**。员工端不暴露 Skill 时序 / MCP / Codex 术语 |
| 角色 | `admin`（超级用户，两端可进）+ `employee`。不设「只能管不能用」第三角色 |
| 调试视图 | 仅 `admin` 显式打开，默认关。管理员也不能跳过确认发送 / 确认阶段 |
| 高危卡点 | 弹窗，或 L3 确认块，或口令「确认发送」 |
| Codex harness | **就是 Codex app-server**（thread / turn / Skill / MCP）。不是 Host TypeScript |
| Host | 会话 HTTP、PEP、确认发送 / 确认阶段闸门、阶段机。**不是**业务目录，**不得**生产直出 Skill |
| 其余 | 沿用正文（硬规则与双端边界不变） |

---

## 文档说明

### 0. 用词（强制，避免把两层写成一层）

| 词 | 是什么 | 不是什么 |
|---|---|---|
| **Codex harness** | `codex app-server`：`thread/start|resume`、`turn/start`、Skill、授权远程 MCP、`thread/fork` | Host TypeScript、`runStub`、旁路 REST |
| **Host / 内核** | 会话 HTTP、PEP、确认发送、`hostConfirmStage`、阶段合法性、审计、digest 存储 | 信件目录、缺口文案、口令解析、选 Skill、代调 MCP 组草稿 |
| **Skill** | 已发布业务契约（口令、必填、缺口、禁止事项、MCP 依赖） | 状态机、发送闸门 |
| **员工端入口** | KOL / 审批 / 爬虫三张卡，只预填第一句 | 三套运行时、Claw「KOL Agent」远端 |

v1.2 把上层写成「Host（Codex APP‑Server）」并允许邮件 / SOP / `confirm_stage` **Host 直出**。v1.3 **废除**该口径。实现若仍 `isEmailMcpTask → runStub`，视为与本规范冲突，按 `docs/Host硬编码改进.md` 退。

### 1. 核心定位

全程遵循**规格优先、规则驱动、无定制化临时逻辑**。业务能力以标准化 Skill 为**意图入口与契约**；生产执行以 **Codex app-server** 为唯一 harness；Agent 交互遵循统一 UX。禁止把业务目录、口令语法、缺口文案写成 Host 正则或 TS 表。

Skill **不是**唯一执行引擎。阶段合法性、发送回执、地址占位、异常冻结、发件栈分流等**硬规则留在 Host 内核**，由测试锁死。`SKILL.md` 写清意图、入参、禁止事项；不能替代状态机。内核不能反过来替代 harness。

### 2. 核心架构铁律（全局强制）

1. **生产读写走授权远程 MCP**。档案、真发信、爬虫、看板等生产 IO 只走已授权远程 MCP，由 **Codex app-server 的 turn** 调用。不把远程 MCP 再包一层「本地业务工具」或「Host 代调」当第二套真相源。Codex Worker **禁止**自己发信、改正式阶段（L2 / L3 闸门在内核）。
2. **Codex app-server 是唯一业务 harness**。未锁 Skill 时的选择、工具调用、草稿 / SOP / 分析结果、缺口与建议下一步，都在 app-server 线程里完成。前端、客户端、MCP 不参与流程编排。人点的芯片只预填并锁 Skill，跳过调度、直接跑该 Skill 的 turn。**禁止**生产路径以 `CODEX_MODE=stub`、`runStub` 或 Host 函数直出 `email_compose` / SOP / Claw / `confirm_stage` 提案。`CODEX_MODE=stub` 仅 CI。
3. **Skill 为唯一业务入口**。对外能力必须落成 catalog 中的 Skill，禁止旁路 API、禁止前端/Prompt 直接调发信或改阶段。规则判断分两类：契约、口令、缺口、推荐文案在 Skill；不可违背的状态机与闸门在 Host。
4. **分层隔离**：远程 MCP = 原子工具；Skill = 意图与契约；Codex app-server = harness；Host = 会话、校验、闸门、熔断；双端 = 展示与操作。
5. **双端职责固化**：配置、规则、权限、审核、数据管理、智能体调度全部在**管理端**；员工端仅业务查看、日常操作、结果交互，无核心配置权限，**不暴露 Skill 时序**。
6. **Agent‑UX 规格约束**：Agent 页面采用**豆包参考三栏布局**；风险视觉、任务状态、时序溯源全局统一。需求阶段确认 UX，编码不得自由改交互。

### 3. 适用业务全域范围

1. KOL 合作全流程智能体（邮件解析、阶段识别、流程流转、异常判断）
2. KOL 邮件智能体（收发、解析、识别、草稿、确认发送）
3. KOL 合同 / 商务审批智能体（指定节点审批拦截；组织 MCP 鉴权为后续能力）
4. 海外平台 KOL 爬虫智能体（抓取、过滤、清洗、分析、打分、入库、出库）
5. 品牌‑KOL 绑定跟进（人员、品牌、KOL 关系与跟进链路）
6. 全局 MCP 鉴权、工具权限、接口安全
7. 熔断、重试、溯源、审计、人机协同
8. Agent UI‑UX 全页面交互、组件、状态、双端归属

### 4. 产品铁律（与实现无关，永久有效）

1. **发送 ≠ 改阶段**。回信分析只建议；人确认后才写正式阶段。
2. 普通画像 / 组信 **不擅自 `decryptKolContact`**，不编造达人邮箱。
3. 两套邮箱栈不混：Starry 真发信用真实 `pageMailboxes`；Host / 知识草稿 From 只用 PEP 白名单 `BRAND_MAILBOXES`。`larry.zhao@amperetime.com` 不在该白名单。
4. From **不默认** `pageMailboxes` 列表第一只。
5. 正式阶段写入只走 Host `confirm_stage`。Worker / Skill turn **禁止**调远程 `changeLifecycleStage`；人在确认卡点确认后，由 Host 内核调用。
6. 不提交 JWT、`data-*`、测试产物、真实密钥。

---

## 一、全局分层架构标准

### 1.1 五层固定架构

1. **底层：远程 MCP 原子工具层**  
   邮件、爬虫、审批、组织权限、鉴权、数据读写。无业务状态机。统一收参、远程调用、回结果、抛基础异常。  
   **已接线（现网）**：Starry 档案读写、会话读写、预览 + 确认发送、看板、风险会话、阶段选项；Claw 评分 / 话术 / 每日任务 / 预算；MediaCrawler 抓取与状态。  
   **Skill / Worker 不接线**：`changeLifecycleStage`（人确认后由 Host 内核调用）、多数邮箱 / Nylas 写接口、`deleteKolProfile`。  
   **后续**：企微 / OA / 组织架构远程 MCP（规范可写依赖，验收不卡此项）。

2. **中层：Skill 标准化业务能力层**  
   一个 Skill = 一个独立业务意图。写清别名、必填、禁止事项、风险标签、**Codex turn 可见的远程 MCP**。  
   Skill 不替代 Host 状态机。Host 不替代 Skill 目录，也不在 SKILL.md 里写「由 Host 调用 MCP」。

3. **上层：Codex app-server harness**  
   选 Skill（未锁时）、补字段、调授权远程 MCP、出 Item、子线程 `thread/fork`。  
   同一连接上的 Profile（commander / lead / …）不是多套运行时。

4. **内核：Host**  
   会话 HTTP、PEP、轮次超时、L2 确认发送、L3 确认阶段、日志溯源、任务状态。  
   Host 代码只承载硬规则：`legalTargets`（人确认，无相邻约束）、SENT 回执、占位邮箱跳过、异常轨道冻结、发件栈分流。自动事实写入另走 `autoLegalTargets`，不约束人确认。不承载信件种类、缺口文案、首页推荐口令。

5. **顶层：双端展示操作层（管理端 + 员工端）**  
   只做渲染、交互、触发、任务展示。无业务规则、无权限决策、无流程编排。  
   Agent 页面遵循 §五 三栏规格；过程与结果用图标 + 文字的 Markdown。

### 1.2 分层职责对照

| 层 | 放什么 | 代码 |
|---|---|---|
| 意图 / Skill | 用户怎么叫、要什么、禁做什么、缺口与推荐 | `backend/skills/<id>/SKILL.md` |
| Codex harness | 选 skill、抽字段、调 MCP、出草稿 / SOP / 分析 | `worker/codex.ts`、`runCodex` |
| 硬规则 / 闸门 | 阶段机、回执、占位、异常冻结、确认发送 | `stages.ts`、`receipt.ts`、`gateway/send.ts`、`hostConfirmStage` |
| 远程 MCP | 档案 / 邮件 / 评分 / 爬虫生产 IO | Starry / Claw / MediaCrawler |

### 1.3 MCP 与本地能力

1. **写生产数据**（档案变更、真发信、爬虫入库）必须走授权远程 MCP，由 Codex turn 调用。确认发送的那一次真发走 Gateway，不走 Worker。
2. **Host 可做会话级只读缓存**（digest、journey 转发 Codex 已产出的字段）。禁止用 Host 只读聚合代替 turn 去组业务结果。
3. **`mcp:` frontmatter = Codex Worker 在该 Skill turn 里可调用的远程工具**。需要 Starry / Claw 的 Skill 不得为了「Host 代调」而留空 `mcp: []`。
4. 禁止为了「少写 Host」再造一套本地发信 / 改阶段工具。也禁止为了「测试好写」让生产写信走 `runStub`。

### 1.4 全局强制约束

- 可配置业务规则不入前端、不入 Prompt、不入 Host 正则；契约在 Skill，状态机在 Host，知识库兜底话术与资料。
- Agent 循环、多步骤、异步流程由 Codex app-server 驱动；Host 只做闸门与持久化。
- 所有写操作、数据变更、业务流转经过 Skill 入口 + Host 标准化校验。
- 禁止前端 intent 绕过 PEP / Host 再校验。
- 口令里的 handle / 金额 / 运单 / 地址由 **Codex turn 按 Skill `required_inputs` 认**。Host 只做否决（邮箱必须出现在人口令或已绑定箱；禁止默认第一只发件箱）。

---

## 二、阶段模型（展示八段 ≠ 官方写入）

v1.1 将「八大阶段」写成官方主流程。v1.2 拆成两层，**禁止把官方写入压成 8 个枚举**。

### 2.1 展示层：8 个 SOP 阶段

只用于 Home / Journey / `stage_sop` 轨道，**不是**写模型。

| # | 展示阶段 | 对应正式 `stage_code` |
|---|---|---|
| 1 | 建联 | `INITIAL_CONTACT` |
| 2 | 意向 | `INTERESTED` |
| 3 | 评估报价 | `EVALUATING` / `QUOTE_PENDING` |
| 4 | 商务谈判 | `NEGOTIATING` |
| 5 | 方案签约 | `PLAN_PENDING` / `CONTRACTING` |
| 6 | 寄样测评 | `SAMPLE_PENDING` / `SHIPPED` / `TESTING` |
| 7 | 内容发布 | `CONTENT_PLANNING` / `CONTENT_REVIEW` / `PUBLISH_PENDING` / `PUBLISHED` |
| 8 | 结算 | `SETTLING` |

异常是八段的**旁路**，不是第 9 段。`COMPLETED` 是结算终点，不是异常。

### 2.2 写入层：15 主阶段 + 旁路 / 终态

官方定义见 `backend/src/stages.ts`（测试锁长度 15）。

| # | code | 中文 | 推进模式 |
|---|---|---|---|
| 1 | INITIAL_CONTACT | 初步接触 | 自动记录 |
| 2 | INTERESTED | 已回复-有兴趣 | AI 建议 + 人确认 |
| 3 | EVALUATING | 合作评估 | AI 建议 + 人确认 |
| 4 | QUOTE_PENDING | 报价待确认 | 事实触发 |
| 5 | NEGOTIATING | 商务谈判 | 受控执行 |
| 6 | PLAN_PENDING | 方案待确认 | 必须审批 |
| 7 | CONTRACTING | 合同签署 | 必须审批 |
| 8 | SAMPLE_PENDING | 待寄样 | 规则 / 人工 |
| 9 | SHIPPED | 已发货 | 物流事实自动 |
| 10 | TESTING | 已签收-测试中 | 物流事实自动 |
| 11 | CONTENT_PLANNING | 内容策划 | AI 建议 + 人确认 |
| 12 | CONTENT_REVIEW | 内容审核 | 必须审核 |
| 13 | PUBLISH_PENDING | 待发布 | 审核通过后推进 |
| 14 | PUBLISHED | 已发布 | 平台事实自动 |
| 15 | SETTLING | 结算中 / 已付款 | 财务事实 / 审批 |

旁路（可回主轨道）：`PAUSED`、`DISPUTED`。  
终态（无出边）：`LOST`、`REJECTED`、`CANCELLED`、`COMPLETED`。

写入规则：

- 目标必须是具体 `stage_code`，禁止口令「下一阶段」。
- **人确认**以 `legalTargets` 为准：Host 列出主流程 / 分支流程 / 异常流程，**无相邻约束**。可选下一格、不寄样等跳过、纠正记错回退、进入或离开异常。跳过 / 纠正 / 异常必须填写原因。
- 目标不在 `legalTargets` 确认列表中 **400**。`expected_version` 不符 **409**。
- 物流 / 平台等自动事实写入不走 `legalTargets`，只按 `autoLegalTargets` 推下一格，不能替人跳过或纠正。
- 正式迁移必须在同一事务写快照 + 不可变记录（from/to、reason、evidence、recommender、approver、version）。
- 异常轨道上冻结事实自动推进；人确认后才能回到指定正式阶段。
- 唯一官方写入口：`confirm_stage`。

---

## 三、全局 Skill 统一设计标准

### 3.1 Skill 核心定义

Skill = **可复用、可审计、可测试的最小业务意图单元**。  
对应一个独立业务意图；Codex app-server 在 turn 中调用多个 MCP 原子工具。  
Skill 承载完整业务**契约**；Host 承载不可违背的**硬规则**。

### 3.2 现网必须字段（编码 / 评审 / 验收）

每个业务 Skill 的 `backend/skills/<id>/SKILL.md` frontmatter 必须包含：

| 字段 | 说明 |
|---|---|
| `id` | 全局唯一，不可改主键 |
| `title` | 展示名 |
| `description` | 一句话意图 |
| `category` | 业务分类 |
| `profile` | commander / lead / opportunity / negotiation / execution / settlement-growth |
| `output` | 输出类型（如 `task_result`、`propose_stage`） |
| `mcp` | Codex app-server 本 turn 可调用的远程 MCP 工具；禁止为「Host 代调」而留空 |
| `required_inputs` | 缺一则拦截 |
| `permissions` | 权限声明 |
| `actions` | 允许的动作 |
| `aliases` | 用户叫法；可增不可换主键 |
| `in_market` | 是否上架技能市场 |

正文必须写：必填项示例、禁止事项、是否发信、是否改阶段。

### 3.3 可选机器字段（不挡现网路由）

v1.1 的下列字段作为**可选标注**，逐步补齐，不作为当前路由前置：

1. `level`：L1 / L2 / L3（见 §3.5）
2. `timeout` / `max_retry` / 熔断阈值
3. `input_schema` / `output_schema` / `error_schema`
4. `depends_on_mcp_tools`：本 Skill 的 Codex turn 实际调用的**远程**工具清单
5. `rule_source` / `knowledge_depend`
6. 是否需要组织 MCP 鉴权（现状：未建，标后续）

### 3.4 Skill 统一执行流水线

1. 员工端触发已发布 Skill（芯片预填只锁 Skill，不跑箱）
2. Codex app-server `thread/start|resume` + `turn/start`（Skill 契约 + CONTEXT）
3. Turn 按 `mcp:` 调用授权远程 MCP；抽口令字段、组 Item
4. Host 硬规则校验（阶段机、回执、占位、异常冻结）——只否决，不改目录
5. 结果写入 session；UI 渲染业务结果
6. L2 预览等人「确认发送」→ Gateway 真发；L3 等人确认 → `hostConfirmStage`
7. 异常统一封装、重试 / 兜底、审计
8. 未锁 Skill 时由 commander profile `thread/fork` 选下一个 Skill，不另起 Host 调度器

### 3.5 风险分级（标签，映射现网闸门）

L1 / L2 / L3 是**标签**，映射已有闸门，不是「凡写必组织审批」。

| 标签 | 含义 | 现网闸门 | 例子 |
|---|---|---|---|
| **L1 只读** | 查询、解析、识别、分析，无写无发信 | Agent 可执行 | `stage_sop`、会话读、知识检索、`reply_analysis`（只建议） |
| **L2 草稿 / 预览** | 生成草稿、建议、报告，未正式生效 | 可生成；真发必须「确认发送」 | `email_compose` 预览 |
| **L3 人确认写** | 改正式阶段或商务生效 | `confirm_stage`；报价 / 方案 / 合同 / 结算走 `business_approval` | 记状态、审批通过 |

强制区分：

- **确认发送** = 人看过预览后真发信。**不是**组织审批。
- **确认阶段** = 人确认后写官方 `stage_code`。
- **组织 / 企微 MCP 鉴权**：后续能力；本轮验收不依赖。
- L3 必须幂等；阶段写必须带 `expected_version`。

---

## 四、Skill 矩阵与发布门禁

### 4.1 允许新增，禁止旁路

v1.1「禁止新增、只准用封闭约 25 个新 id」作废。

**允许新增 Skill**，但一次发布必须同时满足：

1. `backend/skills/<id>/SKILL.md`（字段齐全，禁止事项写清）
2. 进入 catalog（`taskDefinitions()` / `SKILL_CATALOG` 自动收录）
3. 生产路径可测：真实 Codex app-server；`CODEX_MODE=stub` 只锁阶段机等硬规则，不算 UX / 写信验收
4. 不绕过阶段机、发送回执、占位邮箱、异常冻结
5. 不新增旁路 HTTP / 前端直调发信或改阶段

禁止：

- 前端或 Prompt 直接调 `sendEmailNow` / 改 `stage_code`
- 平行再造一套 Skill 主键（如另做 `mail_formal_send` 替换 `email_compose`）
- 只加 API 不加 `SKILL.md`

需要「邮件组」等聚合时：做成 **alias / 路由组**，主键仍用现网 id。

### 4.2 规范能力名 → 现网 Skill 主键

规范叙述可用中文能力名；编码与测试必须用现网 id。

| 能力（v1.1 曾用名） | 现网主键 | 风险 | 说明 |
|---|---|---|---|
| 建联发信 / 邮件组 / `mail_draft_generate` + `mail_formal_send` | `email_compose` | L2 预览 → 确认发送 | 首封必填发件 / 收件 / 主题；模板 `kb_mail_kol` |
| 邮件接收解析 `mail_receive_parse` | `email_conversation_read` / `email_conversation_list` | L1 | Codex turn 调 Starry 会话工具 |
| 邮箱列表 | `email_mailbox_list` | L1 | 真实 `pageMailboxes`；不默认 [0] |
| 应用会话列表 | `email_app_conversation_list` | L1 | |
| 阶段识别 `kol_stage_identify` / `mail_content_stage_recognize` | `reply_analysis` | L1 | **只建议，不写阶段** |
| 阶段推进 `kol_stage_status_sync` | `confirm_stage` | L3 | 唯一官方写入口 |
| 本阶段 SOP / 八段轨道 / 异常 SOP | `stage_sop` | L1 | 只展示，不发信不改阶段 |
| 单阶段 SOP 资料包 | `sop_<stage>`（15 个） | L1 | 与正式阶段一一对应 |
| 审批筛选 / 终审 `kol_approval_*` | `business_approval` | L3 | 仅报价 / 方案 / 合同 / 结算类 |
| 组织鉴权 `approval_org_auth_check` | （后续） | — | 远程组织 MCP 未建 |
| 合作记忆 | `deal_memory` | L1 / 受控写 | |
| 达人发现 / 画像 / 评分 / 话术 / 任务 / 预算 | `creator_discovery` `creator_profile` `creator_scoring` `creator_outreach` `creator_daily_tasks` `creator_budget_report` | L1 | Claw / 库查询 |
| 库查询 / 全量 / 同步 | `creator_library_query` `creator_library_all` `creator_library_sync` | L1 | |
| 看板 / 筛选 / 负责人 | `creator_lifecycle_kanban` `creator_filter_options` `creator_owner_update` | L1 / 受控写 | |
| 联系方式解密 | `creator_contact_decrypt` | L3 | 非普通组信路径；禁止擅自调用 |
| 风险 | `risk_scan` `creator_risk_conversations` | L1 | |
| 爬虫抓取 / 清洗 / 打分 / 入库 | MediaCrawler 远程工具 + 对应 creator skill | L1 / L3 入库 | 不另造 `kol_platform_multi_crawl` 主键 |
| MCP 全局鉴权三件套 | Host PEP / 权限中间件 | — | 不做成独立业务 Skill |

`sop_*` 清单（与 15 主阶段对齐）：  
`sop_initial_contact` `sop_interested` `sop_evaluating` `sop_quote_pending` `sop_negotiating` `sop_plan_pending` `sop_contracting` `sop_sample_pending` `sop_shipped` `sop_testing` `sop_content_planning` `sop_content_review` `sop_publish_pending` `sop_published` `sop_settling`

### 4.3 首封建联连通句式（验收保留）

一条指令必须一次跑通预览（不自动真发）：

`首封建联 发件: larry.zhao@amperetime.com 收件: 100705721@qq.com 主题: LiTime MCP 连通测试`

发送必须等人说「确认发送」。发送后不改阶段。

---

## 五、管理端 & 员工端绝对边界（固定分工，永久不变）

沿用 v1.1 §4。**一个代码仓库可以共用组件，但权限、页面、信息架构必须分裂。**

### 5.1 管理端：唯一权限出口

所有 Skill 配置、智能体调度、规则管理、权限审批、数据管控、系统配置只在管理端：

1. Skill 启用 / 禁用、版本、参数
2. MCP 工具权限、鉴权策略、接口白名单
3. 八阶段展示规则、15 阶段写入规则、审批节点
4. 爬虫抓取 / 过滤 / 打分配置
5. 品牌、人员、KOL 绑定后台
6. L3 审批工作台、审批记录、审计溯源
7. **Agent 完整三栏详情（全量时序、溯源、完整审批）**
8. 任务总览、异常接管、人工介入
9. 知识库关联、规则更新、回归测试
10. 组织 / 角色 / 数据权限（组织 MCP 落地前用现网管理员账号）

现网管理员：鄢棽 / `sriphy` / `sriphy.yan@amperetime.com`。SOP 编辑仅管理员。

**管理端定位**：规则中心、权限中心、调度中心、审计中心。

### 5.2 员工端：仅业务使用（无配置权限）

员工端**禁止**规则配置、Skill 管控、权限修改，仅承载：

1. 个人负责 KOL、合作阶段、跟进状态查看
2. 邮件草稿预览、本人待办审批
3. 已入库 KOL 查询、自有品牌关系查看
4. 个人任务记录、智能体**业务结果**查看（阶段卡、SOP 卡、邮件预览）
5. 轻量补信息、简单任务触发

> **Agent 页面双端区分（强制）**  
> - **管理端**：完整三栏（左任务列表｜中工作区｜右 Skill 时序 + 溯源）。可看 Skill / MCP 调用、全部溯源；可终止 / 暂停 / 接管。  
> - **员工端**：简化 Agent 页，**隐藏右侧 Skill 时序树**；只展示业务卡片、消息块、待办审批；**看不到底层 Skill / MCP 执行细节**；仅基础操作，不能接管、终止他人任务。

员工端可以看「当前处于哪一段、本阶段要做什么」（业务结果），不可以看「调了哪个 Skill、哪个 MCP、入参摘要」（执行时序）。

**员工端定位**：业务执行终端、结果展示终端、日常操作终端。

### 5.3 角色与调试视图

| 角色 | 现网 | 员工端 | 管理端 | 调试视图 |
|---|---|---|---|---|
| 超级用户 | `admin`（可同时 `employee`） | 可进，做业务 | 可进，管资产 | 显式打开后才显示时序 / MCP 术语 |
| 普通员工 | `employee` | 可进 | 不可进 | 无 |

- 不设「只能管不能用」的第三角色。
- 超级用户**不能**跳过确认发送、确认阶段、商务审批。
- 员工工作台（含管理员在员工端操作时）不出现：创建/管理技能、添加连接器、MCP 名称、原始堆栈。连接器配置只在 `/admin`。
- 调试开关：`ui:debug-view`，仅 `admin`，默认关。

---

## 六、Agent UI‑UX 全局规格（纳入需求 harness）

参考豆包三栏，面向 2B；目标：**拒绝黑盒、人机协同、可审计、风险可视化**。Agent 详情页以此为基准，不允许自由定制结构。

### 6.1 页面布局标准

```
┌──────────────┬──────────────────────────────────────┬──────────────────────────────┐
│ 左栏：Agent任务列表 │ 中间：Agent业务任务主工作区             │ 右栏：洞察&溯源（仅管理端）   │
│ Agent TaskList│ 【业务卡片 + AI输出 + 审批操作】        │ Skill时序树｜工具调用｜溯源     │
│（对标豆包会话）│                                      │（对标豆包右侧引用）            │
└──────────────┴──────────────────────────────────────┴──────────────────────────────┘
```

1. **左栏：Agent 任务列表**  
   Item：任务标题、业务对象、状态 Badge、创建时间、触发类型（手动 / webhook）。  
   能力：筛选、搜索、新建；终止 / 重试（权限按双端）。  
   状态：`RUNNING🟦 / PENDING_APPROVE🟧 / MANUAL_INTERVENE🟥 / SUCCESS🟩 / FAILED⛔`

2. **中间主工作区（两端都有）**  
   自上而下：  
   - 任务头部：任务 ID、状态；暂停 / 终止 / 重试（员工端仅本人任务）  
   - 业务对象卡片：KOL、阶段轨道、邮件摘要等，结构化展示，不埋进对话  
   - 消息流：按风险标签区分  
     - 🤖 L1 只读分析块：浅灰；识别 / 分析结果 + 溯源标记（业务来源，不是 MCP 时序）  
     - ✍️ L2 草稿输出块：浅蓝；标注 `AI生成草稿，未生效`，可编辑  
     - ⚠️ L3 待确认变更块：橙色边框；必须 diff（变更前 → 变更后）；编辑 / 同意 / 驳回（驳回必填备注）  
   - 底部输入框：只补充信息；**禁止用输入框直接写生产数据**。真发走「确认发送」；改阶段走 L3 确认块。

3. **右栏【仅管理端，可收起】**  
   - Tab1 Skill 时序树：Skill / MCP 链路、入参摘要、输出摘要、耗时、错误；运行中流式追加。  
   - Tab2 参考溯源：邮件原文、知识库命中、来源 ID。  
   **员工端不得渲染此栏。**

现网工作台（导航 + Chat + `SideWorkbench`）应对齐本规格的信息架构：左任务 / 中业务 / 右管理端时序。缺栏视为未对齐，迭代补齐，不另做一套交互语言。

### 6.2 任务状态 UX

1. **RUNNING**：中栏流式消息；管理端右栏流式时序；可暂停 / 终止；终止保留中间结果。
2. **PENDING_APPROVE**：自动暂停；中栏橙色 L3 块；管理端时序标记等待人工。
3. **MANUAL_INTERVENE**：写明原因；【人工接管】【重试】；禁止只甩堆栈。
4. **SUCCESS / FAILED**：保留消息与溯源；管理端保留完整时序；支持回看 / 导出。

### 6.3 全局视觉约束

1. L1 / L2 / L3 消息块全业务复用，禁止各业务自定义样式。
2. AI 业务结论必须带溯源来源 ID（邮件 / 知识 / 阶段记录）。
3. L3 必须 diff，确认前看清变更。
4. 错误用业务可读文案，**禁止把后端堆栈暴露给员工端**。管理端可看详细错误。

### 6.4 Agent‑UX 反模式（评审必拦）

- 照搬纯聊天，缺失结构化业务卡片
- **员工端开放 Skill 时序树或 MCP 执行细节**
- L3 跳过 diff、跳过确认块
- 终止后清空中间产出
- 只有 loading，不输出中间过程
- AI 输出不带溯源
- webhook 任务不出现在左侧任务列表
- 把 8 个展示阶段当成 8 个可写官方枚举

### 6.5 UI‑UX 交付物纳入 harness

每个 Agent 需求必须写明：

1. 页面归属：管理端 / 员工端
2. 使用哪些标准组件（任务列表、消息块、时序树、溯源）
3. 任务状态流转
4. 风险标签的视觉表现
5. 是否新增 / 修改组件；禁止写「页面自由设计」
6. 员工端如何展示业务结果，同时保证时序不可见

---

## 七、规格驱动编码 · 研发交付 Harness

所有需求开发、编码、提测、上线以本文档为校验基准。

### 7.1 需求拆解

1. 业务需求拆到**现网 Skill 主键**；没有则按 §4.1 **新增**，不得先写旁路 API。
2. 禁止非标准化自定义接口承载业务写。
3. 需求必须明确：远程 MCP、风险标签、确认发送 / 确认阶段 / 商务审批、双端落地。
4. Agent 需求明确布局、组件、状态、管理端 / 员工端范围、时序是否仅管理端。

### 7.2 编码开发

1. 生产 IO 走远程 MCP，由 Codex turn 调用；Host 只做硬规则校验与闸门。
2. 对外能力 100% 经 Skill 入口；硬规则在 Host 并有测试。
3. 遵守 frontmatter、风险标签、幂等、鉴权。
4. Codex app-server 做业务循环；Host 做熔断、拦截、日志、确认闸门；不把阶段机下放到前端或 Prompt。
5. 双端不越权：员工端无配置、无 Skill 时序。
6. Agent 前端复用全局组件，不自定义消息块 / 时序 / 状态样式。

### 7.3 提测验收

1. Skill 元数据完整性（§3.2 必填字段）
2. 远程 MCP 连通与异常兜底；需要远程工具的 Skill 必须在 Codex turn 的 `mcp:` 里声明并走 app-server，禁止用 Host 代调冒充验收
3. 风险标签：L2 确认发送、L3 `confirm_stage` / `business_approval`
4. 15 阶段写入 + 8 段展示 + 异常旁路全流程
5. 爬虫抓取 / 过滤 / 打分 / 出入库
6. 双端权限：员工端无配置、无 Skill 时序
7. 溯源、日志、可审计
8. Agent‑UX：状态、消息块、管理端时序树、审批 diff、双端差异

### 7.4 上线评审

1. 无前端 / Prompt 硬编码阶段或发信
2. 无绕过远程 MCP 的生产写工具
3. L3 均有人确认；确认发送 ≠ 组织审批（组织 MCP 未建不挡发信预览）
4. Skill 版本、依赖、禁止事项完整
5. 双端无越权
6. 熔断、重试、兜底生效
7. Agent 页符合 UX，员工端无时序树

### 7.5 新增 Skill 检查单（发布必过）

- [ ] `SKILL.md` 主键、别名、必填、禁止事项
- [ ] catalog 自动收录，`in_market` 正确
- [ ] 自动化测试覆盖主路径与禁止事项
- [ ] 不发信 / 不改阶段（若声明只读）已用测试锁死
- [ ] 若发信：预览 → 确认发送；发送后阶段不变
- [ ] 若改阶段：只走 `confirm_stage` + `expected_version`
- [ ] 无新的旁路 REST / 前端直调
- [ ] 生产执行走 Codex app-server；SKILL.md 不写「由 Host 调用 MCP」
- [ ] 管理端时序可观测；员工端只见业务结果

---

## 八、全局反模式（CR 必拦）

1. 为生产写再造本地工具，绕过授权远程 MCP
2. 只写 Host / 前端 API，不沉淀 Skill（旁路 API）
3. 把阶段合法性、回执、占位、异常冻结只写进 Prompt 或 SKILL.md、代码不校验
4. L3 改阶段跳过 `confirm_stage`；真发信跳过「确认发送」
5. 员工端做后台配置、规则管控、权限修改
6. Agent 编排下放到前端 / 客户端
7. 把官方写入改成 8 个阶段枚举；或用人确认去绕开 Host 确认卡；或以相邻边约束 `legalTargets` / 人确认（`legalTargets` 无相邻约束）
8. 爬虫数据无 Skill + Host 校验直接入库
9. 无溯源的 AI 判断直接写成正式阶段
10. 跨层写逻辑（前端改阶段、MCP 里写状态机）
11. 临时需求只加接口，不进 catalog
12. Agent 页面私自改布局、自定义消息块
13. **员工端暴露 Skill / MCP 内部时序**
14. 平行新建 `kol_stage_identify` / `mail_formal_send` 等主键替换现网 Skill
15. 普通组信路径调用 `decryptKolContact` 或编造达人邮箱
16. From 默认邮箱列表第一只；两套发件栈混用
17. 异常轨道上自动事实推进主阶段
18. 生产业务 Skill 走 `runStub` / Host 直出，绕过 Codex app-server
19. SKILL.md 写「由 Host 调用 MCP」或 `mcp: []` 却靠 Host 代组结果
20. Host 正则 / TS 表作为信件种类、缺口、推荐文案、口令抽槽的真相源

---

## 九、规范生效规则

1. 研发文档优先级：`docs/灵工-Agent中台开发规范.md` 第一，本文第二。临时需求与口头优化不得覆盖这两份。
2. 新需求、迭代、Bug 修复必须先遵循中台规范，再遵循本文。冲突时以中台规范为准。阶段合法性等硬规则仍由 `backend/src/stages.ts` 与测试锁死。
3. Skill 新增、修改必须同步 `SKILL.md`、catalog、测试。
4. 分层、双端边界、员工端不暴露时序、风险标签、Agent‑UX 三栏为永久固定规则。
5. 组织 / 企微 MCP、完整机器 schema、TaskList 视觉补齐按迭代推进，不回溯推翻 §二、§四、§五。

---

## 十、修订对照

| 旧口径 | 现口径 |
|---|---|
| 零本地工具 | 生产 IO 远程 MCP，由 Codex turn 调用；Host 只闸门 |
| 100% Codex 编排 / Host 直出 | **生产业务 turn 必须走 Codex app-server**；Host 不是 harness |
| Host 中心化调度 / Host（APP‑Server） | 废除。harness = app-server；Host = 内核 |
| Skill 独占全部业务规则 | Skill = 入口 + 契约；硬规则在 Host |
| 禁止新增、封闭 25 个新 id | 允许新增；映射现网主键；catalog + SKILL.md + 测试 |
| 全部 L3 强制组织审批 | L1/L2/L3 映射现网闸门；确认发送 ≠ 组织审批 |
| 八大阶段 = 官方流程 | 展示 8 段 + 写入 15 + 旁路 |
| 管理端 / 员工端分裂；员工端无时序 | 保持；用词统一为员工端 |
| 超级用户无权限拦截 | 两端可进 + 可开调试；不能跳过确认闸门 |
| 员工端永久隐藏调度故不能触发任务 | 可触发已发布 Skill；隐藏的是引擎与术语 |
| 豆包三栏 + 主色 hex | 三栏为会话页基准；hex 不卡验收 |

---

## 附录 A · 需求输入模板（产品填空）

1. 业务对象（KOL / 合作 / 邮件 / 审批 / 爬虫）：
2. 现网 Skill 主键（无则走新增检查单）：
3. 风险标签（L1 / L2 / L3）与闸门（确认发送 / 确认阶段 / business_approval）：
4. 远程 MCP（已接 / 不接 / 后续）：
5. 是否改正式阶段（是则目标 `stage_code` + 证据）：
6. 页面归属（管理端 / 员工端）及员工端如何隐藏时序：
7. 标准组件（任务列表 / 业务卡 / L1–L3 消息块 / 管理端时序树）：
8. 验收句式或禁止事项：

## 附录 B · 相关代码锚点

硬规则（内核，允许指向 TS）：

- 正式阶段：`backend/src/stages.ts`
- 发送闸门：`backend/src/gateway/send.ts`
- 阶段写入：`hostConfirmStage`

业务契约与 harness（不要把目录指回 Host）：

- Skill 正文：`backend/skills/<id>/SKILL.md`
- Skill catalog：`backend/src/tasks/registry.ts`
- Codex harness：`backend/src/worker/codex.ts`、`runCodex`
- 中台规范（第一优先级）：`docs/灵工-Agent中台开发规范.md`
- Host 硬编码退场清单：`docs/Host硬编码改进.md`
- 视图：`frontend/src/viewMode.tsx`
