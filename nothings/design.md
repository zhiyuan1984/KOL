# UI 设计系统入口

> **文档类 I（视觉入口）。用户锁定路径：`docs/design.md`。**
>
> 本文件是 UI 设计与前端实现的**唯一视觉入口**。它不保存色值。
>
> **Token 源**仍是 [`design-system/kol-workbench/MASTER.md`](design-system/kol-workbench/MASTER.md)（KOL 试点皮肤目录名，不是产品身份）。单页布局与状态在 [`design-system/kol-workbench/pages/`](design-system/kol-workbench/pages/)。
>
> **默认观感**是 OpenAI-quiet（安静白底、低饱和、发丝级阴影、排版克制）。mood/spec 来源是 [`references/openai-style.md`](references/openai-style.md)。**token 数值仍只住 MASTER**。MASTER 与 OpenAI 在安静白底 / 发丝边 / 胶囊 / 排版 / 阴影上冲突时，**OpenAI 胜**（ADR-031）；胜出后必须和解 MASTER。~~填充主按钮：OpenAI 黑色 / Obsidian 实底。~~ **修订（ADR-031 / 2026-09-16）：** 填充主 CTA 法律目标是产品粉红实底 + 白字（token 名 `--primary` / `--primary-fg`；hex 只住 MASTER），不是 Obsidian 黑。`styles.css` 的旧黑 / 旧蓝是实现滞后，不是胜出法。这不是 Linear-first 品牌。员工表面是助理优先（ADR-032）：Home 跟进面可以是会话脊柱 + 对象卡，不是 ERP 列表。
>
> **禁止**在本文件写入或复制十六进制色值、业务规则、阶段图、权限模型。冲突时：安全 / 权限 / 数据 → FS / Policy；页面职责 / IA / L1–L3 / SEND≠STAGE → [`CONSTITUTION.md`](CONSTITUTION.md) §4 与 [`ia-information-architecture.md`](ia-information-architecture.md)（高于审美工具）；mood 冲突 → OpenAI 胜再和解 MASTER；主填充 → 产品粉红（MASTER）。
>
> 历史「每次先读一份 `design.md` 并内嵌色值」的提示词已废止（见 [`references/legacy-design-summary-prompt.md`](references/legacy-design-summary-prompt.md)）。锁定的是**本路径作为入口**，不是把 MASTER 再抄一遍。

## 1. 怎么用

```text
CONSTITUTION.md §4（表面职责；L1–L3 / SEND≠STAGE 高于审美）
→ ia-information-architecture.md（若问题是导航 / 一页一问 / 使用≠治理）
→ UX-EMPLOYEE 硬不变量（SEND_NE_STAGE、L3_CONFIRM）
→ ui-ux-pro-max（外观 UIUX 必经分析 / 对照；OpenAI 对齐）
→ docs/design.md          ← 你在这里（入口，不读、不写色值）
→ design-system/kol-workbench/MASTER.md（token 源；与 OpenAI 冲突须和解）
→ design-system/kol-workbench/pages/<当前页面>.md
→ references/openai-style.md（OpenAI mood/spec；quiet/white/hairline/capsule 冲突时胜出；黑钮不是产品 CTA 法）
```

强制视觉链（headline）：**CONSTITUTION → ui-ux-pro-max → design.md → MASTER**。

1. 先用本文件确认：**改视觉读哪份、禁止写什么**。默认观感走 OpenAI-quiet。`ui-ux-pro-max` 是外观 UIUX 的必经分析步，不是「仅针对未解决问题」的末端对照。
2. 需要主色 / 辅色 / 危险 / 成功、边框、圆角、字号阶梯时，打开 MASTER 对应节，**按 token 名引用**，不要把 hex 从 MASTER 或 `openai-style.md` 抄回本文件或新页面。MASTER 若与 OpenAI 冲突，先和解 MASTER，再引用。
3. 做某一个页面时，再读 `pages/<page>.md`。它覆盖该页布局、状态矩阵和响应式差异，不覆盖 MASTER token，也不覆盖宪法 / IA。
4. `frontend/src/styles.css` 是 token 的实现事实；改数值必须同时改 CSS 与 MASTER，不在本文件改。阴影 / `--font-*` 和解到 OpenAI-quiet；`--primary` 和解到产品粉红（ADR-031 修订）。本 PR 不改 CSS。

`docs/20-visual-design-system.md` 只是迁移索引，不是实施入口。

## 2. 语义色、边框、圆角、字号（只引用 MASTER）

下列角色**必须**使用 MASTER 已命名的语义 token。本表不写 hex。浅色 / 深色成对数值以 MASTER §2 为准。

