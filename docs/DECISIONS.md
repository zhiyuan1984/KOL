# 关键决策记录入口

本文件是决策索引，不替代规范正文。涉及规范冲突、不可逆副作用、组织范围、物理接口漂移或架构取舍时，先在这里登记，再更新 canonical 文档和追踪矩阵。

## 近期记录

| 日期 | 记录 | 说明 |
|---|---|---|
| 2026-09-15 | #105 之后法律层重组为 A–K。目录 `LAW-MAP.md`；导航不再以 `00`–`21` 为主线。`design.md` = `docs/design.md`（MASTER 仍是 token）。ADR-011 由阶段图兄弟 track 废止 | 见 ADR-026。文档 only。不 LIVE。不发明阶段边。 |
| 2026-09-15 | 删除全部 `docs/evidence-*`、`04`、`19`、`employee-surface-contracts.md`、`FS-KOL-006`、`FS-KOL-010`、ADR-018、ADR-022。必须项只留在宪法 + 瘦 `UX-EMPLOYEE` | 用户锁定。见 ADR-025。文档 / 契约 only。不 LIVE。 |
| 2026-09-15 | 删除过细 UX 合同 `UX-KOL.md`、`UX-FOLLOWED-KOL-CARD.md`，以及把 `UX-SEND-NE-STAGE` 当独立合同 ID 的绑定。瘦契约 `specs/UX-EMPLOYEE.md` 只从宪法派生。门禁硬不变量只留 `SEND_NE_STAGE`、`L3_CONFIRM` | 见 ADR-024 / ADR-025。 |
| 2026-09-14 | 产品是**智能体中台**。十六项一等能力互不隶属、不隶属 KOL Agent。KOL 只是首个试点；Pipeline / Home「AI发现」「我跟进的红人」是试点特化 | 见 ADR-023、`CONSTITUTION.md` §4.1–4.2。 |
| 2026-09-14 | 员工 `/kb` **不是**邮件模板管理台 | 见 ADR-021、宪法 §4.1。 |
| 2026-09-14 | 员工工作台**全局正文基线 16px**；控件 ≥14px；禁止 scale/zoom 假装字号 | 见 ADR-020、`20-visual-design-system.md`。 |
| 2026-09-13 | 邮件往来摘要 Codex `thread/start` 与识别一致：`CODEX_MODEL` / CLI 默认，不传 `gpt-5.6-luna` | 不改 provider 顺序或 sticky-fail。 |
| 2026-09-14 | 并列能力面与 Agent / 任务解耦 | 见 ADR-015、`21-admin-employee-page-roles.md`。 |
| 2026-09-14 | 专家中心 = 召唤岗位专家；召唤 ≠ 发送/阶段 | 见 ADR-016、`21-admin-employee-page-roles.md`。 |
| 2026-09-14 | 首版 `/api/experts` 落实 ADR-016：仅已发布岗位专家 `expert:kol` | 见 ADR-017。 |
| 2026-09-14 | Home AI发现条件区：平台/地区单选芯片；方向多选最多 8；NL 主输入、芯片纠正 | 见 ADR-019。服从宪法 §4.2，不再服从已删 ADR-018。 |

## 已固化决策

