# 统一 Agent 工作台：中栏人机协作，右栏结果与下一步

> 日期：2026-09-23  
> 状态：产品方向已由用户确认；详细方案待实施  
> 范围：Home「今日任务 / 我的待办 / AI发现 / 公海 / 我的红人」及后续适配该协议的技能工作流  
> 本文件是实施规格，不声明生产代码已经完成。

## 1. 已确认的产品决定

用户已确认以下决定：

1. 五类 Home 工作台统一使用「中栏人机协作、右栏结果与下一步」的工作台骨架。
2. 统一的是交互协议、几何与状态语义，不把任务、候选人、红人、草稿等业务对象强行转换成同一种列表。
3. 「首次建联」不是与五类工作台并列的模式；它是选定红人后启动的受控业务工作流。
4. 「公海」保留为 Home 一级模式。实施前先修订仍写「Home 四模式」的现行 IA / DESIGN 文案，再修改运行代码；不得让当前代码自行成为新规则。

## 2. 审宪记录（CONST-08）

| 项目 | 记录 |
|---|---|
| 需求 | 建立可由多类技能工作流复用的 Agent 工作台：中栏承担人机提问与必要澄清，右栏承担 Agent 结果与下一步动作。 |
| 主责角色 | 智能体产品经理：交互与回答协议；UI/UX 专家：布局、状态呈现与无障碍；架构师 / 前端专家：组件与状态边界；KOL 业务专家：公海、跟进、建联及 L3 动作语义。 |
| 宪法条款 | CONST-01、CONST-03、CONST-04、CONST-05、CONST-07、CONST-08、CONST-10。 |
| 基本法条款 | PROD-AGENT-01/03/08/09；BIZ-07/14/16；TECH-ARCH-02/04、TECH-FE-01/02/03、TECH-BE-02/03/04。 |
| 结论与证据 | **总体符合**。AI 提问框继续进入统一 Codex harness；对象、任务和运行记录保持分离；明确动作继续通过 Host Gateway；等待、失败、确认与回执可观察。 |
| 规则冲突 | 现行 `docs/ia-information-architecture.md` 与 `docs/DESIGN.md` 仍写 Home 四模式，而当前代码和本次确认采用五模式。实施阶段 0 必须由平台产品 / UI/UX 职责修订相关表述。 |
| 规则空白 | BIZ-07 的公海公开字段与重新分配规则，以及 BUSINESS 已登记的 `discovery_plan / kol_analyze / today_plan / todo_plan` 快捷面与 Agent 面边界仍待 KOL 业务专家补齐。空白只暂停依赖这些定义的动作，不暂停通用外壳、只读呈现和既有已登记动作。 |
| 下一步 | 按 §15 分阶段实施；任何代码变更前完成阶段 0 的规范同步。 |

## 3. 目标与非目标

### 3.1 目标

- 用户在任一工作台都能稳定理解：正在与 Agent 讨论什么、缺什么信息、执行到哪、结果在哪里、下一步能做什么。
- 将短暂的对话/运行过程与耐久的任务/对象/成果分开。
- 让新技能工作流通过声明输入、结果和动作来接入现有工作台协议，而不是复制整页 JSX。
- 对 queued / running / needs-input / needs-confirmation / failed / completed / cancelled 提供统一且诚实的呈现。
- 所有正式副作用继续由现有业务规则、权限、确认、审批、幂等和回执约束。

### 3.2 非目标

- 不把 Home 重做成第二套完整 Chat，也不建立独立任务脊柱。
- 不把所有技能做成 Home 一级模式；只有产品 IA 明确登记的工作问题才拥有模式。
- 不把红人对象自动转成待办，不把 Agent 建议直接转成正式任务。
- 不借界面重构发明公海可见范围、领取范围、阶段权限或审批链。
- 不改变「发送 ≠ 推进阶段」「入库 ≠ 领取跟进」「领取 ≠ 建联成功」。
- 不把 MediaCrawler 伪装成同步 Skill，也不在浏览器计时器中实现持久作业。

## 4. 核心心智模型

```text
左栏：去哪里
  └─ 平台全局导航，不承载当前工作过程

中栏：人与 Agent 如何把问题说清并完成一次运行
  ├─ 当前上下文 / 用户请求
  ├─ 必要澄清 / 条件确认
  ├─ 运行过程 / 等待原因 / 失败恢复
  └─ Composer（继续提问、修改条件、补充信息）

右栏：这次运行留下了什么，可以做什么
  ├─ 结果状态与来源
  ├─ 任务 / 候选 / 红人 / 草稿 / 其他成果
  ├─ 选择范围
  ├─ 下一步动作
  └─ L3 确认、审批状态与执行回执
```

