# 知识库治理与使用：管理端 / 员工端设计 · 技能与智能体引用机制

> 日期：2026-09-26
> 状态：设计规格（机制部分依据现行法推导；业务口径空白处保持登记，不替业务专家决定）
> 范围：知识资产治理（管理端能力与 UI/UX）、员工使用面（`/kb` 与引用呈现）、知识被技能/智能体引用的机制与数据模型、接口与审计契约（草案）
> 关联：[CONSTITUTION.md](../../CONSTITUTION.md)、[PRODUCT.md](../../PRODUCT.md)、[org-permissions.md](../../org-permissions.md)、[ia-information-architecture.md](../../ia-information-architecture.md)、[DESIGN.md](../../DESIGN.md)、[07-mcp-data-contract.md](../../07-mcp-data-contract.md)；实施见[实施计划](../plans/2026-09-26-knowledge-base-skill-agent-implementation.md)
> 本文件是实施规格，不声明生产代码已经完成。

## 1. 要解决的问题

1. **引用关系不可管理**：知识→技能只有 `knowledge.skill_id` 单值（`backend/src/host/knowledge.ts:49`，仅 `email_compose` 真消费），没有「哪个技能/智能体会取哪类知识」的对象；模板挑选靠阶段优先取首个（`backend/src/host/knowledge.ts:864-888`），没有绑定、没有试算、没有逐次解析回执。
2. **治理缺口**：`GET /api/knowledge` 对任何登录用户全量返回已发布知识（`backend/src/host/knowledge.ts:194-196`），无范围过滤——违反「权限在取数前校验，不能先取全量再过滤」（[PRODUCT.md](../../PRODUCT.md) PROD-AGENT-06；TECH-BE-01）；版本有行级快照但无 diff、无回滚（`backend/src/host/knowledge.ts:279-284`）；审批不绑定版本；反馈只有计数、没有处置流；提取作业状态不诚实（`backend/src/host/knowledge.ts:658-690`，`queued` 状态从未真实停留）。
3. **「被智能体引用」是空心声明**：`agents/kol/manifest.yaml` 与 `experts/*/manifest.yaml` 的 `skills[]`/`skill_ids[]` 只被展示与范围判定读取（`backend/src/contract-scope.ts:35,70-90`；`backend/src/experts.ts:177-190`），没有知识字段，也没有运行时绑定。**先补校验再对外宣称**（CONST-10）。
4. **检索路线未定**：外部提案倾向「命名空间 + 向量库 + GPU 讨论」；本仓栈固定为 SQLite + Codex harness（TECH-ARCH-01），无 embedding 依赖、无向量服务。需要一条可解释、可审计、零新依赖的起步路线。

## 2. 审宪记录（CONST-08）

