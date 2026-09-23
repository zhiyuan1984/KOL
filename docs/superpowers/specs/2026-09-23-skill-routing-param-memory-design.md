# 技能唤起与参数链路 · 右栏结果记忆 · 工作台密度收敛

> 日期：2026-09-23
> 状态：设计规格（专家方案，机制部分依据现行法推导；业务口径空白处保持登记，不替业务专家决定）
> 范围：Home 五模式的技能唤起、路由识别、必要参数澄清、结果呈现与记忆存储；技能管理面的参数/接口声明；工作台表面密度执法
> 关联：`2026-09-23-unified-agent-workspace.md`（工作台骨架与状态机的上位规格，本文件不重复立法）
> 本文件是实施规格，不声明生产代码已经完成。

## 1. 要解决的问题

1. **技能唤起链路不完整**：用户明确指定技能名时应走 Host 语义（锁定执行、不再推断）；未指定时应路由识别技能并识别必要参数。「AI发现」「红人线索」这类业务词语应能唤起发现技能，但现行法禁止前端凭关键词猜测——需要一条「登记 alias + 判别器识别 + Host 校验」的合法链路。
2. **必要参数与接口不可管理**：`required_inputs` 只是字符串数组，无类型、无标签、无选项来源；澄清卡与发现条件卡都是各模式硬编码。技能管理面（Admin）没有暴露参数/接口定义能力。
3. **右栏缺统一心智模型**：右栏应是「这项工作留下了什么、现在能做什么」。进入时读取当前技能相关记忆和历史结果；活动 run 或刚完成的新结果优先展示，记忆作为背景与历史，不覆盖本次结果。新结果何时存记忆按技能声明契约决定。
4. **密度回潮**：结果与思考过程界面出现越界与空间利用不足；空态、标题、卡头是 hero 叙事（大尺寸、粗字重、居中营销文案），违反 `data-dense-dashboard` 与 token 唯一来源。

## 2. 审宪记录（CONST-08）

| 项目 | 记录 |
|---|---|
| 需求 | 技能显式唤起走 Host 语义；未指定时路由识别并结构化澄清必要参数；参数与接口在技能管理声明；右栏记忆优先、结果版本化、存储时机按契约；工作台表面密度回归 data-dense-dashboard。 |
| 主责角色 | 智能体产品经理（路由/回答/记忆协议）；平台产品经理（技能资产与管理面）；UI/UX 专家（密度、字号用途、三轴）；架构师/前后端专家（注册表、renderer、持久化）；KOL 业务专家（未登记技能口径、alias 业务裁定）。 |
| 宪法条款 | CONST-01、CONST-03、CONST-04、CONST-05、CONST-07、CONST-08、CONST-09、CONST-10。 |
| 基本法条款 | PROD-AGENT-01~09、PROD-PLAT-02/03/04/05；BIZ-07/10/14/16/18 与「快捷查询与思考覆盖表」；TECH-ARCH/FE/BE 相关项；DESIGN.md 密度档与 Home 几何；07-mcp-data-contract 工具风险目录与异步契约。 |
| 结论与证据 | **总体符合**。三层入口即 PROD-AGENT-01 显式登记路由的落地形态；结构化澄清满足「前端不得从自然语言猜字段」（统一规格 §6.2）；记忆规则逐条对应 PROD-AGENT-04~08；密度修复是 DESIGN/ui-ux-rules 实施细则的执法，不是新立法。所有正式副作用继续走既有业务规则、确认、审批、幂等与回执。 |
| 规则空白 | ① BUSINESS.md 覆盖表已登记的 8 个未登记技能（discovery_plan、discovery_brief、kol_analyze、today_plan、today_analyze、todo_plan、mail_summary、mail_translate）的快捷面/Agent 面口径；②「AI发现」这一模式名是否同时登记为发现技能 alias（模式切换是页面导航，词语唤起是技能路由，二者关系需业务专家裁定）；③ BIZ-07 公海字段。空白只暂停依赖这些决定的动作，不暂停通用机制、只读呈现与既有已登记动作。 |
| 下一步 | 按 §12 分阶段实施；阶段 0 规范同步先行。 |

## 3. 目标与非目标

### 3.1 目标

