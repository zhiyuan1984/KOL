# KOL-UI 工作台视觉系统（历史归档）

> **历史与迁移文档：** 现行视觉和组件入口为 `design-system/kol-workbench/MASTER.md`。本文件保留原方案、迁移映射与决策背景，只有追溯这些细节时才读取。

员工端 KOL 会话工作台的**视觉与 token 默认**。日期：2026-09-13；2026-09-14 修订：产品确认工作台**全局正文基线 16px**、控件/helper/Tab **≥14px**，禁止用 `scale` / `zoom` 假装字号（ADR-020）；本实现 PR 按用户指定档落地 CSS（section / title / page-title 可高于 ADR 下限）。来源：产品负责人批准的默认视觉栈，供后续前端 PR 对齐。

本文件记录原有**密度、组件基底、主色和 CSS 变量**方案；新改动先遵循 `CONSTITUTION.md`、MASTER、当前页面规范和对应 FS/UX。

## 法律层（禁止重定义）

以下三份是体验法律，本文件只负责「看起来怎么长」，不得另写一套注意力规则或 UX ID：

| 文档 | 本文件不得改写的内容 |
|---|---|
| `19-ui-ux-constitution.md` | 核心闭环五问、Agent 表面、一条主线程、禁止教练「下一步」、发送 ≠ 推进阶段、禁止嵌套滚动、结果优于说明书 |
| `04-ux-ui-system.md` | 双端边界、任务驱动、状态可见、L1–L3、语义色职责、无障碍 |
| `specs/UX-KOL.md` | 可执行 UX ID、Given/When/Then、与 FS / 红线 / E2E 的绑定 |

评审视觉 PR 时先过宪法五问，再核对本文件的密度、token 和 Do / Don't。任一法律层失败，该改动违约，不论是否「更好看」。

## 锁定的默认栈

产品负责人已批准以下默认。KOL-UI 工作台的前端 PR 按此实现，不要各开一套。

### 1. 视觉密度：Linear 气质，字号可读性优先

紧凑、可扫视、高信息密度，而不是卡片墙。密度靠**紧间距、安静阴影、少装饰**实现，**不得**靠缩小正文字号。Linear 默认仍在（安静阴影、高信息密度、低装饰），但**字号优先可读性**，废除旧「13–14px 紧凑正文」目标。见 ADR-020。

- **正文 / 主阅读：16px**（`--font-body`）。约比旧 13–14px 目标大 15–20%。卡片正文、线程、结果说明走这一档；不要把工作台压回 13px。
- **UI 控件、按钮、Tab：16px**（`--font-ui` → `--font-body`），与正文同档，chrome 不再停在 14px。**helper / 次要说明：≥14px**（`--font-sm` / `--font-meta: 14px`）。禁止 12px 辅助字。`--font-table` 仍别名 `--font-sm`。
- 标题另档、更大：`--font-section` **18px**、`--font-title` **24px**、`--font-page-title` **28px**（高于 ADR-020 下限 16 / 18，以用户指定档为准）。不要用标题 token 冒充正文。
- 间距收紧：卡片内边距、行距、组间距按 `--space-*` 五级走，禁止为了「透气」把主窗格撑成仪表盘。**收紧间距 ≠ 缩小正文到 16px 以下。** 字号变大后控件跟着长高（点击热区 ≥36–40px）。
- 阴影安静：最多一层 `--shadow-quiet` 或只用边框分区；禁止层层叠卡、大圆角毛玻璃。
- 信息靠对齐、字重和 muted 文案分层，不靠再包一张卡。

#### 字号 token（工作台，已落地）

| Token | 值 | 用途 |
|---|---|---|
| `--font-xs` | 13px | 仅非 UI/meta 的最小档；**不得**给按钮 / Tab / helper / `--font-meta` |
| `--font-sm` | **14px** | 密集 chrome / helper 下限；`--font-table` / `--font-meta` 别名 |
| `--font-body` | **16px** | 正文 / 主阅读：线程、卡片正文、结果说明；`html` / `body` 默认；`--font-ui` 别名 |
| `--font-section` | **18px** | 小节 / 卡片标题（≥ ADR 下限 16） |
| `--font-title` | **24px** | 页内标题（≥ ADR 下限 18） |
| `--font-page-title` | **28px** | 页面主标题；`--font-hero` 别名 |
| `--leading-body` | 1.55 | 正文行距；`--leading-ui` 别名 |
| `--leading-tight` | 1.35 | 标题紧行距；`--leading-hero` 别名 |