| ID | 决策 | 依据 |
|---|---|---|
| ADR-001 | Codex harness = Codex app-server；Host 是内核，不是业务调度器 | `06-codex-harness.md` |
| ADR-002 | 组织树与品牌维度分离；LT/PQ/RO/TB 是品牌 | `01-organization-tenancy.md`、`12-kol-agent.md` |
| ADR-003 | 展示 8 段与正式写入 15 阶段分离 | `05-agent-workflow-skill-policy.md` |
| ADR-004 | 草稿、发送、阶段变更是独立产物和动作 | `03-prd-and-functional-spec.md`、`08-permission-approval-audit.md` |
| ADR-005 | Stub 只用于确定性测试，真实验收必须走 app-server + 授权 MCP | `06-codex-harness.md`、`10-test-evaluation.md` |
| ADR-006 | 新增 Agent 以配置、Skill、Workflow、Policy、MCP 声明为主 | `13-migration-roadmap.md` |
| ADR-007 | 新增 Agent 分为配置型、Skill 型、MCP 型、内核型；配置化不代表零代码 | `agents/kol/manifest.yaml`、`13-migration-roadmap.md` |
| ADR-008 | Starry MCP 不是独立组织授权源，但其邮箱负责人/授权结果可与已确认组织证据和 registry 绑定共同完成安培时代试点 PEP 核验 | `18-mcp-master-data-assessment.md`、`01-organization-tenancy.md` |
| ADR-009 | 安培时代部门负责人（张慧玲、刘敏）自动拥有公司全部品牌、区域和普通业务数据读写；高风险动作仍受 Gateway/确认/审批约束 | `config/org-registry.yaml`、`01-organization-tenancy.md` |
| ADR-010 | 试点 PEP 的授权证据由组织截图、100%真实邮箱负责人清单、远程 Starry MCP 只读结果和 registry 绑定共同构成；未补齐的身份元数据不阻断试点授权 | `config/org-registry.yaml`、`18-mcp-master-data-assessment.md` |
| ADR-011 | Starry 阶段写入用原生码；人跳过只在 Host 记账；远程只走相邻前进（跨段则逐格 walk）。**将由阶段图 track 废止**（ADR-026）；本记录暂留正文 | `05-agent-workflow-skill-policy.md`、`planStarryAdjacentWalk` / `changeLifecycleStage` |
| ADR-012 | 页职责：Home+Chat=平台任务/会话脊柱；Pipeline=**KOL 试点**生命周期页（禁止复制 Home 待办）；Admin=谁/权限/审计 | `CONSTITUTION.md` §4.2 |
| ADR-013 | 管理端是员工表面的配套治理套件，不是副本；连接器**治理**只在 `/admin/connectors`，员工**使用面**独立（`/connectors`），Agent 治理在 `/admin/agents`，个人 Starry 绑定只留 Settings。Pipeline 是 KOL 试点页，不是「员工四表面」平台核 | `21-admin-employee-page-roles.md`、`CONSTITUTION.md` §4.2 |
| ADR-014 | 员工侧栏：定时任务归今日工作簇；簇间用分割线，不画可见「今日 / 智能体 / 资产」组标题 | `CONSTITUTION.md` §4.1、`21-admin-employee-page-roles.md` |
| ADR-015 | 并列能力面与任务/数字员工解耦；清单以 §4.1 十六项为准（含技能、数字团队预留）。KOL 只作数据不定义 IA；「支撑」≠ 二等；治理仍 Admin-only | `CONSTITUTION.md` §4.1、`21-admin-employee-page-roles.md` |
| ADR-016 | 员工 `/agents` 只召唤已发布岗位专家；无专家团；禁止把引擎 chrome / 技能图鉴做成 `/agents` 主 IA。**修订（ADR-023）：** 产品「技能」一等，侧栏露出=UX，不是「员工默认禁止 Skill」。召唤只建绑定、不发信不写阶段 | `CONSTITUTION.md` §4.1、`21-admin-employee-page-roles.md` |
| ADR-017 | 首版 `ExpertManifest` + `/api/experts` 落实 ADR-016：仅 `expert:kol` 已发布；召唤持久化 `expert_id`/`expert_version`；无专家团 API | `02-domain-model.md`、`14-implementation-contract.md`、`experts/kol/manifest.yaml` |
| ADR-019 | Home AI发现条件区：平台/地区单选芯片；方向多选最多 8；NL 主输入、芯片纠正、计划跟芯片；重置不清空 NL；无 TikTok、无「全部平台」。服从宪法 §4.2 | `CONSTITUTION.md` §4.2 |
| ADR-020 | 员工工作台正文基线 **16px**；UI / 按钮 / Tab / helper **≥14px**；禁止 scale/zoom 假装字号；Linear 密度靠间距与阴影，不靠缩小正文 | `20-visual-design-system.md` |
| ADR-021 | 员工 `/kb` 是并列能力面（ADR-015）：查找 / 理解适用场景 / 预览 / 收藏 / 用于当前任务；禁止邮件模板管理台与引擎行话；应用只产未发送草稿；卡片元数据底线先立法、schema 可后补 | `CONSTITUTION.md` §4.1、`14-implementation-contract.md`、`21-admin-employee-page-roles.md` |
| ADR-023 | 智能体中台十六项一等能力；KOL=首个试点不是平台壳；技能入口密度=UX；数字团队预留未实现，禁止专家团假导航。Pipeline 页只许深链 / CTA | `CONSTITUTION.md`、`21-admin-employee-page-roles.md` |
| ADR-024 | 删除 `UX-KOL.md` / `UX-FOLLOWED-KOL-CARD.md` / `UX-SEND-NE-STAGE`-as-file-ID。员工 UX 从宪法派生为 `specs/UX-EMPLOYEE.md`。门禁只绑 `SEND_NE_STAGE`、`L3_CONFIRM` | `CONSTITUTION.md` §4–5、`specs/UX-EMPLOYEE.md` |
| ADR-025 | 删除全部 `docs/evidence-*`、`04`、`19`、`employee-surface-contracts.md`、`FS-KOL-006`、`FS-KOL-010`、ADR-018、ADR-022。必须项只住在宪法 + 瘦 `UX-EMPLOYEE`。不新开 FS | `CONSTITUTION.md`、`specs/UX-EMPLOYEE.md` |
| ADR-026 | #105 后法律层 A–K 重组。导航以 `LAW-MAP.md` 为准，不以 `00`–`21` 为主线。UI 设计路径 = `docs/design.md`；MASTER 仍是 token 源。ADR-011 由阶段图兄弟 track 废止 | `docs/LAW-MAP.md`、`docs/README.md`、`docs/stage-graph.md` |

**废止读法：** 「四页法律 / 四页分工 / 员工四表面」不得再被读成 Pipeline 是平台核心导航。现行：Home+Chat = 平台任务/会话脊柱；Pipeline = KOL 试点页（§4.2）。后文若仍写「四页法律」一律按此句，不以旧 P0 为准。权威清单仍是 `CONSTITUTION.md` §4.1–4.2。

## 新增 Agent 分级

| 级别 | 典型变更 | 允许做法 | 必须门禁 |
|---|---|---|---|
| 配置型 | 已有 MCP/实体上的新流程、文案、知识、审批人 | manifest / Skill / Policy / 知识 | 契约编译、评价样例、范围校验 |
| Skill 型 | 新业务意图，但工具和实体已存在 | 新 Skill 契约、测试和 EVAL | 不得新增 Host 调度器 |
| MCP 型 | 新外部 API 或工具 | adapter、物理契约、风险标记 | 写工具必须 Gateway/审批分类 |
| 内核型 | 新主数据、状态机或副作用类型 | 平台代码、安全评审和迁移 | 不得用配置绕过内核 |

## 记录模板

```text
ID / 日期 / 状态
问题与背景
候选方案与证据
决定与不决定的范围
影响的规范、代码、测试和评价
回滚条件与复审日期
决策人：业务 / 产品 / 工程 / 测试 / 运维
```

## ADR-011 — Starry 写入原生码与 Host-only 跳过（2026-09-13）

**状态**：已固化；**将由阶段图 track 废止**（ADR-026）。本文件暂留正文，本 track 不删除。  
**决策人**：业务 owner

### 问题与背景

Host 用 15 段 + 旁路的本地码（如 `NEGOTIATING`）做确认卡、审计和协作状态。Starry 生命周期用另一套原生码（如 `BUSINESS_NEGOTIATION`）。先前把「官方写入码」定成 Host-local，远程 `changeLifecycleStage` 收到 `NEGOTIATING` 等 Host 码。人跳过/纠正时，也不该要求 Starry 理解 skip 语义或接收中间阶段。

### 决定

