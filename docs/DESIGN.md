---
version: alpha
name: employee-design-spec
style-baseline: data-dense-dashboard
description: 员工端视觉与设备适配实施细则。风格基准为 data-dense-dashboard（密集数据工作台），只约束员工端全部工作台表面（Home 五模式、Pipeline、Admin、一等能力面）。
---

# 员工端实施细则（密度 · 控件 · 三轴适配 · 不变量 · 验收矩阵）

> 依据 [CONSTITUTION.md](CONSTITUTION.md) 的 CONST-09 重建记录（2026-09-21）：本文件是员工端
> **唯一**的视觉 token 与设备适配数值来源，含颜色、字号阶梯、控件尺寸、密度档、三轴适配与
> 验收矩阵。
>
> 实现落点：`frontend/src/styles.css` 的 `:root`（间距 / 字号 / 圆角 / 控件高度 / 层级）、
> `frontend/src/composer.css`（提问框外壳几何，以及提问框内的两处浮层：+ 菜单行与档位面板）、**组件级样式表**（`frontend/src/home/today-plan-board.css`、
> `today-plan-progress.css`、`discovery-workspace.css`、`today-display-row.css`、`today-rec-row.css`、
> `edit-task-dialog.css`）与**组件内联样式**
> （例如 `frontend/src/pages/SkillLifecycle.tsx`）。落到哪一份都按本文件取值；不一致时先核对本文件
> （根 `AGENTS.md` §3）。落点清单不全会一处改、一处漏 —— 2026-09-22 的颜色职责迁移首轮就漏了上面这四份，
> 别再从「只有两份」的假设出发。

## 密度档

| 档 | 用于 | 节奏 |
|---|---|---|
| `data-dense-dashboard` | 员工端全部工作台表面：Home 五模式、Pipeline、Admin、一等能力面 | 紧凑。一屏之内回答本面唯一的那个问题；列表行本身就是内容，不做卡片墙 |

## 颜色

颜色只承担四种职责，**不得互相串用**。职责与 token 的对应由本表决定；数值只住
`frontend/src/styles.css`（`--primary*` / `--accent*` / `--cat-*` 的定义处），本文件不写 hex（根 `AGENTS.md` §3）。

| 职责 | 用哪个 token | 用在哪 |
|---|---|---|
| 主行动 | `--primary` / `--primary-hover` / `--primary-fg` | **同一视口唯一的实底主 CTA**。粉色除此之外不再使用 |
| 辅助 | `--accent` / `--accent-text` / `--accent-hover` | 选中态（分段选中、列表选中）、图标砖与图标字形、行内可点强调、信息性标记 |
| 类别 | `--cat-*` / `--cat-*-text` | 按类别分组的目录面里，图标砖的淡底 / 描边与砖内字形（2026-09-23 增补，UI/UX 专家裁定；首例：技能目录的图标砖按技能来源分色） |
| 状态 | `--warning` / `--danger` / `--success` | 风险与 L3「需确认」、失败、成功。只表达状态，不承担品牌或辅助 |

- **类别色不承担交互与状态**：选中与可点强调仍走 `--accent`；风险、L3「需确认」、成功失败仍走状态色；
  类别色也不得与品牌粉同形使用。
- **类别只是加强信号**：不得成为唯一信号 —— 名称、分组与详情列口径必须仍能独立判读。
- 每个类别色同样分两档：图形 / 描边 ≥3:1、砖内字形 ≥4.5:1，浅色与深色两套分别验证（与下条同源）。

- **「选中」不等于「主行动」**：选中态用辅助色 + 形状 / 字重 / 下划线信号表达，不得靠一个实底按钮。
- 对比度（WCAG 2.2 AA，与 §不变量 4 同源）：文字与可点标签 ≥4.5:1；纯图形（图标、描边）≥3:1；
  实底上的字 ≥4.5:1。因此辅助色分两档：`--accent` 供图形与描边，`--accent-text` 供文字与图标字形。
- 语义色只表达状态：不得用 `--warning` / `--danger` 代替品牌色或辅助色，也不得只靠颜色表达状态
  （§不变量 4：形状、字重、下划线、文案至少一条同时变化）。

## 控件尺寸

- 控件高度、圆角、命中区走实现里的命名 token：`--control-h*`、`--radius-control`、
  `--radius-card`、`--chip-h`、`--home-chip-w` / `--home-chip-h` / `--home-chip-gap`、
  `--badge-h`。**不在法条与页面里写具体数值**（根 `AGENTS.md` §3）。
- 工作台按钮、搜索框和筛选项采用紧凑高度、小圆角；胶囊形只用于明确的身份/状态语义，不能作为通用按钮造型。
- 同组控件保持等高、等宽和统一对齐；输入、按钮、筛选项等不同控件类型可使用不同宽度。触摸模态只扩大命中区，不同步放大视觉控件。
- 触摸输入下命中区 ≥44px；视觉图标小于命中区时用内边距撑开，不改布局边界。
- 焦点态统一用 `--focus-ring` + `--focus-ring-width/offset`；`focus-visible` 才出现。

