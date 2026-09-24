# AI 发现现有实现与刷新目标的对比

**作者：Manus AI**  
**日期：2026-09-24**  
**结论：现有 AI 发现已经实现了目标工作台的核心骨架，应在现有实现上做定向增强，不应重建另一套页面。**

## 1. 结论先行

已找到 AI 发现的完整实现链路。其核心是 `DiscoveryWorkspace`、`useDiscovery`、`DiscoveryProcessPanel`、`DiscoveryResultPane` 与共享的 `WorkspaceShell`。当前实现已经严格遵循“**中栏承接人与 AI 的交互；右栏承接运行状态、结果明细和受控后续动作**”的结构。[1] [2] [3] [4]

因此，前一版“中栏人机交互、右栏 AI 摘要—结果明细—下一步计划”的设计方向与现有代码**高度一致**。需要做的不是新增一个“AI 发现工作台 v2”，而是将现有右栏从“运行状态 + 结果标题 + 历史 + 默认选择工具条 + 明细”重组为“AI 摘要 + 结果明细 + 下一步计划”，同时删除空结果状态对展开宽度和顶部留白的特殊处理。

> **实现策略应是“保留骨架、重组右栏、补齐计划层、修复状态化宽度覆盖”，而不是替换 `DiscoveryWorkspace`。**

---

## 2. 已定位的实现链路

| 层级 | 当前实现文件 | 当前职责 | 与目标设计的关系 |
|---|---|---|---|
| 页面入口 | `frontend/src/pages/Home.tsx` | 将筛选 Brief、运行 ID、任务 ID、重试入口传入发现工作台 | 保留 |
| 工作台组合 | `frontend/src/home/DiscoveryWorkspace.tsx` | 组合中栏条件卡/过程流、右栏结果区、历史记忆与共享壳 | 保留，作为改造入口 |
| 共享布局 | `frontend/src/home/WorkspaceShell.tsx` | 唯一两栏骨架、展开/折叠、中心滚动与右栏插槽 | 保留，修复空态列宽分支 |
| 中栏交互 | `frontend/src/home/DiscoverySearchCard.tsx` | 提交前的发现条件表单 | 保留，作为初始人机交互 |
| 中栏过程 | `frontend/src/home/DiscoveryProcessPanel.tsx` | 任务事件、运行步骤、推理摘要、改条件入口 | 保留，已符合 AI 发现流 |
| 状态与副作用 | `frontend/src/home/useDiscovery.ts` | 运行读取、轮询、候选选择、忽略、入库确认、错误恢复 | 保留，扩展派生摘要与计划数据 |
| 右栏结果 | `frontend/src/home/DiscoveryResultPane.tsx` | 运行状态、统计、历史、选择、候选清单、入库确认 | 拆分并重组 |
| 结果行 | `frontend/src/home/DiscoveryLeadRow.tsx` | 紧凑线索行、置信度、匹配原因、展开详情 | 保留，适配新的列表区域 |
| 客户端数据契约 | `frontend/src/home/discoveryHome.ts` | 运行、候选、失败、重试、入库 API 映射 | 保留，补充摘要/计划的派生字段即可 |
| 内容样式 | `frontend/src/home/discovery-workspace.css` | 中栏过程流、条件卡和右栏内容层样式 | 保留，删除初始态顶部补白 |

后端已经提供发现运行、运行详情、候选列表、任务事件、失败重试和入库确认的完整流程。前端在切换到 AI 发现时只读取既有运行和历史结果，不会因为切换页面而创建会话或调用模型；实际运行由提交后任务驱动，并通过事件轮询显示进度。[3] [5]

---

## 3. 现有实现的实际工作方式

### 3.1 中栏：已经是目标中的“人机交互区”

`DiscoveryWorkspace` 在提交前将 `DiscoverySearchCard` 放入中栏。用户可设置平台、地区、内容方向、关键词、粉丝数、均播和期望人数。提交成功后，条件卡自动收起，`DiscoveryProcessPanel` 成为中栏主内容。[1] [6]

`DiscoveryProcessPanel` 展示真实的任务步骤、当前运行步骤、失败状态和经过截断的推理摘要。用户可以点击“改条件再搜”，在不丢失上一次运行事实的前提下重新展开条件卡。运行中还会展示“正在按已确认的条件检索红人线索。不会发信、不会改阶段、不会编造结果”的状态说明。[4]

