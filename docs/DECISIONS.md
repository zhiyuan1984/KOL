# 关键决策记录入口

本文件是决策索引，不替代规范正文。涉及规范冲突、不可逆副作用、组织范围、物理接口漂移或架构取舍时，先在这里登记，再更新 canonical 文档和追踪矩阵。

## 近期记录

| 日期 | 记录 | 说明 |
|---|---|---|
| 2026-09-14 | **硬锁：** 员工侧栏**禁止**挂「生命周期」或 `/pipeline` 主入口。Pipeline 仍是 KOL 试点页，只许深链 / 产品内 CTA。不是「可挂可不挂」的 UX 密度。删除技能硬禁残留。Home「AI发现 / 我跟进的红人」不是平台一等清单。「支撑」≠ 二等。宪法 §4.1–4.2 + ADR-023 仍最高 | 用户硬锁 2026-09-14。见 ADR-023 本条修订、`docs/evidence-constitution-reconcile-2026-09-14.md`。文档 only；不删 Pipeline 页或 FS-KOL-010；不实施 FE/BE；不 LIVE。 |
| 2026-09-14 | 产品是**智能体中台**。十六项一等能力（含技能、数字团队预留未实现、考试、项目/云盘/遥控占位、定时、通知、设置等）互不隶属、不隶属 KOL Agent。「支撑」≠ 二等。KOL 只是首个试点；Pipeline / Home「AI发现」「我跟进的红人」是试点特化。技能侧栏露出=UX，不是「员工永远不许看见」。禁止专家团假导航；不得永久禁止名词「数字团队」 | 用户锁定。见 ADR-023、`CONSTITUTION.md` §4.1–4.2、`docs/evidence-platform-law-gap-2026-09-14.md`。本记录不实施 FE/BE，不 LIVE。 |
| 2026-09-14 | MediaCrawler → Starry 跟进桥：三模式（单个 / 勾选批量 / 条件批量）。条件批量**本期全开**：粉丝 ≥ N、近10均播 ≥ M、Host 评分 ≥ S、平台 / 地区沿用发现计划芯片。无邮箱仍单行 `importKolProfilesFromCrawler`；跟进+主档=一张 L3 确认卡（每 `source_batch` 一次）；采集只产线索；成功才跟进（真实 `kolUid`）；本路径禁发信/改阶段/解密/编造邮箱；入库仍 Host-only；门槛只在 Host（列表预览 + 写入前复核） | 产品锁定。见 ADR-022、`07-mcp-data-contract.md`、`19-ui-ux-constitution.md`。本记录不实施 FE/BE，不 LIVE，不在跟进时改阶段。 |
| 2026-09-14 | 员工 `/kb` **不是**邮件模板管理台。只回答查找 / 理解适用场景 / 预览 / 收藏 / 用于当前任务；邮件模板只是一类资料；主 CTA「用于当前任务」只产未发送草稿；卡片元数据底线可后补字段 | 产品裁定现行员工 `/kb` 不适合。见 ADR-021、`19-ui-ux-constitution.md`。本记录不实施 FE/BE。 |
| 2026-09-14 | 员工工作台**全局正文基线 16px**（约比旧 13–14px 大 15–20%）；控件 / 按钮 / Tab / helper **≥14px**；禁止 `transform: scale` / `zoom` 假装字号。Linear 密度仍在，但不靠缩小正文 | 产品确认。见 ADR-020、`20-visual-design-system.md`。字号 CSS 由实现 PR 落地。 |
| 2026-09-14 | Home 内四模式：**今日任务 → 我的待办 → AI发现 → 我跟进的红人**；旧「AI发现」改名为今日任务；新「AI发现」= CreatorCandidate 线索；加入跟进才建 Collaboration | 默认 `tab` 为空即今日任务。推荐仍只预填不自动执行。见 ADR-018、`19-ui-ux-constitution.md`。 |
| 2026-09-13 | Home 视图顺序曾为 **AI发现 → 我的待办 → 我跟进的红人**；今天推荐只挂当时的 AI发现；我的待办去掉「后续」历史桶 | **已被 ADR-018 取代。** 旧「AI发现」现为「今日任务」；新「AI发现」是红人线索。推荐仍只预填不自动执行（`04`）。 |
| 2026-09-13 | 邮件往来摘要 Codex `thread/start` 与识别一致：`CODEX_MODEL` / CLI 默认，不传 `gpt-5.6-luna`。Luna digest 需要 `OPENAI_BASE_URL` 及该端点 key | 公共 OpenAI `sk-proj` 打默认 Luna 会 HTTP 401。不改 provider 顺序或 sticky-fail。 |
| 2026-09-13 | 邮件往来摘要 `analysis_failed` 改为冷却后自动再试，并持久化 `error` / `attempted` / `failed_at` | 不是新 ADR。不改 provider、指纹、寒暄过滤或超时。详见 `docs/evidence-mail-digest-analysis-plan-2026-09-13.md`。 |
| 2026-09-14 | 并列能力面与 Agent / 任务解耦：知识库、审批、考试、连接器使用面是独立产品面，不隶属 KOL Agent，也不因进行中任务才存在 | 不是第五套 Home。治理仍 Admin-only。见 ADR-015、`19-ui-ux-constitution.md`、`21-admin-employee-page-roles.md`。 |
| 2026-09-14 | 专家中心 = 召唤岗位专家：员工 `/agents` 只找谁协作；无专家团；无员工默认引擎 chrome（MCP/Profile/Harness/英文 Skill 图鉴）；召唤 ≠ 发送/阶段；Home 独占任务；能力面仍解耦。产品「技能」一等，入口=UX（ADR-023） | 见 ADR-016、`19-ui-ux-constitution.md`、`21-admin-employee-page-roles.md`。 |
| 2026-09-14 | 首版 `/api/experts` 落实 ADR-016：仅已发布岗位专家 `expert:kol`；召唤只绑定会话，不发信不写阶段；无专家团 API | 见 ADR-017、`docs/evidence-expert-manifest-2026-09-14.md`。 |
| 2026-09-14 | Home AI发现后端：DiscoveryRequest / Run / CreatorCandidate；海外 MediaCrawler 异步采集；confirm-follow 才建 Collaboration | 见 `docs/19-ui-ux-constitution.md`、`docs/evidence-ai-discovery-backend-2026-09-14.md`。 |
| 2026-09-14 | Home AI发现条件区：平台/地区单选芯片；方向多选最多 8；NL 主输入、芯片纠正且生成计划以芯片为准；重置不清空 NL；无 TikTok、无「全部平台」 | 轻备注，服从 ADR-018。见 ADR-019、`19-ui-ux-constitution.md`。 |

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
| ADR-011 | Starry 阶段写入用原生码；人跳过只在 Host 记账；远程只走相邻前进（跨段则逐格 walk） | `05-agent-workflow-skill-policy.md`、`planStarryAdjacentWalk` / `changeLifecycleStage` |
| ADR-012 | 页职责：Home+Chat=平台任务/会话脊柱；Pipeline=**KOL 试点**生命周期页（禁止复制 Home 待办；**禁止**员工侧栏主入口）；Admin=谁/权限/审计 | `CONSTITUTION.md` §4.2、`specs/FS-KOL-010-pipeline.md` |
| ADR-013 | 管理端是员工表面的配套治理套件，不是副本；连接器**治理**只在 `/admin/connectors`，员工**使用面**独立（`/connectors`），Agent 治理在 `/admin/agents`，个人 Starry 绑定只留 Settings。Pipeline 是 KOL 试点页，不是「员工四表面」平台核 | `21-admin-employee-page-roles.md`、`CONSTITUTION.md` §4.2 |
| ADR-014 | 员工侧栏：定时任务归今日工作簇；簇间用分割线，不画可见「今日 / 智能体 / 资产」组标题 | `19-ui-ux-constitution.md` |
| ADR-015 | 并列能力面与任务/数字员工解耦；清单以 §4.1 十六项为准（含技能、数字团队预留）。KOL 只作数据不定义 IA；「支撑」≠ 二等；治理仍 Admin-only | `CONSTITUTION.md` §4.1、`21-admin-employee-page-roles.md` |
| ADR-016 | 员工 `/agents` 只召唤已发布岗位专家；无专家团；禁止把引擎 chrome / 技能图鉴做成 `/agents` 主 IA。**修订（ADR-023）：** 产品「技能」一等，侧栏露出=UX，不是「员工默认禁止 Skill」。召唤只建绑定、不发信不写阶段 | `CONSTITUTION.md` §4.1、`21-admin-employee-page-roles.md` |
| ADR-017 | 首版 `ExpertManifest` + `/api/experts` 落实 ADR-016：仅 `expert:kol` 已发布；召唤持久化 `expert_id`/`expert_version`；无专家团 API | `02-domain-model.md`、`14-implementation-contract.md`、`experts/kol/manifest.yaml` |
| ADR-018 | Home **内**四模式：今日任务 / 我的待办 / AI发现 / 我跟进的红人；旧「AI发现」改名为今日任务；新「AI发现」= CreatorCandidate；加入跟进才建 Collaboration；不是第五页 | `19-ui-ux-constitution.md`、`04-ux-ui-system.md`、`21-admin-employee-page-roles.md` |
| ADR-019 | Home AI发现条件区：平台/地区单选芯片；方向多选最多 8；NL 主输入、芯片纠正、计划跟芯片；重置不清空 NL；无 TikTok、无「全部平台」。服从 ADR-018 | `19-ui-ux-constitution.md` |
| ADR-020 | 员工工作台正文基线 **16px**；UI / 按钮 / Tab / helper **≥14px**；禁止 scale/zoom 假装字号；Linear 密度靠间距与阴影，不靠缩小正文 | `20-visual-design-system.md`、`19-ui-ux-constitution.md` |
| ADR-021 | 员工 `/kb` 是并列能力面（ADR-015）：查找 / 理解适用场景 / 预览 / 收藏 / 用于当前任务；禁止邮件模板管理台与引擎行话；应用只产未发送草稿；卡片元数据底线先立法、schema 可后补 | `19-ui-ux-constitution.md`、`14-implementation-contract.md`、`21-admin-employee-page-roles.md` |
| ADR-022 | MediaCrawler → Starry 跟进桥：三模式；条件批量本期全开（粉丝 / 近10均播 / Host 评分 / 平台 / 地区）；无邮箱仍单行 `importKolProfilesFromCrawler`；跟进+主档一张 L3 卡（每 `source_batch` 一次）；采集不写 Starry；成功才跟进（真实 `kolUid`）；禁发信/改阶段/解密/编造邮箱；门槛只在 Host。服从 ADR-018 / ADR-011 / ADR-019 | `07-mcp-data-contract.md`、`19-ui-ux-constitution.md`、`08-permission-approval-audit.md`、`policies/import_creator.yaml` |
| ADR-023 | 智能体中台十六项一等能力；KOL=首个试点不是平台壳；技能入口密度=UX（禁止图鉴压过任务脊柱）；数字团队预留未实现，禁止专家团假导航，不得永久禁「数字团队」名词。「支撑」≠ 二等。服从 ADR-015 精神；修订 ADR-016 中「员工默认禁技能 / 不要求数字团队」的过度读法。**硬锁：** 禁止员工侧栏挂「生命周期」或 `/pipeline` 主入口；Pipeline 页只许深链 / CTA | `CONSTITUTION.md`、`employee-surface-contracts.md`、`21-admin-employee-page-roles.md`、`docs/evidence-platform-law-gap-2026-09-14.md`、`docs/evidence-constitution-reconcile-2026-09-14.md` |

