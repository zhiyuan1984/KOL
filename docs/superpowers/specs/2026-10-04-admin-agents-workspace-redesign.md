# 管理端 Agent 工作台（`/admin/agents`）再设计——详细设计（UI/UX + 视觉）

```yaml
version: draft-1
date: 2026-10-04
baseline: main@8d48390（生产同版；行号均按该基线实测）
owner: UI/UX 专家（布局 / 视觉 / 无障碍 / 文案呈现）+ 平台产品经理（管理端 IA 不降级）
status: 待确认（本稿为实施前设计；两处依赖后端裁决，见 §9）
```

> **位阶声明**：本文件是实施设计稿（实施细则层），不属规范正文、不建立法律层级（CONST-09）。与 [`DESIGN.md`](../../DESIGN.md)、[`org-permissions.md`](../../org-permissions.md) 冲突时以上位文件为准；视觉数值一律取 `docs/DESIGN.md` 与 `frontend/src/styles.css` 既有 token，本文件不新造数值 token（页内布局约束值除外，见 §4.6）。

## 审宪记录（CONST-08）

需求「管理端 Agent 界面整体解决方案：含 UI/UX 与视觉的详细设计」→ 主责 UI/UX 专家 + 平台产品经理 → CONST-04 / CONST-07 / CONST-08 / CONST-09 / CONST-10 → 细则：[`DESIGN.md`](../../DESIGN.md)（§1 不变量 1–7、§2 密度、§3 颜色、§4 控件、§5 字阶、§6 布局、§7 弹窗、§8 去重、§9 密度、§11 三轴、§12 深色、§13 验收矩阵）；[`ia-information-architecture.md`](../../ia-information-architecture.md)；[`org-permissions.md`](../../org-permissions.md)（管理端只回答谁 / 权限 / 审计）；[`07-mcp-data-contract.md`](../../07-mcp-data-contract.md)（工具标识与 L1/L2/L3）→ **符合**：全部为呈现层再设计，不改发布 / 覆盖 / 权限 / 审计规则与闸门；两处依赖（技能风险档字段、取消装配的确认等级）标为待决、交对应角色 → 下一步：按 §7 批次实施 + §6 截图验收。

## 0. 一页摘要：问题 → 方案

| # | 现状问题（证据） | 方案（章节） |
|---|---|---|
| 1 | 同屏双实底 CTA（截图 02） | 动作体系 T1/T2/T3；唯一实底＝「新增 Agent」（§3.2） |
| 2 | 状态/版本/覆盖数在详情内多处重复（截图 02） | 信息处置表：详情头＝身份；发布＝检查清单；版本归「维护信息」（§3.4） |
| 3 | 选中态仅底色、与 hover 同 token、未暴露读屏（截图 01） | 选中条＋字重＋`aria-current`（§3.3 / §4.2） |
| 4 | ≤1100 堆叠档列表被筛选挤没（截图 04，0 行可见） | 堆叠档重排：筛选横滑＋列表保底高度（§3.12） |
| 5 | 触摸命中区 <44px（chips 26px、行内按钮 ≈28px） | `pointer: coarse` 补丁覆盖本页（§3.12） |
| 6 | 加载 / 失败 / 筛选无结果三态不分 | 三态规范＋重试入口（§3.9） |
| 7 | 47+ 技能平铺、13 项 SOP 雷同、无风险标识 | 分组折叠＋卡内搜索＋风险标签（§3.5；字段依赖见 §9-2） |
| 8 | 审计工程话术＋裸 ID（截图 03） | 事件中文映射＋复用页面解析器（§3.8） |
| 9 | 字阶塌陷、按钮全是描边盒、零图标、无辅助色 | §4 全套：字阶表 / 文字按钮 / 图标最小集 / 颜色地图 |
| 10 | 「卡片墙」（7 张同款卡） | 主卡＋小节分隔线体系（§3.4 / §4.5） |

