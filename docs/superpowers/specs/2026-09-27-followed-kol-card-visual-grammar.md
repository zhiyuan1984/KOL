# 跟进红人卡片：视觉语法重做（2026-09-27）

> 依据：`docs/DESIGN.md`（员工端实施细则，唯一 token 数值来源）+ `docs/ui-ux-rules.md`（界面细则）。
> 落点：`frontend/src/components/FollowedKolWorkCard.tsx`、`frontend/src/styles.css`（卡片基座 + `.followed-kol-column` 作用域）、`docs/DESIGN.md` §控件尺寸 新增一行 token 登记。
> 范围：**一张卡片的视觉语法**。不改数据模型语义、不改业务规则、不改右栏几何与工具行。

## 1. 审宪记录（CONST-08）

| 项 | 内容 |
|---|---|
| 需求 | 让卡片承担「快速判断优先级」：只保留三级字号、头像降为图标砖、标签按语义分工、去掉与选中态混淆的整高红线、以间距代替内部线、行高收到 104–136px |
| 主责角色 | UI/UX 专家（视觉与控件尺寸）；KOL 业务角色确认阶段/风险文案未被改写 |
| 宪法条款 | CONST-04（前端只实现已定义规则）、CONST-09（不得为通过而改法）、CONST-10（不得用占位或假状态冒充能力） |
| 基本法/细则 | DESIGN.md §密度档、§颜色（四职责不得串用）、§控件尺寸、§字号阶梯用途、§不变量 4、§验收矩阵；ui-ux-rules.md 规则 4 / 7 / 10 / 13 / 17 |
| 结论 | **符合**：本方案把现状收回既有条款，未新立规则。 |

### 1.1 现状违反实施条款的三处（反证）

1. `.kol-band-identity strong { font-size: var(--font-section) }`（16px）——DESIGN.md §字号阶梯用途把 `--ds-font-section` 归给「页面/上下文标题」，列表行内容应走 `--ds-font-body`/`--ds-font-sm`。
2. 行内主 CTA 用 `--radius-buttons`（9999px 胶囊）——DESIGN.md §控件尺寸：胶囊只用于身份/状态语义，不能作为通用按钮造型。
3. `is-exception` 用整高红色内阴影表达风险——纯颜色、且与「选中」形状同构，违反 §不变量 4「状态不能只靠颜色」。

### 1.2 规则冲突登记（不阻塞）

`ui-ux-rules.md:130` 写 `--radius-pill: 9999px`「主 CTA」；`DESIGN.md` §控件尺寸写胶囊只留给身份/状态。同一形状两处结论不同。本次按 **DESIGN.md** 执行（较新，且被声明为员工端唯一 token 数值来源），并在此登记该冲突给 UI/UX 角色；未擅自改写 `ui-ux-rules.md`。

## 2. 视觉契约（本次唯一验收口径）

### 2.1 字号：只留三级

| 级 | 内容 | token / 字重 / 颜色 |
|---|---|---|
| 一级 | `@名称`、当前建议 | `--ds-font-body`(14) / 600 / `--text` |
| 二级 | 互动摘要、主要原因 | `--ds-font-body`(14) / 400（摘要 `--text`，理由 `--text-muted`） |
| 三级 | 平台·区域·负责人·品类·邮件来源时间·14 日计时·停留天数·未读·阶段标签·辅助入口 | `--ds-font-sm`(13) / 400–500 / `--text-muted`（阶段标签与可点强调用 `--accent-text`） |

- 卡片上不出现 12px：`ui-ux-rules` 规则 7 要求可点标签 ≥13px。
- 陷阱：`--font-body` 别名指向 `--ds-font-ui`(15)，与 `--ds-font-body`(14) 不是一回事；卡片一律写 `--ds-font-*`。

### 2.2 头像

`--kol-avatar-size`(28px) 小圆角方形图标砖（圆角 `--radius-control`），淡辅助底 + `--accent-text` 字形；与勾选框、第一行文字同一 28px 行内居中。未提供真实头像时用名称首字（本仓无平台图标资产，平台图标列入后续项）。

### 2.3 标签分工（四种表现）