| 角色 | 引用 | MASTER |
|---|---|---|
| 主色 primary | `--primary`、`--primary-fg`、`--focus-ring` | §2 核心语义 |
| 辅色 secondary | MASTER **没有**独立的 `--secondary`。辅层级用 `--text-muted`、`--bg-elevated`、`--border`；不要新发明一条辅色 hex | §2 |
| 危险 danger | `--danger`；控件错误边框 `--control-border-invalid` | §2 |
| 成功 success | `--success` | §2 |
| 警告 warning | `--warning` | §2 |
| 背景 / 文字 | `--bg`、`--bg-elevated`、`--text`、`--text-muted` | §2 |
| 边框 | 低强调分隔 `--border`；强分隔 `--border-strong`；可操作控件 `--control-border` / `--control-border-hover` / `--control-border-invalid` | §2 Token 分类 |
| 圆角 | 小控件 `--radius-sm`；面板 `--radius-md`。Composer 容器与 Chip 半径只在 MASTER §2 Composer 行 | §2–§3 |
| 字号阶梯 | `--font-xs`、`--font-sm`、`--font-body`、`--font-section`、`--font-title`、`--font-page-title`；行高 `--leading-body`、`--leading-tight` | §2 字体系统、§3 |
| 间距 | `--space-1` … `--space-5`（4 / 8 / 12 / 16 / 24） | §3 |
| 阴影 | 仅抬升 / 浮层 `--shadow-quiet` | §3 |

Composer token（`--composer-*`）只服务任务输入容器，不扩散到普通按钮、卡片或页面背景。迁移别名（`--star`、`--canvas`、`--line`、`--muted`、`--red`、`--ok`、`--orange` 等）禁止出现在新代码。

禁止用 `transform: scale()` 或 `zoom` 假装密度。正文基线与控件下限见 MASTER §3 / ADR-020。

## 3. `pages/*.md` 怎么用

`design-system/kol-workbench/pages/` 是**单页覆盖规则**，不是第二套设计系统。

| 文件 | 何时读 |
|---|---|
| [`pages/home.md`](design-system/kol-workbench/pages/home.md) | Home 布局、模式 Tab、发现 / 跟进（助理脊柱 + 对象卡） |
| [`pages/chat.md`](design-system/kol-workbench/pages/chat.md) | 会话时间线、Composer、结果卡 |
| [`pages/pipeline.md`](design-system/kol-workbench/pages/pipeline.md) | KOL 试点 Pipeline 页密度与阶段列（页不是必挂侧栏） |
| [`pages/admin.md`](design-system/kol-workbench/pages/admin.md) | 治理表 / 授权矩阵的视觉结构 |
| [`pages/approvals.md`](design-system/kol-workbench/pages/approvals.md) | 员工审批队列的确认与回执 chrome |

用法：

- 先完成宪法 / IA / UX 硬不变量 → `ui-ux-pro-max` → 本文件 → MASTER，再打开当前页的 `pages/*.md`。
- `pages/*.md` 可以规定该页的区块顺序、状态矩阵、窄屏折行。它**不能**改 token 数值，也不能改一页一问或使用 ≠ 治理。
- 没有对应 `pages/*.md` 的一等能力面（如 `/kb`、`/connectors`、`/exam`、`/cron`）：沿用 MASTER + 宪法 / IA 的「只答一问」，不要为了视觉另立法。
- 现有页面截图不是设计基准（MASTER 开篇）。重做页面时用 token 与页面规范，不反向把现状写入 MASTER。

## 4. 本文件禁止写入

| 禁止 | 应去的位置 |
|---|---|
| 任何 hex / rgb 色值，或「本页主色改成 #…」 | MASTER §2；改数值同步 `styles.css` |
| 业务规则、阶段机、15 段图、`stage_code` 迁移 | FS、Policy、`05` / 阶段契约（不在视觉文档） |
| 权限、租户、PEP、谁能看见哪条数据 | FS、C [`org-permissions.md`](org-permissions.md) |
| 发送 ≠ 推进阶段、L3 确认文案、拒绝原因 | 宪法 §3 / §5、`UX-EMPLOYEE` |
| 导航该挂谁、Pipeline 是否侧栏、使用 ≠ 治理 | [`ia-information-architecture.md`](ia-information-architecture.md)、宪法 §4 |
| 连接器枢纽字段、Admin 遗留收敛 | C [`org-permissions.md`](org-permissions.md) |
| 把 `ui-ux-pro-max` 输出写成可覆盖 FS / Policy / 宪法硬不变量的法 | 它是视觉链必经分析；OpenAI 对齐且不违反宪法的建议可以驱动 MASTER 更新；仍不得发明 Glassmorphism / 随机品牌字体 / 橙强调 |
| 把 `openai-style.md` 的 hex 抄进本文件 | token 数值只改 MASTER。mood 冲突时 OpenAI 胜；主填充按产品粉红和解 MASTER（不是 ~~黑 / Obsidian 实底~~），不要把冲突 hex 留在 MASTER |

页面和组件不得自行定义与 MASTER 冲突的颜色、字号、圆角或间距（宪法 §3）。

## 5. 交付时仍按 MASTER 检查

键盘、焦点、对比度、触控目标、减少动态效果、视口（360 / 768 / 1024 / 1366 / ≥1440）以 MASTER §6–§9 为准。本入口不重复那份清单。
