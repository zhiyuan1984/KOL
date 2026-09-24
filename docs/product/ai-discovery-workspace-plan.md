# AI 发现工作台：刷新后的产品设计与开发计划

**作者：Manus AI**  
**版本：v1.1**  
**日期：2026-09-24**  
**本次硬性约束：AI 发现右栏在展开状态下的宽度，必须与今日任务右栏完全一致。**

## 1. 先给出 AI 发现的界面优化建议

### 1.1 右栏先统一宽度，再重构内容

**AI 发现不应拥有自己的右栏宽度。** 当前“今日任务”“我的待办”“AI 发现”已经共用 `WorkspaceShell`，今日任务的展开右栏宽度来自同一组设计令牌：`clamp(360px, 54%, 820px)`；折叠宽度为 `56px`。[1] [2]

但 AI 发现当前传入 `resultIdle`。当它尚未开始发现任务时，外壳会追加 `is-result-idle`，并把右栏宽度改为最小值 `360px`。这使它在展开状态下与今日任务的标准宽度不一致。[1] [3] 这不是内容密度问题，而是**布局规则被状态分叉**的问题。

因此，刷新后的设计规定如下：

> **无论 AI 发现处于初始、运行中、成功、失败、空结果或查看历史结果状态，只要右栏是展开状态，就使用与今日任务相同的宽度计算式。**

`resultIdle` 可以继续表达“暂无结果”的内容状态，但不得再参与列宽计算。AI 发现的首屏优化只能通过内容组织、间距和空态重写完成，不能通过收窄右栏完成。

### 1.2 中栏承担人与 AI 的交互，右栏承担决策成果

刷新后的页面采用稳定职责分工：

- **中栏是人机交互区。** 它显示用户的目标、AI 的发现过程、证据化结论、追问记录与固定提问框。
- **右栏是 AI 决策工作台。** 它依次显示 AI 摘要、结果明细与下一步计划。
- **右栏不是操作按钮仓库。** 搜索和筛选属于结果明细的局部控制；批量操作只在用户进入选择模式后出现。

当前页面顶部空间利用率低的原因，是结果尚未出现时便同时摆放标题、搜索、阶段筛选、计数、全选、多个禁用批量按钮和大空态。刷新后，默认首屏只保留决策所需的信息，让用户先看到“AI 发现了什么”和“该做什么”。

### 1.3 右栏顶部改为“摘要、明细、计划”三段式

右栏展开后的固定顺序如下：

```text
我的红人 / 红人线索                           [刷新] [收起]
当前范围 · 数据新鲜度 · 来源状态

AI 摘要
已确认 8 · 待核验 23 · 异常 1
优先处理：核验负责人候选，避免将候选误计入正式跟进

结果明细
[搜索结果] [更多筛选]
结果行 / 卡片列表

下一步计划
1. 同步 Starry 并补齐归属字段
2. 核对 1 条退信
3. 对已确认对象生成本周跟进计划
```

AI 摘要最多显示三项统计和一条最高优先级发现。结果明细是右栏的主要滚动区域。下一步计划只保留一至三项可执行建议，每一项都应说明来源、对象范围和是否需要人工确认。

### 1.4 解决错误空态，而不是美化错误空态

之前的只读核查发现，`larry.zhao@amperetime.com` 绑定负责人赵良玉；Starry 全量画像中存在 **23 条**负责人为赵良玉的记录，但当前本地 `/home/following` 仅读取 `kol_follow_index`，并不会把这些 Starry 记录纳入右栏。[4] 因而“在跟 0 位 / 该邮箱下暂无跟进红人”不能被视为真实业务结论。

右栏必须区分以下数据状态：

| 状态 | AI 摘要的表达 | 结果明细的表达 | 是否计入正式在跟 |
|---|---|---|---|
| 邮箱或负责人 ID 已精确匹配 | 已确认归属 | 正常红人结果 | 是 |
| 仅负责人姓名匹配，缺少负责人邮箱 | 待邮箱核验 | 候选结果，标记置信度 | 否 |
| 本地已领取、远端暂时无法确认 | 本地跟进，待同步 | 本地结果 | 单独计数 |
| 退信、自动回复或系统邮件 | 投递异常 | 异常结果，不混入红人 | 否 |
| 无匹配记录 | 暂未发现匹配对象 | 正常空态 | 否 |
| Starry 失效或查询失败 | 数据暂不可用 | 故障状态和重试 | 否 |

---

## 2. 目标布局：与今日任务同宽的右栏

### 2.1 宽度契约