| 项目 | 记录 |
|---|---|
| 需求 | 知识资产治理端（管理）与使用端（员工）能力与 UI/UX；知识被技能/智能体引用的声明-解析-校验-追溯机制；分期实施。 |
| 主责角色 | 平台产品经理（通用功能与资产治理机制）；UI/UX 专家（IA、视觉、无障碍）；KOL 业务专家（知识内容权威、审批口径、到期语义）；智能体产品经理（Agent 交互/记忆/引用呈现、检索工具准入）；架构师、前端专家、后端专家（实现）；测试经理（门禁证据）。 |
| 宪法条款 | CONST-02（平台提供知识能力）、CONST-03（已发布技能/知识/工具的组合，规则由代码强制）、CONST-04（角色决定权）、CONST-05（读/草稿/正式动作分清，管理员不能绕过）、CONST-06（知识保留来源、版本与时间）、CONST-07（两类入口）、CONST-08（本审宪）、CONST-09（实施细则不得覆盖上位条款）、CONST-10（不得以文档冒充生产能力）。 |
| 基本法条款 | PROD-PLAT-02/03/04/05/06/07；PROD-AGENT-01/03/04/05/06/07/09；BIZ-02/03/09/14/15；TECH-ARCH-01/02、TECH-BE-01/02/06/08、TECH-FE-01/02/03、TECH-TEST-01/02；细则：[ia-information-architecture.md](../../ia-information-architecture.md) §1/§2#5/§3/§4、[org-permissions.md](../../org-permissions.md)（范围、知识库行）、[DESIGN.md](../../DESIGN.md) 不变量、[07-mcp-data-contract.md](../../07-mcp-data-contract.md)（风险目录、真实调用、异步契约）。 |
| 结论与证据 | **总体符合**。① 治理/使用切分与「8 个治理动词」逐字对应现行法（[PRODUCT.md](../../PRODUCT.md) PROD-PLAT-04；[ia-information-architecture.md](../../ia-information-architecture.md) §2#5、§3；[org-permissions.md](../../org-permissions.md) 知识库行）；② 注入沿用 `workerSafeExtra` 白名单与四闸，不新增「模型读 wiki 原文」通道（`backend/src/host/knowledge.ts:812-848,927-948`；`backend/wikiskill/SKILL.md:28`）；③ 发布/停用/删除走「确认→执行→持久回执」（[DESIGN.md](../../DESIGN.md) 不变量 2；[org-permissions.md](../../org-permissions.md) 审批链与审计字段）；④ 检索前置范围过滤修复现行全量返回缺口（PROD-AGENT-06、TECH-BE-01）；⑤ 读取保留来源/版本/时间（CONST-06）。 |
| 规则空白 | ① 绑定声明格式与解析优先级——属实施细则，由本规格补齐，不改基本法；② 检索工具（M2）是否沿用「个人启用」四闸——交智能体产品经理；③ 到期/失效的业务语义（是否拦截检索、谁续期）——交 KOL 业务专家；④ kind 字典是否扩展（faq/case）与培训问答口径——交业务专家/平台产品经理。视觉 token 与设备适配数值统一服从 [DESIGN.md](../../DESIGN.md)（已由 UI/UX 专家在 ADR-2026-09-26 收敛）。 |
| 下一步 | 按本规格与实施计划分阶段落地；阶段 1 起代码另案启动。 |

## 3. 总纲

### 3.1 三层职责（本仓口径）

- **知识库（Wiki 层）= 事实素材源**：制度、方法与资料；版本化、可追溯；不携带执行逻辑。
- **Skill = 动作与规则**：何时取用、取哪一类、如何组装、输出与校验；**不写死模板原文**（保持现状）。
- **智能体 = 组合体**：按已发布范围组合技能/知识/工具；范围必须**声明 + 运行时校验**，否则不许对外宣称。
- **引用关系是对象**（新增）：绑定把「哪个技能会取哪类知识」变为可管理、可试算、可审计的配置。

### 3.2 与外部提案（WikiSkill 式）的对齐映射

| 外部提案 | 本仓落地 | 说明 |
|---|---|---|
| 命名空间（kol_business / product_training） | 范围（公司/组织/品牌/区域）+ 授权 grants | [org-permissions.md](../../org-permissions.md) 已定义范围维度；不新增命名空间重表（TECH-ARCH-01） |
| MySQL + 独立向量库 | SQLite（better-sqlite3）+ `backend/src/db.ts` 内联 schema + `backend/migrations/NNN_*.sql` 镜像留档 | 沿用现有迁移机制（`backend/src/db.ts:1043-1052`），不引入 ORM/新服务 |
| chunk / embedding / 向量检索 | 起步用显式选择器 + SQLite FTS5；embedding 后置（触发条件见 §4.5） | 零新依赖；外部数据契约与成本属单独决策 |
| `skill_wiki_binding` + Skill 内 `wiki` 字段自动检索注入 | `knowledge_bindings`（服务端配置）+ Host 侧解析器 | 不在全部 SKILL.md 强加新 frontmatter 字段；绑定在管理端治理 |
| 检索结果注入 `{{wiki_context}}` | 保持白名单，注入**编译后的载荷**（按 kind 定义 payload） | `backend/src/host/knowledge.ts:927-948` |
| trace / feedback | 审计事件 `knowledge.resolve`；反馈沿用三原因 + 处置流 | `backend/src/db.ts` `audit_events` |
| Maintainer / Proposer 离线闭环 | 复用 `knowledge_proposals`（shadow、人审、否决留档、永不自动改主文档） | `backend/src/host/knowledge.ts:697-786`；`backend/wikiskill/SKILL.md:29-32` |
| GPU / 本地模型 | 不引入；LLM 走 Codex harness，判型已有外部 API 通道（`backend/src/tasks/openai-intent.ts:1-5`） | 结论：框架不需要 GPU；在线优先 API |