- 一条技能唤起链路对全部模式通用：显式指定 → Host 锁定；未指定 → 判别器路由 + 结构化参数澄清；记忆快捷 → 零模型直读。
- 必要参数、结果类型、建议动作、记忆策略、取消/重试能力成为技能的**声明式契约**，可在技能管理面维护，驱动前端渲染，不散写在各页面。
- 右栏统一为「记忆优先的结果区」：进入即读已授权历史结果，显示来源与新鲜度，版本可回看，空态诚实并给双入口。
- 记忆存储时机成为可审计规则：终态写入、增量去重、失败不覆盖、草稿不进记忆、建议不自动成事实。
- 工作台表面密度执法：消灭 hero 空态、hero 标题、硬编码字号与内容越界。

### 3.2 非目标

- 不建第二套技能注册表（统一规格 §10 的 WorkspaceCapability 并入 SKILL.md manifest 单一事实源）。
- 不允许前端或 Host 生产代码用正则/子串把口令锁成技能（`intent.ts`/`resolver.ts` 既有铁律）。
- 不把模式切换放进 Composer；不让判别器命中另一模式技能时自动切页签。
- 不替业务专家编写未登记技能的口径与 alias 裁定。
- 不改权限、审批、阶段、异步作业与回执契约；不把 MediaCrawler 伪装成同步 Skill。
- 不在判别器不可用时加本地关键词兜底（保持诚实降级）。

## 4. 三层入口与路由链路

对齐 PROD-AGENT-01「入口决定路径」，路由类型全部显式登记：

```text
L0 记忆快捷（kind=memory）
   「已有发现批次」「我跟进的红人」「今日规划产物」等 → 直读已授权索引。
   零 thread / 零 turn / 零 model；不创建虚假 turn。
   未命中、过期或服务失败 → 返回真实状态 + 「交给 Agent」入口，由用户选择，不暗中升级。

L1 Host 锁定（kind=think/command，task_type 已锁）
   触发物：composer 技能 chip / @提及、模式页签内的登记按钮、右栏结果的「重跑」、
   澄清候选（alternatives）的点选、专用锁定端点（today-brief/plan、kol-analyze/enqueue、discovery/run）。
   请求携带 locked task_type + 登记入口 id（HOME_ENTRY_REGISTRY ≅ host/entry-registry.ts）。
   Host 不再推断意图：source="locked"，confidence=1。

L2 路由识别（kind=think，from-text）
   AI 提问框自由文本、无技能锁定 → POST /api/tasks/from-text → 意图判别器。
   判别器输入 = 登记目录行（id / title / employee_summary / aliases / input_schema 摘要）。
   判别器输出 ≤1 个 task_type + entities + missing_fields + alternatives + confidence；
   Host 校验 task_type 必须在 catalog 内，entities 过 sanitize（邮箱只认用户输入或绑定邮箱）。
   三种出口：
   a) 命中且必要参数齐 → ready 摘要（目标/范围/将执行动作/风险档）→ 按 L1/L2/L3 风险档执行；
   b) 命中但缺必要参数 → needs_input：结构化澄清，控件类型由 input_schema 决定；
   c) 低置信或多候选 → direction 澄清：alternatives 渲染为可点选 chip，点选即升级为 L1 锁定。
```

### 4.1 词语唤起的合法实现（「红人线索」「AI发现」）

**Host 分工澄清：**请求显式携带已登记 `task_type` / `entry_id` 时 Host 锁定该路径，不调用意图判别器；自由文本未指定技能时，由判别器提出目录内候选，Host 执行确定性校验和运行前置条件检查。判别候选不等于用户授权，也不等于业务动作许可；低置信/多候选需用户选定，权限、风险、参数和 L3 仍由 Host/Gateway 按现行规则判定。技能 alias 是供判别器识别的目录数据，不是 Host 子串路由表，也不是自动执行命令。