#### 禁止用缩放假装字号

**禁止**用 CSS `transform: scale(...)`、`zoom`、缩小容器再拉伸，或同类视觉缩放，当作 `font-size` 替代。真实计算字号必须达到上表；缩放到「看起来像 16px」不算合规。Logo / 头像 / 图标不要跟着字号放大，只允许对齐微调。

现行 `frontend/src/styles.css` `:root` 已落地本表。新代码只读这些 token，禁止再写死 `11px`–`13px` 字号。

### 2. 组件基底：shadcn/ui 模式 + Tailwind CSS 变量

- 组件形态跟 shadcn/ui（Button / Input / Dialog / Card / Badge / Separator 等）：**拷入仓库**的无样式/低样式件，用 CSS 变量上色。
- Token 走 Tailwind 可消费的 CSS 变量，而不是再引入第二套 styled 系统。
- **禁止**同时使用 Radix Themes 与 shadcn token。需要 Radix 行为时，只用无头 Primitive（或 shadcn 已封装的那一层），主题仍用本文件变量。
- 现有页面可以继续用仓库内 class；新件优先「shadcn 结构 + 本文件变量」，不要平行再写一套 BEM 色盘。

本文件批准的是**模式与 token 约定**，不是「本 PR 必须 `npx shadcn@latest init`」。

### 3. Agent 表面：Vercel AI Elements 交互形

会话主路径按 AI Elements 的交互形来，即使尚未安装 `@ai-elements/*`：

| 形 | 工作台落点 | 必须像什么 |
|---|---|---|
| Conversation | 主窗格消息流（`session-stream` 一类） | 一条可滚线程，人话与结果按时间排 |
| Message | 用户句 / Agent 句 / 系统提示 | 角色可辨，但不靠大聊天气泡墙抢密度 |
| PromptInput | 底部 Composer | 输入、附件、发送粘在线程脚下；缺口补全走输入，不另起教练卡 |
| 结果卡 | `task_result`、草稿、确认/拒绝、发送卡、阶段卡 | 结构化结果是一等消息，不是侧栏说明书 |

后续若安装 AI Elements，只允许它实现上述形，不允许它改写宪法里的注意力法律。

#### PromptInput / Composer 视觉默认

作用域只在 `.composer` / `.composer-dock` / `.home-composer-dock` / `.session-composer`。**不**改全局 `--primary`。Linear 密度：字号不超过本表，靠间距而不是放大 chrome。

Home workspace 与 session Chat 共用同一套 token；Chat 可以略紧，但壳、边、半径和工具栏必须同一视觉语言。Composer 固定在线程脚，不另起教练卡。

| Token / 表面 | 值 |
|---|---|
| `--composer-bg` | `#FFFFFF` |
| `--composer-border` | `#C2D1FF` · 1px |
| `--composer-radius` | `25px` |
| `--composer-accent` | `#3568FF`（激活工具、可发送箭头、链接） |
| 选中 / 工具芯片 | `98×32` · radius `12px` · bg `#F3F6FF` |
| placeholder | `16px` / `24px` · `#A6A6A6` |
| 工具栏字 | `14px` / `20px` · `#000000` |
| 空闲发送箭头 | `#CCCCCC` |
| 组分隔 | `1×16` · `#E5E5E5` |
| 圆形侧钮（加号 / 停止） | `36×36` · `#F5F5F5` |
| 壳宽 | 跟随 rail / dock `width: 100%`；min-height `~100px`。不要为了居中加 `max-width: 875px` 打断 Home 满轨 |
| 焦点环 | 浅 `--composer-accent`，禁止厚 indigo 光晕 |

### 4. 主色：indigo / violet；语义色沿用 04

- **主操作**用 indigo / violet（主按钮、焦点环、链接强调、当前项）。
- **语义职责**继续遵守 `04`：主操作、高风险、成功/已发布、错误。04 写「蓝色表示主操作」时，本文件把该槽位**映射**到 indigo，而不是再发明第五种主色。
- 高风险仍是橙、成功仍是绿、错误仍是红。改这些职责必须先写 `DECISIONS.md`，再改 `04`。