### 3.3 三条硬原则（沿用现状，不得回退）

1. **注入的永远是「编译载荷」**：模板 → `subject/body_en/placeholders`；其他 kind 为「结构化字段 + 来源 + 版本」。不得让模型读 wiki 原文。
2. **权限先于取数**：解析、检索、列表都在服务端先做范围与状态过滤；禁止「先召回、再过滤」。
3. **AI 只产候选**：自动提炼、演化、案例生成一律进入待审队列；正式文档只能人工编辑、人工发布。

## 4. 功能设计

### 4.1 生命周期与闸门

```text
上传(raw) → 提取(候选) → 修订(=新版本) → 审核(绑定版本) → 发布(L3+回执)
          → 停用/归档(从解析与员工面移除) → 版本追踪(diff / 回滚=生成新版本)
```

- **四闸保留**：`published` + 范围匹配 + 个人启用（cite）+ 未被个人隐藏（deprecate）（`backend/src/host/knowledge.ts:812-848`）；新增「已过期」为解析跳过原因之一（到期语义见 §10 空白 3，先只做标记与提示，不自动删除）。
- **审核绑定版本**（BIZ-15）：审批请求必须携带被审版本号；与当前版本不一致返回 409（「内容已变，重新审核」）；审批通过后该版本行置为 published，并记录审批人/时间。
- **保存草稿 ≠ 发布生效**（PROD-PLAT-05）：编辑永远写新草稿版本；发布确认框展示「变更对象 / 影响范围 / 生效版本」。
- **回滚 = 生成新版本**：以历史版本内容创建新版本（默认 draft 或 pending_review），不改写历史行。

### 4.2 引用机制（三种，分期落地）

| 机制 | 形态 | 适用 | 阶段 |
|---|---|---|---|
| **M1 绑定注入** | 管理端配置绑定（选择器：显式 id / kind / tags / 阶段 / 品牌 / 语言）；Host 运行时解析、四闸校验、按 kind 编译载荷注入 CONTEXT；**每次解析写入审计与跳过原因** | 邮件模板（现有链路的泛化），后续制度类注入 | 阶段 1（先在 `email_compose` 上跑通闭环） |
| **M2 检索工具** | 强化 `search_knowledge`（现为占位：`backend/mcp/tools.ts:307-313`）：服务端范围前置过滤、仅 published、返回「片段 + 来源 + 版本 + 时间」、限量与截断；**登记进目标技能 `mcp[]` 白名单才可用** | 培训问答等开放式场景 | 阶段 4（准入门槛为空白项 ②） |
| **M3 智能体范围** | manifest 声明知识范围（发布期校验），运行时与技能解析求交 | 「被智能体引用」 | 阶段 4（先补校验再宣称） |

**解析优先级（实施细则，本轮定稿）**：

1. 显式 `knowledge_id`（用户选定/回执钉住）最高；
2. 绑定选择器命中：阶段精确命中 > 通配（`stage_codes` 空 = 全阶段）；品牌精确 > `*`；同分取最新发布版本；
3. 无绑定命中时回退现行「本人已启用集合 + 阶段优先」挑选（兼容现有行为，避免破坏 `email_compose`）。

