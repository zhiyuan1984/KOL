# KOL-UI 工作台视觉系统

员工端 KOL 会话工作台的**视觉与 token 默认**。日期：2026-09-13。来源：产品负责人批准的默认视觉栈，供后续前端 PR 对齐。

本文件管**密度、组件基底、主色和 CSS 变量**。注意力、信息架构和主路径感觉仍以 `19-ui-ux-constitution.md` 为准；闸门、风险分级、L1–L3、UX ID 和无障碍仍以 `04-ux-ui-system.md` 与 `specs/UX-KOL.md` 为准。本文件**不**安装组件库，也**不**改 `frontend/src/pages/Chat.tsx`。

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

### 1. 视觉密度：Linear 气质

紧凑、可扫视、高信息密度，而不是卡片墙。

- 正文字号约 **13–14px**（UI 控件与卡片正文走这一档；标题另档，不要把工作台做成 16px 长文杂志）。
- 间距收紧：卡片内边距、行距、组间距按 `--space-*` 四级走，禁止为了「透气」把主窗格撑成仪表盘。
- 阴影安静：最多一层极淡投影或只用边框分区；禁止层层叠卡、大圆角毛玻璃。
- 信息靠对齐、字重和 muted 文案分层，不靠再包一张卡。

现行 `frontend/src/styles.css` 里 `--font-body: 16px`、`--font-ui: 14px` 偏松。迁移时把工作台正文/控件收到 13–14px；本 PR 不改 CSS。

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

### 4. 主色：indigo / violet；语义色沿用 04

- **主操作**用 indigo / violet（主按钮、焦点环、链接强调、当前项）。
- **语义职责**继续遵守 `04`：主操作、高风险、成功/已发布、错误。04 写「蓝色表示主操作」时，本文件把该槽位**映射**到 indigo，而不是再发明第五种主色。
- 高风险仍是橙、成功仍是绿、错误仍是红。改这些职责必须先写 `DECISIONS.md`，再改 `04`。

## Token（供日后 `styles.css` 迁移）

以下是目标最小集。文档先行；**本 PR 不改** `frontend/src/styles.css`。实现迁移时用新名，旧名做别名，避免一次改光所有 class。

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

  /* 字号目标（工作台） */
  --font-body: 13px;
  --font-ui: 13px;
  --font-meta: 12px;
  --font-section: 14px;
  --font-title: 18px;
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

迁移期允许 ` --primary: var(--star); ` 再改色值；新代码只读 `--primary` / `--bg` / `--border`。不要并行维护两套互不相认的色名。

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

首页同样适用：不要做成仪表盘卡片蔓延；推荐与芯片只预填，不自动执行。

## 与现行主线的关系

| 文档 | 角色 |
|---|---|
| `19-ui-ux-constitution.md` | 注意力 / Agent 闭环法律 |
| `04-ux-ui-system.md` + `specs/UX-KOL.md` | 可执行 UX ID / 闸门 / 状态 / 无障碍 |
| 本文件（`20`） | 视觉 / token 默认，供 KOL-UI 工作台前端对齐 |

冲突时：注意力与主路径以 `19` 为准；UX ID 与闸门以 `04` + `UX-KOL` 为准；色值与密度以本文件为准。04 的「蓝色主操作」与本文件 indigo 主色的**职责**一致，只换槽位色值。若有人要把主操作改回蓝、或改橙/绿/红的职责，先登记 `DECISIONS.md`。

## 非目标

- 本 PR **不**安装 shadcn/ui、Radix Themes 或 Vercel AI Elements。
- 本 PR **不**重设计 `Chat.tsx`（会话 Agent 闭环已在 PR #15；后续视觉落地另开实现 PR）。
- 本文件 **不**废止 `04` 的语义色职责，也不新增 UX ID。
- 不为视觉层再写一套调度器、状态机或 Host 旁路。
- 不把「建议 / 预填」升级成自动执行。

## 落地顺序

1. 新员工端 PR 先过 `19` 五问，再按本文件选组件、字号、色和滚动。
2. 可执行验收仍走 `specs/UX-KOL.md` 与 `specs/ux-traceability.json`。
3. 改 `styles.css` 变量名或把 `--star` 换成 `--primary` indigo 时，只做 token 迁移，不夹带 Chat 重设计。
4. 安装 shadcn 或 AI Elements 必须单独开 PR，并证明没有引入第二套主题（尤其禁止 Radix Themes）。
5. 冲突写入 `DECISIONS.md`，不要在前端分支里另立色盘或密度规范。
