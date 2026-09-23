# 技能路由、参数、记忆与密度收敛实施计划

> 日期：2026-09-23  
> 状态：实施中；阶段 0–3 为既有 partial/complete，阶段 4–7 本轮推进为 partial，阶段 8 未运行（按当前开发要求不跑测试/构建/E2E）。
> 依据：[设计规格](../specs/2026-09-23-skill-routing-param-memory-design.md)、[统一工作台规格](../specs/2026-09-23-unified-agent-workspace.md)。  
> 本计划范围：把技能显式锁定/自然语言路由、schema 参数澄清、技能管理配置、统一结果区、终态记忆与截图所示密度问题，按可回滚阶段接入现有 Host 和 Workspace。

## 1. 审宪记录（CONST-08）

| 需求 | 主责角色 | 宪法条款 | 基本法条款 | 结论与证据 | 下一步 |
|---|---|---|---|---|---|
| 由技能声明驱动明确唤起、自由文本识别、参数澄清、结果展示与记忆，并收敛截图中的界面密度/溢出 | 智能体产品经理（入口/记忆）；平台产品经理（技能资产）；UI/UX 专家（布局/密度）；架构师、前后端专家（契约/Host）；KOL 业务专家（业务 alias/动作口径） | CONST-01/03/04/05/06/07/08/10 | PROD-AGENT-01~09、PROD-PLAT-02~05；TECH-ARCH-02/04、TECH-FE-01~03、TECH-BE-01~09、TECH-TEST-01~03；BIZ-07/10/14/16/18；DESIGN 密度、双栏、三轴、不变量；07-mcp-data-contract 风险与异步约束 | **符合，按规格与本计划实施。** 显式技能锁定由 Host 接受已登记 task_type/entry_id；自由文本候选由判别器产生、Host 校验；结果/记忆均按授权和来源呈现；L3 与异步流程不改写。 | 先完成阶段 0 设计冻结和基线盘点；规则空白只阻塞对应 alias/业务动作，不阻塞通用机制。 |

规则空白继续登记，不在实现中代填：BIZ-07 公海字段/领取范围、BUSINESS 覆盖表未登记技能的员工入口口径。用户已明确要求将「AI发现」作为 `creator_discovery` alias；命中只形成候选/参数回填，不自动切换页面或执行。

## 2. 现状与实现边界

- 技能源数据目前位于 `backend/skills/<id>/SKILL.md`；后端通过 `tasks/registry.ts` 加载，技能发布经 `host/skill-publish.ts`，管理界面为 `frontend/src/pages/SkillLifecycle.tsx`。
- 自然语言识别主要在 `tasks/openai-intent.ts`、`tasks/recognize.ts`、`tasks/resolver.ts` 与 `routers/tasks.ts`；明确入口另有 `host/entry-registry.ts` 及各业务 endpoint。
- Home 已采用五模式 `WorkspaceShell`，AI发现已有专用参数卡、异步过程和结果面板；实施应先复用既有契约再抽象，不另建平行注册表/任务运行器。
- 记忆已有 `employee_memory_items`、`memory-increment.ts`、`memory-kinds.ts` 和专用发现事实存储。新增通用结果记忆前必须盘点既有读写，避免双写或以个人记忆覆盖业务事实。
- 工作树已有其他未提交变更。本计划执行时必须逐文件核对并仅编辑本计划列出的目标；不得重置、暂存或覆盖其他人的改动。特别保护 `backend/skills/today_plan/SKILL.md`、`backend/skills/todo_plan/SKILL.md` 以及 `.stage*.patch`。

### 明确不改

- 权限范围、业务审批链、KOL 阶段规则、导入/发送/领取/解密的风险等级及 Host Gateway 闸门。
- MediaCrawler 的单任务异步契约、持久作业状态、取消/重试和回执语义。
- Codex harness；不为技能另造推理循环，不让本地前端关键词或 regex 成为生产路由器。
- 既有专用事实表和业务事实源；统一结果区只投影，不改权威来源。

## 3. 目标调用协议