**废止读法：** 「四页法律 / 四页分工 / 员工四表面」不得再被读成 Pipeline 是平台核心导航。现行：Home+Chat = 平台任务/会话脊柱；Pipeline = KOL 试点页（§4.2），**禁止**侧栏挂「生命周期」或 `/pipeline` 主入口。后文若仍写「四页法律」一律按此句，不以旧 P0 为准。权威清单仍是 `CONSTITUTION.md` §4.1–4.2。

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

**状态**：已固化  
**决策人**：业务 owner

### 问题与背景

Host 用 15 段 + 旁路的本地码（如 `NEGOTIATING`）做确认卡、审计和协作状态。Starry 生命周期用另一套原生码（如 `BUSINESS_NEGOTIATION`）。先前把「官方写入码」定成 Host-local，远程 `changeLifecycleStage` 收到 `NEGOTIATING` 等 Host 码。人跳过/纠正时，也不该要求 Starry 理解 skip 语义或接收中间阶段。

### 决定

1. **Starry 写入码 = Starry 原生码，远程字段是 `toStageCode`。** `changeLifecycleStage` 顶层参数只能是 `{ lifecycleId, requestJson }`；`requestJson` 为 `{ toStageCode, reason }`，`toStageCode` 经 `LEGACY_STAGE_ALIASES` / `toLegacyStarryStage` 发出原生码（Host `NEGOTIATING` / `商务谈判` → `BUSINESS_NEGOTIATION`）。不要写 `cooperationStageCode` / `targetStageCode` / `stageCode`（LIVE 上会误报回退）。读取继续 `normalizeStage` / `codeFromLabel` 归一成 Host-local。证据：`docs/evidence-stage-request-shape-2026-09-13.md`（`KOL202607300002` lifecycle 16，`INTEREST_CONFIRMED` → `COOPERATION_EVALUATION`）。
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