1. **Starry 写入码 = Starry 原生码，远程字段是 `toStageCode`。** `changeLifecycleStage` 顶层参数只能是 `{ lifecycleId, requestJson }`；`requestJson` 为 `{ toStageCode, reason }`，`toStageCode` 经 `LEGACY_STAGE_ALIASES` / `toLegacyStarryStage` 发出原生码（Host `NEGOTIATING` / `商务谈判` → `BUSINESS_NEGOTIATION`）。不要写 `cooperationStageCode` / `targetStageCode` / `stageCode`（LIVE 上会误报回退）。读取继续 `normalizeStage` / `codeFromLabel` 归一成 Host-local。LIVE 形状已由 Host 按此发送（`KOL202607300002` lifecycle 16，`INTEREST_CONFIRMED` → `COOPERATION_EVALUATION`）。
2. **人跳过是 Host-only 语义；远程只接受相邻前进。** 人确认 skip/jump 时，Host 把 skip kind、原因、被跳过的 Host 码记在确认卡、`host.confirm_stage` 审计和本地 `collaborations`（`last_skip_*`）。Starry 不能理解 skip，也**禁止**一次 `changeLifecycleStage` 写入非相邻落地阶段。跨多格主流程时，Host 按 `planStarryAdjacentWalk` **逐格相邻前进**走到落地，每格一次 `{ lifecycleId, requestJson: { toStageCode, reason } }`；一格失败则停止并回传远程错误。单格相邻确认仍只写一次。纠正/异常不是相邻前进，远程跳过（`not_adjacent_forward`）。自动事实路径仍走 `autoLegalTargets` / evidence pointer。

### 不决定的范围

不放宽 `LIVE_*` / Gateway / confirm-before-send。相邻 hop 的 LIVE 写入已在允许名单 KOL 上证明可通，**不是完整生产放行**，也不是全量 skip-walk LIVE PASS。

### 影响

- 规范：`05-agent-workflow-skill-policy.md`（`legalTargets` vs `autoLegalTargets`，`confirm_stage` 写路径）
- 代码：`planStarryAdjacentWalk`、`writeRemoteOfficialStage`（单 hop 邻接校验）、`writeRemoteOfficialStageWalk`、`syncConfirmedStageToMcp`
- 测试：`changeLifecycleStage` 仅 `{ lifecycleId, requestJson: { toStageCode, reason } }`；skip → adjacent walk；确认卡/审计保留 skip 原因

## ADR-012 — 页职责与 Pipeline 非目标（2026-09-13；§4.2 修订）

**状态**：已固化  
**决策人**：产品负责人

### 问题与背景

Pipeline 曾把首页任务芯片、「本页动作」伪芯片和 Chat 会话启动器叠在资产页上，并在无 `?kol=` 时自动选中第一名红人。这让 Pipeline 回答「现在做什么 / 等待中」，与 Home 的等待诚实重复，也把写邮件、回复分析、风险扫描变成了第二套工作入口。

### 决定

1. **平台脊柱 + 试点页各答一问。** Home + Chat = 平台任务/会话脊柱（现在做什么；完成一件具体任务）。Pipeline = **KOL 试点**正式生命周期页，不是平台核心导航。Admin = 谁 / 权限 / 审计。Pipeline 仍禁止复制 Home 待办。页只许深链 / 产品内 CTA。
2. **Pipeline 是资产页，不是待办页。** 只展示正式阶段、品牌/负责人、停留、近期事件、同步来源/时间、阶段风险、允许的阶段变更提案。筛选限于 `brand|owner|stage|region|kol|sync` 与旁路/异常侧状态。无 `?kol=` 时不默认选中第一名红人；详情是次要抽屉，不是主栏小说。
3. **阶段动作只有「提出阶段变更」。** 打开既有合作会话的 `confirm_stage` 确认卡，走既有人确认 / 审批 / 写入。不在 Pipeline 发明 LIVE 发送、新权限模型，也不为邮件/分析/风险快捷方式新建 Chat 会话。
4. **缺字段用诚实空态。** `api.pipeline` 已有阶段/停留/负责人则展示；近期事件、同步时间、往来摘要、审计若未返回，省略或写「本页未返回」，不得伪造。

### 不决定的范围

不重做 Home 等待态，不重做 Agents，不改 Chat 主线程，不新增 Pipeline 专用后端，不宣称 LIVE 发送/阶段写入。

### 影响

- 规范：`CONSTITUTION.md` §4.2
- 代码：`frontend/src/pages/Pipeline.tsx` 及 Pipeline CSS
- 测试：Stub Playwright 去掉首页任务芯片、自动选中和伪看板动作断言

## ADR-013 — 管理端配套套件，不是员工表面副本（2026-09-13）

**状态**：已固化  
**决策人**：产品负责人

### 问题与背景

Admin 导航和页面与员工连接器/智能体表面重叠：员工侧栏深链 `/admin/connectors`，管理端顶栏跳员工 `/agents`，两端共用 remote-pill chrome，Starry 个人绑定同时挂在 Admin 与 Settings，`Admin.tsx` / SkillHub / SimplePages 各维护一份连接器清单。这让管理端回答「现在从哪开工」，与宪法 Admin 行（谁 / 权限 / 审计）和 Agents 工作入口冲突。

### 决定

1. **不改平台脊柱。** Home+Chat 仍是任务/会话面；Pipeline 仍是 KOL 试点页（§4.2），不是第二套员工核导航。`/agents` 仍是员工工作入口。管理端展开为配套套件，不是第五套员工页，也不是第二套 Home / Pipeline / Agents。
2. **连接器治理只在管理端枢纽。** `/admin/connectors` + `/admin/connectors/:id`：启用、凭据引用永不回显、员工 read/write、组织 Starry 策略。个人邮箱绑定只留 Settings。
3. **Agent 治理页替换跳转。** 新 `/admin/agents` 管发布状态、可写范围、考试闸门、连接器授权矩阵；管理端顶栏不再跳员工 `/agents`。
4. **导航与 chrome 分家。** 去掉员工侧栏管理端深链；管理端健康条用治理文案，不克隆员工 remote-pill。遗留「本期连接器」与 SkillHub 调试砖收敛到枢纽。

### 修订（2026-09-13）— 员工使用面不是治理目录