- 业务词语 → 技能的映射住登记数据：SKILL.md 的 `title` 与 `aliases`（技能管理面可维护），随目录行提供给判别器。判别器负责候选识别，Host 负责按登记路由策略校验候选、参数、权限、技能版本与运行入口；Host 不用关键词规则复判，也不把识别结果视为授权。任何一端都不新增关键词硬编码。
- 「红人线索」登记为 `creator_discovery` 的 alias 属于其已登记口径（覆盖表：「新发现分析、异步采集」走 Agent）范围内，可直接实施。
- 「AI发现」是 Home 模式名（IA §5）。模式切换是页面导航；若业务专家裁定同时把「AI发现」登记为发现技能 alias，则提问框命中后**在当前中栏运行发现链路**，并附一个非阻塞导航提示 chip（点击=正常切页签），不自动切换、不在 Composer 内做导航。裁定前保持空白登记。
- 判别器命中「属于另一模式主工作流」的技能时同上：工作台协议是模式无关的，运行在当前中栏进行。

### 4.2 澄清规则（承接统一规格 §6.2）

- 只有影响当前任务的必要信息缺失才进入 needs_input；已在对象、已确认输入、发布规则或授权范围中存在的信息不重复追问（PROD-AGENT-03）。
- 每题携带稳定 `question_id`、`field_path`、`required`、`kind`、`options_source`、`reason`（为什么需要这个信息）。
- 结构化问题优先用已注册控件（单选 chip / 多选 / 数值区间 / 日期 / 对象选择器）；自由文本只是补充。
- 回答后 `inputVersion + 1`；旧 L3 确认快照自动失效。
- 澄清发生在 Host 层，**不建箱、不启动 Codex turn**；参数补齐后才进入执行。

## 5. 技能声明契约（技能管理可定义）

单一事实源 = `backend/skills/<id>/SKILL.md` frontmatter（经 `tasks/registry.ts` 解析校验）。在现有字段（id/title/description/employee_*/category/profile/output/mcp/required_inputs/permissions/actions/aliases/in_market/funnel/side_effects）之上新增：

```yaml
input_schema:                       # 有序参数字段；驱动判别器提示、澄清控件与参数卡
  - key: platforms                  # 稳定码字段名（与 entities/required_inputs 同名）
    label: 平台                     # 员工语言标签（禁引擎词）
    kind: single                    # single | multiple | text | number | date | object
    required: true
    options_source: "dict:discovery_platforms"   # 已登记字典接口或静态枚举；前端不自造选项（BIZ-10）
    reason: "采集服务只支持按平台检索"             # 追问文案：为什么需要
    prefill: from_entities          # 允许判别器 entities 预填
    default: null                   # 可选默认值
    max: null                       # multiple 的上限（如方向 ≤3）
result_type: discovery_candidates   # 决定右栏 ResultRenderer；未注册类型安全降级为文本/表格+来源
next_actions:                       # 完成后的建议；只引用已登记 action id（entry-registry）
  - action_id: discovery-ingest
    when: has_results
    note: "入库公海是独立 L3 动作；不建联、不发信、不领取跟进"
  - action_id: kol-analyze-enqueue
    when: has_results
memory_policy:                      # 结果记忆契约（§9）
  kind: skill_result                # employee_memory_items 的 memory_kind
  scope: owner                      # owner | company | object
  auto_persist: on_complete         # on_complete | on_adopt | never
  stale_refs: [source_batch]        # 哪些源变化触发 stale 标记
supports: { cancel: true, retry: true, resume: false }
required_inputs: ["platforms", "keywords"]   # 保留为校验最小集；契约校验保证 ≡ input_schema 中 required 项
```

约束与校验（进入契约校验与发布门禁）：

1. `required_inputs` 必须等于 `input_schema` 中 `required: true` 的 key 集合；不一致拒绝加载。
2. `kind` 白名单外拒绝；`options_source` 必须指向已登记字典端点或内联静态枚举。
3. `next_actions[].action_id` 必须在入口登记表（entry-registry）中存在；`when` 只允许登记谓词（has_results / has_selection / always）。
4. `mcp` 继续受 `ALLOWED_TASK_MCP` 白名单约束；spec.yaml 的 `forbidden_tools`/`entry`/`from_text` 不变——「必须要的接口」由 mcp + permissions + forbidden_tools 三件共同声明。
5. 员工面文案字段（label/reason/note）过既有员工禁词过滤（引擎词、snake_case id 不出员工面，CONST-10）。
6. 未声明 `input_schema` 的技能保持现状（澄清退化为字段名列表），**不批量伪造支持状态**；试点从 `creator_discovery` 开始逐个迁移。

### 5.1 技能管理面（Admin）