## Token（`styles.css` 已落地）

以下是现行最小集。色名旧别名继续有效；字号旧名映射进可读性优先的新档，不要再写一套平行尺。

### 目标变量

```css
:root {
  /* 画布 */
  --bg: #ffffff;
  --bg-elevated: #f6f7f8;
  --border: #e5e6e8;
  --text: #1a1a1a;
  --text-muted: #6b7280;

  /* 语义：主操作 = indigo；其余沿用现行 04 色值 */
  --primary: #4f46e5;          /* indigo-600 */
  --primary-fg: #ffffff;
  --danger: #c43c3c;
  --success: #2f7d73;
  --warning: #ea5504;          /* 高风险 / 待确认 */

  /* 形状与密度 */
  --radius-sm: 6px;
  --radius-md: 10px;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --shadow-quiet: 0 1px 2px rgba(15, 23, 42, 0.06);

  /* 字号（ADR-020 + 用户指定档） */
  --font-xs: 13px;
  --font-sm: 14px;
  --font-body: 16px;
  --font-section: 18px;
  --font-title: 24px;
  --font-page-title: 28px;
  --leading-body: 1.55;
  --leading-tight: 1.35;
}
```

暗色对应（与现行 dark 画布对齐，主色改亮 indigo）：

```css
:root[data-theme="dark"] {
  --bg: #17191d;
  --bg-elevated: #101216;
  --border: #30343b;
  --text: #f1f3f5;
  --text-muted: #a2a8b2;
  --primary: #818cf8;          /* indigo-400 */
  --primary-fg: #111827;
}
```

`--chrome-2` 这类「再抬一层」可继续用，映射为比 `--bg-elevated` 略深/略亮的分区底，不单独立法。

### 现行变量 → 目标变量

| 现行 `frontend/src/styles.css` | 目标 | 语义 |
|---|---|---|
| `--canvas` | `--bg` | 主画布 |
| `--chrome` | `--bg-elevated` | 抬升面 / 侧栏 / chrome |
| `--line` | `--border` | 分割线 |
| `--text` | `--text` | 主文案 |
| `--muted` | `--text-muted` | 次要文案 |
| `--star` `#0d3d82` / 暗色 `#78aaf2` | `--primary` `#4f46e5` / `#818cf8` | 主操作（蓝 → indigo） |
| `--orange` | `--warning` | 高风险 |
| `--ok` | `--success` | 成功 / 已发布 |
| `--red` | `--danger` | 错误 |

色名迁移期允许 `--primary: var(--star)` 再改色值；新代码只读 `--primary` / `--bg` / `--border`。不要并行维护两套互不相认的色名。

### 旧字号变量 → 可读性优先

| 旧名（紧凑档） | 旧值 | 新名 | 新值 | 用法 |
|---|---|---|---|---|
| `--font-meta` | 12px | `--font-sm`（`--font-meta` 别名） | **14px** | helper / 时间戳 / 次要说明（ADR-020 下限 14） |
| `--font-table` | 13px | `--font-sm`（`--font-table` 别名） | **14px** | 密集表格 |
| `--font-ui` | 13px | `--font-body`（`--font-ui` 别名） | **16px** | 按钮、页签、导航，与正文同档 |
| `--font-body` | 13px | `--font-body` | **16px** | 正文基线；`html` / `body` 默认 |
| `--font-section` | 14px | `--font-section` | **18px** | 小节 / 卡片标题 |
| `--font-title` | 18px | `--font-title` | **24px** | 页内标题 |
| `--font-hero` | 28px | `--font-page-title`（`--font-hero` 别名） | **28px** | 页面主标题 |
| `--leading-hero` / `--leading-ui` | 1.3 / 1.5 | `--leading-tight` / `--leading-body` | 1.35 / 1.55 | 标题紧行距 / 正文行距 |

禁止用 `transform: scale` 或浏览器缩放代替改 token。Logo / 头像 / 图标不要跟着字号放大，只允许对齐微调。控件热区 ≥36–40px；芯片、按钮、页签随字号长高。

### 密度与滚动（视觉层复述法律，不另立）