## 1. 背景与证据索引

- 现状截图（生产实测 `8d48390`）：[01 1280 列表+详情](../../../artifacts/admin-agents-redesign/01-current-1280-list-detail.png)｜[02 双实底 CTA 与重复信息](../../../artifacts/admin-agents-redesign/02-current-double-solid-cta-and-duplication.png)｜[03 审计与版本](../../../artifacts/admin-agents-redesign/03-current-audit-bottom.png)｜[04 1024 堆叠档](../../../artifacts/admin-agents-redesign/04-current-1024-stacked.png)
- 关键代码（基线实测）：`frontend/src/pages/AdminAgents.tsx`（348 行）、`frontend/src/admin/governance-layout.css`（72 行）；`frontend/src/styles.css` 相关锚点：`.btn.work`（:6484）、`.btn.row-action` 注释（:6319–6321）、token 区（:88–232、:12562–12567）。

## 2. 设计目标与非目标

**目标（全部可截图验收）**：唯一主 CTA 与三级动作体系；同一信息一处表达；列表可扫描、选中可感知（含读屏）；技能区可检索、可折叠、风险可见（依赖 §9-2）；三态诚实；≤1100 堆叠档可用、触摸达标；字阶/颜色/图标建立节奏，消除「单调」。

**非目标**：不改发布 / 覆盖 / 权限 / 审计语义与闸门；不改导航外壳（admin-sidebar-shell-parity 不动）；不引入新库；不新增色值、字号、间距、圆角 token；不做技能批量开关（避免误操作与审计噪声）。

## 3. UI/UX 详细设计

### 3.1 骨架

保持双栏（rail 列表 + main 详情）。详情列从「7 张同款卡片」改为三段结构：**头部（身份）→ 主卡（技能与知识库）→ 小节组（人员范围 / 发布 / 运行与审计 / 维护信息）**。`details/summary` 或 `button[aria-expanded]` 均可，优先原生 `details`（无障碍免费）。

### 3.2 动作体系（治「双实底」，也治「全是描边盒」）

| 层 | 规则 | 分配 |
|---|---|---|
| **T1 实底主 CTA**（`.btn.work`） | 任一时刻视口内**实底 ≤1**（弹窗自身视口除外） | **唯一＝「新增 Agent」**（rail 底常驻）；备选：归属「发布 Agent」，二选一，规则不变（§9-4 关联） |
| **T2 文字按钮**（`.governance-text-action`） | 无边框、`color: var(--accent-text)`、命中高 ≥`--control-h`(28)；hover 8% accent 底；focus 走 `--focus-ring` | 修改名称、预览绑定影响、绑定知识库、取消、关闭 |
| T2-strong（`.is-strong`，600） | 同上＋字重 600 | 发布 Agent、确认绑定 |
| **T3 危险文字按钮**（`.is-danger`） | `color: var(--danger)`；hover 8% danger 底 | 撤销绑定、移除知识库、停用 Agent |
| 弹窗内 | 确认＝实底（此刻视口唯一）；**取消＝文字按钮** | 本页两套弹窗（AdminFormDialog / ConfirmDialog 的调用面）|

```css
/* 新增于 governance-layout.css（页级，不动全局） */
.governance-text-action { border: 0; background: transparent; color: var(--accent-text); padding: var(--space-1) var(--space-2); min-height: var(--control-h); border-radius: var(--radius-control); font: inherit; cursor: pointer; }
.governance-text-action:hover:not(:disabled) { background: color-mix(in srgb, var(--accent) 8%, transparent); }
.governance-text-action.is-strong { font-weight: 600; }
.governance-text-action.is-danger { color: var(--danger); }
.governance-text-action.is-danger:hover:not(:disabled) { background: color-mix(in srgb, var(--danger) 8%, transparent); }
```