- `skill-publish.ts` 的 Create/UpdateSkillInput 扩展上述字段；发布仍走 `publishSkillVersion`（保存草稿 ≠ 发布生效，PROD-PLAT-05）。
- `SkillLifecycle.tsx` 增加「参数与接口」编辑区：参数字段行（key/label/类型/必填/字典来源/追问文案/默认值）、结果类型、建议动作、记忆策略、取消/重试能力。编辑的是登记数据，不改 SKILL.md 正文的业务 prose。
- 员工面（技能目录/详情）展示已登记口径：参数清单（员工语言）、结果说明、建议动作与风险档；未登记口径的技能继续显示「待业务专家补齐」。

## 6. 端到端链路（示例：「帮我找些户外露营的红人线索」）

```text
① 提问框输入（无技能 chip）→ POST /api/tasks/from-text（L2）
② 判别器：alias+schema 命中 creator_discovery；entities={keywords:[户外,露营]}；
   missing_fields=[platforms, region]；confidence 0.93；Host 校验通过
③ 中栏 needs_input：SkillParamCard 预填已识别参数，缺失必填项高亮 + reason 文案；
   平台/地区选项来自字典端点（GET /api/home/discovery/template），提交稳定码
④ 用户补全提交 → inputVersion+1 → 中栏 ready 摘要：
   「将执行：YouTube · 北美 · 关键词[户外,露营] · 期望 20 人。异步采集；不发信、不改阶段、不建联。」
⑤ 执行：Host 建 box（Profile=lead、SKILL.md=creator_discovery、CONTEXT pack=spec+字典+裁剪记忆）→
   Codex 输出 crawl_plan Item → 内核启动 MediaCrawler 异步作业（同一时间一个任务）→
   中栏过程流：真实 steps（排队/采集/排序）+ 等待原因 + 取消/重试；不显示虚假百分比
⑥ 终态 completed → Host 校验 Item → 按 memory_policy 持久化（§9）→ 右栏 ResultRail：
   版本化结果（候选 n 位 · 来源批次 · 采集时间 · 匹配证据 · 缺失字段）+
   NextActionBar（next_actions 渲染：入库公海 L3 / 分析已选 / 忽略；建议≠执行）
⑦ failed/cancelled → 保留旧结果与已发生动作；中栏给恢复入口（重试失败部分/改条件再跑）
```

显式路径（L1）：用户点技能 chip「达人发现」或在 AI发现模式提交条件卡 → 同 ④ 起，跳过判别器。
记忆路径（L0）：进入 AI发现模式 → 右栏直读 runs/候选历史；「重跑」按 L1 锁定发起新 run。

## 7. 中栏/右栏通用协议（衔接统一规格 §7/§8，不重复立法）

本规格只规定「技能接入面」的三个通用渲染器，组件层次、状态机、折叠与几何照旧：

- **SkillParamCard**（中栏）：由 `input_schema` 驱动的通用参数卡。控件注册表：single→chip 单选、multiple→chip 多选（含 max）、number→数值/区间、date→日期、object→对象选择器、text→输入框。同一组件承担三个场景：模式内条件卡（如 AI发现）、L2 缺参澄清、ready 摘要的只读回显。`DiscoverySearchCard` 迁移为第一个实例，data-* 契约保留（E2E 兼容）。
- **ResultRenderer 注册表**（右栏）：按 `result_type` 注册（discovery_candidates / task_rows / kol_objects / drafts / briefs / …）；未注册类型安全降级为文本/表格 + 来源信息，不执行脚本（统一规格 §10）。`DiscoveryResultPane` 的候选列表迁移为 discovery_candidates renderer。
- **NextActionBar**（右栏）：渲染 `next_actions` + 服务端返回的 RegisteredActionView（enabled/disabledReason/selectionRule/confirmationRequired/approvalState 以服务端为准，前端不推算权限，CONST-04）。区分「建议 / 草稿 / 待确认 / 已执行」；同一视口 0–1 个实底主 CTA；批量选择出现后批量主动作可替换默认主动作。

每模式 `use*Workspace` → `WorkspaceViewModel` 投影（统一规格 §11.3 类型）；技能运行从任一模式发起时投影到同一形状。

## 8. 右栏心智模型：结果与连续上下文区

