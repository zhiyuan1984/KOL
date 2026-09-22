# 颜色职责迁移对照表（粉 → 主行动 / 辅助 / 状态）

> 决策件，不是现行法。规则本体在 [`docs/DESIGN.md`](../../DESIGN.md) §颜色（2026-09-22 新增）；
> 数值只住 `frontend/src/styles.css`（`--primary*` / `--accent*`）。
> 生成方式：扫 `frontend/src/styles.css` 中**本页之外**所有引用 `var(--primary` 或 `var(--star)` 的规则
> （技能页已在 2026-09-22 完成迁移，不在表内）。共 **140** 条。

## 0. 三档定义（摘自 DESIGN.md §颜色）

| 职责 | token | 判据 |
|---|---|---|
| 主行动 | `--primary`（品牌粉） | **它是不是当前视口的那个「提交/执行/确认」按钮**。是 → 粉 |
| 辅助 | `--accent`（蓝） | 选中态、当前位置、筛选 chip、图标砖、链接与可点强调、信息性标记、进度 |
| 状态 | `--warning` / `--danger` / `--success` | 表达「风险 / 失败 / 完成」等**状态**，不表达品牌或选中 |

判据的边界：**「选中」不是「主行动」**。凡是「用户选中的某一项 / 当前所在的位置 / 已切换到某项」，
一律辅助色 + 形状或字重信号，不用实底按钮。

## A. 主行动 —— 保持粉（建议 8 条）

| 规则 | 用途 |
|---|---|
| `.btn.primary`（+`:hover` / `:focus-visible`） | 通用主按钮 |
| `.btn.send` / `.composer .btn.send.send-arrow` / `.home-composer-dock .btn.send.send-arrow`（+hover） | 发送（写作面的主行动） |
| `.btn.work`（+`:hover` / `:active`） | 启动 / 执行 |
| `.admin-confirm .btn.primary`（+hover） | 确认弹窗的主行动 |
| `.todo-cta, .insight-actions button, .insight-primary` | 「今日待办」「洞察」里的主行动按钮 |
| `.hub-new` | 「新建」主行动 |
| `.today-todo-act` | 今日待办的行内主行动 |
| `.kb-page .btn.work:active, .admin-kb .btn.work:active` | 知识库的启动按钮（已覆盖在上一条 `.btn.work`） |

> 说明：这一组是**同一个视口里最多出现一个**的实底 CTA（§不变量 1），迁移时不要动。

## B. 辅助 —— 建议改蓝（约 118 条，按用途分组）

### B1 导航与「当前位置」（11）
`.nav-link.active`、`.nav-link.active .nav-ico`、`.nav-combo.active`（含 `.nav-ico`）、
`.admin-nav-item:hover`、`.admin-nav-item.active`、`.journey-strip li.is-current`、`.journey-funnel li.is-current`、
`.team-rail-title`、`.mail-page .mail-row-folder.is-open`、`.mail-box-card.is-active`、`.agent-task-list li.is-current a`

### B2 分段 / 筛选 / 开关的选中态（22）
`.home-mode-tabs button[aria-selected="true"]`、`.home-tabs button[aria-selected="true"]`、
`.mail-list-tabs button[aria-selected="true"]`、`.mail-mobiletabs button[aria-selected="true"]`、
`.settings-tabs button.active`、`.kb-tabs a.active, .kb-tabs button.active, .kb-tabs button[aria-selected="true"]`、
`.expert-tab.on`、`.agent-tab.on`、`.mail-filter-btn.is-on`、`.mail-row-folder.is-open`、
`.task-filters button[aria-pressed="true"]`、`.home-mode-pane[data-home-pane="todo"] .task-filters button[aria-pressed="true"]`、
`.kol-sorts button[aria-pressed="true"]`、`.agent-task-filters button.is-on`、
`.discovery-chip[aria-pressed="true"]`、`.follow-style-chip.is-on`、`.expert-pin.is-on`、
`.kb-page .btn[aria-pressed="true"]`（含 `.is-on` / `:active` / `:hover` 三种）、`.admin-kb` 同名规则、
`:root[data-theme="dark"] .today-board-pill[aria-pressed="true"]`、
`.suggested-actions button.is-on` / `[aria-pressed="true"]`、`.result-actions button.is-on` / `a.is-on` / `[aria-pressed="true"]`

### B3 列表 / 卡片的选中态（7）
`.mail-row.is-selected`、`.mail-row.is-selected, .mail-timeline-item.is-selected`、
`.mail-message.is-current`、`.mail-message.is-out`、`.kol-mail.is-out`、
`.expert-tab.on`（见 B2）、`.stage-chip.is-selected`、`.phase-chip.is-current`