```text
明确技能 chip / 登记按钮 / 专用业务入口
  → 请求携带锁定的 task_type + entry_id + skill_version
  → Host 跳过意图判别，校验登记、权限、必需参数与风险

自由文本
  → 已登记目录（title/aliases/input_schema 摘要）供判别器选择候选
  → Host 校验候选与参数；低置信/多候选交用户选择
  → 缺参在 Host 结构化澄清；补齐后生成 ready 快照
  → Codex harness / 已登记异步 handler

记忆/历史快捷入口
  → Host 权限过滤后直接读已存在索引，不建 thread/turn、不调用模型

完成
  → Host 校验运行终态与输出 → 按 memory_policy 幂等更新记忆
  → 当前新结果在右栏置顶，授权记忆/历史作为背景，可追溯、可标 stale
```

## 4. 阶段 0：设计与基线冻结

**目的：**在改代码前确认事实来源、端点、现有状态和用户工作区边界。

**操作：**

1. 对照设计规格 §4–§14、统一工作台规格 §6–§10、§17，建立需求到文件/接口/证据映射；消解“记忆优先”一词的歧义：活动 run/本次新结果置顶，记忆是背景/历史。
2. 查全 `SKILL.md` frontmatter 字段解析、入口登记、intent verdict schema、缺参判断与已有 aliases；确认 `creator_discovery` 的实际 ID、字段、发现模板字典、现有请求 endpoint 和异步事件。
3. 盘点 `employee_memory_items` 的 schema/migration/索引以及发现、今日计划、待办专用事实写入；决定结果记忆复用还是扩展 kind，禁止未经审查的双写。
4. 盘点 `SkillLifecycle` 当前技能详情/生命周期 API 的读写 DTO、保存草稿和发布版本流程，界定声明字段从 SKILL.md 到管理 DTO 的端到端路径。
5. 检查现有工作区改动及基线失败，只记录不归属本任务的已知问题；保留具体文件和用户已有修改。

**产物：**本计划的最终文件清单、兼容决定、基线缺口清单。若发现规范冲突，记录条款与责任角色；不依代码现状改法。

**进入门槛：**无未解决的权限/风险契约冲突；历史结果存储方案可避免权威事实双写；业务空白已隔离。

## 5. 阶段 1：技能契约与发布校验

**目标：**让 schema 以单一事实源随已发布技能版本传递，旧技能仍可兼容。

**主要文件：**

- `backend/src/tasks/registry.ts`
- `backend/src/host/skill-publish.ts`
- `backend/src/host/skills-catalog.ts`（仅当现有目录 DTO 不足时）
- `backend/src/routers/misc.ts`（仅当现有管理 API 必须扩展时）
- `backend/skills/creator_discovery/SKILL.md`
- 对应 backend registry/publish/catalog 契约测试与发布校验配置

**步骤：**

1. 定义并导出版本化类型：`input_schema`、`result_type`、`next_actions`、`memory_policy`、`supports`；约束未知字段/类型安全处理。
2. 增加注册期验证：`required_inputs` 与 required schema key 集合一致；参数 key 唯一；kind 与 default/max/options 类型合法；动态 options source 在登记端点表中；next action 引用已登记 action id 与允许谓词；MCP、permissions、forbidden_tools 仍服从现有白名单。
3. 旧技能无新字段时保留旧表现和明确的“未配置”状态，不给其推导伪 schema。解析错误须指出技能 ID/字段路径并阻止无效版本发布。
4. 扩展创建/更新/发布 DTO 和 YAML 序列化，保留编辑草稿与发布版本分离；读取端返回版本号与声明字段，避免编辑草稿改变运行中的技能。
5. 仅为 `creator_discovery` 加入第一版 schema；复用当前模板字典与已有稳定 code，登记「红人线索」「AI发现」alias，不改采集和入库 endpoint。
6. 增加安全回归：文案员工禁词过滤；action 不可信；员工 DTO 不包含凭据；技能版本固定到运行上下文。

**验收门：**有效/无效 manifest 契约覆盖；旧技能兼容；保存草稿不生效、发布新版本才生效；schema 缺失/错误明确失败；无权限或接口集合扩张。

## 6. 阶段 2：技能管理面「参数与接口」

**目标：**管理员能编辑、验证和发布声明字段；员工端只读展示已发布声明。

**主要文件：**