**跳过原因枚举（必须可解释、可入审计）**：
`not_published`｜`scope_mismatch`｜`not_cited`｜`deprecated_by_user`｜`expired`｜`shadowed_by_higher_priority`｜`binding_disabled`｜`missing`（显式 id 找不到行）。
显式 ids 钉住的条目同样过四闸（一次评估、不重复计入）。

### 4.3 数据模型增量（SQLite；写入 `backend/src/db.ts`，镜像 `backend/migrations/012_*.sql`）

- `knowledge` 增列：`effective_at`、`expires_at`（可空；展示与筛选用，不做自动删除）。
- 新表 `knowledge_grants`：`id, knowledge_id, scope('org'|'team'|'user'), scope_id, granted_by, granted_at`。
  **语义（按对象收窄）**：某条知识出现授权行时仅授权范围可见；无授权行者维持现行「已发布即可见」。与 `skill_grants` 的全局空表语义不同，此处取增量收窄，避免一次性改变全量可见性（`backend/src/host/grants.ts:36-61` 为对照实现）。
- 新表 `knowledge_bindings`：`id, skill_id, selector(JSON), enabled, note, created_by, created_at, updated_at`。
- 审计事件：`knowledge.resolve`（每次运行：解析到 id+版本、跳过项与原因）、`knowledge.binding.save`、`knowledge.grant.save`、`knowledge.rollback`、`knowledge.feedback.handle`。
- **不加** chunk / embedding / vector 表。

### 4.4 反馈与管理闭环

- 员工反馈沿用三原因（过时 / 品牌用不上 / 发出去容易被拦，`backend/src/host/knowledge.ts:21-25`）。
- 管理端**处置流**：转为修订（生成新草稿版本，进入正常审核）/ 归档 / 忽略（留理由），全部写审计与回执。
- 采纳/改写统计只读推导（从草稿与发送审计聚合），不做模型打分。
- 案例候选走 `knowledge_proposals`（shadow、人审、否决留档）；**AI 永不自动改主文档**。
- 门禁：发布前展示「影响面」（依赖该知识的技能/专家列表）；阶段 4 起对已绑定技能提示/要求跑相关 `skill_tests`（`backend/src/host/skill-lifecycle.ts` 既有测试运行器）。

### 4.5 检索与算力路线

- 阶段 1–3：确定性选择器，无自由检索；阶段 4：SQLite FTS5 关键词 + 过滤（零新依赖）。
- embedding / 向量库的**触发条件**（未满足前不做）：① FTS 命中率实测不达标（需评测数据）；② 外部数据契约与成本决策通过（[07-mcp-data-contract.md](../../07-mcp-data-contract.md) 的真实调用规则）；③ 届时仍可选 API 方案（零 GPU）。
- 结论：**框架不需要 GPU**；在线优先 API；本仓当前无本地模型、无向量服务，不引入。

### 4.6 场景走查

**场景一：邮件模板管理（阶段 1–3 交付）**

1. 运营在管理端上传新版模板 → 提取候选 → 编辑为新版本 → 审批（绑版本）→ 发布（L3 确认 + 回执）。
2. 技能零改动：绑定已存在，`email_compose` 下次运行时解析到新版本并注入；解析写入 `knowledge.resolve` 审计。
3. 员工端 `/kb` 看到新版（来源、版本、时间）；草稿与发送回执显示「模板：{标题} v{n}」引用芯片。

**场景二：产品培训问答（阶段 4 试点，依赖空白项 ②④）**

1. 上传产品手册/FAQ → 治理入库；kind 扩展（见空白 4）。
2. 培训问答技能声明 `mcp[]` 含强化后的 `search_knowledge`；回答带「来源 + 版本 + 时间」引用，知识不足时诚实回复「不知道」。
3. 检索前置范围过滤，只返回该用户可见知识；检索回执进入审计。

## 5. 管理端设计

### 5.1 能力清单