这一实现已经满足刷新设计中的三个关键要求：中栏承担人与 AI 的连续交互；过程和结果分开；AI 运行不自动执行邮件、跟进或阶段写入。因此，不建议将中栏改造成一个全新的聊天页面。第一版应在当前过程流上补充“AI 发现结论”和“基于结果追问”的卡片或消息块。

### 3.2 右栏：已具备结果工作台，但信息顺序需要优化

`DiscoveryResultPane` 当前按以下顺序渲染右栏内容：

1. 失败或连接异常提示；
2. 入库确认已失效、已取消、待审批或接口缺失提示；
3. 运行状态卡；
4. 结果标题和“原始 / 入围”数量；
5. 历史运行选择器；
6. 候选数量、排序说明、全选、已选数量和“入库公海”按钮；
7. 候选明细列表；
8. 去公海提示；
9. 无结果或服务不可用空态；
10. L3 入库确认弹窗。[2]

候选行 `DiscoveryLeadRow` 已经是紧凑的可扩展结果单元。它展示名称、平台、推荐分、置信度、粉丝、近十条均播、播放/粉丝比、匹配理由、来源链接、展开详情和忽略操作。详细指标默认折叠，避免长内容挤压右栏。[7]

这意味着右栏的“结果明细”已经具备，不需要重新定义候选对象或列表交互。需要改变的是顶部信息层级：把运行状态、标题和数量合并为 AI 摘要；把历史查看与结果筛选组织到结果明细中；把默认选择工具条改为选择模式上下文操作条；把下一步建议从弹窗后的隐性操作提升为显式计划区。

### 3.3 运行状态与安全边界已经可复用

`useDiscovery` 已管理以下状态：历史运行、当前运行、候选、选择、忽略、展开详情、任务事件、轮询、失败、连接状态、入库确认、审批状态、重新配条件和提示消息。[3]

它还区分了三类空状态：未运行、筛选无结果和服务不可用；区分了抓取失败、排名失败、事件订阅缺失、入库接口缺失、确认作废、取消和等待审批。这些细粒度状态是右栏 AI 摘要和下一步计划的良好数据基础，而不是需要重新建模的障碍。

入库操作也已有明确安全边界：选中候选后必须经过确认；入库不会自动建联、发信、改阶段或领取跟进。[2] 这一约束应继续保留，并在“下一步计划”中用 `requiresConfirmation` 明示。

---

## 4. 与刷新目标的逐项对比

| 目标能力 | 当前实现 | 对比结论 | 定向改造 |
|---|---|---|---|
| 中栏承担人机交互 | 条件卡 → 提交后过程流 → 可改条件 | 已实现，且逻辑正确 | 保留；在过程流下增加发现结论与追问块 |
| 右栏展示结果明细 | 候选列表、详情展开、忽略、入库确认 | 已实现，且数据较完整 | 保留 `DiscoveryLeadRow`，调整顶部顺序 |
| 右栏展示 AI 摘要 | 运行状态卡、标题、原始/入围数量分散显示 | 部分实现 | 合并为固定高度的 `DiscoveryAiSummary` |
| 右栏展示下一步计划 | 只有“入库公海”及错误恢复等隐含动作 | 缺失显式计划层 | 新增 `DiscoveryNextPlan`，先由规则生成 |
| 批量操作按需出现 | 默认始终显示全选和禁用“入库公海”按钮 | 不符合目标 | 仅在选择模式显示操作条 |
| 顶部空间利用 | 初始态有额外顶部留白；成功态有多个连续头部区块 | 不符合目标 | 移除补白，合并摘要，首条结果上移 |
| 右栏展开宽度与今日任务一致 | 共用 `WorkspaceShell`，但初始态被 `is-result-idle` 压缩为 360px | 不符合硬约束 | 删除空态对列宽的覆盖 |
| 运行、失败与恢复 | 有真实任务事件、轮询、失败说明、重试和连接检查 | 已实现，优于纯静态方案 | 将状态映射为摘要和计划 |
| 数据不编造 | 缺失数据有明确文案；无 URL 时禁用来源链接；运行中说明不编造 | 已实现 | 继续保留 |
| 高风险业务操作确认 | 入库有 L3 确认；不会自动发信或跟进 | 已实现 | 计划只发起确认，不直接写入 |

---

## 5. “宽度一致”问题的代码根因

当前右栏外层几何由 `WorkspaceShell` 结合 `today-plan-board.css` 的共享规则控制：