1. **平台脊柱 + 试点页各答一问。** Home + Chat = 平台任务/会话脊柱（现在做什么；完成一件具体任务）。Pipeline = **KOL 试点**正式生命周期页，不是平台核心导航，**禁止**员工侧栏主入口。Admin = 谁 / 权限 / 审计。Pipeline 仍禁止复制 Home 待办。页只许深链 / 产品内 CTA。
2. **Pipeline 是资产页，不是待办页。** 只展示正式阶段、品牌/负责人、停留、近期事件、同步来源/时间、阶段风险、允许的阶段变更提案。筛选限于 `brand|owner|stage|region|kol|sync` 与旁路/异常侧状态。无 `?kol=` 时不默认选中第一名红人；详情是次要抽屉，不是主栏小说。
3. **阶段动作只有「提出阶段变更」。** 打开既有合作会话的 `confirm_stage` 确认卡，走既有人确认 / 审批 / 写入。不在 Pipeline 发明 LIVE 发送、新权限模型，也不为邮件/分析/风险快捷方式新建 Chat 会话。
4. **缺字段用诚实空态。** `api.pipeline` 已有阶段/停留/负责人则展示；近期事件、同步时间、往来摘要、审计若未返回，省略或写「本页未返回」，不得伪造。

### 不决定的范围

不重做 Home 等待态，不重做 Agents，不改 Chat 主线程，不新增 Pipeline 专用后端，不宣称 LIVE 发送/阶段写入。

### 影响

- 规范：`19-ui-ux-constitution.md` 页面角色法律、`04-ux-ui-system.md` 指向、`specs/FS-KOL-010-pipeline.md`
- 代码：`frontend/src/pages/Pipeline.tsx` 及 Pipeline CSS
- 测试：Stub Playwright 去掉首页任务芯片、自动选中和伪看板动作断言

## ADR-013 — 管理端配套套件，不是员工表面副本（2026-09-13）

**状态**：已固化  
**决策人**：产品负责人

### 问题与背景

Admin 导航和页面与员工连接器/智能体表面重叠：员工侧栏深链 `/admin/connectors`，管理端顶栏跳员工 `/agents`，两端共用 remote-pill chrome，Starry 个人绑定同时挂在 Admin 与 Settings，`Admin.tsx` / SkillHub / SimplePages 各维护一份连接器清单。这让管理端回答「现在从哪开工」，与 `19` 的 Admin 行（谁 / 权限 / 审计）和 Agents 工作入口 P0 冲突。

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