- `frontend/src/pages/SkillLifecycle.tsx`（页面结构与表单状态）
- 技能 lifecycle/catalog API client 与对应 DTO
- 组件级样式文件（遵循 `docs/DESIGN.md` token）
- 管理面与员工目录相关的 UI/权限验证

**交互步骤：**

1. 在技能编辑区增加“参数与接口”分组：输入字段表格支持添加/编辑/移除、排序；字段含稳定 key、员工标签、类型、必填、字典来源、缺参理由、默认值、限制值。
2. options source 仅从已登记字典/接口目录选择；管理面显示接口名称、用途、风险档和授权要求，不能输入任意 URL/工具调用，也不把接口声明当成授权。
3. 增加结果类型、登记动作引用、记忆范围/策略及 cancel/retry/resume 能力配置；提供 schema 校验错误定位和发布前摘要。
4. 草稿预览展示 schema 效果；保存草稿、运行测试、发布版本分别呈现状态，沿用现有生命周期/审核能力。
5. 员工面只展示已发布参数/结果说明/建议动作和风险提示；未登记显示真实未配置状态。

**验收门：**管理权限由服务端校验；字段校验可操作且错误有路径；发布/回滚遵守既有版本流程；员工面无引擎词、原始 ID 或凭据；无第二注册表。

## 7. 阶段 3：Host 路由和结构化澄清

**目标：**明确入口不猜意图，自由文本候选有确定性 Host 校验，缺参时不启动 Codex。

**主要文件：**

- `backend/src/tasks/openai-intent.ts`
- `backend/src/tasks/recognize.ts`（仅若候选 DTO/实体提取有必要改动）
- `backend/src/tasks/resolver.ts`
- `backend/src/routers/tasks.ts`
- `backend/src/host/entry-registry.ts`（只补齐既有入口元数据，不新增第二事实源）
- `frontend/src/pages/Home.tsx`、`frontend/src/components/ComposerDock.tsx`
- 新通用澄清/参数组件见阶段 4

**步骤：**

1. 自由文本目录候选包含已发布 title/aliases/schema 摘要及适用入口；模型输出限于登记 `task_type`、实体值、缺参、备选、置信和原因。
2. Host 严格校验模型输出：技能已发布且可见、路由模式允许、字段存在/类型通过 sanitize、entities 不扩越权范围；别名不成为 Host 子串匹配逻辑。
3. 显式入口携带 `task_type + entry_id + skill_version`，Host 跳过判别器；禁止忽略 locked task_type 后再次推断。模式 tab 本身仅导航，不隐式执行技能。
4. 置信不足或多候选返回方向澄清；用户选择候选后以锁定入口继续。不得把模型判别成功视为授权或自动确认。
5. 缺必填项返回结构化问题：稳定 question_id/field_path/kind/options_source/reason/required/inputVersion；Host 执行参数校验并在补齐前不建 box、不启动 turn。
6. 每次已提交输入变更递增 inputVersion，使既有 ready/L3 快照失效；ready 摘要读取 Host 返回动作与风险，不由前端推断。
7. 未配置 schema 的技能延用现有缺参体验；未登记业务口径的技能不给猜测性候选或动作。

**验收门：**明确锁定无判别器调用；自由文本判别结果经 Host 校验；低置信有选项；缺参零 box/turn；越权字段拒绝；变更输入令旧确认失效；既有 memory 快捷入口仍零模型。

## 8. 阶段 4：通用参数卡与 AI发现试点

**目标：**一个 schema renderer 同时服务模式条件、缺参澄清与 ready 回显，先迁移 `creator_discovery`。

**主要文件：**

- `frontend/src/home/workspace/SkillParamCard.tsx`（建议新建，目录按现有结构核实）
- `frontend/src/home/DiscoverySearchCard.tsx`
- `frontend/src/home/DiscoveryWorkspace.tsx`
- `frontend/src/home/useDiscovery.ts`
- `frontend/src/pages/Home.tsx`
- 对应 `frontend/src/home/*` 参数/form/澄清单元与 E2E

**步骤：**