确认矩阵（保持并明确）：发布 / 停用 / 撤销绑定 / 移除知识库 → 保留 `useAdminConfirm` 确认（沿用既有影响面文案）。「取消勾选技能」的等级见 §9-1。

### 3.3 列表（rail）

- **行结构（两行）**：第一行＝名称（14/600）＋状态胶囊；第二行＝元信息（helper/12、muted）「N 项技能 · N 人可用」。
- **状态胶囊**：字形＋文字＋色三通道（§3.1 映射）：已发布 ✓ `--success`／草稿 ✎ `--text-quiet`／已停用 ⏻ muted。
- **选中态**：2px `--accent` 左条＋`color-mix(accent 6%, bg)` 底＋名称 600；hover 用 `--surface-hover`（与选中可区分）；补 `aria-current="true"`。
- **测试钩子**：`data-agent-id`、`data-agent-status`。
- 筛选组保持 chips（≤8 项合 §4）；补 hover（accent 边框＋accent-text）。

### 3.4 详情结构：去重与去墙

**信息处置表（同一上下文内每息一处）**：

| 信息 | 现状出现 | 处置 |
|---|---|---|
| 发布状态 | 列表行＋详情头＋发布小节 | 列表行（列表上下文）＋详情头胶囊（身份）；发布小节删除 |
| 版本 `vN` | 详情头＋发布小节＋维护信息 | **维护信息（唯一）**；详情头不再显示 `vN` |
| 覆盖人数 | 列表行＋人员范围＋发布小节 | 列表行＋人员范围；发布小节删除（只留检查清单满足态）|
| 组织版本 | 人员范围正文＋绑定预览 | **只在「人员范围」小节标题尾注**显示一次；正文与预览不再重复 |
| 技能数 | 列表行＋发布小节 | 列表行保留；发布小节删除 |
| 绑定点数 | 发布小节 vs 绑定点列表 | 删除计数（列表即事实；零数据不渲染，§8.2）|

> 说明：列表行 ↔ 详情头属于 master-detail 两个上下文（扫描 vs 身份），判定可保留；同上下文内的重复一律消除。

**结构落位**：头部＝名称＋状态胶囊＋「修改名称」（T2，✎ 图标）；主卡＝技能与知识库；小节＝人员范围 / 发布 / 运行与审计 / 维护信息（原版本卡），小节用「标题＋尾注＋分隔线」不再套盒子。

**发布小节（检查清单化）**：满足态清单「已装配技能 ≥1 ✓/✗」「已绑定组织或人员 ≥1 ✓/✗」，附 helper 保留服务端拒绝口径；单一动作：草稿 → 「发布 Agent」（T2-strong）；已发布 → 「停用 Agent」（T3）。删除原状态/技能/绑定点/覆盖人数/组织版本五行重复。

### 3.5 技能与知识库

- **分组**：已启用（展开）／阶段 SOP（收起，13 项）／其他技能（收起）；组头＝`<summary>` 或 `button[aria-expanded]`＋计数；组头不做批量开关（非目标）。
- **卡内搜索**：技能项 >15 时显示（小搜索框，复用搜索样式）。
- **行**：勾选框 16px＋`accent-color: var(--accent)`；名称 13/600＋说明 12 muted 单行截断（`title` 给全文）；行 hover 全宽淡底；行高触摸 ≥44。
- **风险标签**：行右侧 tag（L1/只读＝quiet、L2/草稿＝warning、L3/敏感＝danger；文字＋形状＋色），**数据依赖见 §9-2**；无字段时本批只做分组与折叠。
- 学习成本提示（既有文案保留）：说明文字降为 helper，不抢层级。
- 「知识库依赖」区保持；「调用技能」下拉加 `optgroup`（同分组）；「绑定知识库」→ T2。

### 3.6 人员范围

保持「选择 → 预览 → 确认」三段式；预览＝T2、确认＝T2-strong（重量由确认动作本身承担）。覆盖名单分组标题带计数（helper），行内「通过 X」用 muted。