- 规范：`21-admin-employee-page-roles.md`（正文）、`19` / `04` / `20` / `docs/README.md` 索引
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

- 规范：`19-ui-ux-constitution.md` 员工侧栏 IA、`04-ux-ui-system.md` 一句指向
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
4. **不是第五套 Home，也不是能力图鉴。** Home+Chat 是平台脊柱；Pipeline 是 KOL 试点页（禁止侧栏主入口）。技能是一等能力，不得做连接器 / 知识的上级目录，也不得压过任务脊柱。连接器仍遵守 `21` 的使用面 vs 治理面；治理仍 Admin-only。

### 不决定的范围

不实施前端 / 后端，不 LIVE，不新增 UX ID，不削弱核心闭环、发送 ≠ 推进阶段、或无可见侧栏组标题。不重做 Chat，不改数字员工对象模型。

### 影响

- 规范：`19-ui-ux-constitution.md` 并列能力面条款、`21-admin-employee-page-roles.md` 交叉引用
- 代码：本 ADR 不改 JSX / API
- 测试：文档评审 only；无新发布门禁项

## ADR-016 — 专家中心 = 召唤岗位专家（2026-09-14）

**状态**：已固化  
**决策人**：产品负责人

### 问题与背景

`19` P0 把 `/agents` 写成「用来开始干活」，侧栏数字员工簇又写「团队/技能入口」。这容易被读成技能图鉴、第二套 Home 待办页、连接器目录，或再发明「专家团」假导航。员工应只看见可召唤的岗位专家；内部对象可以是 Expert / Agent，员工文案是「数字员工」。召唤比发送更早，不得附带发信或写阶段。并列能力面（ADR-015）与 Home 任务主权不得被专家中心吞并。

### 决定

1. **专家中心只回答「找谁协作」。** 员工 `/agents`（专家中心 / 数字员工入口）列出已发布、可供召唤的岗位专家并建立协作绑定。不是技能目录、不是第二套 Home 任务页、不是连接器目录。不发明第五套主脊柱；`/agents` 仍是 P0 工作入口 chrome。
2. **无专家团。** 员工默认表面完全没有专家团：无入口、无占位、无假导航。侧栏入口文案「数字员工」。**修订（ADR-023）：** 「数字团队」是独立一等能力、尚未实现；预留名词与位阶，禁止用专家团冒充，**不得**把该产品名词永久写成禁词。
3. **员工默认禁止引擎与目录 chrome。** 默认员工 `/agents` 及数字员工相关 chrome 不得展示 Profile 内部、Harness、MCP、Codex、技能图鉴 / Skill picker、连接器状态 / connector pills 作为主 IA。引擎行话仍按 `UX-COPY-ENGINE`。**修订（ADR-023）：** 技能是一等能力；侧栏是否露出是 UX 密度，不是「员工永远不许看见技能」。仍禁止能力图鉴压过任务脊柱，也禁止把图鉴做成 `/agents` 主 IA。
4. **召唤 ≠ 发送 / 推进阶段。** 召唤只建立绑定会话 / 协作绑定。无 send-mail 副作用，无 stage-change 副作用。「发送 ≠ 推进阶段」仍然有效；召唤更早，必须两都不做。
5. **Home 独占任务；能力面仍解耦。** Home 仍回答现在做什么 / 今日待办 / 任务计数。专家中心不得复制 Home 待办桶。知识库 / 审批 / 考试 / 连接器使用面仍是并列能力面（ADR-015），专家中心不拥有它们。
6. **对象命名。** 内部：Expert 或 Agent 均可。员工文案：「数字员工」/ 岗位专家。`/admin/agents` 仍是治理（发布 / 授权 / 考试闸门），不得与员工专家中心混读；员工专家中心禁止连接器状态 chrome。

### 不决定的范围

不实施前端 / 后端，不 LIVE，不新增 UX ID，不实施 ExpertManifest / 数字员工 API，不改数字员工对象模型 schema。不削弱平台脊柱与 Pipeline 试点页职责（§4.2）、并列能力面（ADR-015）、连接器使用面 vs 治理面、发送 ≠ 推进阶段、或无可见侧栏组标题。不重做 Chat。

### 影响

- 规范：`19-ui-ux-constitution.md` 专家中心条款、`21-admin-employee-page-roles.md` 交叉引用、`docs/README.md` 索引
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

## ADR-018 — Home 内四模式：今日任务 / 我的待办 / AI发现 / 我跟进的红人（2026-09-14）

**状态**：已固化  
**决策人**：产品负责人

### 问题与背景

`19` 把 Home 写成**三个视图**，且把「AI发现」定义为今天推荐预填（邮件 / 阶段建议）。产品已收敛为 Home **内**四个入口模式：今日任务 | 我的待办 | AI发现 | 我跟进的红人。若不立法，实现会继续把任务推荐叫「AI发现」，或把红人线索当成 Task，或在发现阶段就建 Collaboration，或再发明第五套主脊柱。

2026-09-13 的视图顺序（当时的 AI发现 → 我的待办 → 我跟进的红人）由本记录取代。

### 决定