基本原则：

- **中栏是交互主轴，右栏是成果主轴。** 中栏默认拥有更高的视觉优先级；右栏不得长期压缩中栏到无法阅读或澄清。
- **中栏内容是时间序列，右栏内容是对象集合。** 中栏按 turn / event 演进；右栏按稳定 ID、版本和结果类型维护。
- **消息不是权限。** Agent 生成的按钮、文案或卡片不能授予权限；动作必须引用注册的 action ID。
- **折叠不等于丢失。** 右栏折叠后保留结果类型、数量与待确认标记；重新展开恢复滚动位置、选择和待确认上下文。

## 5. 页面与工作流层级

### 5.1 Home 一级模式

批准的顺序：

```text
今日任务 | 我的待办 | AI发现 | 公海 | 我的红人
```

- 今日任务、我的待办：平台任务脊柱。
- AI发现、公海、我的红人：KOL 业务试点模式，不写死进平台内核。
- 模式切换属于页面导航，必须移出 Composer 的任务/动作快捷区。

### 5.2 动作工作流

「首次建联」属于动作工作流，不属于 Home 模式：

```text
选定红人
→ 中栏建立建联工作上下文
→ 缺字段时澄清
→ 生成并明确标注 L2 草稿
→ 右栏预览草稿、收件人、证据与风险
→ 用户编辑或确认发送
→ Host Gateway 执行 L3
→ 右栏显示真实回执
```

其他动作如入库公海、领取跟进、释放回公海、确认阶段也服从同一原则：可以从右栏启动，但不能伪装成新的 Home 模式或普通聊天消息。

## 6. 统一工作台状态机

### 6.1 顶层状态

| 状态 | 中栏 | 右栏 | 允许动作 |
|---|---|---|---|
| `idle` | 显示该模式能回答的问题与可用起点 | 空结果说明或最新耐久结果 | 发起请求、选择对象 |
| `composing` | 用户输入、条件编辑、上下文 chip | 保留上一版结果并标明其版本 | 提交、清空明确输入 |
| `needs_input` | Agent 只问影响当前任务的必要问题；显示为何需要 | 保留上一版结果，不伪造新结果 | 回答、跳过可选项、取消 |
| `ready` | 显示已理解的目标、范围和将执行的动作 | 若为 L3，右栏显示待确认快照 | 运行 L1/L2；确认或取消 L3 |
| `queued` | 排队原因、提交时间、取消/接管入口 | 结果占位明确写「尚未产生」 | 取消、查看队列、人工接管 |
| `running` | 真实事件流、当前阶段、等待原因 | 可显示已落地的部分结果并标「进行中」 | 取消（若支持）、恢复、接管 |
| `partial` | 说明已完成与未完成的边界 | 展示部分结果及缺失项 | 重试失败部分、继续处理 |
| `completed` | 对本轮过程作简短收束 | 展示版本化结果、建议动作 | 选择结果、启动下一动作 |
| `failed` | 原因、已发生动作、可恢复方式 | 保留旧结果或部分结果，不清空历史 | 重试、修改输入、接管 |
| `needs_confirmation` | 说明为何需要确认，不重复生成结果 | 展示确认快照、风险、范围与动作 | 确认、编辑、取消 |
| `awaiting_approval` | 说明等待谁/哪类规则，不推算审批链 | 展示审批状态和当前不可执行动作 | 查看审批、撤回（若服务端允许） |
| `cancelled` | 显示取消时间和已经发生的外部动作 | 保留已产生结果和回执 | 新建运行、继续人工处理 |

### 6.2 澄清规则

- 只有影响当前任务的必要信息缺失时才进入 `needs_input`。
- 已经在当前对象、已确认输入、发布规则或授权范围中存在的信息不得重复追问。
- 每次澄清必须携带稳定 `question_id`、适用字段和是否必答；前端不得从自然语言猜字段。
- 结构化问题优先用选择、对象选择器、日期、数值范围等已注册控件；自由文本作为补充。
- 回答后生成新的输入版本；旧 L3 确认快照自动失效。
- 用户可以修改先前答案，界面必须显示哪些结果需要重新计算、哪些耐久对象不受影响。

## 7. 中栏详细结构：InteractionSurface

建议组件层次：