### 3.7 发布

见 §3.4 检查清单化；确认弹窗保持（含技能数/绑定点/覆盖人数/组织版本的影响面数据）。

### 3.8 运行与审计

- **事件中文映射**（示例，实施时与后端事件登记对齐）：`admin.agent.created`→创建、`.published`→发布、`.disabled`→停用、`.skill`→技能装配变更、`.knowledge.bind`→知识库绑定；未知事件回落原始值（`title` 保留原文）。
- **payload 解析**：`skill_id`→`skillLabel`、`base_id`→`knowledgeBases`、`target_id`→`unitName/personName`（复用页面既有解析器）；未解析 ID 保留但弱化。
- 行：时间（helper/muted）· 事件 · 操作者 · 摘要（`title` 全文）。
- **一致性检查项**：同一列表不得时区混排（截图 03 存在 14:29 与 04:50 并存的观察，交后端确认口径，§9-5）。

### 3.9 三态规范（加载 / 失败 / 筛选无结果）

- 加载：`aria-busy`＋「正在读取 Agent…」（列表区与审计区同一规范）；
- 失败：`role="alert"` 错误＋「重试」T2 文字按钮（重发 `load()`）；
- 筛选无结果：「没有符合条件的 Agent」＋「清空筛选」T2。
三处文案必须分开（现首帧「0 / 0 ＋ 没有符合条件的」属误报）。

### 3.10 弹窗规范

- AdminFormDialog（「新增 Agent」2 字段）：宽度改 `--dialog-w-sm`(440)＋`--dialog-pad-compact`；标题字阶 `--ds-font-section`(16)/600（§5：弹窗不另起字阶）。
- AdminTextDialog（改名）：沿用 440 系现状。
- ConfirmDialog：宽 440 保持；按钮 `min-height: 40px`（styles.css:6035）与 §4 核对该否对齐 32；取消按钮文字化——**共享组件影响面大，先核使用范围（§9-7），大的话另案**。
- 全部弹窗保留既有焦点锁 / Esc / `aria-modal`。

### 3.11 键盘与读屏

行 `aria-current`；技能组 `aria-expanded`；「N / M 个 Agent」count 加 `aria-live="polite"`；错误 `role=alert`（已有）；重试按钮可达；Tab 顺序＝视觉顺序（rail → main）。

### 3.12 三轴适配

- **≤1100 堆叠档**：rail 改 `minmax(320px, 46%)`；筛选区改**一行横滑**（`overflow-x: auto`，chips 不换行，两组间以分隔线区分）；列表保底 `min-height: 3 行`（自身滚动）；行内四列改两行布局。目标：视口内至少可见 2–3 行 Agent。
- **≤860 触摸**：补 `@media (pointer: coarse)`：`.governance-filter-options button / .governance-text-action / .governance-minor / .governance-list-row / 技能行` → `min-height: 44px`；无横向滚动（长文本 `overflow-wrap`）。
- **高度档 630/589**：rail 保底 260px（保持）；详情滚动不裁切、不遮页脚。
- **深色**：全部走 token；实施后按 §12 / §13 双档验收。

## 4. 视觉详细设计（token 级）

### 4.1 字号 / 字重映射表（before → after）

| 角色 | 现状（基线实测） | 设计 | 备注 |
|---|---|---|---|
| 详情头 h2 | 16/600（`--ds-font-section`） | 保持 | — |
| 卡标题 h3 | 15/600（`--ds-font-ui`） | 保持 | — |
| 小节标题 h4 | 15/600 ↔ 13/600 混用 | **13/600 ＋ `--text-muted`**（`--ds-font-sm`） | 统一 |
| 列表行名称 | 14/600 | 保持（`--ds-font-body`） | — |
| 列表行元信息 | 14/400、同色 | **12 ＋ `--text-muted`**（`--ds-font-helper`）＋可选 `tabular-nums` | 拉开层级 |
| 解释性文案 | 14 正文 | **12 ＋ muted**（helper） | 降噪 |
| 技能行 | 14/400 | 名称 13/600＋说明 12 muted | 47+ 行降噪 |
| 弹窗标题 | 15/600 | **16/600**（`--ds-font-section`，§5） | 对齐 |
| 卡头尾注（新增） | — | 12 muted（helper） | 信息锚点 |