右栏几何只由 `WorkspaceShell` 与全局令牌决定，不能在 `DiscoveryWorkspace.tsx`、`discovery-workspace.css`、`DiscoveryResultPane` 或单个结果组件中重新定义列宽。

| 视口条件 | 今日任务右栏展开宽度 | AI 发现右栏展开宽度 | 规则 |
|---|---:|---:|---|
| 大于 1280px | `clamp(360px, 54%, 820px)` | **完全相同** | 同一 `--scope-task-rail-width` 计算式 |
| 1101px–1280px | `clamp(360px, 54%, 820px)` | **完全相同** | 同一 Shell，无页面覆盖 |
| 1100px 及以下 | 两栏改为纵向堆叠 | **完全相同** | 不再存在独立右栏像素宽度 |
| 任意桌面宽度的折叠态 | `56px` | **完全相同** | 同一 `--workspace-result-rail-collapsed` |

在 1966px 宽的当前截图所对应的大屏环境中，`54%` 会触发 `820px` 上限。因此 AI 发现展开后的右栏也必须为 **820px**，而非因空结果退回 360px。

### 2.2 CSS 实施规则

将几何规则收敛为下面的单一实现。`is-result-idle` 只可改变内部空态密度，不可改变列宽。

```css
/* today-plan-board.css：唯一的工作台右栏几何来源 */
.scope-workspace {
  --scope-task-rail-width: clamp(
    var(--workspace-result-rail-min),
    var(--workspace-result-rail-ideal),
    var(--workspace-result-rail-max)
  );
  display: grid;
  grid-template-columns: minmax(0, 1fr) var(--scope-task-rail-width);
}

.scope-workspace.is-task-rail-collapsed {
  grid-template-columns: minmax(0, 1fr) var(--workspace-result-rail-collapsed);
}

/* 空结果只调内部内容，不调 --scope-task-rail-width。 */
.scope-workspace.is-result-idle .scope-task-rail-body {
  min-height: 0;
}
```

应删除或重写当前会把展开空结果右栏强制改为 `var(--workspace-result-rail-min)` 的规则：

```css
/* 删除：它使 AI 发现初始状态比今日任务窄。 */
.scope-workspace.is-result-idle:not(.is-task-rail-collapsed) {
  --scope-task-rail-width: var(--workspace-result-rail-min);
}
```

`DiscoveryWorkspace` 可以保留 `resultIdle` 作为内容状态；也可以将其重命名为 `resultEmpty`，以避免误解为“空结果需要更窄的右栏”。两种实现都必须保证它不再写入宽度变量。

### 2.3 桌面信息架构

```text
┌───────────────────────────────────────────────┬────────────────────────────────────────────┐
│ 中栏：人与 AI 的连续交互                       │ 右栏：与今日任务同宽的结果与决策工作台          │
│                                               │ 宽度：clamp(360px, 54%, 820px)                │
│ 目标与范围条                                  │                                            │
│ “发现北美房车领域红人 · 已选 0 位”             │ 标题 + 当前范围 + 新鲜度                      │
│                                               │                                            │
│ AI 发现流                                     │ AI 摘要                                    │
│ - 搜索条件和过程                              │ 已确认 / 待核验 / 异常                       │
│ - 证据、比较、解释                            │ 最高优先级发现                              │
│ - 用户追问                                    │                                            │
│                                               │ 结果明细                                    │
│ 动态快捷问题                                  │ 搜索、更多筛选、对象行                       │
│                                               │                                            │
│ 固定提问框                                    │ 下一步计划                                  │
│ “基于当前发现结果提问”                          │ 1–3 项确认前的行动建议                       │
└───────────────────────────────────────────────┴────────────────────────────────────────────┘
```

右栏宽度一致后，AI 发现可以使用与今日任务相同的行密度、输入控件和信息层级。它不需要额外变宽来容纳卡片，也不应变窄来隐藏空结果；必要的细节应在内部用一行摘要、折叠行和按需展开的详情处理。

---

## 3. 交互设计

### 3.1 中栏：人机交互区

中栏的首屏不再以“等待选择对象”“从右栏开始”等静态说明为主要内容。它展示当前范围和一条基于真实数据状态的 AI 发现。

当尚未开始一次发现任务时，中栏提供不超过三项快捷问题，例如“按当前条件开始发现”“查看上次有效结果”“比较已保存候选”。当已有结果时，中栏展示发现过程、证据和用户追问。每条 AI 建议都可跳转到右栏里的具体结果或计划项。