右栏回答「这项工作留下了什么、现在能做什么」。活动 run 与本次新产物是结果主序；相关记忆提供背景与历史，不覆盖当前结果：

1. **进入读相关上下文**：切到模式/技能上下文，右栏读取该技能登记范围内的授权记忆与历史结果（L0，零 turn）；若已有活动 run 或刚完成的新产物，活动/新产物置顶，记忆收纳为可辨识的背景与历史区：
   discovery→runs+候选（GET /api/home/discovery/runs…）；today→today-brief（task_cover/task_result）；
   公海→pool 索引；跟进→following 列表。每条显示来源 + 更新时间 + 新鲜度（过期标 stale，不伪装最新，PROD-AGENT-06）。
2. **历史结果 = 版本序列**：ResultHeader 提供版本历史（同技能同 scope 的历次 run 结果）；选旧版本 → 只读展示 + 「回到最新 / 按当前条件重跑」入口。折叠不清空选择、不关闭确认、不改结果版本（统一规格 §8.2）。
3. **空态/未命中诚实**：「尚无发现结果」+ 双入口——「填参数跑一次」（中栏打开 SkillParamCard）或「交给 Agent」（think）。不伪造 0、空字符串或静态模板数据。
4. **提示新运行**：idle 时中栏展示本模式能回答的问题与可用起点；结果 stale 时右栏给非阻塞更新标记与重跑入口；新结果到达不强行展开折叠栏。
5. **建议任务的位置**：Agent 的下一阶段建议（含 next_actions 与候选任务）只出现在 NextActionBar/时间线，保持候选状态；采纳是独立 command（adopt-recommendation），采纳后才进入正式待办（PROD-AGENT-08）。

## 9. 记忆存储时机（决策规则）

| # | 规则 | 依据 |
|---|---|---|
| 1 | 只在 run 终态（completed/partial）且 Host 校验 Codex Item 输出通过后写入；运行中不写，模型说了不算 | PROD-AGENT-07；persistTodayDisplayFromBrief 既有模式 |
| 2 | 增量合并 + content_hash 去重 + revision 递增；unchanged 不写；同一来源版本不重复提炼 | memory-increment.ts；PROD-AGENT-07 |
| 3 | failed/cancelled 不覆盖旧记忆：保留上一版，失败记入运行历史；不抹去已发生副作用 | PROD-AGENT-09；统一规格 §6.1 |
| 4 | L2 草稿不进记忆（用户保存/采纳才持久）；L3 写入的是回执（审计记录，不是记忆） | CONST-05；BIZ-14 |
| 5 | 建议/候选永不自动存为事实；采纳 → 写正式对象（work_items）→ 以 task 家族事实回流，与结果展示记忆（task_result/skill_result 家族）分家 | PROD-AGENT-08；memoryKinds 双记忆原则 |
| 6 | 每条记忆满足最小信息：owner/公司/可见范围/对象类型与ID/记忆类型/内容/来源及版本/发生与更新时间/有效状态 | PROD-AGENT-05 |
| 7 | 事件驱动失效：源数据变更（新邮件/归属变更/重跑）→ 按 stale_refs 标 stale 或后台作业刷新；刷新失败保留旧 + 标过期，不伪造新摘要 | PROD-AGENT-07 |
| 8 | 存储时机按技能 memory_policy.auto_persist 声明（on_complete=结果展示类默认；on_adopt=建议类；never=一次性只读）；检索前校验权限，不靠模型忘记 | PROD-AGENT-04/06；本规格新增声明位 |

落地：复用 `employee_memory_items`（owner+kind+item_key 唯一约束），新增 memory_kind（如 `skill_result`）；item_key = skillId+scope（latest 指针）或 runId（历史版本）；历史版本列表即同 kind 下按时间序的 item 集合。已有专用事实表（discovery_memory_facts、kol/memory、mail-memory）不迁移，只在右栏读取协议层统一投影。

## 10. 与企业数字员工 / Codex 运行时的对齐