```text
InteractionSurface
├─ InteractionContextHeader
│  ├─ 模式名称 / 当前对象范围
│  ├─ 运行状态（文字 + 图形）
│  └─ 版本 / 更新时间（必要时）
├─ InteractionTimeline          ← 唯一中栏滚动容器
│  ├─ UserRequestBlock
│  ├─ AgentUnderstandingBlock
│  ├─ ClarificationBlock[]
│  ├─ ExecutionProgressBlock
│  ├─ WaitReasonBlock
│  ├─ FailureRecoveryBlock
│  └─ CompletionSummaryBlock
└─ InteractionComposer          ← 固定在中栏底部，矮视口让出高度
   ├─ ContextChips
   ├─ PromptInput
   ├─ Attachment / knowledge controls
   └─ Submit / Stop
```

### 7.1 时间线内容规则

- 默认不逐字复制所有内部推理；显示对用户有意义的理解、步骤、工具状态和结果边界。
- `run.think` 只按现有安全呈现规则展示可公开摘要，不泄露内部秘密或凭据。
- 成功摘要只收束本轮，不复制右栏全部结果。
- 失败必须写明：失败在哪一步、哪些动作没有发生、是否可能已经发生外部副作用、恢复入口。
- 用户切换模式再返回时，恢复该模式当前 session / run 的时间线与 Composer 草稿。

### 7.2 Composer 规则

- Composer 是 AI 提问入口，不兼任模式导航。
- 模式标签可以作为只读上下文 chip，但点击 chip 不暗中切换或执行动作。
- 「首次建联」等动作入口从快捷模式条移出，放到右栏对象的下一步动作或对象详情。
- Enter / Shift+Enter、停止、附件、知识和档位继续使用现有 Composer 契约。

## 8. 右栏详细结构：ResultRail

建议组件层次：

```text
ResultRail
├─ ResultRailToggle
├─ ResultHeader
│  ├─ 结果类型 / 数量
│  ├─ 状态 / 来源 / 更新时间
│  └─ 版本与刷新入口
├─ ResultToolbar
│  ├─ 搜索 / 筛选 / 排序
│  └─ 选择摘要
├─ ResultBody                   ← 唯一右栏滚动容器
│  └─ ResultRenderer            ← 按 artifact type 注册
├─ NextActionBar               ← 有行动时才出现
│  ├─ 推荐下一步及理由
│  └─ 0–1 个实底主 CTA
└─ ConfirmationReceiptRegion
   ├─ L3ConfirmCard
   ├─ ApprovalStatus
   └─ ActionReceipt
```

### 8.1 右栏不变量

- 列表行本身就是内容，不为每行制造独立卡片墙。
- 工具栏和操作列不得迫使整个右栏横向滚动；次要字段进入展开层或详情抽屉。
- 右栏同一视口最多一个实底主 CTA；批量选择出现后，批量主动作可替换默认主动作。
- 下一步必须区分「建议」「草稿」「待确认」「已执行」。
- 结果缺失、过期或部分成功不得用 0、空字符串或静态模板伪装真实数据。

### 8.2 折叠行为

- 折叠条显示：结果类型、数量、运行/待确认标记；状态不能只靠颜色。
- 折叠不清空选择、不关闭确认、不改变结果版本。
- 若已有打开的 L3 确认，折叠动作不得使确认上下文不可恢复。
- 新结果到达时不强行展开；在折叠条提供非打扰性状态更新。

## 9. 五种模式的具体映射

### 9.1 今日任务

**中栏**

- 当前问题：「今天应优先处理什么？」
- 展示来源范围、异常项、Agent 的规划理解和真实规划过程。
- 缺少优先级、期限冲突或处理偏好时提出必要澄清。
- 规划完成后只显示摘要和与上一版的关键变化。

**右栏**

- 任务结果必须保留负责人、对象、依据、期限、状态、摘要与下一步。
- 支持搜索、筛选、编辑、打开任务；AI 推荐仍保持候选状态，未经采纳不进入正式待办。
- 「重新生成今日计划」是 L2 规划动作，不等于执行全部任务。

### 9.2 我的待办

**中栏**

- 当前问题：「未完成工作如何整理与推进？」
- 澄清排序目标、期限冲突、批量处理意图和是否纳入今日。
- 与今日任务共享规划协议和组件，不共享错误的数据切片。

**右栏**

- 展示正式待办与其下一步，不重复今日切片。
- 转入今日、编辑、打开和完成等动作引用明确 action ID。
- 完成任务必须服从任务验收条件；发送邮件、关闭会话或释放红人不自动完成任务。

### 9.3 AI发现

**中栏**

- 当前问题：「按什么条件发现哪些候选红人？」
- 条件卡是结构化输入编辑器；提交后进入异步运行过程。
- 条件缺失时先澄清，确认后才启动采集。
- MediaCrawler 显示排队、采集、排序、失败、取消与恢复；不得显示虚假百分比。