提问框固定在中栏底部。它明确显示作用范围，例如“基于当前 28 条发现结果提问”或“基于已选 3 位红人提问”。AI 可以生成比较、风险判断和计划草案，但不得在没有明确确认的情况下发送邮件、领取红人或更改合作阶段。

### 3.2 右栏：AI 摘要

AI 摘要固定在展开右栏顶部，但高度受限。无异常时，标题、范围条与摘要合计不超过 **160px**；有数据健康或高优先级异常时，不超过 **208px**。摘要中的数字可点击，并驱动结果明细筛选。

摘要的统计口径必须清晰。候选归属与已确认归属分列显示，禁止将候选数和正式在跟数相加。对于 AI 发现页面，摘要还应标注本次运行状态、来源新鲜度和已过滤数量。

### 3.3 右栏：结果明细

结果明细在右栏中占据主要可滚动区域。默认只显示搜索框和“更多筛选”入口；阶段、风险、平台、来源、新鲜度等细项放入二级筛选面板。这样可避免工具栏在结果出现前占用纵向空间。

每个结果行只显示决策所需信息：名称、平台、一个匹配或阶段标签、最近事实，以及一个主要动作。长描述、完整画像与原始邮件应在点击行后进入中栏会话或详情视图。结果默认按待处理优先级排序。

多选后才进入选择模式。此时在结果区出现上下文操作条，提供“分析已选”“生成计划”“提出阶段变更”等操作。未选择时不得显示禁用按钮。

### 3.4 右栏：下一步计划

下一步计划位于右栏底部。它是由规则与 AI 协作生成的短计划，而不是重新罗列全部结果。每项计划应包含：优先级、具体动作、对象数、原因、来源和是否需要确认。

例如，“核验 23 条负责人候选”来自数据健康规则；“核对 1 条退信地址”来自邮件异常规则；“对 5 位高优先级候选生成触达策略”来自 AI 的排序建议。任何可写入系统的动作都以建议形式存在，点击后进入既有确认流程。

---

## 4. 数据、AI 与接口设计

### 4.1 统一工作台快照

新增面向页面的只读接口：

```text
GET /api/home/followed-workspace
```

后端负责聚合绑定邮箱、本地跟进索引、Starry 红人画像、生命周期、会话事实和数据健康。前端不得自行跨来源判断红人归属。

```ts
type FollowedWorkspaceSnapshot = {
  scope: {
    mailboxEmail: string;
    mailboxId: string;
    ownerName: string;
    status: "connected" | "expired" | "unbound";
  };
  dataHealth: {
    status: "ready" | "partial" | "down";
    freshness: string | null;
    reconciliationRequired: boolean;
    message?: string;
  };
  summary: {
    confirmedCount: number;
    candidateCount: number;
    localOnlyCount: number;
    exceptionCount: number;
    primaryFinding: string;
  };
  results: Array<{
    kolUid: string;
    kolName: string;
    source: "confirmed" | "candidate" | "local" | "exception";
    confidence: "verified" | "owner-id" | "owner-fallback" | "local-only";
    stage?: string;
    risk?: string;
    latestFact?: { type: string; time?: string; summary: string };
    recommendedAction?: { label: string; requiresConfirmation: boolean };
  }>;
  nextPlan: Array<{
    id: string;
    priority: "high" | "normal";
    title: string;
    reason: string;
    source: "data-health" | "risk" | "stage" | "ai";
    targetCount?: number;
    requiresConfirmation: boolean;
  }>;
};
```

### 4.2 归属与置信度规则

以 `kolUid` 作为唯一红人主键。匹配优先级依次为：负责人邮箱精确匹配、负责人 ID 匹配、负责人姓名降级匹配、本地领取关系。负责人姓名降级匹配只能形成候选，不能计入正式在跟。

当前 `matchesFollowedMailbox` 已采用邮箱优先、负责人姓名回退的基础策略；刷新后需要将命中来源与置信度向上透出，而不是只返回一个布尔结果。[4]

邮件会话只有在具备有效 `kolUid` 且不是退信、自动回复或系统通知时才可成为“最近互动”事实。退信应进入异常计划，不得加入正式红人列表。

### 4.3 Starry MCP 的最小能力补齐

长期应由 Starry 提供按邮箱或负责人分页读取的接口：

```text
pageFollowedKolProfiles({
  mailboxEmail,
  ownerUserId,
  pageNo,
  pageSize,
  stageCodes,
  riskTagCodes,
  sortField,
  sortOrder
})
```