### B4 阶段 / 进程轨道的「当前」（6）
`.stage-chip.is-suggested:not(.is-selected)`、`.stage-chip.is-selected`、`.stage-chip-badge`、
`.stage-chip.is-selected .stage-chip-badge`、`.phase-chip.is-done`、`.phase-chip.is-current`、
`.stage-track.is-phases.journey-track::after`、`.session-stage-chip`、`.approval-path li[data-path-state="current"]`
> `is-done` 类建议归**状态**（见 C1），这里只列其中「当前」的部分。

### B5 链接 / 可点强调 / hover（30+）
`.home-templates-link:hover`、`.recommend-to-todo:hover`、`.discovery-toast a`、`.discovery-filters-reset:hover`、
`.discovery-chip:hover`、`.discovery-chip-remove:hover`、`.home-fold-more:hover`、`.followed-brief-stat-action:hover`、
`.work-panel-open:hover`、`.mail-preview-link:hover`、`.kol-mail-preview [data-open-original-mail]:hover`、
`.clarification-chip:hover`、`.feedback-links a:hover`、`.digest-retry:hover`、`.link-button`、
`.candidate-actions button`、`.icon-btn:hover`、`.task-back:hover`、`.mail-copy-btn:hover:not(:disabled)`、
`.mail-page .mail-more-toggle`、`.expert-back:hover`、`.expert-card-titles h2 a:hover`、`.expert-prompt:hover:not(:disabled)`、
`.agent-hero a`、`.agent-secondary-link:hover`、`.admin-crumb a`、`.agent-report-action-primary`、
`.today-brief-primary`、`.today-brief-card .today-brief-primary`、`button.today-brief-primary-btn`、
`.today-todo-label`、`.mobile-top a`、`.sidebar .account-avatar`、`.home-mode-count`、`.rec:hover`、
`.recommend-to-todo:hover`（border）

### B6 输入框 / Composer 的强调（8）
`.composer-dock, .composer, .home-composer-dock, .session-composer { --composer-accent }`（1 行改全站写作面）、
深色两处 `--composer-border / --composer-chip-bg`、`.composer-plus:hover / .is-selected / [aria-expanded]`、
`.composer-tools a`、`.composer-suggestions button`、`.composer-tool.is-selected`、`.skill-chip, .attach-chip`、
`.attach-chip`、`.followed-kol-select input { accent-color }`

### B7 信息性标记 / 装饰（22）
`.project-chip`、`.nav-badge`、`.today-brief-badge`、`.mail-count-pill`、`.mail-count-pill.is-solid`、
`.mail-side-tag`、`.today-brief-badge`、`.task-source-mark`、`.mail-digest.is-model`、`.kb-card.is-cited`、
`.kb-versions`、`.kb-step-n`、`.creation-feedback`、`.thread-mail-digest`、`.thread-mail-digest.is-codex/is-luna`、
`.session-loading-status`、`.session-loading-dot`、`.task-analysis-summary`、`.md blockquote`、
`.pipeline-row:hover`、`.remote-pill[data-remote="starry-kol-mcp"]`、`.kb-page/.admin-kb { --kb-accent, --kb-accent-ink }`

### B8 焦点环用错了 token（3，顺带修规）
`.btn.primary:focus-visible { box-shadow: 0 0 0 4px var(--primary) }`、
`.stage-chip:focus-visible { outline: 2px solid var(--primary) }`、
`.pipeline-drawer .stage-chip.is-selected:focus-visible { box-shadow: 0 0 0 4px var(--primary) }`
> DESIGN.md §控件尺寸：「焦点态统一用 `--focus-ring` + `--focus-ring-width/offset`」——这三处应改成
> `--focus-ring`（与配色迁移无关的**条文不符**，建议一并修）。

## C. 状态 —— 建议改语义色（6 条，含 2 条待你定）

| 规则 | 现状 | 建议 |
|---|---|---|
| `.milestone.is-done { background: var(--star) }` | 粉实底 | `--success`（完成） |
| `.stage-track li[data-phase-state="done"] .phase-label { color: var(--star) }` | 粉字 | `--success` |
| `.phase-chip.is-done { color/border/bg 粉 }` | 粉 | `--success` 淡底 + 描边 |
| `.trace-list li[data-status="running"] { color: var(--star) }` | 粉字 | **待定**：运行中既非成功也非失败 → 建议 `--accent`（辅助）或保留中性 `--text-muted` |
| `.mail-star.is-starred { color: var(--primary) }` | 粉星 | **待定**：星标是「用户标记」不是状态 → 建议 `--warning`（与技能页 ★ 一致） |
| `.bubble.assistant.is-streaming::after { color: var(--star) }` | 粉闪标 | **待定**：生成中 → 建议 `--accent` 或中性 |
| `.followed-kol-select input { accent-color: var(--primary) }` | 粉勾选 | 辅助（B6） |

## D. 迁移方式建议（分批，避免一次盲扫 140 条）