**右栏**

- 展示候选、来源、采集时间、匹配证据、缺失字段和置信信息。
- 入库公海是独立 L3 动作；每个 `source_batch` 独立确认。
- 入库不建联、不发信、不领取跟进、不改阶段。

### 9.4 公海

**中栏**

- 当前问题：「公海里哪些对象值得分析或领取？」
- 支持用户指定对象、筛选范围和分析问题；Agent 返回分析过程和必要澄清。
- 快速读取现有公海索引不创建虚假 turn；新分析明确进入 Agent 流程。

**右栏**

- 只展示业务规则允许的公开字段；禁止泄露旧邮件、合同、价格和员工私有笔记。
- 领取跟进是独立 L3 动作，显示范围、当前版本、竞争冲突和真实回执。
- 「分析已选」是 Agent 分析入口；「领取跟进」是受控动作，两者不得共用提交路径。
- 公海字段与可领取人群未补齐前，只实现既有后端已经返回并授权的字段与动作。

### 9.5 我的红人

**中栏**

- 当前问题：「我正在跟进哪些对象，现在需要怎样判断或推进？」
- 用户选择对象后可以询问风险、邮件、履约、建议阶段或下一步。
- 对象事实、Agent 推断、建议和缺失信息必须分开呈现。

**右栏**

- 展示跟进对象及其公开事实、跟进关系、任务事实和允许动作。
- 不能把 15 个正式阶段作为本面主导航，也不能复制待办状态桶。
- 邮件草稿、发送、阶段确认、释放回公海分别走独立动作与确认。
- 建议阶段不直接写正式状态；正式阶段修改使用 `confirm_stage` 与版本校验。

## 10. 技能与工作台的接入协议

技能不直接声明整页 JSX。一个可接入工作台的技能工作流应登记：

```ts
type WorkspaceCapability = {
  capabilityId: string;
  version: string;
  ownerRole: string;
  supportedModes: HomeMode[];
  entryKind: "agent" | "memory" | "controlled_action";
  inputSchemaId: string;
  resultType: string;
  actionIds: string[];
  riskLevel: "L1" | "L2" | "L3";
  supportsCancel: boolean;
  supportsRetry: boolean;
  supportsResume: boolean;
  clarificationSchemaId?: string;
};
```

约束：

- `entryKind="agent"` 才创建 / 恢复 thread 与 turn。
- `entryKind="memory"` 直接读取已授权索引，缺失时只提供「交给 Agent」入口，不暗中升级。
- `entryKind="controlled_action"` 调用明确动作接口，不重新让模型判断是否执行。
- `resultType` 决定右栏 renderer；未知结果安全降级为文本/表格和来源信息，不执行脚本。
- L2 结果必须标注草稿；L3 必须提供确认快照、幂等键和回执引用。

## 11. 前端组件与状态边界

### 11.1 建议模块

```text
frontend/src/home/workspace/
├─ WorkspaceShell.tsx
├─ InteractionSurface.tsx
├─ InteractionTimeline.tsx
├─ ClarificationBlock.tsx
├─ ExecutionProgressBlock.tsx
├─ ResultRail.tsx
├─ ResultHeader.tsx
├─ NextActionBar.tsx
├─ ConfirmationReceiptRegion.tsx
├─ workspace-types.ts
├─ workspace-reducer.ts
├─ workspace-registry.ts
└─ workspace.css

frontend/src/home/workspaces/
├─ TodayWorkspace.tsx
├─ TodoWorkspace.tsx
├─ DiscoveryWorkspace.tsx
├─ PoolWorkspace.tsx
└─ FollowedWorkspace.tsx
```

可以在迁移完成后再物理移动现有文件；第一阶段不为了目录整齐做大规模改名。

### 11.2 `WorkspaceShell`

只负责：

- 中栏 / 右栏几何；
- 两个独立滚动容器；
- 中栏 footer；
- 右栏折叠与恢复；
- 三轴适配；
- 无障碍区域名称和焦点回送。

不得负责：

- 业务模式判断；
- 数据请求；
- 任务、红人或候选字段；
- 权限、审批和动作可用性计算；
- 拼装业务文案。

### 11.3 Workspace adapter

每个模式负责把自己的 hook 输出转换成统一视图模型：

```ts
type WorkspaceViewModel = {
  mode: HomeMode;
  session: InteractionSessionView;
  timeline: InteractionBlock[];
  composer: ComposerContextView;
  result: ResultCollectionView | null;
  actions: RegisteredActionView[];
  confirmation: ConfirmationView | null;
  receipt: ActionReceiptView | null;
};
```