| 能力 | 条款 | 现状 | 阶段 |
|---|---|---|---|
| 上传/提取（文件预览、失败重试、真实终态） | PROD-PLAT-04 | 有，同步、作业状态不诚实 | 1 |
| 修订（新版本）/ 审核（绑版本）/ 发布（L3+回执） | PROD-PLAT-04/05、BIZ-15 | 有，缺版本绑定与 409 保护 | 1 |
| 版本 diff / 回滚（=新版本） | PROD-PLAT-03 | **缺** | 1 |
| 范围授权（grants）与列表范围过滤 | org-permissions、PROD-AGENT-06 | 全量返回，**缺口** | 1 |
| 引用关系（绑定表、正反向查询） | 本规格新增（实施细则） | **缺** | 1 |
| 解析试算台（命中/跳过原因） | 本规格新增 | **缺** | 1 |
| 反馈处置（转修订/归档/忽略）与到期清单 | PROD-PLAT-04 | 只有计数 | 1–2 |
| 审计回放（`knowledge.*` 切片，关联 Worker Trace） | [ia-information-architecture.md](../../ia-information-architecture.md) §2#9 | 有基础 | 1–2 |
| 检索工具治理（工具准入、检索回执） | 07、PROD-AGENT-03 | 占位工具 | 4 |
| 智能体范围治理（发布期校验） | org-permissions | **缺** | 4 |

### 5.2 页面规范（一页一问；`/admin/knowledge` 子视图）

统一要求：纵滚治理表/行、页头治理标题、行内动作一律链接式样式（不抢主 CTA）、每视口 0–1 实底主 CTA、状态不靠颜色、L3 动作走 `ConfirmDialog` + 持久回执。建议 DOM 契约：`data-admin-kb-view="todo|assets|detail|ingest|bindings|feedback"`。

| 路由 | 只回答 | 主 CTA | 结构与关键要素 |
|---|---|---|---|
| `/admin/knowledge`（待办） | 有什么在等我决定？ | 无（行内链接式） | 待审、草稿、隔离提案、到期提醒、超阈值反馈；每行 → 详情 |
| `/admin/knowledge/assets` | 有哪些资产、什么状态、被谁用？ | 「新建知识」 | 治理表：标题/类型/状态/版本/适用/引用数/更新；筛选 kind/status/品牌/技能；行 → 资产详情 |
| `/admin/knowledge/assets/:id` | 这份资产的治理状态与影响面？ | 按状态唯一渲染：「编辑为新版本」或「审批发布」 | 正文与元数据；版本时间线（diff 入口、回滚）；范围与 grants；引用列表（技能/专家）；引用回执；审计切片 |
| `/admin/knowledge/ingest` | 素材入库与提取成败？ | 「上传资料」 | raw 列表、提取真实状态与失败重试、抽取候选预览（确认后生成待审稿，L2） |
| `/admin/knowledge/bindings` | 哪些技能会拿到哪些知识、为什么？ | 「新增绑定」 | 绑定表（技能 × 选择器 × 当前可解析数 × 启用）；试算台；启用/停用（L2 配置，明确「保存≠生效」提示） |
| `/admin/knowledge/feedback` | 员工反馈了什么、怎么处置？ | 「转为修订」（选中后） | 原因聚合与明细、处置记录、到期清单 |

### 5.3 关键交互与状态

- **L3 动作**（发布 / 停用-归档 / 删除-仅草稿 / 跨品牌转移）：事实清单（变更对象 / 影响范围 / 生效版本 / 后果）+ 必填理由 + 持久回执；沿用既有 `frontend/src/adminConfirm.ts` 构建器与 `frontend/src/components/ConfirmDialog.tsx`。
- **版本 diff**：新建只读对比组件（当前无 diff 组件）；旧文保留、结构化字段逐项对照。
- **绑定与试算**：选择器构建 + 样例上下文（技能 / 用户 / 阶段 / 品牌）→ 展示将注入的载荷摘要与逐条跳过原因。
- **过期确认失效**：对话框打开期间版本已变则拒绝提交并刷新（TECH-FE-03）。
- **诚实状态**：上传/提取/重试真实终态；空态、错误态（复用 `frontend/src/home/surfaceError.ts` 映射）、非 admin 重定向（`frontend/src/pages/AdminConsole.tsx:100`）。