| 语义 | 表现 |
|---|---|
| 当前阶段 | `--badge-h`(20px) 高、`--ds-radius-tag`、淡辅助底 + 细描边、`--accent-text` |
| 异常/风险 | `--badge-h` 高、危险色描边(70% = 3.3:1) + 图标 + 文案，无实底 |
| 普通属性 | 无底色无描边的弱文本，`·` 分隔（CSS `::before` 生成，不进 textContent） |
| AI 可信度 | `[data-confidence="low"]`：图标 + 弱化色，保留模型既有文案「建议依据不足」 |

- 一行最多一个状态强调点：风险标记按 `exception → high-risk → refused → overdue → unbound` 取第一个；其余降为弱文本。「临近14日」不再单独出现——同一份数据已由 14 日计时那一行承载。
- 「未读 N」由红色实底改为辅助色弱文本；已有风险标记时退为 `--text-muted`。

### 2.4 红线与选中

- 删除整高红内阴影。风险只由 row1 的 `⚠ 异常` 局部标记表达。
- hover/选中只有极淡辅助底（`color-mix(--accent 3%)`），不加边框；选中另由 16px 勾选框的勾选标记承担「不只靠颜色」。
- 触摸模态（`pointer: coarse`）用 `min-width/height: 44px` + 等量负外边距把勾选框命中区扩到 44×44，视觉尺寸与位置逐像素不变。

### 2.5 分隔与密度

- 对象之间只有卡片 `border-bottom` 一条完整线；末行不再与列表底线叠成双线。
- 对象内部取消全部横线，改用间距与对齐分组；只有展开「依据」时才出现局部分隔线。

### 2.6 控件

| 控件 | 取值 |
|---|---|
| 勾选框 | 视觉 16px；触摸命中区 44×44 |
| 阶段标签 | `--badge-h` 20px |
| 行内主 CTA | 高 `--control-h-lg`(32px，与同屏工具行等高)，圆角 `--radius-control`(6px)，不再用胶囊 |
| 文字链接 | 默认无下划线，hover/`:focus-visible` 才加；仍是 `.kol-cta-link`，`[data-open-kol-detail]` 不带 `btn` |
| 依据入口 | `依据 ▾` ⇄ `收起依据 ▴`，由 `<details>[open]` 驱动，箭头是统一 SVG |
| CTA 尾箭头 | 组件内把 `rec.label` 结尾的 `→` 拆出来渲染 SVG（模型 `confirmStageCtaLabel` 未改，顶部批量 CTA 文案不变） |

## 3. 与设计稿的有意偏离

1. **主 CTA 位置**：稿里把 CTA 提到摘要那一行；实现把它留在 `[data-kol-band="action"]` 内的右侧。原因：既有契约要求主 CTA 的矩形完整落在 action 带内（`frontend/e2e/workbench.spec.ts:1197-1203`），这是「主行动属于 AI 建议、不飘到事实层」的表达。密度表中「固定右侧**或右下角**」取的是右下角。
2. **右上角文案**：保留「停留 N 天」（真实字段 `days_in_stage`，且被 3 处断言固定），未改成「N 天未互动」——后者与第二行 14 日计时的「已过 N 天」同源同义，同屏出现会重复。

## 4. 实施落点（改动清单）

- `frontend/src/components/FollowedKolWorkCard.tsx`：四行结构；风险标记与停留天数移入第一行；14 日计时移入第二行（`data-release-timer` / `data-clock-none` 元素与文案原样保留）；摘要与邮件来源同行；「AI 建议 · 理由」合并为一条弱化行；依据入口改 `依据 ▾`；CTA 尾箭头改 SVG；辅助入口改 `详情` / `互动`（带 `title`）。
- `frontend/src/styles.css`：卡片基座（字号/头像/标签/分隔/CTA 圆角/文字链接）与 `.followed-kol-column` 作用域（行高与密度、末行分隔线、`pointer: coarse` 命中区）。
- `docs/DESIGN.md` §控件尺寸：新增 `--kol-avatar-size | 28px`。
- `frontend/src/styles.css` `:root`：新增 `--kol-avatar-size: 28px`。

### 4.1 关键修复：动作组永远换行