原句「连接器只在管理端枢纽」容易被读成员工端任何连接器表面都违约。澄清：

- **管理治理面**不变：启停、凭据引用、组织策略、授权、审计只在 `/admin/connectors` 与 `/:id`。
- **员工使用面**合法：独立员工 chrome（如 `/connectors`）只回答「我已被授权可用哪些、对我意味着什么、个人绑定去哪」。这不是枢纽副本，也不是第五套主表面。
- 「员工不可见配置」= 配置 / 凭据 / 组织策略 / 授权编辑不可见；**不**禁止使用/状态面。员工端零处**治理**目录，不是零处使用面。
- 员工侧栏若有入口，只链使用面，禁止深链 `/admin/connectors`。个人绑定仍只留 Settings。
- 不改平台脊柱与 Pipeline 试点页职责（§4.2），不 LIVE，不新增 UX ID，不在本修订里加后端字段。

### 不决定的范围

不实施后端，不 LIVE，不新增 UX ID 或 `specs/UX-ADMIN-PAGES.md`，不重做 Chat，不改数字员工对象模型。后端缺字段另开计划。

### 影响

- 规范：`21-admin-employee-page-roles.md`（正文）、`CONSTITUTION.md` §4–5、`docs/README.md` 索引
- 代码：员工使用面是后续纯前端（`/connectors`）；本 ADR 修订不改后端
- 测试：无新发布门禁项，直到另有 FS / UX ID 绑定

## ADR-014 — 员工侧栏：定时任务归今日簇，组标题改为分割线（2026-09-13）

**状态**：已固化  
**决策人**：产品负责人

### 问题与背景

员工侧栏把「定时任务」放在资产簇，并用可见「今日 / 智能体 / 资产」组标题把 chrome 画成目录。这让 `/cron` 看起来像可回看对象，也让组名抢走主路径注意力。页职责与发送 ≠ 阶段不变。

### 决定

1. **定时任务属于今日工作簇。** 与新工作任务 / 进行中并列；不进资产。确认入口若仍在今日簇，必须与审批页同路由。
2. **簇间只用分割线。** 禁止可见「今日 / 智能体 / 资产」组标题。`<nav aria-label>` 保留给读屏。项目 / 最近若还在，同样不写可见组标题。
3. **只改员工工作台侧栏。** 不重做 Admin 导航，不改 Chat，不改 LIVE / stage 写入。

### 不决定的范围

不预合并「去掉等我确认」「去掉最近」或管理端治理壳；那些由并行侧栏 PR 处理。本决策不改平台脊柱与 Pipeline 试点页职责（§4.2）。

### 影响

- 规范：`CONSTITUTION.md` §4.1
- 代码：`frontend/src/layout/Workbench.tsx`、`frontend/src/styles.css` 侧栏
- 测试：员工侧栏 stub E2E（定时任务在今日簇；无可见组标题）

## ADR-015 — 并列能力面与 Agent / 任务解耦（2026-09-14）

**状态**：已固化  
**决策人**：产品负责人

### 问题与背景

资产簇已列出知识库、审批、考试、连接器使用面，但未写明这些入口相对 KOL Agent 与今日任务队列的主权。若不立法，后续容易把它们降成 Agent 设置、任务详情 Tab，或按「有没有进行中任务」才挂入口，也容易用 KOL / 合作对象重写这些面的信息架构。

### 决定

1. **并列能力面是独立产品面。** 清单以 `CONSTITUTION.md` §4.1 十六项为准（含技能、数字团队预留、知识库、审批、考试、连接器使用面，及可占位的云盘 / 遥控 / 项目）。与 `/agents` 开工入口、今日任务队列相互独立：不隶属 KOL Agent，也不因进行中任务才存在。「支撑」≠ 二等。
2. **数据可进、壳子不出。** KOL / 合作 / 邮件只作记录类型或示例；IA / 导航 / 空态不得改成「先选 Agent / 先开任务」。
3. **调用单向。** Chat / Agent 可调用已授权连接器、检索知识、提交审批；能力面不得复制 Chat 主线程或 Home 待办桶，也不得做成第二会话台。
4. **不是第五套 Home，也不是能力图鉴。** Home+Chat 是平台脊柱；Pipeline 是 KOL 试点页。技能是一等能力，不得做连接器 / 知识的上级目录，也不得压过任务脊柱。连接器仍遵守 `21` 的使用面 vs 治理面；治理仍 Admin-only。

### 不决定的范围

不实施前端 / 后端，不 LIVE，不新增 UX ID，不削弱核心闭环、发送 ≠ 推进阶段、或无可见侧栏组标题。不重做 Chat，不改数字员工对象模型。

### 影响

- 规范：`CONSTITUTION.md` §4.1、`21-admin-employee-page-roles.md`
- 代码：本 ADR 不改 JSX / API
- 测试：文档评审 only；无新发布门禁项

## ADR-016 — 专家中心 = 召唤岗位专家（2026-09-14）

**状态**：已固化  
**决策人**：产品负责人

### 问题与背景

早期员工面把 `/agents` 写成「用来开始干活」，侧栏数字员工簇又写「团队/技能入口」。这容易被读成技能图鉴、第二套 Home 待办页、连接器目录，或再发明「专家团」假导航。员工应只看见可召唤的岗位专家；内部对象可以是 Expert / Agent，员工文案是「数字员工」。召唤比发送更早，不得附带发信或写阶段。并列能力面（ADR-015）与 Home 任务主权不得被专家中心吞并。

### 决定