1. **仍是一页 Home，四个模式。** 不发明第五套主脊柱。平台脊柱是 Home+Chat；Pipeline 是 KOL 试点页（§4.2），**禁止**员工侧栏挂 Pipeline。四个模式都在 Home 内。前两项是平台任务模式；后两项是 **KOL 试点特化**，不是中台一等清单。KOL 试点员工文案顺序与默认落地：

   ```text
   今日任务 | 我的待办 | AI发现 | 我跟进的红人
   ```

   未指定 `tab` 时默认 **今日任务**。员工 Home 禁止 MCP / Codex / Thread / Skill 等引擎行话（`UX-COPY-ENGINE`）。

2. **对象分属，不得串用。**

   | 模式 | 只回答 | 主对象 |
   |---|---|---|
   | **今日任务** | 今天的优先事项（邮件 / 阶段建议、今天推荐预填——即旧「AI发现」的任务推荐语义） | 今日优先工作项——**不是**红人发现 |
   | **我的待办** | Task / WorkItem 队列 | Task·WorkItem（逾期 / 今天到期 / 结果待确认 / 等审批 / 已入队 / 执行中；**仍不含**「后续」历史桶） |
   | **AI发现** | 端到端红人线索发现 | CreatorCandidate（红人线索）——**不是**任务推荐 |
   | **我跟进的红人** | 我跟进的合作 | Collaboration。**加入跟进才建 Collaboration** |

3. **改名 / 语义迁移。** 旧「AI发现」内容（邮件 / 阶段建议、今天推荐预填）改名为「今日任务」。仍只推荐 / 预填，不自动执行；适用处确认后才进待办（confirm-before-todo）。新「AI发现」= CreatorCandidate 端到端发现管道，不是任务推荐，也不把线索自动写成 Task。

4. **加入跟进才建 Collaboration。** 发现中的 CreatorCandidate 不是合作。跟进 / 创建 Collaboration 是显式动作；未跟进不得假装已有合作资产。

5. **边界不变。** 专家中心 ≠ Home（ADR-016）：Home 拥有任务（今日任务 + 我的待办），也拥有线索发现与跟进列表；`/agents` 只召唤岗位专家。并列能力面仍解耦（ADR-015）。Pipeline 不得复制 Home 四模式语义或对象。发送 ≠ 改阶段。不新增专家团、组织权限扩张、审批系统扩张。不 LIVE。

### 不决定的范围

不实施前端 / 后端 / CSS / e2e。不实施 ExpertManifest 变更。不 MediaCrawler LIVE。不新增 UX ID。不改数字员工对象模型 schema，也不在本记录落地 CreatorCandidate 表结构。不削弱平台脊柱与 Pipeline 试点页职责（§4.2）、ADR-015 / ADR-016、连接器使用面 vs 治理面、发送 ≠ 推进阶段、或无可见侧栏组标题。不重做 Chat。Home 卡片仍禁止横向滚动；等待态用词必须诚实。

### 影响

- 规范：`19-ui-ux-constitution.md` Home 行与四模式条款、`04-ux-ui-system.md` / `21-admin-employee-page-roles.md` 短指针、`docs/README.md` 索引
- 代码：本 ADR 不改 JSX / API
- 测试：文档评审 only；无新发布门禁项，直到另有 FS / UX ID 绑定
- 条件区细则见 ADR-019（2026-09-14 轻备注），不改本记录四模式

## ADR-019 — Home AI发现条件区（2026-09-14）

**状态**：已固化（轻备注；服从 ADR-018）  
**决策人**：产品负责人

### 问题与背景

ADR-018 已锁定新「AI发现」= CreatorCandidate 线索，不是任务推荐。条件区若做成多选平台、「全部平台」或 TikTok，或让自然语言盖过芯片，生成的计划会超出可采集范围。

### 决定

只补条件区规则，不改四模式：

1. **平台 / 地区：单选芯片。** 平台只展示已支持海外组合（YouTube / Instagram / Facebook）。**禁止 TikTok**，**禁止「全部平台」**。
2. **方向：多选标签，最多 8 个。**
3. **自然语言是主输入，芯片是纠正。** 生成计划以芯片为准（芯片覆盖 NL 里冲突的平台 / 地区 / 方向）。
4. **重置条件芯片不清空 NL。**

仍服从 ADR-018：Home 内四模式不变；发送 ≠ 改阶段；加入跟进才建 Collaboration；不 LIVE；无引擎行话。

### 不决定的范围

不实施前端 / 后端 / CSS / e2e。不新增 UX ID。不发明 TikTok 或「全部平台」支持。不削弱 ADR-018 四模式、平台脊柱与 Pipeline 试点页职责（§4.2）、发送 ≠ 改阶段、Collaboration-on-follow-only。

### 影响

- 规范：`19-ui-ux-constitution.md`「AI发现条件区」
- 代码：本备注不改 JSX / API
- 测试：文档评审 only；后续 FE PR 以本记录 + `19` 条件区表为对照

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
5. **Linear 密度仍在。** 紧间距、安静阴影、低装饰不变；密度**不**靠把正文压到 16px 以下。`19` 的「紧凑」指 chrome / 间距，不授权旧 13–14px 正文。

### 不决定的范围

本记录**只立法、不改 CSS / JSX**。不 LIVE。不削弱核心闭环、平台脊柱与 Pipeline 试点页职责（§4.2）、Home 四模式（ADR-018）、并列能力面（ADR-015）、专家中心（ADR-016）、连接器使用面 vs 治理面、发送 ≠ 推进阶段。不新增 UX ID。字号落地另开前端 PR。