- **分工**：Host 管路由（选 Profile+Skill）、装配 CONTEXT pack（裁剪过的记忆+字典+对象事实，不让模型自己翻记忆）、闸门（required_inputs 校验、L3 确认、幂等、回执）、持久化（终态写记忆）。Codex 在 box 内只跑一份 SKILL.md，输出 schema 化 Item JSON（task_result/create_draft/propose_stage/…），无凭据、不写正式状态（box AGENTS.md 既有约束）。
- **澄清前置**：必要参数在 Host 层用结构化控件补齐（便宜、可校验），不烧 Codex turn 来回问；建箱时 CONTEXT pack 因此更完整，一次成功率更高。这是 input_schema 住路由层而非 SKILL.md 正文的原因。
- **数字员工 = Profile 身份**（expert:kol / crawler / approver），决定 box 约束与工具面；技能 = 该回合的单任务说明。路由链路不感知员工身份，只消费 Host 注入的 scope（07-mcp-data-contract：MCP/Skill 不得重新解释部门负责人范围）。
- **异步作业不是 Skill**：判别器/锁定只产出计划（crawl_plan），内核启动 MediaCrawler 作业；进度/取消/重试/单任务约束走既有 run 契约。
- **run.think 呈现**：中栏只展示可公开摘要，按既有安全规则过滤，不泄露内部 MCP 名、thread、原始工具名或堆栈（统一规格 §7.1/§14）。

## 11. 密度与溢出修复（DESIGN 执法清单）

字号阶梯用途规则（增补进 DESIGN.md；数值仍只住 styles.css token）：

| 角色 | 用哪一档 | 禁止 |
|---|---|---|
| 页面/上下文标题（中栏 header、object-interaction h1） | `--ds-font-section`（16/600） | `--ds-font-title`(28/700)、`--text-display`(48) 进工作台表面 |
| 块标题（条件卡头、过程流标题、右栏分段头） | `--ds-font-ui` 或 `--ds-font-body`，字重 ≤600 | 20px/600 营销式卡头 + 副标题双行叙事 |
| 内容（列表行、正文、结果字段） | `--ds-font-body` / `--ds-font-sm` | 硬编码 px 字号 |
| 元信息（时间、来源、计数、提示） | `--ds-font-helper` / `--ds-font-tag` | 11px 用于可点标签（ui-ux-rules §7 既有规则） |

具体修复项（证据 → 修法）：

| 现状 | 位置 | 修法 |
|---|---|---|
| `.task-empty` hero 空态：居中、虚线框、padding 32px 20px、`<strong>` 大标题 | styles.css:3755 | 紧凑空态：左对齐、sm/body 字号、`--ds-space-3` 内边距、动作内联；保留 role 与诚实文案 |
| `.object-interaction h1` = 28px/700 hero 标题 | today-plan-board.css:633 | 降为 `--ds-font-section`；行距随 token |
| 发现条件卡头 h2 20px/600 + 营销副标题 | styles.css:1949-1961、DiscoverySearchCard.tsx | 单行标题（ui/600）；副标题降 helper 或与字段 label 重复即删 |
| today-display-row.css 硬编码 15/12.5/11/13px | 该文件 :15/:30/:40/:56/:79 | 全换 ds token（12.5→helper、11→tag、15→ui/body、13→sm） |
| think 推理块：既有设计 = 只展开最新一段、截尾 6 行、「…」与「已折叠 N 段更早的推理」诚实标记（`streamText.ts THINK_TAIL_LINES`） | DiscoveryProcessPanel.tsx、TodayPlanProgress.tsx、streamText.ts | **核查后保留**该安全呈现规则（pre-wrap + overflow-wrap:anywhere 已防横向越界）；执法点 = 发现/今日两套过程流形态保持一致；需要全文阅读时走管理员 Trace 或增加内部滚动，不移除截尾、不静默裁切 |
| 右栏 `overflow-x: hidden` 创可贴 | discovery-workspace.css:153-156 | 行 grid `min-width:0` + 工具栏 wrap + 次要字段进展开层；移除 hidden 兜底（统一规格阶段 3.3 验收项） |

## 12. 实施分期与文件级变更

### 阶段 0：规范同步（本文件即产物之一）
1. 本 spec + `docs/DESIGN.md` 增补「字号阶梯用途与内容密度」节 + `docs/DECISIONS.md` ADR + `docs/BUSINESS.md` 覆盖表空白备注。
2. `docs/ia-information-architecture.md` 不需改动（模式导航与词语唤起的关系已在本文件 §4.1 登记为业务裁定项）。