它必须稳定返回 `kolUid`、负责人 ID、负责人邮箱、负责人姓名、阶段、风险、最近会话、最近互动时间和更新时间。

在该接口上线前，后端可以调用全量画像接口做短期降级聚合，但必须标记 `dataHealth.status = "partial"`，并在 AI 摘要中明确“待核验”。客户端不可下载全量画像后自行筛选。

### 4.4 AI 生成的边界

规则层计算数据健康、归属分类、退信、风险、阶段停滞与排序依据。AI 层只能解释这些结构化事实、生成可读摘要、回答用户问题和提出计划草案。

AI 输出需包含 `evidenceIds`、`confidence` 与 `requiresConfirmation`。证据不足时，AI 的结论必须为“待核验”；不能猜测红人归属，也不能把建议直接写入业务系统。

---

## 5. 开发计划

### 阶段 A：先修复展开宽度一致性

**目标：** 让 AI 发现与今日任务的右栏几何完全一致，且不影响折叠态和窄屏布局。

1. 删除 `is-result-idle` 对 `--scope-task-rail-width` 的覆盖，或将其改为仅影响内部空态内容。
2. 保留 `WorkspaceShell` 作为今日任务、待办、AI 发现和对象工作台的唯一骨架。
3. 禁止在 `DiscoveryWorkspace`、`discovery-workspace.css`、`DiscoveryResultPane` 中定义 `grid-template-columns`、`width`、`min-width`、`max-width` 或任何 `--scope-task-rail-width` 覆盖来改变右栏外层几何。
4. 扩展 `scopeParity.test.ts`，验证 AI 发现的初始态、运行态、完成态和失败态均不改变展开右栏宽度变量。

**完成条件：** 在 1440px、1600px 与 1966px 视口中，今日任务与 AI 发现展开右栏的 `getComputedStyle(...).width` 相等；在 1966px 宽时均为 820px；折叠后均为 56px。

### 阶段 B：重构 AI 发现右栏为三段式

**目标：** 在不改变外层宽度的前提下，提高右栏首屏信息密度。

将 AI 发现结果区拆分为 `DiscoveryRailHeader`、`DiscoveryAiSummary`、`DiscoveryResultList` 与 `DiscoveryNextPlan`。`ResultRail` 继续作为通用的上下文、历史、建议与动作协议容器，但 AI 发现的域内组件负责三段式顺序。[5]

初始态不再把空结果压缩为窄栏。它应在相同宽度中显示“尚未开始发现”的短摘要、最近一次有效结果与一个主要动作。运行态显示正在发现的对象数、当前阶段与预计下一步。失败态显示错误原因、重试入口和上次有效结果。

**完成条件：** AI 发现默认首屏没有无关的工具条或禁用按钮；标题、范围与摘要不超过 160px；第一条结果或初始数据状态在 220px 内可见。

### 阶段 C：接入中栏人机交互与证据化计划

**目标：** 让中栏自然承接右栏的结果与计划，而不是承担静态帮助说明。

中栏增加范围条、AI 发现流、动态快捷问题和固定提问框。用户点击右栏摘要、结果行和计划项时，中栏定位到相应的证据或会话上下文。用户勾选结果后，提问框范围变为已选对象；批量动作仅在选择模式出现。

AI 初版只面向结构化发现结果生成排序理由、对比、风险解释与计划草案。发送邮件、领取红人、阶段推进等写入性动作沿用既有独立确认流程。

**完成条件：** 每条 AI 结论可以追溯到结果、数据健康项或会话；用户无需离开中栏即可追问“为什么”“比较谁”“下一步做什么”。

### 阶段 D：补齐邮箱维度的真实跟进数据

**目标：** 修正“Starry 有负责人记录，页面显示 0”的根因。

新增 `GET /api/home/followed-workspace` 聚合接口。短期在服务端汇总 Starry 数据并输出置信度；长期接入 `pageFollowedKolProfiles`。将原有 `/home/following` 保留为本地索引兼容接口，但 Home 的“我的红人”页面改用新快照。

**完成条件：** 已绑定邮箱在有候选时不显示绝对空态；已确认、候选、本地和异常计数分别可见；退信不计入正式红人。

### 阶段 E：回归、观测与灰度

**目标：** 验证几何一致性和决策效率都持续成立。

实施视觉回归、端到端交互测试、数据对账与产品事件监控。灰度期保留旧本地列表作为只读回退；当 Starry 异常时，工作台必须明确展示数据健康状态，而不是将失败误显示为零结果。