### 影响

- 规范：`20-visual-design-system.md` token 表与禁止条款；`19-ui-ux-constitution.md` 一句交叉引用（紧凑 ≠ 缩小正文）
- 代码：本 ADR 不改 `frontend/src/styles.css`
- 测试：文档评审 only

## ADR-021 — 员工 `/kb`：知识库，不是邮件模板管理台（2026-09-14）

**状态**：已固化  
**决策人**：产品负责人

### 问题与背景

`19` / ADR-015 已把知识库列为并列能力面，但未写员工 `/kb` 答哪一问。现行实现是**已发布邮件模板列表 + 本账号启用/隐藏 + 「用这份写信」**，页头写 Codex / harness，并在 KB chrome 宣讲「发送不等于推进阶段」。`docs/evidence-kb-acceptance-2026-09-13.md` 已记员工知识库 FAIL。产品裁定：这样的员工 `/kb` **不适合**，不得继续当邮件模板管理台演进。

若不立法，后续 FE 会继续把整库 IA 做成「邮件模板 / 其它」、把「启用/停用/隐藏」当主 CTA，或把「发送 ≠ 改阶段」布道搬到知识库首页。

### 决定

1. **定位。** 员工 `/kb` 只回答：**查找 / 理解适用场景 / 预览 / 收藏 / 用于当前任务**。仍是 ADR-015 并列能力面 / 可选 chrome，**不是**第五套 Home。禁止员工 KB 出现 Codex / Harness / MCP / Thread / Skill 等引擎行话（`UX-COPY-ENGINE`）。禁止在 KB 首页 / 页头 / chrome 宣讲「发送 ≠ 改阶段」——该不变量仍有效，住在 `19` §4 与 `UX-SEND-NE-STAGE`，KB 不是布道页。邮件模板是**一类资料**，不是整库。

2. **员工 IA（Tab / 筛选，顺序锁定）：**

   ```text
   全部资料 | KOL合作SOP | 邮件模板 | 品牌与产品 | 报价与谈判 | 最近使用
   ```

   不得再用「我的知识库 / 知识市场」或「邮件模板 / 口径与其它」当员工主 IA。「最近使用」是最近打开/应用过的资料，不是 Home 待办桶。

3. **动作分家。** 员工主动作：**查看 / 收藏 / 用于当前任务**。管理主动作：**停用 / 发布 / 版本 / 范围**（治理）。若「隐藏」仍留在员工 UI，只许降为**次要偏好**，不是主治理动作，不得与管理端停用混读。

4. **CTA 与副作用。** 「用这份写信」改为 **「用于当前任务」**。副作用只能是：把该条作为**未发送草稿**填入**当前任务 / composer**（邮件类对齐 #75「正文进框」：填组信正文，可改后再发）。禁止从 KB 应用动作发信或写阶段。「发送 ≠ 推进阶段」仍然有效；KB 应用比发送更早，必须两都不做。

5. **卡片元数据底线（有数据才展示）。** 每张卡必须能展示：适用品牌 / 区域 / 阶段 / 场景、版本、生效、来源、已发布。缺字段诚实省略，不得伪造。用词对齐 `14` 的 `brand_scope`、`region_scope`、版本、来源、`effective_from/to`。**先立法 UX 底线，不在本记录迁 schema**；后端可后补字段。

6. **边界不变。** 平台脊柱与 Pipeline 试点页职责不变。不削弱 ADR-015 / 016 / 018 / 019 / 020。连接器使用面 vs 治理面不因本条合并。不发明专家团。不扩张组织权限或审批系统。不 LIVE。

### 不决定的范围

不实施前端 / 后端 / CSS / e2e。不迁知识表 schema，不补 `tenant_id` / 范围 PEP / 检索 API。不重做 Admin 知识页，不写企业 RAG，不新增 UX ID。不削弱核心闭环、发送 ≠ 推进阶段（只是不在 KB 说教）、无可见侧栏组标题。不重做 Chat。本记录不把 `evidence-kb-acceptance-2026-09-13.md` 改写成 PASS。

### 影响

- 规范：`19-ui-ux-constitution.md` 知识库 `/kb` 节；`14-implementation-contract.md` 知识库契约一句；`21-admin-employee-page-roles.md` / `04-ux-ui-system.md` 短指针；`docs/README.md` 索引
- 代码：本 ADR 不改 JSX / API
- 测试：文档评审 only；后续 FE / BE 以本记录 + `19` 知识库节为对照

## ADR-022 — MediaCrawler → Starry 跟进桥：三模式、单卡确认、成功才写跟进（2026-09-14）

**状态**：已固化  
**决策人**：产品负责人

### 问题与背景

ADR-018 已锁定：采集完成只产 CreatorCandidate；**加入跟进才建 Collaboration**；发现阶段不得自动写合作。现行 `confirm-follow` 仍只落本地 Collaboration，并用 `disc_` 假编号当成功，也不写 Starry。产品已锁定 MediaCrawler → Starry 跟进桥，否则后续实现会：编造邮箱、两步确认、采集结束自动写主档、本地假编号当成功、在跟进路径发信/改阶段/解密，或让采集侧直接写 Starry。