1. **专家中心只回答「找谁协作」。** 员工 `/agents`（专家中心 / 数字员工入口）列出已发布、可供召唤的岗位专家并建立协作绑定。不是技能目录、不是第二套 Home 任务页、不是连接器目录。不发明第五套主脊柱；`/agents` 仍是 P0 工作入口 chrome。
2. **无专家团。** 员工默认表面完全没有专家团：无入口、无占位、无假导航。侧栏入口文案「数字员工」。**修订（ADR-023）：** 「数字团队」是独立一等能力、尚未实现；预留名词与位阶，禁止用专家团冒充，**不得**把该产品名词永久写成禁词。
3. **员工默认禁止引擎与目录 chrome。** 默认员工 `/agents` 及数字员工相关 chrome 不得展示 Profile 内部、Harness、MCP、Codex、技能图鉴 / Skill picker、连接器状态 / connector pills 作为主 IA。引擎行话仍按宪法任务/结果工作台原则与 `UX-EMPLOYEE` 员工禁词（旧 `UX-COPY-ENGINE` ID 已废，见 ADR-024）。**修订（ADR-023）：** 技能是一等能力；侧栏是否露出是 UX 密度，不是「员工永远不许看见技能」。仍禁止能力图鉴压过任务脊柱，也禁止把图鉴做成 `/agents` 主 IA。
4. **召唤 ≠ 发送 / 推进阶段。** 召唤只建立绑定会话 / 协作绑定。无 send-mail 副作用，无 stage-change 副作用。「发送 ≠ 推进阶段」仍然有效；召唤更早，必须两都不做。
5. **Home 独占任务；能力面仍解耦。** Home 仍回答现在做什么 / 今日待办 / 任务计数。专家中心不得复制 Home 待办桶。知识库 / 审批 / 考试 / 连接器使用面仍是并列能力面（ADR-015），专家中心不拥有它们。
6. **对象命名。** 内部：Expert 或 Agent 均可。员工文案：「数字员工」/ 岗位专家。`/admin/agents` 仍是治理（发布 / 授权 / 考试闸门），不得与员工专家中心混读；员工专家中心禁止连接器状态 chrome。

### 不决定的范围

不实施前端 / 后端，不 LIVE，不新增 UX ID，不实施 ExpertManifest / 数字员工 API，不改数字员工对象模型 schema。不削弱平台脊柱与 Pipeline 试点页职责（§4.2）、并列能力面（ADR-015）、连接器使用面 vs 治理面、发送 ≠ 推进阶段、或无可见侧栏组标题。不重做 Chat。

### 影响

- 规范：`CONSTITUTION.md` §4.1、`21-admin-employee-page-roles.md`
- 代码：本 ADR 不改 JSX / API
- 测试：文档评审 only；无新发布门禁项

## ADR-017 — 首版 ExpertManifest / `/api/experts` 落实 ADR-016（2026-09-14）

**状态**：已固化  
**决策人**：工程（本 PR 落地首版后端）

### 问题与背景

ADR-016（#53）立法：员工专家中心只召唤已发布岗位专家；召唤只建绑定；无专家团；员工默认不见 Profile / Harness / MCP / Codex / Skill catalog / 连接器状态。立法当时不实施 API。本记录是该法律的第一版后端落地，不另立专家中心 IA。

### 决定

1. **服从 ADR-016。** `/api/experts` 只服务已发布岗位专家。无专家团 list/members/placeholder 端点。不把 `/profiles`、`/skills`、`/connectors`、`/api/agent-manifest` 伪装成员工专家 API。`/admin/agents` 仍是治理。并列能力面（ADR-015）不归本 API。
2. **资产。** `experts/kol/manifest.yaml` 是岗位专家发布对象；`agents/kol/manifest.yaml` 仍是 Agent 发布包。员工文案「数字员工」/「岗位专家」。
3. **锁定字段。** `id` / `version` / `status=published` / `display_name=KOL 合作专员` / `profession` / `description` / `avatar` / `category` / `tags` / `mission` / `quick_prompts` / `entry_skill`。
4. **召唤。** `POST /api/experts/:id/summon` 响应恰好 `{ session_id, expert_id, expert_version, intro }`，会话持久化 `expert_id` + `expert_version`。不发信、不写阶段、不 LIVE。

### 不决定的范围

不重做 Chat / `/agents` UI。不做组织/部门/品牌授权、审批模型、专家团队成员。不放宽 LIVE。

### 影响

- 规范：引用 ADR-016、`02-domain-model.md`、`14-implementation-contract.md`
- 代码：`experts/kol/manifest.yaml`、`backend/src/experts.ts`、`GET/POST /api/experts`
- 测试：`backend/tests/experts.test.ts`、`validate:contracts`


## ADR-019 — Home AI发现条件区（2026-09-14）

**状态**：已固化（轻备注；服从宪法 §4.2）  
**决策人**：产品负责人

### 问题与背景

宪法 §4.2 已把 Home「AI发现」定为 CreatorCandidate 线索，不是任务推荐。条件区若做成多选平台、「全部平台」或 TikTok，或让自然语言盖过芯片，生成的计划会超出可采集范围。

### 决定

只补条件区规则，不改四模式：

1. **平台 / 地区：单选芯片。** 平台只展示已支持海外组合（YouTube / Instagram / Facebook）。**禁止 TikTok**，**禁止「全部平台」**。
2. **方向：多选标签，最多 8 个。**
3. **自然语言是主输入，芯片是纠正。** 生成计划以芯片为准（芯片覆盖 NL 里冲突的平台 / 地区 / 方向）。
4. **重置条件芯片不清空 NL。**

仍服从宪法 §4.2：Home 试点模式名不变；发送 ≠ 改阶段；加入跟进才建 Collaboration；不 LIVE；无引擎行话。

### 不决定的范围

不实施前端 / 后端 / CSS / e2e。不新增 UX ID。不发明 TikTok 或「全部平台」支持。不削弱宪法 §4.2 模式名、平台脊柱与 Pipeline 试点页职责、发送 ≠ 改阶段、Collaboration-on-follow-only。

### 影响

- 规范：`CONSTITUTION.md` §4.2
- 代码：本备注不改 JSX / API
- 测试：文档评审 only；后续 FE PR 以本记录 + 宪法 §4.2 为对照

## ADR-020 — 工作台正文基线 16px，禁止 scale 假装字号（2026-09-14）

**状态**：已固化  
**决策人**：产品负责人

### 问题与背景

