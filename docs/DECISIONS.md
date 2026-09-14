# 关键决策记录入口

本文件是决策索引，不替代规范正文。涉及规范冲突、不可逆副作用、组织范围、物理接口漂移或架构取舍时，先在这里登记，再更新 canonical 文档和追踪矩阵。

## 近期记录

| 日期 | 记录 | 说明 |
|---|---|---|
| 2026-09-13 | Home 视图顺序改为 **AI发现 → 我的待办 → 我跟进的红人**；今天推荐只挂 AI发现；我的待办去掉「后续」历史桶 | 默认 `tab` 为空即 AI发现；推荐仍只预填不自动执行（`04`）。见 `19-ui-ux-constitution.md`。 |
| 2026-09-13 | 邮件往来摘要 Codex `thread/start` 与识别一致：`CODEX_MODEL` / CLI 默认，不传 `gpt-5.6-luna`。Luna digest 需要 `OPENAI_BASE_URL` 及该端点 key | 公共 OpenAI `sk-proj` 打默认 Luna 会 HTTP 401。不改 provider 顺序或 sticky-fail。 |
| 2026-09-13 | 邮件往来摘要 `analysis_failed` 改为冷却后自动再试，并持久化 `error` / `attempted` / `failed_at` | 不是新 ADR。不改 provider、指纹、寒暄过滤或超时。详见 `docs/evidence-mail-digest-analysis-plan-2026-09-13.md`。 |
| 2026-09-14 | 并列能力面与 Agent / 任务解耦：知识库、审批、考试、连接器使用面是独立产品面，不隶属 KOL Agent，也不因进行中任务才存在 | 不是第五套 Home。治理仍 Admin-only。见 ADR-015、`19-ui-ux-constitution.md`、`21-admin-employee-page-roles.md`。 |
| 2026-09-14 | 首版 Expert / DigitalEmployee 后端：`ExpertManifest` + `GET/POST /api/experts`；仅 `expert:kol` 已发布；召唤只建绑定会话 | 不改 `/agents` IA，不是第五套 Home，不 LIVE。见 ADR-016、`docs/evidence-expert-manifest-2026-09-14.md`。 |

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
| ADR-012 | 员工端四页分工：Home=现在做什么；Pipeline=正式生命周期资产；Chat=完成一件任务；Admin=谁/权限/审计。Pipeline 禁止复制 Home 待办语义 | `19-ui-ux-constitution.md`、`specs/FS-KOL-010-pipeline.md` |
| ADR-013 | 管理端是员工四表面的配套治理套件，不是副本；连接器**治理**只在 `/admin/connectors`，员工**使用面**独立（`/connectors`），Agent 治理在 `/admin/agents`，个人 Starry 绑定只留 Settings | `21-admin-employee-page-roles.md`、`19-ui-ux-constitution.md` |
| ADR-014 | 员工侧栏：定时任务归今日工作簇；簇间用分割线，不画可见「今日 / 智能体 / 资产」组标题 | `19-ui-ux-constitution.md` |
| ADR-015 | 员工并列能力面（知识库 / 审批 / 考试 / 连接器使用面等）与数字员工开工入口、今日任务队列解耦；KOL 只作数据不定义 IA；治理仍 Admin-only | `19-ui-ux-constitution.md`、`21-admin-employee-page-roles.md` |
| ADR-016 | DigitalEmployee 的机器可读发布对象是 `ExpertManifest`（API `expert` / `expert:kol`）；Agent 包保持 `agents/*/manifest.yaml`；召唤只建绑定会话 | `02-domain-model.md`、`14-implementation-contract.md`、`experts/kol/manifest.yaml` |

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

## ADR-012 — 四页分工与 Pipeline 非目标（2026-09-13）

**状态**：已固化  
**决策人**：产品负责人

### 问题与背景

Pipeline 曾把首页任务芯片、「本页动作」伪芯片和 Chat 会话启动器叠在资产页上，并在无 `?kol=` 时自动选中第一名红人。这让 Pipeline 回答「现在做什么 / 等待中」，与 Home 的等待诚实重复，也把写邮件、回复分析、风险扫描变成了第二套工作入口。

### 决定

1. **四页只各答一问。** Home = 现在做什么与等待诚实（结果待确认·已入队·执行中·等审批）。Pipeline = 正式生命周期坐落。Chat = 如何完成一件具体任务。Admin = 谁 / 权限 / 审计。
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

1. **不改四页法律。** Home / Pipeline / Chat / Admin 仍各答一问。`/agents` 仍是员工工作入口。管理端展开为配套套件，不是第五套员工页，也不是第二套 Home / Pipeline / Agents。
2. **连接器治理只在管理端枢纽。** `/admin/connectors` + `/admin/connectors/:id`：启用、凭据引用永不回显、员工 read/write、组织 Starry 策略。个人邮箱绑定只留 Settings。
3. **Agent 治理页替换跳转。** 新 `/admin/agents` 管发布状态、可写范围、考试闸门、连接器授权矩阵；管理端顶栏不再跳员工 `/agents`。
4. **导航与 chrome 分家。** 去掉员工侧栏管理端深链；管理端健康条用治理文案，不克隆员工 remote-pill。遗留「本期连接器」与 SkillHub 调试砖收敛到枢纽。

### 修订（2026-09-13）— 员工使用面不是治理目录