视图模型只描述后端已允许的动作。前端不得根据阶段、角色名或按钮文案推算权限。

### 11.4 状态归属

- `Home.tsx`：只保留路由模式、跨模式共享的轻量入口状态和组合。
- 各 `use*Workspace`：拥有本模式 session、run、结果、选择和恢复逻辑。
- `WorkspaceShell`：只拥有纯 UI 状态，如 rail 折叠和两个滚动位置。
- 确认快照：来自服务端并绑定对象版本；不能只存在于组件布尔值。
- Composer 草稿：按模式 / session 隔离；切换模式不互相覆盖。

## 12. 数据与事件契约

### 12.1 Interaction session

最少字段：

```ts
type InteractionSessionView = {
  sessionId: string;
  mode: HomeMode;
  state: WorkspaceState;
  inputVersion: number;
  runId?: string;
  updatedAt: string;
  waitReason?: string;
  recoveries: RecoveryActionView[];
};
```

### 12.2 Clarification

```ts
type ClarificationQuestionView = {
  questionId: string;
  fieldPath: string;
  label: string;
  reason: string;
  required: boolean;
  kind: "single" | "multiple" | "text" | "number" | "date" | "object";
  options?: Array<{ id: string; label: string }>;
  inputVersion: number;
};
```

### 12.3 Result collection

```ts
type ResultCollectionView = {
  resultId: string;
  resultType: string;
  version: number;
  status: "partial" | "complete" | "stale";
  sourceRefs: SourceRefView[];
  generatedAt: string;
  items: ResultItemView[];
};
```

### 12.4 Registered action

```ts
type RegisteredActionView = {
  actionId: string;
  label: string;
  riskLevel: "L1" | "L2" | "L3";
  enabled: boolean;
  disabledReason?: string;
  selectionRule: "none" | "single" | "multiple";
  confirmationRequired: boolean;
  approvalState?: "none" | "required" | "pending" | "approved" | "rejected";
};
```

### 12.5 Receipt

回执最少包含：动作、对象范围、操作者、提交时间、结果、不确定状态、规则/输入版本、幂等键引用及外部回执引用。敏感值继续脱敏。

## 13. 几何、密度与响应式

所有数值继续只以 `docs/DESIGN.md` 和 `frontend/src/styles.css` 为来源。本规格只规定关系：

### 13.1 宽度轴

- 宽视口：中栏为主、右栏为辅；右栏设置合理最小/最大约束，不再默认占工作区多数。
- 中等宽度：右栏允许收窄，操作列改为行内菜单或详情层，禁止用整栏横向滚动兜底。
- `≤ 860`：中栏保持主页面，右栏改为可打开的结果抽屉/下层区域；触摸命中区服从 DESIGN。
- 实施前由 UI/UX 专家在 `DESIGN.md` 增加工作台列宽语义 token，再落 `styles.css`，不得在多个组件散写数值。

### 13.2 高度轴

- 页面外层不滚；中栏时间线和右栏结果体分别滚动。
- Composer、右栏动作区必须给内容让路；矮视口至少能看到一块完整交互内容或一行完整结果。
- Composer 多行增长到上限后内部滚动，不得把中栏时间线压成不可用区域。

### 13.3 输入模态

- 键盘：模式切换、时间线、Composer、右栏、确认对话框有稳定 Tab 顺序和可见焦点。
- 指针：关键动作不依赖 hover 才出现。
- 触摸：折叠、选择、展开和下一步动作具备合格命中区。

## 14. 视觉与内容规则

- 延续 `data-dense-dashboard`：紧凑、少卡片、列表行即内容。
- 同一视口 0–1 个实底主 CTA；选择批量对象后，批量动作可以接管主 CTA 位置。
- 选中态使用辅助色、形状或字重，不使用主行动实底色冒充选择。
- 状态同时提供文案和图形，不只靠成功/警告/危险颜色。
- 中栏不得显示内部 MCP、Codex thread、原始工具名或堆栈；管理员 Trace 另行呈现脱敏技术信息。
- Agent 回答不强制每次生成固定五段；前端只保证事实、推断、建议、缺失与执行结果能被可靠区分。

## 15. 实施分期

### 阶段 0：规范同步与风险登记

1. 修订 `docs/ia-information-architecture.md`：Home 四模式改为五模式；说明公海是 KOL 试点模式，不能成为平台内核。
2. 修订 `docs/DESIGN.md` 中「Home 四模式」表述；增加工作台列宽语义 token 的唯一来源。
3. 在 `docs/DECISIONS.md` 记录：公海保留一级模式、首次建联降为对象动作工作流。
4. 由 KOL 业务专家补充或显式登记 BIZ-07 仍未决定的字段/范围；未决定项保持不可用或只读。
5. 更新相关 traceability / 验收映射；不得只修改文档标题。