**完成条件：** 右栏几何不因页面、运行状态或结果数量而漂移；错误绝对空态率下降；用户可在首屏看到一条有效结论或可恢复动作。

---

## 6. 工程改造清单

| 模块 | 改造 | 验收重点 |
|---|---|---|
| `styles.css` | 保持唯一的右栏尺寸令牌 | 所有模式共享 360px / 54% / 820px / 56px |
| `today-plan-board.css` | 移除空结果对展开列宽的覆盖 | `is-result-idle` 不影响 `--scope-task-rail-width` |
| `WorkspaceShell.tsx` | 保持唯一布局骨架；状态只影响内容 | 不引入模式专属几何分支 |
| `DiscoveryWorkspace.tsx` | 保留 `resultIdle` 为内容状态，不用于列宽 | 初始态与今日任务展开宽度相同 |
| `DiscoveryResultPane` 与相关组件 | 按摘要、明细、计划拆分 | 外层不定义右栏宽度 |
| `ObjectWorkspace.tsx` | 中栏改为范围条、发现流和提问框 | 避免大段静态引导占首屏 |
| 后端聚合服务 | 产出统一跟进快照、置信度和计划 | 正式、候选、异常口径清晰 |
| Starry MCP 适配 | 按邮箱/负责人读取 | 能够稳定提供负责人邮箱与 ID |
| 测试 | 几何、数据、交互、可访问性回归 | 每种状态下展开宽度都与今日任务一致 |

---

## 7. 测试与验收标准

### 7.1 几何回归测试

新增浏览器级测试，分别打开今日任务和 AI 发现。读取展开态 `.scope-task-rail` 的计算宽度，断言两者相等。测试矩阵至少覆盖：1440px、1600px、1966px、初始态、运行态、成功态、失败态与历史结果态。

还需断言：1966px 宽时二者均为 820px；1100px 以下二者均转为单栏堆叠；折叠态二者均为 56px。测试不应只检查 CSS 文本中是否存在令牌，而应验证实际渲染结果。

### 7.2 内容密度测试

在 AI 发现初始态、空结果和成功结果下进行截图回归。检查右栏标题、范围和 AI 摘要高度；确保首条结果或初始状态在 220px 内出现；确保默认状态没有禁用的批量操作。

### 7.3 数据口径测试

覆盖邮箱精确匹配、负责人 ID 匹配、姓名候选匹配、本地领取、远端缺失、退信、自动回复、详情失效与 Starry 超时。断言候选不计入正式在跟，系统邮件不进入红人列表，部分数据会显示数据健康状态。

### 7.4 可访问性与动作安全测试

摘要标签、筛选、结果行、选择模式和计划项必须可键盘操作。风险、候选、异常和禁用状态不能只靠颜色表达。AI 提出的发信、领取和阶段变更仍需经过独立确认。

---

## 8. 发布成功指标

| 指标 | 目标 |
|---|---|
| AI 发现与今日任务展开右栏宽度差 | 0px |
| AI 发现所有状态的宽度漂移 | 0 次 |
| 默认禁用批量操作数量 | 0 个 |
| 首条有效结论或可恢复状态出现位置 | 右栏前 220px 内 |
| 有候选却显示绝对空态的比例 | 持续下降，目标为 0 |
| 退信误计入正式跟进对象数 | 0 |
| AI 建议进入人工确认流程的可追溯率 | 100% |

---

## 9. 最终决策

本次设计不改变“AI 发现与今日任务使用同一工作台骨架”的方向，反而将其落实为可测试的硬约束：**相同展开宽度、相同折叠宽度、相同断点行为，页面状态不能改变几何。**

在这个稳定几何基础上，AI 发现的差异只存在于内容：中栏更强调人机互动，右栏更强调 AI 摘要、结果明细与下一步计划。这样既统一产品体验，也能解决顶部空间被工具条和错误空态占用的问题。

## References

[1]: file:///home/ubuntu/KOL/frontend/src/home/today-plan-board.css "Shared workspace shell and result-rail geometry"
[2]: file:///home/ubuntu/KOL/frontend/src/styles.css "Global workspace result-rail design tokens"
[3]: file:///home/ubuntu/KOL/frontend/src/home/DiscoveryWorkspace.tsx "AI discovery workspace composition and idle-state input"
[4]: file:///home/ubuntu/KOL/backend/src/routers/kol-memory.ts "Current local follow-up API"
[5]: file:///home/ubuntu/KOL/frontend/src/home/workspace/ResultRail.tsx "Common result-rail composition protocol"