1. 注册控件映射：single、multiple、text、number/range、date、object；字段 label/reason/options 来自已发布 schema/授权字典 DTO。
2. 实现同一参数模型与稳定 serialization：UI label 只用于显示，提交稳定值；支持 schema 默认值、从判别 entities 预填和未识别字段安全丢弃/报错。
3. 明确编辑态、needs_input、ready 只读态；字段错误关联 field_path；支持键盘、焦点、触摸命中区与 screen reader 标签。
4. 将 DiscoverySearchCard 的硬编码字段映射为 `creator_discovery.input_schema`，保留现有 API 请求 shape、`data-*` 选择器和来源字典，不改异步 job 状态。
5. 新建 run 时锁定 schema/skill 版本、输入版本和请求范围；显示异步等待原因、取消/重试能力由服务端契约决定。

**验收门：**同一参数值从表单与自由文本路由得出相同规范化 DTO；选项 code 稳定；五模式共享 shell 不回归；MediaCrawler 单任务约束与真实状态保持。

## 9. 阶段 5：ResultRail、下一步与来源分层

**目标：**右栏用统一结果协议呈现活动 run/本次产物、相关历史/记忆和可执行下一步。

**主要文件：**

- `frontend/src/home/workspace/ResultRail.tsx`、`ResultRendererRegistry.tsx`（如阶段 0 确认无既有等价组件）
- `frontend/src/home/DiscoveryResultPane.tsx`
- `frontend/src/home/DiscoveryLeadRow.tsx`
- `frontend/src/home/WorkspaceShell.tsx`
- `frontend/src/home/useDiscovery.ts` 与其它 workspace view-model adapter
- 注册动作展示 DTO 所属 router/host（仅复用现有授权 DTO，不自算权限）

**步骤：**

1. 统一右栏 view model：run 状态、结果类型、结果版本、来源/时间/新鲜度、授权记忆/历史、选择范围、登记动作与确认/审批/回执信息。
2. 渲染优先级：活动 run 状态 → 本次最新结果 → 相关记忆/历史；旧版本只读可返回最新。记忆明确标记为背景/历史且显示来源与 stale 状态。
3. 空态分别区分尚无结果、服务不可用、筛选无结果；提供“补参数运行”和“交给 Agent”两个真实入口。
4. action renderer 只呈现服务端 RegisteredActionView（allowed/enabled/disabledReason/selection/confirmation）；每屏最多一个实底 CTA。模型文字不生成任意动作。
5. 未注册 result_type 降级为安全文本/表格并显示来源；拒绝渲染 HTML/脚本。
6. 先将 discovery 接入，再迁移其它模式；五模式逐一验证对应对象语义，不把业务列表统一成同一对象类型。

**验收门：**当前新结果不会被旧记忆覆盖；右栏折叠/展开不丢结果版本、选择和待确认上下文；动作禁用理由来自服务端；无假数量/假成功/假来源。

## 10. 阶段 6：终态记忆和历史版本

**目标：**只持久化经 Host 校验、按技能策略允许保存的结果摘要；保持业务事实与记忆分层。

**主要文件（依阶段 0 决定复用或扩展）：**

- `backend/src/host/employee-memory.ts`
- `backend/src/host/memory-increment.ts`
- `backend/src/host/memory-kinds.ts`
- 结果终态 handler / `backend/src/host/` 新的结果记忆模块
- 对应 memory endpoint 与 `backend/src/routers/` route
- DB schema/migration（只有确认现有 schema 不足时）

**步骤：**

1. 定义可持久化 payload：技能/版本、owner/company/可见 scope、对象 ID、run ID、输入/来源版本、validated result 摘要、created/updated、有效状态、stale refs、content hash。
2. 将写入挂接到唯一可信的 Host terminal path：`completed/partial` 且 output schema/来源校验通过；去重键幂等，hash 未变不写，revision 递增。
3. failed/cancelled 只记录运行终态，不覆盖旧成功记忆；不回滚已发生外部副作用。L2 草稿不入长期记忆；L3 保留动作回执在审计/结果层。
4. `on_complete`、`on_adopt`、`never` 由发布技能策略控制；候选/建议只有被采纳后才形成正式对象，不将建议直接变成事实。
5. 读取前按当前身份与对象范围过滤；权限撤销、来源变更和删除使衍生摘要失效/过期；检索不调用模型。
6. 保留旧记忆读取兼容；专用 discovery/today/mail memory 只投影，不双写同一权威事实。历史版本 API 分页并限制响应字段。