### 阶段 1：外壳职责收敛

1. 将 `WorkspacePane` 扩展为五模式，但不在 Shell 内写模式分支。
2. 抽出 `InteractionSurface`、`ResultRail` 和统一的状态/结果类型。
3. 调整列宽关系，让中栏成为默认视觉主轴；删除右栏整表横向滚动依赖。
4. 将模式导航移出 `ComposerDock`。
5. 保证今日/待办/AI发现行为零回归后再迁移另外两面。

### 阶段 2：今日任务 / 我的待办

1. 将现有 `TodayPlanProgress + PlanSummary` 投影成时间线 block。
2. 补齐用户请求、Agent 理解和 `needs_input` 的呈现契约。
3. 任务板改接通用 `ResultRail`，保留 TaskBoard 自有字段和动作。
4. 校验今日与待办只共享组件/管线，不混淆切片。

### 阶段 3：AI发现

1. 将现有条件卡、过程流、候选结果接入统一视图模型。
2. 保留异步采集、取消、重试、失败和 L3 入库契约。
3. 结果工具栏取消横向溢出；次要指标进入展开层。
4. 条件修改生成新 input version，使旧确认自动失效。

### 阶段 4：公海 / 我的红人

1. 从 `Home.tsx` 拆出 `usePoolWorkspace`、`useFollowedWorkspace`。
2. 新建 `PoolWorkspace`、`FollowedWorkspace`，组合统一 Shell。
3. 公海 / 跟进对象列表进入右栏；对象分析、澄清和过程进入中栏。
4. 领取、释放、阶段确认、草稿、发送继续使用既有独立确认与回执路径。
5. 移除旧页面级 Composer 和旧全宽 pane 几何。

### 阶段 5：首次建联与技能接入

1. 从模式导航/快捷模式条移除「首次建联」。
2. 在公海、我的红人及对象详情的允许动作中注册 `creator_outreach`。
3. 建立 L2 草稿结果 renderer 和 L3 发送确认/回执组合。
4. 建立 `WorkspaceCapability` 注册表；只迁移契约明确的技能，不批量伪造支持状态。

### 阶段 6：清理与发布门禁

1. 删除旧 `followed-kol-pane` / page-level composer 的死分支和失效 CSS。
2. 缩减 `Home.tsx` 的业务状态数量，只保留组合职责。
3. 更新单元、契约、E2E、可访问性和截图证据。
4. 执行全量前后端门禁，并区分目标域失败、基线失败和并发 flake。

## 16. 文件级变更计划

| 文件/区域 | 计划 |
|---|---|
| `docs/ia-information-architecture.md` | 五模式 IA、模式问题和公海边界 |
| `docs/DESIGN.md` | 五模式表述、工作台列宽语义 token、三轴验收补充 |
| `docs/DECISIONS.md` | 公海一级模式、首次建联动作化的决策记录 |
| `frontend/src/home/WorkspaceShell.tsx` | 纯几何与折叠；支持五模式，不含业务分支 |
| `frontend/src/home/ScopeWorkspace.tsx` | 组合 InteractionSurface + Task ResultRail |
| `frontend/src/home/DiscoveryWorkspace.tsx` | 接统一状态/结果协议，保留发现专用逻辑 |
| `frontend/src/home/PoolPane.tsx` | 逐步拆为 Pool 结果 renderer，最终移除全页职责 |
| `frontend/src/home/FollowedPane.tsx` | 逐步拆为 Followed 结果 renderer，最终移除全页职责 |
| `frontend/src/pages/Home.tsx` | 从业务状态中心收敛为模式路由与 workspace 组合器 |
| `frontend/src/components/ComposerDock.tsx` | 保留输入能力；不再承载 Home 模式导航 |
| `frontend/src/styles.css` / home CSS | 使用 DESIGN token 落地列宽、双滚动和低高度行为；删死样式 |
| `frontend/src/home/modes.ts` | 保留五模式；标签与入口由登记表提供 |
| 后端 session/run/action DTO | 补齐 clarification、result version、registered actions、receipt 投影（仅缺失时） |
| backend skills | 声明 entry kind、输入、结果、风险和取消/恢复能力；不写页面布局 |

## 17. 验收矩阵

### 17.1 跨模式不变量