| token | 值 | 工作台用途 |
|---|---:|---|
| `--control-h-lg` | `32px` | 搜索框与同排计划按钮 |
| `--home-chip-w` / `--home-chip-h` / `--home-chip-gap` | `88px` / `28px` / `4px` | 快捷任务与任务筛选；触摸模态只把高度命中区扩至 `44px` |
| `--home-mode-tab-gap` | `2px` | 五个工作模式入口的间距；按可用宽度分列换行，同行等宽、等高，不设置中栏最小宽度 |
| `--workspace-task-priority-col` / `--workspace-task-actions-col` | `64px` / `124px` | 任务结果表优先级列 / 操作列 |
| `--workspace-task-action-h` | `20px` | 任务行操作按钮与状态标签同高；触摸模态操作按钮命中区扩至 `44px` |
| `--radius-control` / `--radius-card` | `6px` / `8px` | 输入与普通控件 / 内容容器 |
| `--ds-radius-section` / `--ds-radius-input` / `--ds-radius-chip` / `--ds-radius-tag` | `8px` / `6px` / `6px` / `6px` | 工作台分区、输入、chip 与普通状态标签 |

### 连接器控制台（对话框与表单字段）

依据：连接器「MCP 配置」参考图逐像素测量（图像 818×974；**1 图像 px = 1 CSS px，不做设备像素比换算**，
测量记录见 `superpowers/specs/2026-09-26-connector-admin-console-redesign.md`）。
本节数值是该弹窗的**唯一来源**，实现落在 `frontend/src/styles.css` 的 `:root`
与 `frontend/src/admin/connector/connectorAdmin.css`；改数值必须先改本表。

| token | 值 | 用途（连接器对话框与字段） |
|---|---:|---|
| `--dialog-w-form` | `800px` | 表单弹窗宽度（`ModalShell form`），桌面端上限；窄屏用 `100vw - 32px` |
| `--dialog-pad-x` / `--dialog-pad-t` / `--dialog-pad-b` | `28px` / `30px` / `40px` | 卡片左右 / 上 / 下内边距 |
| `--dialog-head-gap` / `--line-dialog-title` | `22px` / `32px` | 标题块到第一个字段 / 弹窗标题行高 |
| `--radius-dialog` | `20px` | 弹窗卡片圆角（参考图 16px 不是标准值，按实测取 20px） |
| `--control-h-form` | `48px` | 输入框、下拉、headers 行、按钮统一高度 |
| `--radius-field-form` / `--radius-btn-form` / `--radius-icon-box` | `8px` / `10px` / `10px` | 输入与下拉 / 按钮 / 图标虚线框圆角 |
| `--note-h-form` | `134px` | 备注文本域高度 |
| `--field-gap` / `--block-gap` / `--grid-gap` / `--row-gap` | `16px` / `26px` / `26px` / `12px` | 标签↔控件 / 字段块之间 / 两列之间 / headers 行之间 |
| `--icon-box` | `80px` | 图标位（1px 虚线框） |
| `--font-dialog-title` / `--font-field` / `--font-hint` | `24px` / `20px` / `16px` | 弹窗标题 / 字段标签与输入文本 / 说明与占位文案 |
| `--fill-control` / `--fill-card` | `#ececeb` / `#f8f8f7` | 控件填充（无描边）/ 弹窗卡片底色 |
| `--border-quiet` / `--border-dashed` | `#dadad9` / `#e5e5e4` | 描边按钮 / 图标虚线框 |
| `--hint-text` / `--placeholder-text` | `#737373` / `#a6a6a6` | 说明文字 / 占位文字 |
| `--danger-soft` | `#ee5b5e` | 删除图标（headers 行） |
| `--action-strong` / `--action-strong-fg` | `#1a1a19` / `#ffffff` | 弹窗主行动实底与字色 |

- 输入与下拉**不使用描边**，只用填充 + 圆角；焦点态回到 `--control-border-hover` 描边。
  `.connector-panel.is-form` 在自身作用域内把 `--radius-control` / `--radius-card` / `--radius-cards`
  指向本节实测值，弹窗内不需要逐条改写通用规则。
- 说明文字可点区域仍须满足命中区要求（§控件尺寸）；虚线图标框只表达「可上传」，不是按钮。
- 主行动在浅色取参考图的近黑 `--action-strong`；深色下回落品牌主色（近黑在深底上对比度不足），
  该例外已在本表登记，不得扩散到连接器控制台之外的表面。
- 弹窗内主行动仍受「同一视口 0–1 个实底主 CTA」约束：底部只有「保存草稿 ｜⌄」一个实底。
- 本节字号档位（24 / 20 / 16）**只用于连接器控制台**；工作台表面仍按 §字号阶梯用途 取档。

## 字号阶梯用途（工作台表面）

档位数值只住 `frontend/src/styles.css` 的 `--ds-font-*` token；组件 CSS 不得硬编码 px 字号。
哪个角色用哪一档由本表决定（2026-09-23 增补，UI/UX 专家裁定；执法清单见
`superpowers/specs/2026-09-23-skill-routing-param-memory-design.md` §11）：