```css
.scope-workspace {
  --scope-task-rail-width: clamp(
    var(--workspace-result-rail-min),
    var(--workspace-result-rail-ideal),
    var(--workspace-result-rail-max)
  );
  grid-template-columns: minmax(0, 1fr) var(--scope-task-rail-width);
}
```

全局令牌定义为：最小 360px，理想比例 54%，最大 820px，折叠态 56px。[8] `DiscoveryWorkspace` 与今日任务共用这一壳，因此运行中和有结果时的基础实现方式是正确的。

但当前存在以下状态覆盖：

```css
.scope-workspace.is-result-idle:not(.is-task-rail-collapsed) {
  --scope-task-rail-width: var(--workspace-result-rail-min);
}
```

而 `DiscoveryWorkspace` 在“无运行、未运行、无失败”时传入 `resultIdle`，导致 AI 发现初始态将右栏收窄为 360px。[1] [3] 在 1966px 视口下，今日任务的共享计算会达到 820px 上限，因此两者会出现 460px 的差异。

此外，AI 发现内容样式在初始态增加了额外顶部补白：

```css
.scope-workspace[data-scope-workspace="discovery"].is-result-idle .scope-task-rail-body {
  padding-top: calc(var(--space-5) + var(--space-5));
}
```

这条规则不是列宽问题，却是右栏顶部空间利用率低的直接原因。[9] 它应被删除；初始态应通过短摘要和最近结果记忆填充，而不是以空白垫开内容。

---

## 6. 基于现有实现的目标组件映射

刷新设计应沿用现有组件，并采用下面的映射关系：

```text
DiscoveryWorkspace                         保留：页面组合与共享布局入口
├── 中栏
│   ├── DiscoverySearchCard                 保留：条件输入与初始互动
│   ├── DiscoveryProcessPanel               保留：运行过程、推理、恢复入口
│   └── DiscoveryInsightThread（新增）      新增：发现结论、追问、证据跳转
└── 右栏
    └── DiscoveryResultPane                 改为内容编排层
        ├── DiscoveryRailHeader（新增）     范围、刷新、连接/新鲜度
        ├── DiscoveryAiSummary（新增）      运行/数量/风险或数据质量结论
        ├── DiscoveryResultControls（新增） 搜索、筛选、历史运行
        ├── DiscoverySelectionBar（新增）   仅多选时显示
        ├── DiscoveryLeadRow（保留）        结果明细行
        └── DiscoveryNextPlan（新增）       1–3 条计划与确认入口
```

`DiscoveryResultPane` 目前既是状态显示器，也是结果列表与批量操作容器。拆分后，它仍可以继续接收 `DiscoveryState`，避免把请求和状态副作用分散到多个组件。`useDiscovery` 可新增只读派生对象，例如 `summary` 与 `nextPlan`，而不改变现有轮询、选择、入库和失败恢复逻辑。

---

## 7. 最小变更开发路径

### 第一步：修正共享几何，不改变业务逻辑

删除 `.scope-workspace.is-result-idle:not(.is-task-rail-collapsed)` 对 `--scope-task-rail-width` 的覆盖。保留 `resultIdle`，但仅用于内容语义。删除 AI 发现初始态的 `padding-top: calc(var(--space-5) + var(--space-5))`。

**结果：** AI 发现与今日任务在展开、折叠和响应式断点上的外层几何立即一致，且不会涉及发现任务、候选列表或入库流程。

### 第二步：压缩现有右栏顶部为 AI 摘要

以 `run`、`visible`、`failure`、`connection`、`runHistory` 和 `emptyKind` 为数据源，新增 `DiscoveryAiSummary`。它取代“状态卡 + 结果标题 + 原始/入围数量”的连续三段结构，但复用已有 `DiscoveryRunStatusCard` 的计算数据和标签逻辑。

AI 摘要的首版无需调用模型。它可以用规则得出“发现运行完成，入围 12 位”“当前运行失败，需要检查采集服务”“按当前条件没有入围线索”等确定性结论。语言模型解释可作为下一阶段增强。

### 第三步：将批量操作移到选择模式

当 `selected.length === 0` 时，不渲染全选复选框、已选人数和禁用的“入库公海”按钮。当用户点击“选择”或选择第一个候选时，显示 `DiscoverySelectionBar`，其中包含全选、已选数量与“入库公海（N）”。

**结果：** 右栏默认首屏少一整行工具条，结果或初始状态会上移；现有 L3 确认机制不受影响。