| 批次 | 范围 | 风险 | 预估 |
|---|---|---|---|
| 1 | **间接层**：`--composer-accent`、`--kb-accent/--kb-accent-ink`（2 处 token 定义） | 低（一处改、全站写作面/知识库跟随） | 10 分钟 |
| 2 | **焦点环 3 处**（B8）——属条文不符，与配色无关 | 低 | 10 分钟 |
| 3 | **导航与分段选中**（B1+B2，33 条） | 中（每页都要看一眼观感） | 1–2 小时 |
| 4 | **列表/卡片选中 + 阶段轨道**（B3+B4，15 条） | 中 | 1 小时 |
| 5 | **链接强调 + 信息性标记**（B5+B7，50+ 条） | 低但量大（多数是一行 `color:`） | 1–2 小时 |
| 6 | **状态 6 条**（C） | 需先定 3 条待定项 | 30 分钟 |

每批完成后跑：`cd frontend && npx tsc --noEmit && npx playwright test e2e/`（至少本页 + 受影响的页面 spec），
并按 §验收矩阵 在 1280/1440 两档截图复核 —— 颜色改动**不进 e2e 断言**的地方（其它页面）靠截图留证。

---

## 迁移执行记录（2026-09-22，所有者「全部都做」后实施）

### 结果

| 项 | 迁移前 | 迁移后 |
|---|---|---|
| `styles.css` 里把粉当「辅助/选中」的规则 | 140 条 | **0**（只剩 8 条主行动：`.btn.primary` / `.btn.send` / `.btn.work` / `.admin-confirm .btn.primary` / `.todo-cta` / `.insight-*` / `.hub-new` / `.today-todo-act`，含各自 hover/active） |
| 粉色浅底家族（`--color-pink-tint*`、`#FFF0F6` 等） | 11 处使用 + 6 处 token 定义 | **0**（token 定义已删除，使用点改 `color-mix(in srgb, var(--accent) N%, var(--bg))`） |
| 选中态派生 | `--ds-selected-bg/border` 由 `--color-primary`（粉）派生 | 改由 `--accent` 派生（一处改，全站选中态跟着走；技能页原先的页面级覆盖已删） |
| 焦点环 | 3 处用粉 | 全部改 `--focus-ring`（§控件尺寸） |
| 管理端技能页内联色（`SkillLifecycle.tsx`） | 自有粉 `#e94057` / 选中 `#fdf2f4`+`#f5c2cb` / 焦点 `#e94057` | 主行动 → `var(--primary)`；选中 → accent 系；焦点 → `var(--focus-ring)`；阶段点 → `success/muted/warning/accent` |

### 迁移中发现并补上的 5 个盲区（原表只扫了 `styles.css` 的 `var(--primary)` / `var(--star)`）

1. **粉色浅底家族**：`--color-pink-tint` / `--color-pink-tint-soft`（8 处使用）、直写 `#FFF0F6`（3 处）——侧栏当前项、今日任务选中 pill 都由此上色，第一遍没扫到。
2. **另一个 token 名**：`var(--color-primary)` / `var(--color-primary-hover)`（品牌原 token）在 `styles.css` 有 2 处、在组件 CSS 有 23 处把粉当辅助用。
3. **四个组件级样式表**：`src/home/today-plan-board.css` / `edit-task-dialog.css` / `today-display-row.css` / `today-rec-row.css`（`today-plan-progress.css` 无粉用法）。**`docs/DESIGN.md` 引言写的「实现落点 = `styles.css` + `composer.css`」本身不完整** —— 建议把这几份也写进落点清单（属§控件尺寸 的口径补充，交 UI/UX 专家确认）。
4. **内联样式**：`SkillLifecycle.tsx` 用内联 `style` 写死颜色（含一个自成一套的粉 `#e94057`），任何按 CSS 规则做的清单都扫不到。
5. **单行规则**：选择器与声明写在同一行（33 条），以及 `@media` 内嵌套的规则，需要按行状态机处理而不是按声明块扫。

### 顺带修掉的条文不符

- 焦点环 3 处（`.btn.primary:focus-visible`、`.stage-chip:focus-visible`、`.pipeline-drawer .stage-chip.is-selected:focus-visible`）改用 `--focus-ring`。
- `--primary-text` / `--star` 的**定义**在本轮被脚本误伤过一次（改成蓝派生），已当场修回并复核（这类 token 定义不应参与「用法迁移」）。

### 仍待所有者决定（与配色无关，属 §不变量 1）

**知识库页每张卡片都有实底粉按钮「用于当前任务」**（`kb-page .btn.work`），同一视口 3+ 个实底 CTA —— 撞 `docs/DESIGN.md` §不变量 1「同一视口最多一个实底主 CTA」。迁移前就存在，不是本轮引入。建议：给「行/卡内动作」单独一档样式（描边款或链接式），`.btn.work` 只保留在页面级主行动上；但这会改动 KB、Admin 等多处观感，需要 UI/UX 专家先定「行内动作」的统一形态。本轮**未擅自改**。
（同类的行内实底已在本轮降级：今日计划行的 `today-display-go`、推荐任务行按钮 → 辅助色描边款。）