### 阶段 1：技能声明升级（后端契约 + 管理面）
| 文件 | 变更 |
|---|---|
| `backend/src/tasks/registry.ts` | 解析/校验 input_schema、result_type、next_actions、memory_policy、supports；§5 的 6 条契约校验 |
| `backend/skills/creator_discovery/SKILL.md` | 试点：aliases 增「红人线索」；补 input_schema（字段=现有 brief 表单）/result_type/next_actions/memory_policy/supports |
| `backend/src/host/skill-publish.ts`、`skill-lifecycle.ts`、`routers/misc.ts` | Create/UpdateSkillInput 扩展 + 发布校验 |
| `frontend/src/pages/SkillLifecycle.tsx` | 「参数与接口」编辑区；员工面展示已登记口径 |
| `backend/tests` | registry 契约单测、publish round-trip、非法 schema 拒绝 |

### 阶段 2：路由与澄清链路
| 文件 | 变更 |
|---|---|
| `backend/src/tasks/openai-intent.ts` | catalogLines 携带 aliases + input_schema 摘要；verdict 按 schema 输出 entities/missing_fields |
| `backend/src/tasks/resolver.ts`、`routers/tasks.ts` | missing() 读 schema；from-text 响应携带结构化澄清（question_id/field_path/kind/options_source/reason/required/inputVersion） |
| `frontend/src/home/workspace/SkillParamCard.tsx` 等 | schema 驱动参数卡 + ClarificationBlock + ReadySummaryBlock；DiscoverySearchCard 迁移为首个实例 |
| `frontend/src/pages/Home.tsx` | 「还缺X、Y」文字卡 → ClarificationBlock；alternatives → 可点选 chip（升级锁定）；inputVersion 语义 |
| `frontend/src/components/ComposerDock.tsx` | 技能 chip 附「已锁定」标识与参数完成度提示（不改 Composer 契约） |

### 阶段 3：ResultRail + 记忆优先右栏
| 文件 | 变更 |
|---|---|
| `frontend/src/home/workspace/ResultRail.tsx` 等 | ResultHeader（版本历史/新鲜度）、ResultToolbar、result-renderers 注册表、NextActionBar、ConfirmationReceiptRegion（组合既有 Confirm 组件） |
| 各 `use*Workspace` | → WorkspaceViewModel 投影；WorkspaceShell 插槽装配（Shell 职责不变） |
| `backend/src/host/`（新 result-memory 模块） | 通用终态持久化（employee_memory_items，memory_kind 按 memory_policy）；stale 标记与 source refs；缺失的结果历史端点按需补 |

### 阶段 4：密度修复（§11 清单落地）
styles.css / today-plan-board.css / today-display-row.css / DiscoveryProcessPanel.tsx / discovery-workspace.css / TodayPlanProgress（两套过程流形态保持一致的既有约定）。

### 阶段 5：验证与门禁
- 单元：registry schema 校验、resolver missing（schema 驱动）、澄清版本、memory merge/终态持久化、SkillParamCard 状态。
- 契约：clarification / result / action / receipt schema（统一规格 §17.5 同源）。
- E2E：三层入口链路（L0 零 turn / L1 锁定 / L2 判别+澄清+升级）、五模式 shell parity 不回归、右栏记忆优先+版本+无横向溢出、密度截图（DESIGN 验收矩阵宽度×高度组合）。
- 既有红清单（统一规格登记的 home-pool-follow:230、home-chat-send-ne-stage:69/113 等）逐条保持登记，不与本轮失败混淆。
- 发布门禁 `.github/workflows/release-gate.yml` 全量过。

## 13. 验收矩阵（关键项）

- 「红人线索」等已登记 alias 在提问框能唤起发现技能并预填已识别参数；未登记词语走 direction 澄清而非猜测执行。
- 显式技能 chip/按钮入口零意图推断（source=locked）；切页签/读记忆零 session/turn/model。
- 必要参数缺失时出结构化澄清（控件类型来自 schema，选项来自字典端点，提交稳定码）；补齐前不建箱、不启动 Codex turn。
- 运行前 ready 摘要写明目标/范围/将执行动作与风险档；L3 独立确认+回执；L2 标草稿。
- 修改已提交参数 → inputVersion+1 → 旧 L3 确认快照失效。
- 右栏进入即显示该技能记忆（来源+更新时间+新鲜度）；历史版本可只读回看；空态诚实且给双入口。
- 记忆只在终态写入；failed/cancelled 不覆盖；建议未采纳不进正式待办；草稿不进记忆。
- 工作台表面无 28px+/700 标题、无 hero 空态、无硬编码字号、无整栏横向滚动；think 块不越界、可展开不丢内容。
- 同一视口 0–1 实底主 CTA；状态不只靠颜色；键盘/触摸可达（三轴矩阵照 DESIGN 验收）。