### 4.2 颜色使用地图（只动「职责」，不动色相）

| 元素 | 用色 | 通道 |
|---|---|---|
| 选中条 / 文字按钮 / 可点图标 / hover 底 / 焦点环 | `--accent` / `--accent-text` | 交互（§3 辅助色明文职责）|
| 状态胶囊：已发布 / 草稿 / 已停用 | `--success` / `--text-quiet` / muted ＋字形 | 状态（§3.1）|
| 危险动作（撤销/移除/停用）、敏感技能标签 | `--danger` | 风险 |
| 技能来源分组（P1，待 §9-2） | `--cat-*` | 类别（§3「技能目录按来源分色」）|
| hover 混合底 | `color-mix(… 8%, transparent)` | — |

约束：图形 ≥3:1、文字 ≥4.5:1、深浅双档验证；类别色只是加强信号；不新增色相。

### 4.3 控件尺寸统一

- 规则：**同一动作行等高**——与 select 同排（预览/绑定行）用 `--control-h-form`(32)；rail 内行（搜索 32）旁的动作 ≥28；chips `--chip-h`（对账见 §9-3）；文字按钮视觉可矮，但**命中高 ≥28，触摸 ≥44**。
- 勾选框 16px＋`accent-color: var(--accent)`；行内边距维持 `--space-*`。

### 4.4 图标规范与最小集

口径：24×24 描边、`stroke 1.85`、`currentColor`（与侧栏 `Ico` 同源）；尺寸 `--icon-sm`(14) / `--icon-md`(18)；默认 `--text-muted`，**可点图标用 `--accent`**。

| 位置 | 图标 | 说明 |
|---|---|---|
| 搜索框 | 放大镜（内置） | 复用 skills 页 `.skill-search-wrap` 模式 |
| 状态胶囊 | ✓ / ✎ / ⏻ | 与状态色构成三通道 |
| 文字按钮前缀（仅高频/歧义） | ✎（修改名称）、＋（添加绑定/绑定知识库）、×（撤销/移除） | 14px，随按钮色 |
| 选中项 | 左侧 2px accent 条 | 形状通道 |

路径示例：放大镜 `M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14 M20 20l-3.7-3.7`；＋ `M12 5v14 M5 12h14`；× `M18 6 6 18 M6 6l12 12`。

### 4.5 间距与节奏（去「卡片墙」）

- 只保留主卡 1 张；其余改小节：小节间 `1px --border` 分隔线；小节标题上下 `--space-5/--space-2`；卡头右尾注（helper）。
- 组内行距 `--space-1/2`；列表与卡内不再叠盒子，靠线＋字阶＋颜色建立节奏。

### 4.6 页内布局约束值（非 token 域，随本页样式表维护）

rail `minmax(300px, 36%)`（保持）；堆叠档 `minmax(320px, 46%)`（新）；列表保底 `min-height: 240px / 3 行`；弹窗宽度改走 `--dialog-w-*`。

## 5. 实现落点清单