**验收门：**终态、去重、失败保留、权限撤销、stale、来源引用、删除/更正场景覆盖；快捷读取零 thread/turn/model；无敏感凭据进入 payload/log。

## 11. 阶段 7：界面密度与越界治理

**目标：**按用户最新裁定更新 `docs/DESIGN.md` 与实现：右栏结果优先且可宽于中栏，控件本体紧凑、小圆角；控件尺寸通过命名 token 管理。

**主要文件：**

- `frontend/src/styles.css`
- `frontend/src/home/today-plan-board.css`
- `frontend/src/home/today-display-row.css`
- `frontend/src/home/discovery-workspace.css`
- `frontend/src/home/DiscoveryProcessPanel.tsx`
- `frontend/src/home/TodayPlanProgress.tsx`
- `frontend/src/home/DiscoverySearchCard.tsx`
- 其它由截图评审定位到的组件 CSS（需先证明选择器对应关系）

**步骤：**

1. 修复 hero 空态、对象交互标题、发现条件卡副标题，统一到 DESIGN 规定字号角色；全部引用 `--ds-font-*` 和现有 spacing token。
2. `today-display-row.css` 去掉硬编码字号；结果行 grid 使用 `min-width:0`，长 token/URL 用断词规则，次要字段展开显示。
3. 两套 think/progress 面板沿用渐进折叠与诚实截断；使用 `pre-wrap`/`overflow-wrap`，不移除内容、不静默裁切；全文 trace 保持权限保护。
4. 去除整栏横向滚动和 `overflow-x:hidden` 掩盖；右栏扩宽、修复列最小宽度与操作栏换行，必要字段仍可进详情。
5. Composer 按矮视口让出高度；中栏 timeline 和右栏 body 独立滚动，避免外层第三条业务滚动轴。
6. 核对对象卡和参数卡的实际行数/内容密度；禁止 hero 卡墙和无效留白，保留触摸命中区与焦点可见性。

**验收门：**使用 DESIGN 宽度/高度/输入模态矩阵截图；无横向溢出/静默裁切；1 个完整交互块或结果行可见；状态不只靠颜色；右栏宽度满足结果可读性，不再强制中栏宽于右栏。

## 12. 阶段 8：贯通验证、灰度与交付

**自动化验证：**

- Registry/publish：schema 合法、非法、旧 manifest 兼容、发布版本隔离、员工文案过滤。
- Route/resolver：locked path、自由文本候选、低置信澄清、结构化缺参、sanitize、权限拒绝、inputVersion 与 L3 snapshot 失效。
- UI：参数卡控件/错误/键盘，Discovery 参数契约 parity，右栏新结果/记忆分层/历史版本/折叠恢复/错误空态。
- Memory：completed/partial 写入、failed/cancelled 不覆盖、hash 去重、权限撤销、过期、删除、来源版本变化。
- E2E：红人线索自然语言至 MediaCrawler 异步完成的试点（只在授权测试环境）；明确技能入口跳过判别器；L0 记忆读取零 turn；五模式 parity 与既有 L3 动作回归。
- 视觉：DESIGN 验收矩阵指定尺寸与键盘/触摸路径；截图含 needs_input、running、failed、completed、旧版本、折叠态。

**发布顺序：**

1. 先发布可向后兼容的 schema parser/DTO，旧技能不变。
2. 以 creator_discovery 为唯一首批 schema 技能，管理面仅管理员可编辑。
3. 启用路由与参数澄清，观测未识别/低置信/缺参和失败，不收集不必要个人文本。
4. 启用结果区投影；确认已发布任务不会丢旧结果/回执。
5. 最后启用终态记忆写入；通过权限、幂等与删除验证后才放量。
6. 密度 CSS 可独立发布/回滚，不与业务动作变更捆绑。

**全量门禁：**按仓库 `backend/package.json`、`frontend/package.json` 和 release gate 运行契约、类型、测试、构建、E2E、Agent evaluation 与必要授权集成验证；不可用外部环境时明确标注未验证，不以 mock 冒充生产闭环。

## 13. 完成定义与上线阻断条件

全部满足才可宣称完成：