## 14. 完成定义

1. 三层入口链路在至少一条技能链（creator_discovery 试点）端到端可用，且五模式既有行为零回归。
2. input_schema/result_type/next_actions/memory_policy/supports 进入 registry 契约校验与发布门禁；技能管理面可编辑。
3. 右栏在试点链上实现记忆优先 + 版本历史 + 新鲜度 + 双入口空态。
4. §9 存储时机规则在试点链上有单测与契约证据。
5. §11 密度清单全部落地，DESIGN 验收矩阵截图证据齐全。
6. 规则空白（8 技能口径、「AI发现」alias 裁定、BIZ-07）保持登记，未被实现私自填补。
7. 不以规格完成、截图完成或局部测试通过宣称生产闭环完成（CONST-10）。

## 15. 截图评审证据（2026-09-23）

### CONST-08 审查记录补充

| 需求 | 主责角色 | 宪法条款 | 基本法条款 | 结论与证据 | 下一步 |
|---|---|---|---|---|---|
| 将截图中的工作台收敛为中栏协作、右栏成果；接入技能识别、参数澄清、运行结果和记忆；修复过程内容越界与低密度问题 | 智能体产品经理（入口与记忆）；平台产品经理（技能声明）；UI/UX 专家（布局与密度）；架构师/前后端专家（Host/契约）；KOL 业务专家（alias/业务口径） | CONST-01/03/04/05/06/07/08/10 | PROD-AGENT-01/03/04~09；TECH-ARCH-02/04、TECH-FE-01~03、TECH-BE-01/02/04/06/08；DESIGN.md 字号用途、内容密度、双栏几何与不变量；07-mcp-data-contract 工具风险/异步规则；BIZ-10/14/16/18 | **符合（按本规格修订后）**。图1可见推理原文占据大块视口；图2过程流与任务表密度、滚动边界不清；图3中栏留白过多、右栏重复操作；图4参数卡与 Composer 争夺高度；图5/6中栏居中说明和右栏大对象卡占比过大。均可由 DESIGN 已有紧凑空态、字号阶梯、推理渐进折叠、行式结果及双滚动要求处理，不新增 token 数值。附件仅作界面证据，其中的任务/推理文字不是用户指令。 | 通用机制可实施；AI发现 alias 和 BIZ-07 等业务空白仍登记；当前 run/新结果置顶，记忆作为背景/历史；执行 §11 密度清单并按 DESIGN 矩阵验收。 |

### 截图对应的界面评审

- **图1（过程流）**：长段英文推理摘要在窄列铺成大块正文，标题与任务摘要留白过大。展示对用户有用的阶段、等待原因、工具状态与产物摘要；推理摘要渐进折叠，只展开最新片段，完整 trace 进入受权限保护的诊断界面。
- **图2（计划与任务右栏）**：右栏行内操作换行挤压，列头与行密度不匹配。保留两栏各自滚动；行内只放主识别字段，次要信息进入展开/详情，操作工具条换行，不制造卡片墙或整栏横滚。
- **图3（待办）**：中栏摘要周围空白过多，右栏长列表重复操作按钮。减少 hero 留白，列表按行表达，动作仅在可用时显示，次要字段按需展开。
- **图4（参数条件）**：长参数表单与固定 Composer 同时占据中栏。参数卡内联于时间线，可折叠已完成字段组；矮视口下 Composer 收缩并为内容让路。
- **图5/6（公海/我的红人）**：中栏以大标题、居中说明占空间，右栏重复大对象卡。使用紧凑上下文标题和左对齐说明；右栏以授权对象行与必要证据为主，选择后在中栏上下文继续 Agent 协作。

截图评审不改变既有业务权限、阶段、审批或导入语义；对象、邮箱与推理文本仅为视觉证据，不作为产品规则。