`20` 曾把工作台正文立法成 **13–14px 紧凑正文**，并要求把现行 CSS 收到这一档。产品已确认：员工工作台全局正文基线改为 **16px**（约比旧目标大 15–20%），控件 / 按钮 / Tab / helper 不得低于 **14px**。若不改写，后续字号 PR 会继续按 13px 收缩，或用 `transform: scale` / `zoom` 假装放大。

### 决定

1. **正文 / 主阅读 = 16px**（`--font-body`）。卡片正文、线程、结果说明走这一档。
2. **UI 控件、按钮、Tab、helper / 次要说明 ≥14px**（`--font-ui: 14px`，`--font-meta: 14px`）。禁止 12px 辅助字。
3. **标题可更大**（`--font-section` ≥16px，`--font-title` 18px 或更大）。
4. **禁止缩放假装字号。** 不得用 `transform: scale`、`zoom`、缩小容器再拉伸或同类手法替代真实 `font-size`。
5. **Linear 密度仍在。** 紧间距、安静阴影、低装饰不变；密度**不**靠把正文压到 16px 以下。「紧凑」指 chrome / 间距，不授权旧 13–14px 正文。

### 不决定的范围

本记录**只立法、不改 CSS / JSX**。不 LIVE。不削弱核心闭环、平台脊柱与 Pipeline 试点页职责（§4.2）、Home 试点模式名、并列能力面（ADR-015）、专家中心（ADR-016）、连接器使用面 vs 治理面、发送 ≠ 推进阶段。不新增 UX ID。字号落地另开前端 PR。

### 影响

- 规范：`20-visual-design-system.md` token 表与禁止条款
- 代码：本 ADR 不改 `frontend/src/styles.css`
- 测试：文档评审 only

## ADR-021 — 员工 `/kb`：知识库，不是邮件模板管理台（2026-09-14）

**状态**：已固化  
**决策人**：产品负责人

### 问题与背景

ADR-015 已把知识库列为并列能力面，但未写员工 `/kb` 答哪一问。现行实现是**已发布邮件模板列表 + 本账号启用/隐藏 + 「用这份写信」**，页头写 Codex / harness，并在 KB chrome 宣讲「发送不等于推进阶段」。员工知识库曾记 FAIL（证据文件已删，见 ADR-025）。产品裁定：这样的员工 `/kb` **不适合**，不得继续当邮件模板管理台演进。

若不立法，后续 FE 会继续把整库 IA 做成「邮件模板 / 其它」、把「启用/停用/隐藏」当主 CTA，或把「发送 ≠ 改阶段」布道搬到知识库首页。

### 决定

1. **定位。** 员工 `/kb` 只回答：**查找 / 理解适用场景 / 预览 / 收藏 / 用于当前任务**。仍是 ADR-015 并列能力面 / 可选 chrome，**不是**第五套 Home。禁止员工 KB 出现 Codex / Harness / MCP / Thread / Skill 等引擎行话（宪法任务/结果工作台 + `UX-EMPLOYEE` 员工禁词）。禁止在 KB 首页 / 页头 / chrome 宣讲「发送 ≠ 改阶段」——该不变量仍有效，住在宪法 / `SEND_NE_STAGE`（旧 `UX-SEND-NE-STAGE` 文件级 ID 已废，见 ADR-024），KB 不是布道页。邮件模板是**一类资料**，不是整库。

2. **员工 IA（Tab / 筛选，顺序锁定）：**

   ```text
   全部资料 | KOL合作SOP | 邮件模板 | 品牌与产品 | 报价与谈判 | 最近使用
   ```

   不得再用「我的知识库 / 知识市场」或「邮件模板 / 口径与其它」当员工主 IA。「最近使用」是最近打开/应用过的资料，不是 Home 待办桶。

3. **动作分家。** 员工主动作：**查看 / 收藏 / 用于当前任务**。管理主动作：**停用 / 发布 / 版本 / 范围**（治理）。若「隐藏」仍留在员工 UI，只许降为**次要偏好**，不是主治理动作，不得与管理端停用混读。

4. **CTA 与副作用。** 「用这份写信」改为 **「用于当前任务」**。副作用只能是：把该条作为**未发送草稿**填入**当前任务 / composer**（邮件类对齐 #75「正文进框」：填组信正文，可改后再发）。禁止从 KB 应用动作发信或写阶段。「发送 ≠ 推进阶段」仍然有效；KB 应用比发送更早，必须两都不做。

5. **卡片元数据底线（有数据才展示）。** 每张卡必须能展示：适用品牌 / 区域 / 阶段 / 场景、版本、生效、来源、已发布。缺字段诚实省略，不得伪造。用词对齐 `14` 的 `brand_scope`、`region_scope`、版本、来源、`effective_from/to`。**先立法 UX 底线，不在本记录迁 schema**；后端可后补字段。

6. **边界不变。** 平台脊柱与 Pipeline 试点页职责不变。不削弱 ADR-015 / 016 / 019 / 020 与宪法 §4.2 员工面边界。连接器使用面 vs 治理面不因本条合并。不发明专家团。不扩张组织权限或审批系统。不 LIVE。

### 不决定的范围

不实施前端 / 后端 / CSS / e2e。不迁知识表 schema，不补 `tenant_id` / 范围 PEP / 检索 API。不重做 Admin 知识页，不写企业 RAG，不新增 UX ID。不削弱核心闭环、发送 ≠ 推进阶段（只是不在 KB 说教）、无可见侧栏组标题。不重做 Chat。本记录不把历史 KB 验收改写成 PASS。

### 影响

- 规范：`CONSTITUTION.md` §4.1、`14-implementation-contract.md`、`21-admin-employee-page-roles.md`
- 代码：本 ADR 不改 JSX / API
- 测试：文档评审 only；后续 FE / BE 以本记录 + 宪法 §4.1 知识库面为对照


## ADR-023 — 智能体中台十六项一等能力；KOL 是首个试点（2026-09-14）

**状态**：已固化  
**决策人**：产品负责人（用户确认 2026-09-14）

### 问题与背景