本记录只立法，服从 ADR-018（对象分属 / 加入跟进才建合作）、ADR-011（跟进 ≠ 改阶段）、ADR-019（条件芯片不另造）、`07` / `08`（导入是 L3，发送 / 阶段 / 解密 / 导入不得混成一张副作用卡）、`19`（员工面无引擎行话）。

相关已有证据：`docs/evidence-ai-discovery-backend-2026-09-14.md`（采集只入库线索）、`docs/evidence-ai-discovery-smoke-2026-09-14.md`。分析稿路径 `docs/evidence-mediacrawler-starry-align-2026-09-14.md` 立法时不在本仓库；产品决定不依赖该稿是否入库。

### 决定

1. **三种加入跟进模式。** 本桥只支持：**(A) 单个加入**、**(B) 勾选后批量加入**、**(C) 按条件批量加入**。条件批量 / 确认跟进的门槛**本期全部必支持**（不是「粉丝先做、其余以后」）：

   | 门槛 | 员工含义 | 字段 / 来源 | 控件 |
   |---|---|---|---|
   | 粉丝数 ≥ N | 粉丝数不少于 N | 线索字段 `followers` | Host 条件（列表预览 + 写入前复核） |
   | 近10均播 ≥ M | 近 10 条均播放不少于 M | Host 用线索 `recent_views` / MediaCrawler 最近 10 条 `views` 算算术平均，记为 `avg_views_10` | Host 条件（列表预览 + 写入前复核） |
   | Host 评分 ≥ S | 评分不少于 S | 线索字段 `score`（Host 已算，不另发明评分器） | Host 条件（列表预览 + 写入前复核） |
   | 平台 | 只跟所选平台 | 发现计划芯片（ADR-019）；线索也带 `platform`，写入前对照计划 | **复用**发现计划平台芯片，**禁止**第二套平台控件 |
   | 地区 | 只跟所选地区 | 发现计划地区芯片（ADR-019）；线索若带地区则对照计划，缺字段诚实省略、不得伪造 | **复用**发现计划地区芯片，**禁止**另造地区控件 |

   **不另造一套筛选 IA。** 平台 / 地区不是跟进页新芯片。方向标签仍属发现计划（ADR-019），本桥不新做方向门槛。

2. **无联系邮箱仍写 Starry。** 单个加入即使没有 `contactEmail`，也必须走 **单行** `importKolProfilesFromCrawler` 映射写入 Starry。**禁止**编造邮箱。**禁止**只落本地、把主档写入推迟成「以后有邮箱再说」。

3. **跟进 + 主档写入 = 一张 L3 确认卡。** 员工确认一次：加入跟进与写入主档是同一意图、同一张确认卡，**不是**先跟进再另批导入。幂等 / 审批粒度是每个 `source_batch` 一次（对齐 `policies/import_creator.yaml` 的 `creator_external_id + source_batch`）。这**不是**把发送、改阶段、解密与导入并成一张副作用卡（`00` / `04` / `08` 仍分家）。

4. **采集完成只产线索。** Crawl 结束只写 CreatorCandidate。**禁止**采集完成自动写 Starry、自动建 Collaboration（ADR-018）。`upload_creators` / `KOL_INGESTION_URL` 仍是 Host 侧入库，见第 7 条。

5. **成功才跟进。** 只有 Starry 写入回传**真实** `kolUid` 之后，才把线索标成已跟进并建立 Collaboration。**禁止**再用 `disc_` 假编号当本桥成功路径。现行本地 `disc_` follow 是 residual，实现 PR 必须替换，不得当新成功语义。

6. **本路径禁止。** 跟进桥不得调用 `sendEmail` / `sendEmailNow`、`changeLifecycleStage`、`decryptKolContact`；不得编造邮箱。跟进 ≠ 发信 ≠ 改阶段 ≠ 解密。

7. **入库与主档写入分家。** `upload_creators` / `KOL_INGESTION_URL` 仍是 **Host-only** 入库（CreatorCandidate / 本地创作者）。MediaCrawler **不得**直接写 Starry。Starry 只在人确认后由 Host Gateway 调 `importKolProfilesFromCrawler`（Policy `import_creator`）。

8. **全部门槛只在 Host。** 粉丝 / 近10均播 / Host 评分 / 平台 / 地区都在列表预览筛一次，写入前再核一次。MediaCrawler 工具**没有** min-followers / min-views / min-score 入参；不得把门槛下放到采集侧。

9. **Policy 扩权。** `policies/import_creator.yaml` 的 `mcp_tools` 必须包含 `starrykol.importKolProfilesFromCrawler`（与既有 `addKolProfile` / `importKolProfilesV2` 并列）。本路径的确认闸门走该 Policy，不另发明一条无确认写入。

### 不决定的范围

不实施前端 / 后端 / CSS / e2e。不 LIVE。不在跟进时改阶段、发信或解密。不新增 UX ID。不发明 TikTok 或「全部平台」。不削弱平台脊柱与 Pipeline 试点页职责（§4.2）、ADR-011 / 018 / 019、发送 ≠ 推进阶段、Collaboration-on-follow-only、连接器使用面 vs 治理面。不扩张组织权限或审批系统。不把 MediaCrawler 采集伪装成同步 Skill。不重做 Chat。实现 PR 另开。

### 影响