### 5.4 视觉与无障碍

沿用 Admin 治理 IA 与 `frontend/src/styles.css` 既有 token（[org-permissions.md](../../org-permissions.md) 视觉条；[DESIGN.md](../../DESIGN.md)）；宽表受控横向滚动、窄屏按 ui-ux-rules 数据表规则降级；focus-visible、触摸命中区达标、不依赖 hover；**不新增数值**（token 来源冲突保持登记）。

## 6. 员工端（员工使用面）设计

### 6.1 `/kb` 页面规范

- **列表**：行式（标题 ｜ 类型 ｜ 适用 chips（阶段/品牌） ｜ 版本·更新于）；类型分栏、搜索（服务端 `?q=`，阶段 3）、适用筛选、最近使用。
- **详情抽屉**：全文（内部滚动、不裁切）、占位符高亮、来源与版本行（发布人/时间/原始资料）、适用范围、启用/取消启用、反馈（三原因 + 备注）、「用于当前任务」。
- **用于当前任务**：沿用现有链路（composer 锁定 chip → 会话/草稿携带 `knowledge_id`）→ 草稿与回执显示引用芯片。

### 6.2 引用呈现（草稿 / 发送回执 / 回答）

- 芯片格式：「模板：{标题} v{n}」；**仅当草稿确实带 `knowledge_id` 时渲染**，缺失即不渲染（不宣称来源）；标题取不到时降级 `#{id}`。
- 历史回执必须可回看：即使知识后来停用或范围收窄，回执仍显示**当时**的 id + 版本（CONST-06：保留来源、版本与时间）。
- 点击芯片打开对应抽屉（只读）为后续项；「制度」类芯片随对应 kind 真正进入运行时注入后再启用；知识不足时按 PROD-AGENT-03 区分事实/推断/缺失，不编造来源。

### 6.3 禁止项核对（[org-permissions.md](../../org-permissions.md) 知识库行逐条）

| 禁止项 | 本设计 |
|---|---|
| 员工面做成邮件模板管理台 | 治理全部留在 Admin；员工面只读 + 个人启用/隐藏 |
| 主 CTA 是 启用/停用/发布/隐藏 | 员工面唯一主操作是「用于当前任务」；启用/隐藏为次级动作 |
| 从 KB 发信或写阶段 | 不涉及；发送仍走草稿 L3 与 Stage 确认 |
| KB 首页写 Codex / harness | 不出现 |

### 6.4 状态与无障碍

空态（无可见知识时说明范围原因）、错态（重试 + 交给 Agent）、未启用/已隐藏提示、长文内部滚动、focus-visible、触摸命中区达标、深色模式对照。

## 7. 接口与审计契约（草案；最终以实施为准）

| 方法/路径 | 端 | 副作用层级 | 说明 |
|---|---|---|---|
| `GET /api/knowledge?q=&kind=&stage=&brand=` | 员工 | L1 | 扩展现行全量接口：服务端范围过滤 + 关键词 + 分页 |
| `GET /api/knowledge/:id/versions`（扩展） | 员工/管理 | L1 | 版本元数据（来源、版本、时间） |
| `GET /api/admin/knowledge/assets` | 管理 | L1 | 治理表数据（含引用数） |
| `GET /api/admin/knowledge/:id/versions/:v` | 管理 | L1 | 指定版本全文（diff 渲染用） |
| `POST /api/admin/knowledge/:id/rollback` | 管理 | L2 | 以历史版本生成新版本（非发布） |
| `POST /api/admin/knowledge/:id/approve`（扩展） | 管理 | L3 | 携带被审版本号；不一致 409；通过写回执 |
| `GET/PUT /api/admin/knowledge/:id/grants` | 管理 | L1/L2 | 范围授权（按对象收窄） |
| `GET/POST /api/admin/knowledge/bindings`、`PATCH/DELETE …/:id` | 管理 | L1/L2 | 绑定 CRUD；保存 ≠ 生效提示 |
| `POST /api/admin/knowledge/resolve-preview` | 管理 | L1 | 试算：载荷摘要 + 跳过原因 |
| `GET /api/admin/knowledge/feedback`、`POST /api/admin/knowledge/:id/feedback-handle` | 管理 | L1/L2 | 反馈明细与处置 |
| 审计事件 | — | — | `knowledge.resolve`、`knowledge.binding.save`、`knowledge.grant.save`、`knowledge.rollback`、`knowledge.feedback.handle` |