宪法标题与表面表把产品写成「KOL Workbench」，并把 Agents / KB / 审批 / 考试 / 连接器 / Settings 收进「支撑能力面」，容易被读成二等、隶属 KOL Agent，或把 Home「AI发现」「我跟进的红人」与 Pipeline 当成中台壳。员工契约与 ADR-016 又把「技能目录不是员工默认入口」和「不要求数字团队（易被读成专家团）」写成硬禁，导致：(a) 技能被读成「员工永远不许看见」；(b) 产品名词「数字团队」被与「专家团」永久划等号并禁掉。缺口扫描见 git 历史（证据文件已删，ADR-025）。

### 决定

1. **产品是智能体中台 / Agent middle platform。** 不是 KOL 专用壳。`design-system/kol-workbench/` 只是现行试点皮肤路径名，不是产品身份。
2. **十六项全部是一等公民**，互不隶属，也不隶属 KOL Agent。未实现或占位不降等。清单以 `CONSTITUTION.md` §4.1 为权威：任务/会话、数字员工、数字团队、技能、知识库、连接器、审批、人员与权限、审计/Trace、考试、项目、云盘、手机遥控电脑、定时/自动化、通知/收件箱、个人设置。
3. **「支撑」≠ 二等。** ADR-015 精神保留：能力主权、调用单向（Chat 可调能力，能力面不做第二会话/第二 Home）、使用 ≠ 治理、支撑面不复制 Home IA。这些是 IA 禁令，不是位阶降等。
4. **KOL 只是首个业务实现 / 试点。** Pipeline 与 Home「AI发现」「我跟进的红人」是 KOL 试点特化，不是平台壳。Home「今日任务 / 我的待办」与 Chat 是平台任务/会话面。Pipeline **页**仍存在，只许深链或产品内 CTA。
5. **技能是一等能力。** 侧栏是否露出是 UX 密度，**不是**硬「员工必须永远看不见技能」，也**不是**「技能目录不是员工默认入口」的永久禁令。仍禁止能力图鉴压过任务脊柱，禁止把技能做成 `/agents` 或连接器/知识的上级目录。本记录**不**强制把技能加进员工侧栏。
6. **数字团队是一等能力，尚未实现。** 预留法律地位与产品名词。禁止「专家团」假导航 / 占位 / 冒名。**不得**永久禁止名词「数字团队」。本记录**不**实施数字团队 UI。
7. **不变量不变。** 发送 ≠ 推进阶段；L1–L3；连接器使用 ≠ 管理治理。

### 修订范围（相对 ADR-016）

ADR-016 专家中心「只召唤岗位专家 / 无专家团 / 召唤 ≠ 发送与阶段 / Home 独占任务」仍有效。下列读法被本记录修订：

- 「不要求数字团队（易被读成专家团）」→ 禁止专家团；数字团队另列、预留、未实现。
- 「技能目录仅显式调试或管理端 / 员工默认禁止 Skill / 技能目录不是员工默认入口」→ 禁止图鉴压过脊柱与 `/agents` 主 IA；技能一等；入口密度=UX。
- 「四页法律 ⇒ Pipeline 必须进默认侧栏 / 缺则 P0」或「Pipeline 侧栏 = UX 密度、可挂可不挂」→ Pipeline = KOL 试点页，不是平台核心导航；页只许深链 / CTA。

### 不决定的范围

不实施前端 / 后端 / CSS / e2e。不 LIVE。不实施数字团队 UI。不强制员工侧栏加技能。不重命名 `design-system/kol-workbench/`。不新增 UX ID。不削弱核心闭环、发送 ≠ 推进阶段、L1–L3、ADR-015 能力主权、连接器使用面 vs 治理面、无可见侧栏组标题。不重做 Chat。不改写全部 19 时代历史正文。

### 影响

- 规范：`CONSTITUTION.md` §4；`21-admin-employee-page-roles.md`；`docs/README.md` 平台 vs 试点路由；`CONTEXT-MANIFEST.md`
- 代码：本 ADR 不改 JSX / API / CSS
- 测试：文档评审 only；现行 E2E「侧栏无技能 / 无数字团队」仍是实现快照，不是本记录的永远禁令

## ADR-024 — 删除过细 UX 合同，从宪法重派生员工 UX（2026-09-15）

**状态**：已固化  
**决策人**：产品负责人（用户锁定 2026-09-15）

### 问题与背景

`specs/UX-KOL.md`、`specs/UX-FOLLOWED-KOL-CARD.md`，以及把 `UX-SEND-NE-STAGE` 当独立合同 ID 的绑定，含大量不合理过细处方：1→8 排序键表、绝对禁止阶段筛选、强制四带-only 布局、长字段黑名单、强制每张 Home 卡 CTA 拼「确认进入「目标阶段」」、以及把邮箱默认 / TB 绑定 / 未发布 Agent 等实现细节升格为发布门禁 UX ID。这些文件位阶被读成可改写宪法 / `04`，造成员工面过约。

### 决定

1. **删除。** 整文件删除 `specs/UX-KOL.md` 与 `specs/UX-FOLLOWED-KOL-CARD.md`。废止把 `UX-SEND-NE-STAGE` 当独立合同 ID / 文件级绑定的读法。旧 ID 目录（`UX-CTX-BRAND`、`UX-DEF-MAILBOX-N`、`UX-MAIL-STATUS`、`UX-TB-BIND`、`UX-AGENT-UNPUBLISHED`、`UX-OWNER-NOT-SKIP`、`UX-SEND-NE-STAGE`、`UX-STATE-VISIBLE`、`UX-COPY-ENGINE`）不再进 `ux-traceability.json` 门禁。
2. **重派生。** 新瘦契约 `specs/UX-EMPLOYEE.md` 只从 `CONSTITUTION.md` §4–5 导出，位阶低于宪法，不发明新平台法。
3. **门禁只留硬不变量。** `SEND_NE_STAGE`（发送卡无阶段选择；发送不推进阶段；阶段写入用具体 `stage_code` + 展示名）与 `L3_CONFIRM`（高影响写前：对象/范围/后果 → 确认 → 执行 → 持久回执；拒绝要原因）。其余系统法（员工禁词、Home 试点模式名、Pipeline 深链）留在宪法，不各自升格为合同 ID。
4. **跟进卡只留目标。** Home「我跟进的红人」回答谁 / 卡在哪 / 最新事实 / 建议+依据 / 主行动。允许阶段筛选作二次或产品自选主筛选，但不得克隆 Pipeline 正式资产板。不恢复四带教条、排序键表、字段黑名单、强制 CTA 文案。
5. **不削弱。** 发送 ≠ 推进阶段、L1–L3、员工禁引擎行话、Pipeline 页可深链且非必挂侧栏、ADR-023 表面职责，全部保留。