`.kol-band` 组规则给 `.kol-band-actions` 设了 `width: 100%`，作为 flex 子项时 flex 基准 = 整行宽，于是「建议块 + 动作组」永远换行，每个对象白多 17.5–32px。修复：`.kol-band-recommend > .kol-band-actions { width: auto }`。

## 5. 验收与测量

- 命令：`npm run build`、`npm run test:e2e:release`、`npm run test:e2e`。
- 探针：`frontend/e2e/followed-card-visual.probe.spec.ts`（为本次一次性测量编写，取完数据后删除），截图落在 `artifacts/followed-card-*.png`。
- 目标与实测见 §6。

## 6. 测量结果

探针：`frontend/e2e/followed-card-visual.probe.spec.ts`（一次性，取完数据后删除），截图 `artifacts/followed-card-1440x900.png` / `-1440x785.png` / `-rail-1440.png`；改造前对照 `artifacts/card-stacked2-1440.png`。

### 6.1 密度

| 指标 | 改造前 | 改造后（实测） | 目标 |
|---|---:|---:|---:|
| 单条常规记录高度 | ≈200px | **128.9–129.9px** | 104–136 |
| 2 行摘要的记录 | ≈218px | **148.8px** | 「必要时 2 行」允许高于目标 |
| 1440×785 完整可见条数 | 1–2 | **4** | 3–4 |
| 1440×900 完整可见条数 | 2 | **4** | — |
| 常驻状态标签数 | 4–6 | **1–2**（阶段 +（条件）风险标记） | 1–2 |
| 卡片自身横向溢出 | 无 | 无 | 无 |

> 视口可见条数同时受右栏 chrome 影响：同一提交里 Home 侧的跟进区 chrome 也被重做（`frontend/src/home/FollowedInteraction.tsx`），该数字反映两者之和；卡片侧可独立核对的是「单条高度」与「列表视口高度 538px」。

### 6.2 字号与控件实测（computed）

| 元素 | 实测 | 目标 |
|---|---|---|
| `[data-kol-name]` | 14px / 600 / `--text` | 一级 |
| `[data-kol-suggestion]` | 14px / 600 | 一级 |
| `.kol-mail-digest` | 14px / 400 / `--text` | 二级 |
| `[data-action-why]` | 13px / 400 / `--text-muted` | 二级 |
| `[data-stage-label]` / `[data-kol-chip]` / `.kol-cta-link` / `.kol-mail-meta` | 13px | 三级 |
| `.kol-avatar` | 28×28 | 28–32 |
| `.kol-stage-badge` / `.kol-chip.is-risk` | 高 20px | ≈20 |
| 行内主 CTA | 高 32px（与工具行同档） | 28–32 |

### 6.3 对比度（node 计算 `color-mix` 实测值，底色 `--bg` = #ffffff）

| 组合 | 实测 | 要求 |
|---|---:|---|
| `--accent-text` / 8% 辅助底（阶段标签字） | 5.57:1 | ≥4.5 |
| `--accent-text` / 卡底（可点强调） | 6.09:1 | ≥4.5 |
| `--danger` / 卡底（异常标记的字与图标） | 5.17:1 | ≥4.5 |
| 风险描边（危险色 70%） / 卡底 | 3.33:1 | ≥3 |
| `--text-muted` / 卡底（三级文字） | 5.33:1 | ≥4.5 |
| `--text` / 卡底（一级、二级） | 17.4:1 | ≥4.5 |

> 阶段标签的描边（辅助色 26% = 1.53:1）是**形状装饰**，不承担 ≥3:1 的图形职责：该标签的信息由文字承载（5.57:1），且颜色不是唯一信号（短标签 + 底 + 描边 + 文案）。

### 6.4 契约判据（与 spec helper 同一批判据，逐条实测）

探针对 4 张卡逐条计算 `workbench.spec.ts` 的 `expectFollowedKolCardWraps` / `expectFollowedDecisionDensity` 用到的判据：