- 规范：`07-mcp-data-contract.md` 跟进桥物理路径；`19-ui-ux-constitution.md`「加入跟进」；`docs/README.md` 索引
- Policy：`policies/import_creator.yaml` 增加 `starrykol.importKolProfilesFromCrawler`
- 代码：本 ADR 不改 TS / JSX / API
- 测试：文档评审 + `validate:contracts`；后续实现 PR 以本记录 + `19` / `07` 为对照

## ADR-023 — 智能体中台十六项一等能力；KOL 是首个试点（2026-09-14）

**状态**：已固化  
**决策人**：产品负责人（用户确认 2026-09-14）

### 问题与背景

宪法标题与表面表把产品写成「KOL Workbench」，并把 Agents / KB / 审批 / 考试 / 连接器 / Settings 收进「支撑能力面」，容易被读成二等、隶属 KOL Agent，或把 Home「AI发现」「我跟进的红人」与 Pipeline 当成中台壳。员工契约与 ADR-016 又把「技能目录不是员工默认入口」和「不要求数字团队（易被读成专家团）」写成硬禁，导致：(a) 技能被读成「员工永远不许看见」；(b) 产品名词「数字团队」被与「专家团」永久划等号并禁掉。缺口扫描见 `docs/evidence-platform-law-gap-2026-09-14.md`。

### 决定

1. **产品是智能体中台 / Agent middle platform。** 不是 KOL 专用壳。`design-system/kol-workbench/` 只是现行试点皮肤路径名，不是产品身份。
2. **十六项全部是一等公民**，互不隶属，也不隶属 KOL Agent。未实现或占位不降等。清单以 `CONSTITUTION.md` §4.1 为权威：任务/会话、数字员工、数字团队、技能、知识库、连接器、审批、人员与权限、审计/Trace、考试、项目、云盘、手机遥控电脑、定时/自动化、通知/收件箱、个人设置。
3. **「支撑」≠ 二等。** ADR-015 精神保留：能力主权、调用单向（Chat 可调能力，能力面不做第二会话/第二 Home）、使用 ≠ 治理、支撑面不复制 Home IA。这些是 IA 禁令，不是位阶降等。
4. **KOL 只是首个业务实现 / 试点。** Pipeline 与 Home「AI发现」「我跟进的红人」是 KOL 试点特化，不是平台壳。Home「今日任务 / 我的待办」与 Chat 是平台任务/会话面。**硬锁（2026-09-14）：** Pipeline **页**仍存在（`FS-KOL-010`），只许深链或产品内 CTA。**禁止**员工侧栏挂「生命周期」或 `/pipeline` 主入口。本条不是「可挂可不挂」的密度选项。
5. **技能是一等能力。** 侧栏是否露出是 UX 密度，**不是**硬「员工必须永远看不见技能」，也**不是**「技能目录不是员工默认入口」的永久禁令。仍禁止能力图鉴压过任务脊柱，禁止把技能做成 `/agents` 或连接器/知识的上级目录。本记录**不**强制把技能加进员工侧栏。
6. **数字团队是一等能力，尚未实现。** 预留法律地位与产品名词。禁止「专家团」假导航 / 占位 / 冒名。**不得**永久禁止名词「数字团队」。本记录**不**实施数字团队 UI。
7. **不变量不变。** 发送 ≠ 推进阶段；L1–L3；连接器使用 ≠ 管理治理。

### 修订范围（相对 ADR-016）

ADR-016 专家中心「只召唤岗位专家 / 无专家团 / 召唤 ≠ 发送与阶段 / Home 独占任务」仍有效。下列读法被本记录修订：

- 「不要求数字团队（易被读成专家团）」→ 禁止专家团；数字团队另列、预留、未实现。
- 「技能目录仅显式调试或管理端 / 员工默认禁止 Skill / 技能目录不是员工默认入口」→ 禁止图鉴压过脊柱与 `/agents` 主 IA；技能一等；入口密度=UX。
- 「四页法律 ⇒ Pipeline 必须进默认侧栏 / 缺则 P0」或「Pipeline 侧栏 = UX 密度、可挂可不挂」→ **禁止**侧栏挂「生命周期」或 `/pipeline` 主入口；页只许深链 / CTA。

### 不决定的范围

不实施前端 / 后端 / CSS / e2e。不 LIVE。不实施数字团队 UI。不强制员工侧栏加技能。不重命名 `design-system/kol-workbench/`。不新增 UX ID。不削弱核心闭环、发送 ≠ 推进阶段、L1–L3、ADR-015 能力主权、连接器使用面 vs 治理面、无可见侧栏组标题。不重做 Chat。不改写全部 19 时代历史正文。

### 影响

- 规范：`CONSTITUTION.md` §4；`employee-surface-contracts.md` 技能/数字团队/占位只回答 + **禁止**侧栏挂 Pipeline；`21-admin-employee-page-roles.md` 侧栏必须表；`docs/README.md` 平台 vs 试点路由；`04-ux-ui-system.md` / `19` / `CONTEXT-MANIFEST.md`
- 证据：`docs/evidence-platform-law-gap-2026-09-14.md`、`docs/evidence-constitution-reconcile-2026-09-14.md`
- 代码：本 ADR 不改 JSX / API / CSS
- 测试：文档评审 only；现行 E2E「侧栏无技能 / 无数字团队」仍是实现快照，不是本记录的永远禁令