原句「连接器只在管理端枢纽」容易被读成员工端任何连接器表面都违约。澄清：

- **管理治理面**不变：启停、凭据引用、组织策略、授权、审计只在 `/admin/connectors` 与 `/:id`。
- **员工使用面**合法：独立员工 chrome（如 `/connectors`）只回答「我已被授权可用哪些、对我意味着什么、个人绑定去哪」。这不是枢纽副本，也不是第五套主表面。
- 「员工不可见配置」= 配置 / 凭据 / 组织策略 / 授权编辑不可见；**不**禁止使用/状态面。员工端零处**治理**目录，不是零处使用面。
- 员工侧栏若有入口，只链使用面，禁止深链 `/admin/connectors`。个人绑定仍只留 Settings。
- 不改四页法律，不 LIVE，不新增 UX ID，不在本修订里加后端字段。

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

员工侧栏把「定时任务」放在资产簇，并用可见「今日 / 智能体 / 资产」组标题把 chrome 画成目录。这让 `/cron` 看起来像可回看对象，也让组名抢走主路径注意力。四页角色与发送 ≠ 阶段不变。

### 决定

1. **定时任务属于今日工作簇。** 与新工作任务 / 进行中并列；不进资产。确认入口若仍在今日簇，必须与审批页同路由。
2. **簇间只用分割线。** 禁止可见「今日 / 智能体 / 资产」组标题。`<nav aria-label>` 保留给读屏。项目 / 最近若还在，同样不写可见组标题。
3. **只改员工工作台侧栏。** 不重做 Admin 导航，不改 Chat，不改 LIVE / stage 写入。

### 不决定的范围

不预合并「去掉等我确认」「去掉最近」或管理端治理壳；那些由并行侧栏 PR 处理。本决策不改四页法律。

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

1. **并列能力面是独立产品面。** 知识库、审批、考试、连接器使用面（及明示非本期的云盘 / 遥控 / 项目）与 `/agents` 开工入口、今日任务队列相互独立：不隶属 KOL Agent，也不因进行中任务才存在。
2. **数据可进、壳子不出。** KOL / 合作 / 邮件只作记录类型或示例；IA / 导航 / 空态不得改成「先选 Agent / 先开任务」。
3. **调用单向。** Chat / Agent 可调用已授权连接器、检索知识、提交审批；能力面不得复制 Chat 主线程或 Home 待办桶，也不得做成第二会话台。
4. **不是第五套 Home，也不是能力图鉴。** 四页法律不变。技能目录不得做连接器 / 知识的上级目录。连接器仍遵守 `21` 的使用面 vs 治理面；治理仍 Admin-only。

### 不决定的范围

不实施前端 / 后端，不 LIVE，不新增 UX ID，不削弱核心闭环、发送 ≠ 推进阶段、或无可见侧栏组标题。不重做 Chat，不改数字员工对象模型。

### 影响

- 规范：`19-ui-ux-constitution.md` 并列能力面条款、`21-admin-employee-page-roles.md` 交叉引用
- 代码：本 ADR 不改 JSX / API
- 测试：文档评审 only；无新发布门禁项

## ADR-016 — ExpertManifest 是 DigitalEmployee 发布对象（2026-09-14）

**状态**：已固化  
**决策人**：工程（本 PR 落地首版后端）

### 问题与背景

`02` 把 DigitalEmployee 写成岗位身份、目标、知识范围、权限和可用 Agent。仓库此前只有 Agent 发布包 `agents/kol/manifest.yaml` 与 `GET /api/agent-manifest` 的 `employee_views` 投影。把岗位对象塞进 `entries[].skillId` 会再塌一层。员工端 `/agents` 仍是 `19` P0 工作入口，不是数字员工名册页。

### 决定

1. **命名。** 领域对象仍是 DigitalEmployee；本版 API / 资产路径用 `expert` / `ExpertManifest` / `expert:kol`。
2. **资产位置。** `experts/<id>/manifest.yaml`，与 `agents/<id>/manifest.yaml` 并列。Agent 包继续只发布 skills / workflows / policies / mcp / employee_views。
3. **员工可见。** 仅 `publish_gate.state: published` 出现在 `GET /api/experts`；未发布不可召唤（409 `expert_not_published`）。当前只发布 `expert:kol`。
4. **召唤。** `POST /api/experts/:id/summon` 复用 `POST /api/sessions` / `openKolSession`，在会话上写入 `expert_id`。不发信、不写阶段、不调 LIVE Gateway、不入队副作用。
5. **诚实缺字段。** 知识范围、LIVE 健康、运行投影、岗位 owner、数字部门编制等未落地字段列入 `missing_fields`，API 省略，不伪造。
6. **不改 IA。** `/agents` 仍是工作入口。本 API 支持召唤已发布专家，不把专家做成第五套 Home，也不重定义 `19` 并列能力面。

### 不决定的范围

不重做 Chat / Agents UI，不实施数字部门，不放宽 LIVE / confirm-before-send / stage 写入。

### 影响

- 规范：`02-domain-model.md`、`14-implementation-contract.md`、本文件
- 代码：`experts/kol/manifest.yaml`、`backend/src/experts.ts`、`GET/POST /api/experts`
- 测试：`backend/tests/experts.test.ts`、`validate:contracts`