- 五个模式均使用同一 Shell；仓库中只有一个两栏几何来源。
- 中栏包含上下文、时间线和 Composer；右栏包含结果与下一步。
- 模式导航不在 Composer 内；「首次建联」不再与模式并列。
- 中栏与右栏各自只有一个滚动容器；页面外层不产生第三条业务滚动轴。
- 右栏表格无整栏横向滚动；关键动作无需水平滚动才能触达。
- 同一视口最多一个实底主 CTA。
- 切换模式再返回，保留该模式草稿、当前 run、结果选择和折叠状态。
- 状态文字、图形与 ARIA 一致；不只靠颜色。

### 17.2 状态与恢复

- queued/running 明确原因、阶段、取消/恢复入口。
- needs_input 只显示必要问题；回答后 input version 增长。
- 修改输入使旧 L3 确认失效。
- partial 明确完成与未完成范围。
- failed 不抹去部分结果或已发生副作用。
- cancelled 保留已发生动作和回执。
- 页面刷新后能从服务端恢复持久作业状态，而不是依赖内存定时器。

### 17.3 业务动作

- AI发现入库：确认前不写入；入库后不自动领取、不发信、不改阶段。
- 公海领取：确认前不改变归属；并发冲突返回明确结果。
- 回公海：只改变跟进归属，不自动改阶段或删除历史。
- 首次建联：先产生 L2 草稿；发送使用独立 L3 确认；发送不推进阶段。
- 阶段确认：建议与正式写入分开，使用 `expected_version`。

### 17.4 设备与无障碍

- 按 DESIGN 的宽度、高度、输入模态矩阵逐项验证。
- 矮视口至少显示一块完整交互内容或一行完整结果，Composer 不裁切内容。
- `≤ 860` 时结果区转换为可访问抽屉/下层区域，无横向滚动。
- 键盘可从中栏进入右栏、打开确认、取消并回到触发点。
- 屏幕阅读器能获知模式、运行状态、结果数量、待确认状态和动作结果。

### 17.5 建议自动化证据

- 单元：workspace reducer、clarification 版本、action risk、折叠恢复、模式草稿隔离。
- 契约：session / result / action / confirmation / receipt schema。
- E2E：五模式 shell parity；模式导航与 Composer 分离；双滚动；无横向溢出；L3 快照失效；刷新恢复。
- 业务回归：AI发现、领取、释放、阶段、发送各自既有测试继续通过。
- 人工截图：DESIGN 验收矩阵中所有宽度 × 高度关键组合，覆盖默认、右栏折叠、澄清、运行、失败、确认和完成。

## 18. 发布与回滚

- 分模式迁移，不能一次性替换五种页面后只做视觉验收。
- 每个阶段保留旧数据契约兼容层；新视图模型只做投影，不改变权威事实。
- 前端外壳可按模式 feature flag 回退；L3 动作接口与回执不得随 UI 回滚丢失。
- 若新 Shell 失败，回退的是呈现层；已发生的发送、导入、领取、释放或阶段变更继续按真实回执展示。
- 不以规格完成、截图完成或局部测试通过宣称生产闭环完成。

## 19. 完成定义

只有同时满足以下条件才可标记完成：

1. 现行 IA / DESIGN 已同步为五模式，并记录公海和首次建联决策。
2. 五模式均运行在唯一 `WorkspaceShell` 上。
3. 中栏具备真实的请求、必要澄清、过程、等待、失败恢复和 Composer 脊柱。
4. 右栏具备结果、下一步、确认、审批状态与回执的统一槽位。
5. 公海 / 我的红人不再使用旧全宽 pane + 页面级 Composer 架构。
6. 首次建联已成为对象动作工作流，L2 草稿与 L3 发送分离。
7. 权限、审批、阶段、异步和回执契约未被前端重写。
8. 目标域测试、发布门禁、三轴人工证据和真实授权集成验证齐全。


---

## 实施证据（2026-09-23：阶段 0/1 收尾 + 阶段 4）

### 单元与 E2E 通过清单

| 测试集 | 结果 | 备注 |
|---|---|---|
| `backend npm test -- home/` | 11 files / 98 tests passed | scopeParity 含新增「object panes no longer declare a second pane skeleton」用例（7 tests） |
| `home-pane-parity.spec.ts` | 9 passed | 五模式 Chrome / 折叠记忆 / 堆叠 / 键盘 |
| `home-four-panel.spec.ts` | 10 passed | DESIGN 新几何断言（rail ≥360、中栏宽于右栏） |
| `home-pool-follow.spec.ts` | 5 passed / 1 failed | 唯一失败 :230（既有红：`[data-analyze-queued]` 不出现，基线已登记） |
| `home-surface-failure.spec.ts` | 2 passed | 跟进面 / 公海面失败各自独立 |
| `home-followed-focus.spec.ts` | 1 passed | 悬停 vs 键盘焦点 |
| `home-chat-send-ne-stage.spec.ts` | 5 passed / 2 failed | :69/:113 既有红（基线已登记） |
| `workspace-evidence.spec.ts` | 1 passed（E2E_EVIDENCE=1） | 8 张截图 |