### 不决定的范围

不实施 Home 跟进列表视觉重写。不 LIVE。不 force-push `main`。不把已删除文件的过细处方写回宪法。

### 影响

- 规范：`specs/UX-EMPLOYEE.md`；`specs/ux-traceability.json`；宪法 / README / CONTEXT / 21 指针
- 代码：`validate-contracts.mjs` 改认 `UX-EMPLOYEE.md`；FE 注释去掉对已删文件名的硬绑定
- 测试：契约校验仍要求硬不变量 ID 出现在瘦契约中，并绑定 FS / 红线 / E2E 名

## ADR-025 — 删除 evidence / 04 / 19 / employee-surface / FS-006 / FS-010 / ADR-018 / ADR-022（2026-09-15）

**状态**：已固化  
**决策人**：产品负责人（用户锁定 2026-09-15）

### 问题与背景

过细 UX 合同删除后，仓库仍堆着 `docs/evidence-*`、`04`、`19`、`employee-surface-contracts.md`、`FS-KOL-006`、`FS-KOL-010`、ADR-018、ADR-022。这些文件互相引用、把跟进卡 / 发现桥 / 四带教条写成第二套平台法，位阶被读成可改写宪法。

### 决定

1. **整类删除。** 删除全部 `docs/evidence-*`（不留归档副本）、`docs/04-ux-ui-system.md`、`docs/19-ui-ux-constitution.md`、`docs/employee-surface-contracts.md`、`specs/FS-KOL-006-confirm-stage.md`、`specs/FS-KOL-010-pipeline.md`，以及 `DECISIONS.md` 中的 ADR-018 / ADR-022 正文与索引行。
2. **必须项只住在宪法 + 瘦 `UX-EMPLOYEE`。** 发送 ≠ 推进阶段、L3 确认→执行→持久回执（拒绝要原因）、KOL 试点表面（Pipeline 可深链、非第二套 Home、非必挂侧栏）、Home 试点模式名（今日任务 / 我的待办 / AI发现 / 我跟进的红人）写入 `CONSTITUTION.md` §4.2 / §5；`UX-EMPLOYEE` 只引用/派生，不再依赖已删 04 / employee-surface / ADR-018。
3. **不新开 FS。** 阶段写入与 Pipeline 表面以宪法 + `policies/change_stage.yaml` 为准。`ux-traceability.json` 不再绑定 `FS-KOL-006` / `FS-KOL-010`。
4. **不复活。** 不恢复 evidence、04、19、employee-surface、排序键表、四带教条、字段黑名单。

### 不决定的范围

不实施 FE 重写。不 LIVE。不删除 `21`（只瘦指针）。不删除 MASTER / 视觉页。不删除 ADR-015 / 019 / 021 / 023。

### 影响

- 规范：宪法 §4.2 补模式名与 `stage_code` 句；`specs/UX-EMPLOYEE.md` 重写；`21` / README / CONTEXT / 07 / 14 / 16 改指宪法
- 契约：`specs/traceability.json` 去掉 FS-006/010；`validate-contracts.mjs` 仍认剩余 ≥8 份 FS 与 `UX-EMPLOYEE`
- 代码：仅注释改指宪法（`followedKolCard.ts`、`home/modes.ts`）

## ADR-026 — 法律层 A–K 重组（2026-09-15）

**状态**：已固化  
**决策人**：产品负责人（用户锁定权威顺序 A–K）

### 问题与背景

#105（`33607da`）已删除 `docs/evidence-*`、`04`、`19`、`employee-surface-contracts.md`、`FS-KOL-006` / `010`。仓库仍按 `00`–`21` 编号当主线导航，缺失法律目录，也没有给后续阶段图 / IA / 设计法 / 技术宪法预留路径。`design.md` 的权威路径需要锁定，避免再把 MASTER 或已删 `04` / `19` 当成设计法。

### 决定

1. **权威顺序锁定为 A–K。** 目录见 `docs/LAW-MAP.md`。`docs/README.md` 与 `docs/CONTEXT-MANIFEST.md` 按字母层导航，不以 `00`–`21` 编号为主线。编号文件只是路径别名。
2. **E 只建占位。** `docs/stage-graph.md` 是业务规则与过程的权威路径。矩阵由阶段图兄弟 track 写入。本记录与本 track **不发明阶段边**。
3. **H / I / J 只链路径。** `docs/ia-information-architecture.md`、`docs/design.md`、`docs/technical-constitution.md` 由兄弟 track 创建。
4. **UI 设计路径 = `docs/design.md`。** `design-system/kol-workbench/MASTER.md` 仍是 token 源，不是产品宪法，也不是设计法正文。
5. **ADR 只做变更日志。** `DECISIONS.md` 不能覆盖 A–K 现行正文。
6. **ADR-011 由阶段图兄弟 track 废止。** 本 track 不删 ADR-011 正文，只在索引与本记录标注。

### 不决定的范围

不实施 FE / LIVE。不写阶段边、walk 算法或 Starry 原生码映射。不创建 H / I / J 正文。不复活 evidence / 04 / 19。不改 `validate-contracts` 门禁形状。

### 影响

- 规范：`docs/LAW-MAP.md`、`docs/README.md`、`docs/CONTEXT-MANIFEST.md`、`docs/stage-graph.md`；宪法 §1 指向 E / H / J；根 `README.md` 入口改指 A–K
- 契约：无新 FS / UX ID；`validate-contracts` 仍认剩余 ≥8 份 FS 与 `UX-EMPLOYEE`
- 代码：无