| 判据 | 实测（4 张卡） |
|---|---|
| `[data-kol-band]` 数 = 4 | 4 / 4 / 4 / 4 ✓ |
| `[data-kol-split]` 单轨道 | 1 ✓ |
| `fact` / `action` 带单轨道（flex 行不留陈旧 grid 轨道） | 1 / 1 ✓ |
| `factAiSideBySide = false`、`gutter = 0`、`factAiStacked = true` | ✓ |
| `stageBesideName = true`、`factBelowIdentity = true` | ✓ |
| 主 CTA 完整落在 action 带内 | ✓ |
| 卡片自身不横向溢出 | ✓ |
| `[data-mail-summary]` line-clamp = 2；stage / suggestion 不截断 | 2 / none / none ✓ |
| 每卡 1 个 `[data-open-kol-detail]`、1 个 `[data-followed-select]`；`[data-open-kol-detail]` 不带 `btn` | ✓ |
| `[data-current-state]` 文本不含 ` · `（初步接触）与「异常」 | ✓ |

展开态（`[data-action-evidence]`）：收起时 summary = `依据`；展开后 summary = `收起依据`、`border-top: 1px`（局部分隔线）、证据正文可见、chevron `matrix(-1,0,0,-1,0,0)`（180°）。

另：`home-four-panel.spec.ts:207` 这一例在改造后跑到 **第 256 行**才因 `[data-followed-batch-confirm]`（工具行，已由上一条工作流移除）失败 —— 即第 240–255 行的卡片断言（波段数、阶段标签位置、停留天数、事实文案、建议文案、`依据` 入口、CTA 文案与 SVG 箭头、CTA ghost）全部通过。



## 7. 遗留与后续

### 7.1 发布门禁当前红在跟进区 chrome（不是卡片）

`artifacts/followed-card-gate.log`：`npm run test:e2e:release` 结果 **4 passed / 4 failed**，4 例失败全部指向同一次 Home 侧跟进区改造（`frontend/src/home/FollowedInteraction.tsx` 取代了原来的 journey 导航 + 简报 + 选中计数），**与卡片无关**：

| 失败断言 | 直接原因 |
|---|---|
| `home-followed-rail-layout.spec.ts:71` `compareDocumentPosition` 收到 undefined | `[data-followed-journey]` 已不再渲染（只剩 CSS） |
| `home-followed-legacy-projection.spec.ts:8` | `[data-followed-brief]` 找不到 |
| `home-followed-rail-layout.spec.ts:170` | `[data-followed-brief]` 找不到 |
| `home-followed-rail-layout.spec.ts:191` | `[data-followed-selected-count]` 期望「已选 8 / 8」 |

同一份门禁里 **通过** 的 4 例包含 `home-followed-focus`（钉的正是卡片的 hover / 焦点 → `data-cta-emphasis` 行为）与两例 `home-surface-failure`，即卡片侧的门禁契约仍是绿的。

两种收口方式，需该工作流负责人定：① 新 chrome 保留 `data-followed-journey` / `data-followed-brief` / `data-followed-selected-count` 三个钩子并满足原有顺序断言；② 承认该重构改变了 IA，按新结构更新门禁 spec（属规范变更，不在本次擅自改）。


### 7.2 卡片侧遗留

- 摘要文案仍是邮件原文切片（`digestMailQuote`）：改成判断句属于模型/文案变更，另案。
- `recommendedActionHeadline` 只在 confirm-stage 时给出「建议…」框架；`open-session` / `compose` 等类型直接把 `rec.label` 当建议行，于是与同一行的 CTA 文案重复（例：「查看互动」出现两次）。属模型文案，另案。
- 平台图标（头像里用平台字形而不是首字）需要图标资产，另案。
- `.followed-kol-item` 系列选择器已无对应 DOM（列表是 `div.followed-kol-list > article`），属历史残留；本次只修掉其中会导致末行双线的那条。
- 顶部批量 CTA（工具行）的胶囊圆角属同类问题，按范围留给工具行改造。

## 8. 一次性资产

- `frontend/e2e/followed-card-visual.probe.spec.ts`：本次测量用探针，取完数据后删除（密度与字号契约已由 `home-four-panel.spec.ts` 与 `workbench.spec.ts` 的既有 helper 固定）。
- `artifacts/followed-card-1440x900.png` / `-1440x785.png` / `-rail-1440.png`：改造后截图；`artifacts/card-stacked2-1440.png` 为改造前对照。
- `artifacts/followed-card-baseline.log`、`-gate.log`、`-specs.log`、`-probe.log`：运行记录。