## 8. 实施分期（概要）

| 阶段 | 目标 | 验收门 |
|---|---|---|
| 1 后端治理骨架 | 范围过滤/grants、版本 diff/回滚、审批绑版本、绑定与解析器、试算 API、`knowledge.resolve` 审计 | `npm run typecheck`、`npm test`（新增 `backend/tests/knowledge-governance.test.ts`） |
| 2 管理端 UI | 六子视图、diff 组件、L3 回执、试算台 | frontend `typecheck`/`build`/`test:e2e` |
| 3 员工端 | `/kb` 行式化与详情、搜索 API、引用芯片、反馈处置入口 | 同上 |
| 4 检索与闭环（另案） | `search_knowledge` 强化并登记进技能 `mcp[]`、培训问答试点、kind 扩展、案例候选、门禁收紧、智能体范围校验 | `npm run release:gate`（含 `eval:kol`） |

文件级步骤见[实施计划](../plans/2026-09-26-knowledge-base-skill-agent-implementation.md)。

## 9. 验收矩阵

| 维度 | 通过标准 |
|---|---|
| 桌面（1280/1440/1680 × 900，指针） | 每视口 0–1 实底 CTA；至少一行完整对象；页脚不裁切；宽表受控横向滚动 |
| 触摸（≤860，粗指针） | 抽屉/分段导航；命中区达标；无整页横向滚动 |
| 键盘 | 行内动作可达、focus-visible、对话框焦点锁定 |
| 深色模式 | 状态、分隔、对比达标（状态不靠颜色） |
| 行为 | 解析跳过原因可见；L3 确认 + 持久回执；范围过滤生效（不可见知识不出现在列表、不可被引用）；审批版本 409 生效 |

## 10. 规则空白登记

| # | 空白 | 归属角色 | 影响 |
|---|---|---|---|
| 1 | 绑定声明格式与解析优先级 | 平台产品经理（本规格已按实施细则定稿，如有异议再调） | 阶段 1 |
| 2 | 检索工具是否沿用「个人启用」四闸 | 智能体产品经理 | 阶段 4 |
| 3 | 到期/失效语义（是否拦截、谁续期） | KOL 业务专家 | 阶段 4 前 |
| 4 | kind 扩展（faq/case）与培训问答口径 | KOL 业务专家 / 平台产品经理 | 阶段 4 |

## 11. 完成定义

- 每阶段：文件级变更完成 + 验收门命令通过 + 执行记录填写（见实施计划模板）；**不以文档或测试冒充生产能力**（CONST-10）。
- 管理端发布/停用/删除：确认 + 回执 + 审计三件齐备才算完成。
- 员工端引用芯片：`knowledge_id/version` 可回放（发送审计既有字段）。

## 12. 不做（非目标）

- 不建 MySQL、不引入向量库/embedding 服务、不上 GPU（触发条件见 §4.5）。
- 不引入命名空间重表；范围沿用既有组织/品牌/区域维度。
- 不让模型读 wiki 原文；注入永远是编译载荷。
- 不允许 AI 自动修改主文档（只产候选、人审门禁）。
- 不新增顶层导航；不把 `/kb` 写成治理页；不在管理端做第二套 Home。
- 不改权限/审批/阶段/发信闸门；不绕 Host Gateway；不 LIVE。
- 不替业务专家决定内容口径、审批口径与 kind 字典扩展。