| 角色 | 用哪一档 | 禁止 |
|---|---|---|
| 页面 / 上下文标题（中栏 header、对象交互区 h1） | `--ds-font-section` | `--ds-font-title`、`--text-display` 进工作台表面 |
| 块标题（条件卡头、过程流标题、右栏分段头） | `--ds-font-ui` / `--ds-font-body`，字重 ≤600 | ≥20px/600 的 hero 卡头 + 营销副标题双行叙事 |
| 内容（列表行、正文、结果字段） | `--ds-font-body` / `--ds-font-sm` | 硬编码 px 字号 |
| 元信息（时间、来源、计数、提示） | `--ds-font-helper` / `--ds-font-tag` | 最小档用于可点标签（可点标签字号下限见界面细则） |

## 内容密度（空态 · 过程流 · 结果行）

- **空态紧凑**：左对齐、内容字号、`--space-3` 级内边距、动作内联；禁止居中大标题 + 大内边距的
  hero 空态。空态文案必须诚实区分「尚无结果 / 服务不可用 / 筛选无结果」，保留 role 语义与双入口
  （填参数跑一次 / 交给 Agent）。
- **过程流与推理块不越界**：推理摘要（run.think）按渐进折叠呈现——只展开最新一段，被折叠的段数与
  截断必须诚实标记；文本用 pre-wrap + overflow-wrap 防越界；需要全文阅读时走内部滚动或管理员
  Trace，不得被 `overflow: hidden` 静默裁切（不变量 5）。
- **右栏列表行即内容**：行 grid `min-width: 0`、工具栏可换行、次要字段进行内展开层或详情抽屉；
  禁止整栏 `overflow-x: hidden` 兜底与整栏横向滚动。

## 三轴适配

宽度、高度、输入模态**分别**处理。禁止 UA 嗅探，禁止把三轴合成设备名（如「手机」「平板」）。

| 轴 | 要求 |
|---|---|
| 宽度 | `min-width` 断点收缩；桌面导航轨道锁 260px；内容列上限走 `--content-max` |
| 高度 | **页脚控件必须给内容让路**：视口高度不足时，提问框这类固定地板高度按 `dvh` 收缩，不得把主要内容挤到只剩半张卡 |
| 输入模态 | 键盘 / 指针 / 触摸分别可用：可见焦点环、≥44px 命中区、关键动作不依赖 hover 才出现 |

### Home Agent 工作台几何

Home 五模式共用一套「中栏人机协作 + 右栏结果与下一步」几何。右栏承载主要结果，应有足够宽度阅读结果字段、历史记录和下一步动作；不同宽度下可以宽于中栏，布局不预设中栏必须更宽。右栏不得造成工作区整体横向溢出。

| token / 断点 | 数值 | 用途 |
|---|---:|---|
| `--workspace-result-rail-min` | `360px` | 双栏成立时右栏最小宽度 |
| `--workspace-result-rail-ideal` | `54%` | 结果优先视口下右栏目标宽度 |
| `--workspace-result-rail-max` | `820px` | 防止宽视口右栏无限扩张 |
| `--workspace-result-rail-collapsed` | `56px` | 右栏折叠轨道 |
| 工作台堆叠断点 | `1100px` | 该宽度及以下改为中栏在上、结果栏在下；不使用 UA 嗅探 |

- 双栏宽度按结果可读性分配；1280px 附近右栏优先获得更多宽度。列表字段放不下时收进展开层或详情，不允许依赖整栏横向滚动。
- `≤ 860px` 时继续服从员工端抽屉导航和触摸命中区规则；结果栏作为下层结果区呈现。
- 中栏时间线与右栏结果体各自滚动；页面外层不得再形成第三条业务滚动轴。

## 不变量

1. 同一视口最多一个实底主 CTA；其余动作降低强调。
2. L1 只读直接执行；L2 草稿必须标注；L3 外发、导入、删除、解密、正式写入执行前必须确认并留回执。
3. 真实等待必须有原因、状态与恢复入口；不得伪造完成、联系人、结果或进度。
4. 状态不能只靠颜色表达（WCAG 2.2 AA）：形状、字重、下划线、文案至少有一条同时变化。
5. 页脚与浮层不得吃掉它服务的内容：固定高度的页脚控件在矮视口必须让步，绝不允许溢出被
   `overflow: hidden` 静默裁切。

## 验收矩阵

| 宽度档 | 高度档 | 输入模态 | 必查 |
|---|---|---|---|
| 1280 / 1440 / 1680 | 900 | 指针 | 一屏 0–1 实底 CTA；内容不被页脚裁切 |
| 1280 / 1440 / 1680 | 785 / 700 | 指针 | 列表至少一张**完整**对象卡 |
| 1260 / 1024 | 630 / 589 | 指针 + 键盘 | 页脚控件完整可见可点；Tab 到页脚不被遮挡 |
| ≤ 860 | 任意 | 触摸 | 抽屉导航；命中区 ≥44px；无横向滚动 |

单页级差异由该页实现自行决定，不另立法。