### 第四步：新增下一步计划与中栏结论块

`DiscoveryNextPlan` 首版按确定性规则输出一至三项：开始发现、重试失败运行、查看 N 条候选、选择高推荐候选入库、查看历史运行、检查采集服务。计划项可打开中栏条件卡、滚动到候选列表或发起既有入库确认。

随后再增加 `DiscoveryInsightThread`，用于根据已有候选和排序理由回答“为何推荐”“比较谁”“下一步先做什么”。该模块只能引用 `HomeDiscoveryCandidate` 的字段和运行事实，不能制造不存在的数值或联系人信息。

---

## 8. 需要避免的重复建设

1. **不要新建第二套两栏容器。** `WorkspaceShell` 已经是唯一正确的布局骨架；为 AI 发现单独写 `grid-template-columns` 会再次造成宽度漂移。
2. **不要在右栏重新实现轮询。** `useDiscovery` 已统一读取运行、候选和任务事件；新的摘要、计划和列表组件只能消费它提供的状态。
3. **不要用模型替代状态机。** 运行中、失败、空结果、审批等待和接口缺失都已有真实状态，AI 只能解释，不可猜测。
4. **不要将 AI 发现候选与“我的红人”邮箱跟进列表混在同一个数据源。** AI 发现面向新线索和入库公海；“我的红人”面向已跟进对象和 Starry 邮箱归属。两者可以共享工作台、摘要和计划组件模式，但需保持独立数据契约。
5. **不要绕过 L3 入库确认。** 计划项可以引导用户“入库公海”，但只能打开现有确认流程，不能直接执行写入。

---

## 9. 验收重点

| 验收项 | 当前基础 | 刷新后要求 |
|---|---|---|
| 桌面右栏宽度 | 共用 Shell，但初始态被压缩 | 所有状态下与今日任务相同 |
| 1966px 视口展开宽度 | AI 发现初始态为 360px | 今日任务与 AI 发现均为 820px |
| 顶部留白 | 初始态额外加两档 `space-5` | 删除；显示摘要或最近记忆 |
| 中栏过程交互 | 已有真实步骤和推理 | 保留，并增加结论/追问块 |
| 右栏结果行 | 已有紧凑、可展开行 | 保留 |
| 默认批量操作 | 禁用按钮常驻 | 无选择时不显示 |
| 下一步计划 | 仅隐含在状态和按钮里 | 明确显示 1–3 条、可追溯、需确认 |
| 失败恢复 | 已有重试与连接检查 | 摘要和计划可直接调用现有能力 |

---

## 10. 最终判断

现有 AI 发现实现与刷新目标并不是冲突关系，而是**基础能力已经完成约 70% 至 80%**：共享两栏工作台、中栏条件与过程流、右栏候选结果、历史记忆、真实进度、失败恢复、选择与 L3 确认均已存在。

差距集中在四个可控点：初始态宽度被压缩、初始态顶部补白过大、右栏顶部信息分散且默认展示禁用选择操作、下一步计划未被显式表达。因此，最合理的开发方式是对现有实现做结构性整理与小范围组件拆分，而不是重新开发发现流程或替换状态管理。

## References

[1]: file:///home/ubuntu/KOL/frontend/src/home/DiscoveryWorkspace.tsx "AI discovery workspace composition"
[2]: file:///home/ubuntu/KOL/frontend/src/home/DiscoveryResultPane.tsx "AI discovery result rail implementation"
[3]: file:///home/ubuntu/KOL/frontend/src/home/useDiscovery.ts "AI discovery state orchestration and polling"
[4]: file:///home/ubuntu/KOL/frontend/src/home/DiscoveryProcessPanel.tsx "AI discovery process and reasoning flow"
[5]: file:///home/ubuntu/KOL/frontend/src/home/discoveryHome.ts "AI discovery client data contracts"
[6]: file:///home/ubuntu/KOL/frontend/src/home/DiscoverySearchCard.tsx "AI discovery search condition interaction"
[7]: file:///home/ubuntu/KOL/frontend/src/home/DiscoveryLeadRow.tsx "AI discovery candidate result row"
[8]: file:///home/ubuntu/KOL/frontend/src/home/today-plan-board.css "Shared workspace right-rail geometry"
[9]: file:///home/ubuntu/KOL/frontend/src/home/discovery-workspace.css "AI discovery content-layer styles"