1. `creator_discovery` manifest 的参数/结果/动作/记忆/运行能力进入版本化 registry、管理端编辑及发布校验。
2. 指定技能入口 Host 锁定；自然语言候选由判别器识别、Host 校验；未知/低置信/未登记业务口径不擅自执行。
3. 缺参结构化、服务端校验，补齐前无 Codex turn；修改参数令旧确认失效。
4. 参数卡与右栏结果协议接入五模式公共外壳，保留各模式业务对象与已登记动作。
5. 当前结果、记忆背景、历史版本区分来源和新鲜度；失败不覆盖成功记忆；权限撤销/过期生效。
6. L1/L2/L3、审批、Gateway、幂等和回执行为不回归；MediaCrawler 仍是单任务异步作业。
7. 截图密度问题按 DESIGN 修复，三轴、键盘、触摸及无障碍证据齐全。
8. 目标域自动验证与授权外部集成证据齐全；已知基线失败逐项分类；工作区未提交文件未被误改。

以下任一情况阻断对应发布：Host 收到不在 catalog 的技能 ID 仍继续执行；缺参时建 box/启动 turn；权限先取数后过滤；记忆写入绕过 Host 终态校验；建议直接成为正式待办；L3 未确认/无回执；异步状态被假造；UI 旧版本确认可复用到新输入。

## 14. 回滚策略

- 每阶段独立提交和发布；执行时只暂存本阶段明确路径，不运行 `git add -A`。
- schema reader 先向后兼容；新 manifest 可停用回旧阅读器。禁用新路由不影响显式旧入口。
- UI 参数卡/ResultRail 可按 Home feature flag 或组件接线独立回滚；已有业务 endpoint 和回执照常展示。
- 记忆写入可通过策略/handler 开关停用；不删除已产生的业务事实、审计回执或历史记忆。恢复后由可重入任务补索引，不重复副作用。
- 视觉修复独立回滚；不将密度 CSS 回退与数据或动作状态回滚绑定。

## 15. 执行记录模板

每个阶段完成时回填：