这些与 `19` 同级，写在这里是为了前端实现时不用猜数值：

- **主窗格一条纵向滚动**。线程 + 结果走同一个 `session-stream` 类容器；Composer 固定在底部，不自己再开一条主滚。
- **任务卡 / KOL 卡禁止横向滚动**。宽内容换行或截断加 title，不要出现卡片内 H-scroll。
- **次要面板默认折叠**（SOP、Trace、调试、完整邮件原文、右侧非当前产物）。展开是显式动作。
- 横向滚动只留给真正的宽表或显式调试条，不能出现在员工主路径卡片上。
- 阴影用 `--shadow-quiet` 或不用；禁止为分区再套滚动盒。

## 工作台 Do / Don't

| Do | Don't |
|---|---|
| 线程是脊柱：人话、计划推进、结果卡按时间排 | 把 SOP、状态板、模式页签做成第二套操作系统 |
| Journey / 身份 / 邮箱 / 阶段是紧凑 chrome，可扫视 | 阶段漏斗写成第二主栏小说 |
| 每张业务卡一个主操作（发送、确认阶段、打开会话……） | 一张卡上堆三个同等按钮抢点击 |
| 往来邮件用短摘要；全文进折叠或侧览 | 把历史信全文当作主阅读物 |
| Agent 直接做，或给出可改草稿 / 结果 | 教练式「下一步：写合作邮件 →」卡片 |
| 等待态写清已接收、阶段、更新时间、已有产物 | 无状态 spinner，或把 `waiting` 既当排队又当待确认 |
| 员工端业务语言 | MCP / Codex / Thread / Skill / 原始堆栈等引擎行话 |
| 正文 16px、控件/Tab/helper ≥14px；密度靠间距与阴影 | 13–14px 正文；`transform: scale` / `zoom` / 缩盒再拉伸假装字号 |

首页同样适用：不要做成仪表盘卡片蔓延；推荐与芯片只预填，不自动执行。

## 与现行主线的关系

| 文档 | 角色 |
|---|---|
| `19-ui-ux-constitution.md` | 注意力 / Agent 闭环法律 |
| `04-ux-ui-system.md` + `specs/UX-KOL.md` | 可执行 UX ID / 闸门 / 状态 / 无障碍 |
| 本文件（`20`） | 视觉 / token 默认，供 KOL-UI 工作台前端对齐 |
| `21-admin-employee-page-roles.md` | 管理端 IA（治理表，不是第二套 Home/Agents）；token 仍用本文件 |

冲突时：注意力与主路径以 `19` 为准；UX ID 与闸门以 `04` + `UX-KOL` 为准；色值、字号与密度以本文件为准（字号可读性优先，见 ADR-020；用户指定档可高于 ADR 下限）。04 的「蓝色主操作」与本文件 indigo 主色的**职责**一致，只换槽位色值。若有人要把主操作改回蓝、或改橙/绿/红的职责，或把正文压回 13–14px，先登记 `DECISIONS.md`。

## 非目标

- 本实现 **不**安装 shadcn/ui、Radix Themes 或 Vercel AI Elements。
- 本实现 **不**重设计 `Chat.tsx`（会话 Agent 闭环已在 PR #15）。
- 本文件 **不**废止 `04` 的语义色职责，也不新增 UX ID。
- 不为视觉层再写一套调度器、状态机或 Host 旁路。
- 不把「建议 / 预填」升级成自动执行。
- 不削弱核心闭环、四页法律、Home 四模式、并列能力面、专家中心法律。
- 不夹带 Discovery 筛选芯片重做。

## 落地顺序

1. 新员工端 PR 先过 `19` 五问，再按本文件选组件、字号、色和滚动。
2. 可执行验收仍走 `specs/UX-KOL.md` 与 `specs/ux-traceability.json`。
3. 改 `styles.css` 色名或字号 token 时，只做 token 迁移，不夹带 Chat 重设计、也不夹带 Discovery 筛选芯片重做，也不用 scale 过渡。
4. 安装 shadcn 或 AI Elements 必须单独开 PR，并证明没有引入第二套主题（尤其禁止 Radix Themes）。
5. 冲突写入 `DECISIONS.md`，不要在前端分支里另立色盘、字号或密度规范。