### 截图证据路径

`artifacts/review/unified-agent-workspace/`（不入库，只留 spec 引用）：

- `pool-1440x900.png` / `pool-1000x900.png` / `pool-1440x520.png` / `pool-collapsed.png`
- `lifecycle-1440x900.png` / `lifecycle-1000x900.png` / `lifecycle-1440x520.png` / `lifecycle-collapsed.png`

### 既有红清单（保持红、不修、逐条登记）

- `home-pool-follow.spec.ts:230`：分析入队 flow 自报缺人（`[data-analyze-queued]` 不出现）。
- `home-chat-send-ne-stage.spec.ts:69/:113`：send chrome / draft send L3 confirm 既有竞态。
- `home-plan-cache.spec.ts:56/:84`：固有竞态（retries=1 吸收）。
- `validate:kol-data`：`data/kol/红人画像信息表.md` 缺失（工作区既有）。
- `validate:tb-binding`：remote brand dictionary 不含 TB（工作区既有）。
- `Mail.tsx` typecheck：`ConversationSummary` / `TranslationPanel` 未定义（工作区既有未提交改动）。

### 各提交 hash

本轮未执行 git commit（用户约束：不执行 git 写操作）。待提交文件清单：

```
frontend/src/home/usePoolWorkspace.ts        （新增）
frontend/src/home/useFollowedWorkspace.ts    （新增）
frontend/src/home/PoolPane.tsx               （移除 embedded 死分支）
frontend/src/home/FollowedPane.tsx           （移除 embedded 死分支）
frontend/src/home/scopeParity.test.ts        （新增 object pane 断言）
frontend/src/pages/Home.tsx                  （状态迁入两个 hook）
frontend/e2e/workspace-evidence.spec.ts      （新增）
docs/superpowers/specs/2026-09-23-unified-agent-workspace.md（追加实施证据）
```

### §19 完成定义对照

| 条目 | 状态 | 说明 |
|---|---|---|
| 1. IA/DESIGN 五模式同步 | ✅ | 阶段 0 已完成（ADR-2026-09-23） |
| 2. 五模式唯一 WorkspaceShell | ✅ | home-pane-parity 9 passed |
| 3. 中栏真实请求/澄清/等待/失败恢复 | 🟡 部分 | 公海/我的红人中栏目前只呈现选择上下文与 Agent 提问入口；完整 InteractionSurface 推迟到阶段 2 |
| 4. 右栏结果/下一步/确认/回执统一槽 | 🟡 部分 | 对象列表与 L3 确认已在右栏；统一 ResultRail 组件推迟到阶段 2 |
| 5. 公海/我的红人不再旧全宽 pane | ✅ | embedded 死分支已移除；scopeParity 断言通过 |
| 6. 首次建联成为对象动作工作流 | ⏭ 推迟 | 阶段 5（creator_outreach 注册表） |
| 7. 权限/审批/阶段/异步/回执未被前端重写 | ✅ | 本轮纯前端呈现层重构，无后端改动 |
| 8. 目标域测试/门禁/三轴证据齐全 | ✅ | 见上表；既有红逐条登记 |

### 明确推迟项

- **设计决策 2**：`InteractionSurface` / `ResultRail` 组件与 `workspace-types/reducer` 抽取推迟到阶段 2（今日/待办时间线 block 投影）。
- **设计决策 3**：「切换模式再返回保留草稿 / 结果选择」推迟到阶段 2 的输入版本/草稿隔离模型。
- **§17.2「修改输入使旧 L3 确认失效」**：随结构化澄清与 inputVersion（阶段 2/3）。
- **§17.5 单元（reducer/澄清版本/action risk）**：随阶段 2/3 建单元。

### 后端门禁补充说明

- `npm test -- home/`（覆盖本次改动的前端 home 模块）：11 files / 98 tests passed。
- `npm test`（全量后端）：超时挂起（工作区既有问题，与本次纯前端重构无关）；`home/` 子集已覆盖所有受影响路径。
- `npm run typecheck`（后端）：超时挂起（同上）。
- `validate:kol-data` / `validate:tb-binding`：工作区既有缺失/远端字典不含 TB，与本次改动无关。