| 阶段 | 实际文件 | 负责人角色 | 状态 | 验证证据 | 已知缺口/回滚点 |
|---|---|---|---|---|---|
| 0 | 本轮已核对规范、现有端点、工作树与记忆来源 | 平台产品经理 / 架构师 | complete | `AGENTS.md`、`docs/AGENTS.md`、CONSTITUTION、PRODUCT、DESIGN、07-mcp 与代码路径已核对；发现技能保存会立即激活，历史 runs 属发现事实源 | 终态记忆目前仅接入已验证的 discovery brief；通用 Host result terminal path 仍未接入 |
| 1 | `registry.ts`、`skill-publish.ts`、creator_discovery manifest、目录 DTO | 平台产品经理 / 后端专家 | partial | schema 类型、必填一致性、选项源白名单、结果/动作/记忆/运行能力声明及管理 DTO 已加入；旧 manifest 可省略新字段；仅已登记 Host 校验写入器可声明自动结果记忆，发布校验拒绝其余组合 | 生命周期没有独立草稿保存；保存当前包立即生效，发布版本另存快照；发布隔离验收未满足；需在新结果适配器落地后逐个登记能力 |
| 2 | `SkillLifecycle.tsx`、`api.ts` | 平台产品经理 / 前端专家 | partial | 增加契约 JSON 编辑与服务端校验错误回显；明确即时生效语义 | 尚未提供逐字段 renderer、授权字典选择器、发布前摘要；JSON 编辑器为首版管理控件 |
| 3 | `openai-intent.ts`、`resolver.ts`、`tasks.ts`、`Home.tsx`、`BUSINESS.md`、`creator_discovery/SKILL.md` | 智能体产品经理 / 后端专家 / 前端专家 / KOL 业务专家（用户明确裁定 alias） | partial | alias/schema 目录已用于发现候选；用户指定的「AI发现」与「红人线索」均已登记；命中仍需用户选择，不自动运行；Host resolver 校验已声明字段类型、数字范围、日期格式和静态选项 code；from-text 对 schema 缺失/非法字段只回澄清 DTO，不创建不完整 work item；直接创建 API 对 schema 错误返回 422；采纳接口拒绝非 candidate 状态并校验标题/身份 | 尚未实现全技能锁定入口协议、统一置信澄清/参数补齐和 inputVersion 快照；动态 options source 尚未在通用 resolver 接入 |
| 4 | `workspace/SkillParamCard.tsx`、`DiscoverySearchCard.tsx`、`DiscoveryWorkspace.tsx`、`Home.tsx` | 前端专家 | partial | schema 控件映射覆盖 single/multiple/text/number/date/object；发现表单从技能目录 input_schema 取字段，选项仍来自授权模板端点；一般员工可见的已登记 schema 技能在五模式中栏呈现参数卡；Host 缺参/非法字段回填字段错误；自然语言候选确认后会锁定技能并展示参数卡；仅填参数时允许提交，任务描述使用技能标题；ready 只读展示已由通用 renderer 支持；保留发现选择器，并防护动态 option source 的原型键/非数组值 | 当前仅发现有员工可见 schema，且走专用异步 workspace；其他普通技能的实际端到端覆盖、needs_input DTO/versioned ready snapshot 和浏览器验收未完成 |
| 5 | `WorkspaceShell.tsx`、`workspace/ResultRail.tsx`、`ResultRendererRegistry.tsx`、`NextActionBar.tsx`、`host/registered-actions.ts`、五模式 workspace adapters、`home-board.ts`、`routers/tasks.ts` | 平台产品经理 / 前端专家 / 后端专家 | partial | 五模式由同一 ResultRail 包装；新增 HostRegisteredActionView DTO 和 L3 快照生成/新鲜度校验器；前端改用相同 snake_case DTO；采纳时 Host 重读当前用户服务端建议投影并以服务端字段为准；发现右栏读取并展示分页的此前结果记忆，空态明确提示暂无已保存结果 | DTO 尚未由五模式动作查询端点实际下发，Host 快照比较器未接入各业务执行路由；记忆/历史/动作 slot 未在所有模式完整填充；无浏览器密度截图证据 |
| 6 | `host/skill-result-memory.ts`、`host/employee-memory.ts`、`host/api.ts`、`home-discovery.ts`、`routers/misc.ts`、`api.ts`、发现运行 DTO、`tasks/registry.ts`、`host/skill-publish.ts` | 智能体产品经理 / 后端专家 / 前端专家 | partial | 新增技能必须声明并通过 registry 校验的 result_schema；Host 通用 on_complete/owner 写入器只处理成功 run，要求 `{items:[]}` 契约通过、结果大小受限、凭证型键/Authorization 值拒写；写入幂等且新结果使旧结果 stale；专用 discovery 仍走其既有 writer；失败/取消不写；发现历史按 grant + owner 隔离 | 来源删除/对象撤权失效未接事实源；仅支持 owner scope；技能版本诚实记录为 unversioned；未运行契约/类型/运行验证 |
| 7 | `styles.css`、`today-plan-board.css`、`today-plan-progress.css`、`SkillParamCard.tsx`、`ScopeWorkspace.tsx`、`DESIGN.md` | UI/UX 专家 / 前端专家 | in progress | 用户基于 `v 8e5c807` 新截图确认：结果右栏应更宽且优先；原图可见底部横向滚动条、动作文字多行挤压、工具贴边。按本轮裁定取消“中栏必须比右栏宽”，1280px 档结果栏目标比例设为 54%；筛选项等宽等高并统一对齐，快捷任务复用尺寸；压缩工作台搜索、计划、行内按钮的高度、内距、字号与圆角；固定表格列布局及动作列宽，触摸模态仍保持 44px 命中区。提交 `0132235` 已推送并部署，公网 `/api/version` 返回该版本 | 新版代码已上线，但本机浏览器自动化不可用，尚无用户视口的新截图，不能据静态截图宣称修复通过；仍需 1280×800 对照及 DESIGN 其余宽高、键盘焦点、触摸路径复核 |
| 8 | ResultRail/Host DTO 字段对齐、`git diff --check`、前后端 TypeScript 类型检查 | 测试经理 / UI/UX 专家 | partial | `git diff --check` 无错误；前端 `npm run typecheck --prefix frontend` 通过；后端 `npm run typecheck --prefix backend` 通过；部署构建完成且公网版本接口返回 `0132235`；按用户要求未运行 E2E，也未运行其他测试 | 截图、焦点、滚动边界、短视口与触摸矩阵仍无证据；契约/运行测试未运行 |