| 文件 | 变更 |
|---|---|
| `frontend/src/admin/governance-layout.css` | 新增/修改约 18 类：`.governance-text-action(.is-strong/.is-danger)`、`.governance-status(.is-*)`、`.governance-section(.note)`、`.governance-skill-group`、`.governance-checklist`、`.governance-skeleton`、堆叠档与 coarse 块、行两行布局等（全部 token） |
| `frontend/src/pages/AdminAgents.tsx` | 结构＋文案＋aria/data 钩子：唯一实底、文字按钮、状态胶囊、发布检查清单、信息去重、技能分组/搜索/下拉 optgroup、审计映射与 ID 解析、三态、`aria-current`/`aria-live`/`data-*` |
| `frontend/src/components/AdminFormDialog.tsx`（若仅治理页使用，§9-7） | 宽度档 `--dialog-w-sm`＋紧凑内边距；取消按钮文字化 |
| `frontend/src/components/ConfirmDialog.tsx`（共享，另案评估） | 取消按钮文字化与 40→32 对齐，先核使用范围 |
| `frontend/src/styles.css` | 更新 :6319 注释（描边款 → 文字款先例）；`--chip-h` 对账（§9-3） |
| 后端（可选依赖） | adminAgents 响应增技能风险档（§9-2，交后端专家评估） |
| 测试 | `frontend/e2e/workbench.spec.ts` 现有断言不需改（导航计数/标签不动）；新增建议：视口内 `.btn.work` 计数 ≤1、`aria-current` 选中、三态文案 |

## 6. 验收

- **截图清单（9 张）**：1280 默认 / 选中 / hover；发布检查清单（草稿态）；危险确认弹窗；1024 堆叠；860 触摸；深色；200% 缩放；键盘焦点链。
- **§13 映射**：1280×900 一屏 0–1 实底 CTA；1100–1440 右栏无二次分栏；任意档「同一信息只出现一次」；键盘+读屏 Tab 顺序与语义；触摸 ≥44px；浅/深分别验证。
- **对比度必查**：文字按钮 `--accent-text` on bg ≥4.5；状态字形 ≥3；hover 底上文字 ≥4.5；`--primary`×`--danger` 不混淆。

## 7. 实施批次

- **批 1（P0，独立验收）**：动作体系＋唯一实底；信息去重＋发布检查清单；选中态（条＋`aria-current`）；字阶映射表落地。—— 覆盖「单调」的主要观感面（按钮/字阶/选中）。
- **批 2（P1）**：图标最小集；状态胶囊与颜色地图；技能分组折叠＋卡内搜索＋optgroup（风险标签视 §9-2）；审计本地化；三态；堆叠档重排＋触摸补丁。
- **批 3（P2 打磨）**：弹窗宽度档＋紧凑内边距；窄栏两行细节；共享组件提案（ConfirmDialog）；`--chip-h` 对账。

## 8. 风险与边界

- 「文字按钮」为设计语言演进先行方案（本页）：落地后同步 `styles.css:6319` 注释；是否立为全站语言由用户裁定（§9-4）。
- 深色 / 对比度 / 200% 缩放为必测未测项，批内补齐截图。
- 不改业务规则、发布与审计语义；后端字段需求已单列（§9-2）。

## 9. 待决问题（需对应角色裁决）

1. 「取消勾选技能」确认等级：建议升格为轻确认（其后果是覆盖员工立即失去能力，与「移除知识库」对称）——平台产品经理＋后端专家。
2. 技能风险档字段：adminAgents 响应暴露后端推导的 L1/L2/L3（ADR-2026-09-28 已定型推导规则）——后端专家；无字段时批 2 降级只做分组折叠。
3. `--chip-h` 对账：styles.css 现值 `26px` vs DESIGN §4 记 `28px`——UI/UX 裁定后对齐其一。
4. T1 实底归属：「新增 Agent」或「发布 Agent」二选一（本稿推荐前者）；若采纳「文字按钮」为全站语言，同步更新 DESIGN §4——用户/后续。
5. 审计与版本时间时区混排观察（截图 03：14:29 与 04:50 并存）——后端确认存储与展示口径。
6. 确认弹窗按钮 `min-height: 40px`（styles.css:6035）与 §4 对齐核对——随批 3。
7. AdminFormDialog / ConfirmDialog 的页面使用范围核实（决定改动半径）——实施前检查一次 import 面。
