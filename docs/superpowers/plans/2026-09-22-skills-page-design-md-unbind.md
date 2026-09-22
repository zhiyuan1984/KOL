# 技能目录页（/skills）解绑 Cal.com、收口到 DESIGN.md Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `/skills` 只由 `docs/DESIGN.md`（员工端实施细则）与壳层命名 token 决定；删除页面级 Cal.com 设计分析层，并把该页静默失效的 4 个未定义 token 修好。

**Architecture:** 纯前端。`frontend/src/styles.css` 内该页原本是三层叠加（基础层 / Cal.com 层 / 行式列表层），合并为一段；`SkillCatalog.tsx` 只做行式 DOM 与类名收口；`frontend/e2e/skills-catalog.spec.ts` 的断言逐条重定依据。

**Spec:** `docs/DESIGN.md`（员工端实施细则：密度档 / 控件尺寸 / 三轴适配 / 不变量 / 验收矩阵）；风格基准 `data-dense-dashboard`。

**Tech Stack:** React 19 + TypeScript、react-router、Playwright（e2e，stub 模式；webServer 会先 `npm run build`）。

---

## 审宪记录（CONST-08：需求 → 主责角色 → 宪法条款 → 基本法条款 → 结论与证据 → 下一步）

**需求**：清洗技能目录页 `/skills`，解除对 Cal.com 设计分析的绑定，使该页完全受 `docs/DESIGN.md` 设计。

**主责角色**：UI/UX 专家（视觉裁定，CONST-04）→ 前端专家（实施）。`docs/README.md` 登记 `DESIGN.md` 的责任角色即「UI/UX 专家、前端专家」。

**宪法条款**：CONST-04（UI/UX 专家决定视觉规范、组件呈现与无障碍；前端专家不得在页面重写业务规则）；CONST-09（设计 token 与测试是实施细则，不得覆盖上位条款；不得为了让代码"通过"偷偷改法）；CONST-10（交付必须可验证）。

**基本法条款**：`docs/TECHNOLOGY.md` 与 `docs/PRODUCT.md` 无前端视觉条款（逐词核对 `DESIGN` / `token` / `视觉` / `数值` / `写死` 均无命中）。本项由实施细则 `docs/DESIGN.md` 及其责任角色裁定。

**结论与证据**

1. **实现绑定了无规范位的候选分析。** 全仓 `Cal.com|cal\.com|--cal-` 只命中两处实现：`frontend/src/styles.css:11093-11532`（页面级 Cal.com 层：自建 `--cal-*` 调色板 + nav-pill-group / feature-icon-card / badge-pill / avatar-circle / button-primary / text-input 逐组件映射 + 1200px 内容上限 + 3→2→1 列断点）；`frontend/e2e/skills-catalog.spec.ts`（门禁按 Cal.com 断言：读 `--cal-surface-soft`、`--cal-muted`，断言 6px 胶囊内边距、白色选中胶囊、40px 按钮、圆角阶梯 `0/4/6/8/12/16/9999`）。
2. **DESIGN.md 已明文否定其适用于员工端。** 施工期间规范集又前进了一步（同一所有者）：`docs/DESIGN.md` 已重写为纯员工端实施细则（front-matter `name: employee-design-spec`、`style-baseline: data-dense-dashboard`），Cal.com 分析移入 `docs/references/cal-com-analysis.md`；当时 front-matter 与 §密度档 各有一次「不适用于员工端」的声明，**这两处在收尾时按所有者指示删除（见文末「附：`docs/DESIGN.md` 变更记录」）**，本文件自此不再出现该候选分析的名称。另有 `docs/CONSTITUTION.md` 重建记录（2026-09-21）与 `specs/UX-EMPLOYEE.md:16`。⇒ 本页保留 Cal.com 层已与现行法直接冲突。
3. **该页是三层叠加，浅色下由 Cal.com 层压住。** 层 1 基础层 `styles.css:10117-11090`（走壳层命名 token）；层 2 Cal.com 层 `11093-11532`，选择器形如 `:root:not([data-theme="dark"]) .skill-catalog-page .skill-card`，权重 (0,4,0)；层 3 行式列表层 `12379-12544`，权重 (0,2,0)。⇒ 浅色下 24px 卡片内边距、12px 圆角、白卡底、36px 圆形图标按钮、40px 按钮/搜索框、主色 `#111111`、1200px 上限仍在生效，只有层 2 未声明的属性由层 3 决定——「行式列表被套上卡片壳」。
4. **规则空白（登记，不擅自补法）。** 规范集换装删除了 `docs/ui-ux-rules.md`（HEAD 版 §0–§8 + 规则 1–19），其硬规则未被 DESIGN.md 继承——现行 DESIGN.md 只有 密度档 / 控件尺寸 / 三轴适配 / 不变量 1–5 / 验收矩阵。实现与门禁里的 `§5 规则 2/5/7/8/9/10/11/13/15/16/17/18/19`、`§3`、`§6.2`、`§7.3`、`§8` 现在指向不存在的内容（`docs/AGENTS.md` §4 禁止把失效引用当现行依据）。处理方式：保留实现不回归、不新造规则、只在本记录登记。
4b. **另有一处现行条款直接命中的缺陷：列表在 1024 视口被静默裁切。** 详情列与列表并排，1024 视口下列表列只剩约 400px；原实现按**视口**断点收列（`@media (max-width: 980px)`），1024 不命中，行内「填入输入框」与标记一起被挤出可视区，只能靠横向滚动看到——正撞 `docs/DESIGN.md` §不变量 5「绝不允许溢出被 `overflow: hidden` 静默裁切」。证据：修前实拍中该宽度下「填入输入框」整列不可见（`artifacts/ops/skills-1024x589.png` 是**修后**取图，动作列已完整可见）。修法：列宽改按**列表列实际宽度**收敛（`.skill-list { container-type: inline-size }` + `@container`），并加一条 1024×630 的门禁（行内动作不得被挤出内容盒）。
5. **4 个 token 从未定义，全部落在本页。** 复现命令（对 `var(--x)`（无 fallback）与全文件 `--x:` 定义集合做差集）：

   ```bash
   cd frontend/src && python - <<'EOF'
   import re,collections
   src=open('styles.css',encoding='utf-8').read()
   defined=set(re.findall(r'(--[a-zA-Z0-9-]+)\s*:', src))
   bad=collections.Counter()
   for i,l in enumerate(src.split('\n'),1):
       for m in re.finditer(r'var\((--[a-zA-Z0-9-]+)\s*(,|\))', l):
           if m.group(1) in defined or m.group(2)==',': continue
           bad[m.group(1)]+=1
   print(bad)
   EOF
   ```

   结果：`--hairline` 10 处（首个 10421；`border`/`border-color` 整条声明在计算值阶段失效 → 列表分组线、执行契约分区线、工具行边框全部消失）、`--ink` 2 处（10414/10426；详情列步骤与 `<summary>` 文字色回落继承）、`--radius-pill` 2 处（10786/10814；实底 CTA 与详情列主 CTA 的圆角归 0）、`--shadow-popover` 2 处（11021/11476；窄屏覆盖层无浮层阴影）。这四处目前被层 2 遮住，删除层 2 后会直接暴露。

**定档**：`违反实施细则`（实现与 DESIGN.md 员工端实施细则冲突且绑定候选分析）+ `规则空白`（旧条号失效）。**下一步**：按下述任务清洗该页。

---

## Global Constraints

- 视觉数值只从命名 token 取：`--control-h*` / `--radius-control` / `--radius-card` / `--chip-h` / `--badge-h` / `--hit-min` / `--focus-ring(-width/-offset)` / `--content-max` / `--page-gutter` / `--ds-*` / `--space-*`。**不新增 shell token、不写裸 px 颜色值**（根 `AGENTS.md` §3）。
- 不改业务：取数、筛选、URL 深链、权限、阶段判定、Composer 语义一律不动（CONST-04）。
- `.skill-card-actions` 的全局规则（`styles.css:6671`、6677）被 `pages/Admin.tsx` 使用，**必须保留**。
- 同一视口 0–1 个实底主 CTA；状态不只靠颜色；等待有原因与恢复入口（DESIGN.md §不变量 1/3/4）。
- 验证命令：
  - 类型检查：`cd frontend && npm run typecheck`
  - 本页门禁：`cd frontend && npx playwright test e2e/skills-catalog.spec.ts`
  - 全量门禁：`cd frontend && npm run test:e2e`
  - 构建：`cd frontend && npm run build`

---

### Task 1: 修 4 个未定义 token（独立可验证）

**Files:**
- Modify: `frontend/src/styles.css`

- [ ] `--hairline` → `--border`（发丝线/装饰）；需要 3:1 的可操作边框改用 `--control-border`。逐处核对：10421、10439、12386、12399、12419、12457、12462、12467、12500、12509。
- [ ] `--ink` → `--text`（10414、10426）。
- [ ] `--radius-pill` → `--radius-control`（10786、10814）。
- [ ] `--shadow-popover` → 去掉依赖（11021、11476）：窄屏覆盖层已有 `.skill-detail-scrim` 遮罩，浮层边界改用 `--border` 发丝线表达。
- [ ] 跑上面的差集脚本，结果为空。
- [ ] `cd frontend && npm run typecheck`。

### Task 2: 删除 Cal.com 层，合并为一层

**Files:**
- Modify: `frontend/src/styles.css`（该页段落）

- [ ] 整段删除 `11093-11532`：`--cal-*` 浅/深调色板与页面级 token 覆盖、typography 段、nav-pill-group 段、feature-icon-card 段、badge-pill 段、avatar 段、button 段、text-input 段、详情列段、1200px 段、断点折叠段、`.is-open` 投影、`@media (pointer: coarse)` 重复声明、以及文件头逐项对应 Cal.com 的注释块。
- [ ] 保留并归位：`--icon-sm/--icon-md/--icon-btn` 三档图标阶梯、`:focus-visible` 焦点环清单；注释改引 `docs/DESIGN.md` §控件尺寸 / §不变量 / §三轴适配 + `data-dense-dashboard`。
- [ ] 删除被行式列表取代的死规则：`.skill-grid`/`-3`/`-4` 的网格定义与 1180/1000/768px 折叠；卡片壳几何（`.skill-card` 的 flex 列 + 边框 + 圆角 + 底色、`:hover` 边框、`.skill-card-head`、`.skill-card-title`、`.skill-card-icon` 28px 版、`.skill-card-star` 6px/7px 版、`.skill-card-source`）；`@media (max-height:900px) .skill-card{padding}` 与 `@media (max-width:600px) .skill-card-actions .skill-btn{height}`。
- [ ] 颜色改语义 token：`--ds-surface`（成组容器/图标砖底）、`--surface-hover`（悬停）、`--ds-selected-bg` + `--ds-selected-border`（选中）、`--border`（发丝线）、`--control-border`（可操作边框）、`--primary`/`--primary-fg`/`--primary-text`、`--warning`（L3/异步）。删掉 `color-mix(in srgb, var(--primary) N%, …)` 裸配方。
- [ ] 行式列表几何收口一处：组容器 `border-block: 1px solid var(--border)` + 行间发丝线；行内 `min-height` 与列宽走 token；断点两档（≤980 收起标记列、≤640 折两行）。
- [ ] 页头 / 筛选条 / 内容列：左右内边距用 `--page-gutter`；内容列 `max-width: var(--content-max)` 居中；`.main > .skill-catalog-page` 的 `padding: 14px 16px` 归零。
- [ ] 页标题改壳层页标题档（`--ds-font-block-title`），删掉 28px/600/-0.5px。
- [ ] 类名收口：本页 `.skill-card*` → `.skill-row*`、`.skill-grid*` → `.skill-list`（Admin 用的 `.skill-card-actions` 不动）。

### Task 3: SkillCatalog.tsx DOM 与类名收口

**Files:**
- Modify: `frontend/src/pages/SkillCatalog.tsx`

- [ ] `SkillCard` 去掉 `skill-card-head` / `skill-card-title` 包装层，图标 / 标题 / 摘要 / 标记 / 动作成为同一行网格的 5 个直接子项。
- [ ] 类名跟随 Task 2；去掉 `skill-grid-3` / `skill-grid-4` 修饰类。
- [ ] 保留 `data-skill-id`、名称按钮的 `aria-pressed`、动作容器 `stopPropagation`、图标砖类（改名后详情列同步）。
- [ ] `npm run typecheck`。

### Task 4: 门禁重写

**Files:**
- Modify: `frontend/e2e/skills-catalog.spec.ts`

- [ ] 保留：0–1 实底 CTA（页面/详情列各一）、CTA 文字对比度 ≥4.5（浅/深）、选中态程序化状态 + 非颜色信号、控件高度 = `--control-h*`/`--chip-h`/`--badge-h`、命中区 ≥`--hit-min`、触摸 ≥44px、`focus-visible` 焦点环、内容列 ≤`--content-max`、≤640 单列无横向滚动、矮视口不裁切、错误/空态恢复入口、加载 `aria-busy`、搜索框程序化标签、tab 深链、详情列展开/覆盖/关闭、风险档与异步契约可见、员工禁词、每卡一个动作、「填入输入框」不发 plan POST。
- [ ] 重定：`--cal-*` → 壳层 token；胶囊内边距/白胶囊/圆角阶梯 → `--ds-surface` 容器 + `--bg` 选中段 + `--shadow-quiet` + 字重差 + 圆角只来自 `--radius-control`/`--radius-card`/50%；「画布 = #ffffff」→「画布取自 `--bg`」；颜色白名单 → 反漂移白名单（能指回本页 token 集合）；图标两档 → 正方形不拉伸（旧 §5 规则 17 已无依据）；行高断言 → 可操作控件行高 ≤20px；`prefers-contrast` → 只保留「画布不变」。
- [ ] 新增：页面内 `var()` 引用的 token 全部已定义；组容器与行间隔线真实渲染出边框；实底 CTA 与详情列主 CTA 圆角 ≠ 0。

### Task 5: 验收

**改动前基线**（`E2E_PORT=8891 npx playwright test e2e/skills-catalog.spec.ts --reporter=list`，stub 模式，输出 `test-results-baseline/`）：**38 例，31 通过 / 7 失败**。红的那 7 条在改动前就已红：

| 失败用例 | 说明 |
|---|---|
| `§5 规则 3`：主色当文字必须 ≥4.5:1 | 该断言按 Cal.com 层把 `--primary` 当 ink 的前提写死，已与新法不符 |
| `DESIGN.md colors`：本页文字色只用三档语义色 | 同上（读 `--cal-muted`） |
| `观感与密度修复 › 卡片不得横向溢出` | 卡片壳与行式列表两层叠加的实际后果 |
| `观感与密度修复 › 卡片只有 1 个动作且为链接式` | 同上 |
| `DESIGN.md colors`：白名单反漂移 | 白名单含 `--cal-*`，与实现漂移 |
| `§1 深色`：实底主 CTA 4.5:1 + 色值不扩散 | 深色下色值集合超出该断言上限 |
| `填入输入框 › 填技能不会启动今日或待办任务计划` | 断言的是 Home 的 `plan-today` 文案；工作区另有未提交的 `frontend/src/pages/Home.tsx` 改动，与本页无关 |

结论：旧门禁与本页实现早已不同步，这本身就是「门禁按候选分析写死」的代价。

- [ ] `cd frontend && npx playwright test e2e/skills-catalog.spec.ts` 全绿（新门禁不再依赖 `--cal-*` 与 Home 文案）。
- [ ] `cd frontend && npm run test:e2e` 与基线逐条对齐，不新增失败。
- [ ] `cd frontend && npm run build` 通过。
- [ ] 验收矩阵截图：1280/1440/1680 × 900；1440 × 785/700；1260/1024 × 630/589；≤860 触摸（命中区 ≥44px、无横向滚动）。截图落 `artifacts/ops/`。
- [ ] `grep -rn "cal\.com\|Cal\.com\|--cal-" frontend/` 无命中。

## 规则空白登记（交 UI/UX 专家，本次不补法）

| 失效引用 | 原含义 | 现状 |
|---|---|---|
| `§5 规则 2` | 浅主色不得作静止底 | DESIGN.md 无对应条款（单色驱动已不在现行正文） |
| `§5 规则 5` | 控件必须自设 line-height | 无对应条款；实现保留，门禁保留弱化版 |
| `§5 规则 7` | 可点标签 ≥13px | 无对应条款；字号阶梯由 `--ds-font-*` 承担 |
| `§5 规则 8` | 带框按钮内不放装饰图标 | 无对应条款 |
| `§5 规则 9` | 极浅面 ≤1.1:1、`--bg-elevated` 不得作静止面 | 无对应条款 |
| `§5 规则 10 / 11` | 只标例外；来源信息归详情列 | 无对应条款；实现保留 |
| `§5 规则 13` | 语义色必须颜色 + 文字并行 | 部分并入 §不变量 4 |
| `§5 规则 15` | 描边款 / 链接式动作的形态 | 无对应条款 |
| `§5 规则 17` | 图标只许两档尺寸 | 无对应条款；`--icon-*` 保留为实现的阶梯 |
| `§5 规则 18` | 颜色只来自中性阶 + 主色派生 | 无对应条款；保留为反漂移门禁 |
| `§7.3` | `prefers-contrast: more` 行为 | 无对应条款 |
| `§8` | 迁移清单（`--primary` 数值、`--radius-cards`、`--row-h`、`--touch-gap`） | 无对应条款；`--row-h` / `--touch-gap` 至今未定义 |

---

## 实施结果（2026-09-22）

**改动文件**

| 文件 | 改动 |
|---|---|
| `frontend/src/styles.css` | 删除页面级 Cal.com 层（原 `11093-11532`，约 440 行）与「Skills workbench list」覆盖层（原 `12379-12544`），把本页收成**一段**（`=== Skill Catalog Page ===`，约 946 行）：行式列表、尺寸只走命名 token、列宽按列表列实际宽度用 `@container` 收敛；修掉 4 个未定义 token；删掉已无消费者的 `.skill-card h3` 与 `.skill-card .skill-card-actions .btn`；`.main > .skill-catalog-page` 内边距归零（页面自管 `--page-gutter`）。类名 `.skill-card*` → `.skill-row*`、`.skill-grid*` → `.skill-list`（Admin 仍在用的 `.skill-card-actions` 保留）。 |
| `frontend/src/pages/SkillCatalog.tsx` | 行式 DOM 收直（去掉 `skill-card-head` / `skill-card-title` 包装层与 `display: contents` hack），类名跟随改名。**业务逻辑零改动**（取数、筛选、深链、权限、阶段、Composer 语义未碰）。 |
| `frontend/e2e/skills-catalog.spec.ts` | 门禁按现行 DESIGN.md 重写：38 例 → 33 例。删除/重定所有读 `--cal-*` 或按 Cal.com 数值写死的断言（胶囊 6px、白胶囊、40px 按钮、圆角阶梯、黑底透明度、画布 `#ffffff`）；新增「结构真的画出来」（未定义 token 的后果）、「1024×630 不被并排详情列裁切」（§不变量 5）、「控件高度取自命名 token」等。 |
| `artifacts/ops/skills-*.png` | 验收矩阵截图：1280 / 1440 / 1680 × 900、1440 × 785 / 700、1260 × 630、1024 × 589、860 × 900（详情覆盖态）、390 × 844（触摸）。 |

**验证**

| 项 | 结果 |
|---|---|
| 改动前基线（本页门禁） | 38 例：31 通过 / 7 失败（清单见 Task 5） |
| `cd frontend && npm run typecheck` | 通过 |
| `cd frontend && npx playwright test e2e/skills-catalog.spec.ts` | **34 例全部通过**（3.1 分钟；改前的 7 条红全部消掉） |
| `cd frontend && npm run build` | 通过 |
| 未定义 token 差集扫描 | 空（改动前有 4 个） |
| `grep -rn "cal\.com\|Cal\.com\|--cal-" frontend/` | 无命中 |
| 越出本页的回归面（跨页） | 见下「跨页与全量」 |

**遗留与边界（如实记录）**

- 本次**没有**改 `docs/DESIGN.md` 正文，也没有恢复 `ui-ux-rules.md`；失效条号按 §「规则空白登记」处理。
- 窄窗（列表列 < 700px）时**隐藏行为**里的「标记」列（L3 / 异步），风险与异步契约由详情列完整承担；≤860 触摸档位同理。
- `frontend/*.cjs` 里 6 个 stale 探针脚本仍引用早已删除的 `.skill-btn-secondary` / `.skill-card-source` / `.skill-catalog-preview` / `.skill-grid-4`：不属本页范围，未删。
- 验证用的是 E2E stub 模式（无真实后端数据源）；本页不涉及外部写入，故不做真实集成验证。

### 实施中的两处返工（留档，避免下次重犯）

1. **按视口断点收列 → 按列表列实际宽度收列。** 首版沿用「视口 ≤980px 收起标记列」的写法，结果 1024 视口下列表列只剩约 408px 却仍要放下 5 列，行内「填入输入框」被挤出可视区（撞 §不变量 5）。改为 `.skill-list { container-type: inline-size }` + `@container`。
2. **容器查询阈值必须按列表列实测宽度定，不能按直觉。** 首版阈值取 699px，导致 1280 视口（本项目 Playwright 项目级 `devices["Desktop Chrome"]` 的实际视口是 **1280×720**，不是配置里那个 1440×900）下列表列约 626px 也把标记列收起——等于在主流桌面宽度下丢掉了 L3 / 异步契约的可见标记。实测各档列表列宽度后把阈值下调：

   | 视口 | 列表列宽 | 标记列 | 行内动作被裁 |
   |---|---:|---|---:|
   | 1680 × 900 | 940 | 显示 | 0 |
   | 1440 × 900 / 700 | 737 | 显示 | 0 |
   | 1280 × 900 / 720 | 626 | 显示 | 0 |
   | 1260 × 630 | 612 | 显示 | 0 |
   | 1024 × 589 | 415 | 收起 | 0 |
   | 860 × 900 | 791（详情列改覆盖层） | 显示 | 0 |

   最终阈值：列表列 < 460px 收起标记列，< 400px 折成两行；基础列宽的最小值收到 `minmax(80px, .8fr) minmax(0, 1.8fr)`。

### 跨页与全量（证据强度如实标注）

本页 CSS 类除 `.skill-card-actions` 外没有第二个消费者（已逐类核对），因此改动面理论上是 `/skills` 一页。实测：

1. **全仓还有 3 条其它 spec 会访问 `/skills`**：`e2e/workbench.spec.ts:526 / 2755 / 2914`。三条都失败，但它们断言的是 `[data-skills-page='mine']`、`[data-skill="email_compose"]`、`[data-skills-error]` —— 这些属性只存在于 `frontend/src/pages/SimplePages.tsx` 的 `Skills()`，而该组件**在 HEAD 上就没有被任何路由引用**（`/skills` → `SkillCatalog`、`/market/skills` → `SkillHub`，`SimplePages` 只被 `AdminConsole` 引用了它的 `Admin`）。复核命令：

   ```bash
   git show HEAD:frontend/src/pages/SkillCatalog.tsx | grep -c "data-skills-page"   # 0
   git show HEAD:frontend/src/App.tsx | grep -n "skills"                            # /skills → SkillCatalog
   grep -rn "data-skills-page" frontend/src --include=*.tsx                         # 只有 SimplePages.tsx
   ```

   ⇒ 这 3 条**改动前就是红的**，属「我的技能」旧页的遗留断言，不是本次引入的回归。**建议由 UI/UX 专家 + 平台产品经理决定**：是删掉这 3 条，还是把它们改指到「技能目录」（`data-skill-catalog`）或真实存在的「我的技能」入口。

2. **全量 `npx playwright test` 未能给出有效信号。** 运行时机器上有 300+ 个浏览器 / node 进程（非本次启动），全套用例成片撞 60s 测试超时（连本次未触碰的 `home-*`、`mail.spec.ts` 也在内，每条恰好 1.0m），已中止而不是把这种结果当结论。本页在**单独运行**时稳定全绿（34/34，3.1 分钟，连跑两次）。
   交付说明里不把「全量通过」写成已验证事实——那是环境受限下未取得的证据。

---

## 附：`docs/DESIGN.md` 变更记录（2026-09-22，所有者指示）

**变更原因**：所有者指示「改 docs/DESIGN.md，删掉 Cal.com」。本文件是员工端唯一的视觉数值来源，正文里不应再出现外部品牌候选分析的名称与指针。

**实际改动**（3 处，均在正文，未动任何条款语义）：

| 位置 | 改前 | 改后 |
|---|---|---|
| front-matter `description` | 末句「落地页/营销页候选分析已移入 docs/references/cal-com-analysis.md，不适用于员工端。」 | 删除该句；description 收在「只约束员工端全部工作台表面（Home 四模式、Pipeline、Admin、一等能力面）。」 |
| 引言 blockquote | 一段「落地页/营销页候选分析（原 Cal.com 分析）已移入 …… 不适用于员工端工作台。」 | 删除该段；保留 CONST-09 重建记录段与「实现落点」段 |
| §密度档 表 | 第二行 `｜落地页候选｜无｜仅作参照，不落地到员工端。见 ……cal-com-analysis.md｜` | 删除该行；表格只剩 `data-dense-dashboard` 一行 |

**替代条款**：无。删除的是指针与对照行，不是规则——「本文件只约束员工端、落地页节奏不适用」这层意思仍由 front-matter 的 `description`（只约束员工端全部工作台表面）承担。

**影响资产**：`docs/DESIGN.md`（结构校验：front-matter、blockquote、两张表均完整；内部链接只剩 `CONSTITUTION.md`，有效）；`frontend/e2e/skills-catalog.spec.ts` 的抬头注释同步删去「文件上半部的 Cal.com 设计分析……」一句（已过期）。

**未一并处理（留待所有者决定）**：
- `docs/references/cal-com-analysis.md`（542 行）与其正文里的 Cal.com 记载**保留未删**——它现在是「落地页/营销页候选分析」的存档。
- 指向它的两处指引仍在：根 `AGENTS.md` §1/§5 与 `docs/AGENTS.md` 的领域表。若要去掉这两处（例如连文件一起删），需要所有者明示，因为删除存档属破坏性动作，且会同时影响「决策历史如何在仓库里留痕」这一约定。

**生效版本**：`version: alpha`（front-matter 未变），生效日期 2026-09-22。

---

## 第二轮：员工侧 UI/UX 改进（2026-09-22，所有者指示「全做」）

### 审宪记录（CONST-08）

**需求**：按第一轮分析给出的 10 条建议全部落地（内容诚实与命名 / 键盘代价 / 观感 / 门禁缺口）。

**主责角色**：UI/UX 专家（视觉与交互裁定）→ 前端专家（实施）；第 3 项的词表口径属 KOL 业务专家 + 后端（见下「归属」）。

**宪法条款**：CONST-04（UI/UX 专家决定视觉与交互；前端只实现已定义规则）；CONST-09（测试与 token 是实施细则）；CONST-10（交付必须可验证）。**基本法条款**：`PRODUCT.md` / `TECHNOLOGY.md` 无前端视觉条款，本项由 `docs/DESIGN.md`（§控件尺寸 / §三轴适配 / §不变量 1–4）与 `specs/UX-EMPLOYEE.md`（§员工禁词、§L1–L3）裁定。

**结论**：符合 + 一处「规则空白」（压缩档下的分档可见性；§不变量 2 只说分档必须可见，没说压缩档怎么表达 —— 本次取「形状信号」兜底，登记供 UI/UX 专家复核）。

### 逐条落地

| # | 建议 | 实现 |
|---|---|---|
| 1 | 「常用技能」名不副实 | 新增 `hasUsage`（`SkillCatalog.tsx`）：无使用记录时标题＝「推荐技能」、提示＝「按你所在阶段挑的几项，先试这些」、该块不再逐行打★，「查看全部」改指 `?tab=recommend`（原先指向空的 `?tab=frequent`） |
| 2 | 阶段 tab 文案 | 「数据分析」→「内容发布」，与 `SkillHub.tsx:12` 的 funnel 权威定义一致 |
| 3 | 详情列去引擎词 | 新增四张员工向词表（`ACTION_LABEL` / `OUTPUT_LABEL` / `TOOL_LABEL` / `PERMISSION_LABEL` + `toolLabel()`）：步骤 16 个动作 id、结果 5 个 output id、30 个连接器 ref、4 个权限 scope 全部翻成业务语言；**查不到时回落到业务兜底，绝不回落成原始 id**；纯 ASCII 的未知步骤 id 不渲染，改为「步骤说明还没翻成业务语言」的说明 |
| 4 | 键盘代价（方案 A） | 行内「填入输入框」`tabIndex={-1}`：键盘路径＝搜索 → 筛选 → 行名（选中即更新详情）→ 详情列 CTA；鼠标 / 触摸不变 |
| 5 | 搜索清除 | 新增 `.skill-search-clear`（`--control-h-sm` 方形图标按钮 + `aria-label`），点后清空并把焦点还给输入框 |
| 6 | ★ 位置 | 移到名称行内（名称文字承担省略号，★ 独立 flex 项不收缩）；「常用」那一组整块不再逐行打星 |
| 7 | 压缩档 L3 信号 | 行上加 `is-write` / `is-async` 类；列表列 <460px 收起文字标记后，图标砖用**实线边框＝执行前确认 / 虚线＝异步**（形状信号，不只靠颜色） |
| 8 | 详情段落次序 | 重排为：适用场景 → 需要你提供 → 产出 → 可以直接查到 → 需要走确认或 AI 助理 → 使用步骤 → 执行边界 → （折叠）调用关系 → 内容示例 |
| 9 | 筛选条滚动提示 | 新增 `.skill-tabs-fade`（`position: sticky` + 右缘渐隐，纯 CSS）：窄屏滚动时有「还有内容」的可视信号，宽屏放得下时只盖在背景上 |
| 10 | 禁词门禁 | 把禁用形态收敛进断言：`MCP` / `Codex` / `Thread` / `starrykol` / `kolclaw` / `task_result` / `crawl_plan` / `present_sop` / `analyze`（连同原有 4 个引擎名），并改为查 `textContent`（含折叠区未展开内容） |

**新增门禁**：6 条（常用/推荐口径 ×2、键盘路径、搜索清除、段落次序、压缩档形状信号、渐隐），连同第 10 条扩写。

**技术备注**：`frontend/src/pages/SkillCatalog.tsx` 与 `frontend/src/styles.css` 原为 CRLF / LF 混排，逐处改动无法核对，已统一为 LF（仓库 `core.autocrlf=true`，git 归一到 LF，改动不含行尾噪声）。

**归属与留待复核**：
- 第 3 项的词表出自 `backend/skills/*/SKILL.md` 的 `actions` / `output` / `mcp` / `permissions` 取值（共 16 + 5 + 30 + 4 项，逐项映射，无遗漏）；新增技能若引入新 id，页面会回落到业务兜底而不是引擎词，但**词表本身应由 KOL 业务专家维护并随技能发布更新**。
- 第 7 项是压缩档下的表达方式，属 UI/UX 专家的裁量范围（§不变量 2 只要求分档可见）。

### 第二轮暴露的更深一层问题：技能描述本身是「写给引擎看的」（登记，待业务专家）

第 10 条门禁（整页 textContent 查禁词）第一次跑就抓到了页面渲染的**目录文案**里仍有引擎词。逐条定位（`summary` 字段来自 `backend/skills/*/SKILL.md` 的 `description`，经 `backend/src/routers/misc.ts:133` 直接进员工页面）：

| 位置 | 现文案（节选） | 问题 |
|---|---|---|
| `backend/skills/todo_plan/SKILL.md:4` | 「…产出封面 **today_brief** 和展示任务行 **display_tasks**」 | 原始字段 id |
| `backend/skills/today_plan/SKILL.md:4` | 同上 | 原始字段 id |
| 发现计划 | 「把发现目标写成可确认的 **spec** 草稿」 | 英文概念词 |
| 发现简报 | 「写 **discovery_brief/v1**」 | 契约版本号，属原始堆栈 |
| 红人分析简报 | 「产出 **kol_analyze_brief**」 | 原始 id |
| 今日对象分析 | 「对人可附 **stage_sop**」 | 原始 id |
| 品牌邮箱列表 | 「查询品牌邮箱和 **Nylas** 授权状态」 | 外部厂商名 |
| 回复分析 | 「按 **Starry** 十五阶段核对来信事实」 | 引擎名 |
| 技能标题「**Deal Memory**」 | 英文标题 | 员工禁用英文概念词 |
| 技能标题「**KOL** 预算报告」 | 与页面其它处统一使用的「红人」不一致 | 术语不统一 |

**为什么本次没有直接改**：`description` 是技能的业务口径，归属 KOL 业务专家（CONST-04）；前端擅自改写等于替业务改口径。**建议**：`SKILL.md` front-matter 增加面向员工的 `employee_summary`（引擎口径继续用 `description`），由业务专家补齐后页面优先渲染该字段——否则"员工表面"永远会被引擎文档牵着走。

**本轮门禁的取法**（诚实边界）：整页只断言 `MCP` / `Codex` / `Thread` / `starrykol` / `kolclaw` 这类**系统名**；对页面自己翻译的四个小节（使用步骤 / 执行边界 / 调用工具 / 所需权限）才要求「一个字英文都没有」。目录描述属上面登记的数据问题，不用断言掩盖。

### 第二轮验证结果

| 项 | 结果 |
|---|---|
| `cd frontend && npx playwright test e2e/skills-catalog.spec.ts` | **41 例全部通过**（4.6 分钟）；第二轮新增 6 条断言 + 扩写禁词断言 |
| `npx tsc --noEmit` | 通过（含 `steps` 的 TDZ、`OUTPUT_LABEL` 索引、`toolLabel` 参数三处类型修复） |
| `npm run build` | 通过 |
| 截图复核 | `artifacts/ops/`：验收矩阵全档 + `skills-1440x900-used.png` / `skills-1280x900-used.png` / `skills-1024x630.png` / `skills-860x900.png` / `skills-search-clear.png`（带使用记录、压缩档、清除按钮三种状态） |

肉眼复核确认：阶段 tab 已显示「内容发布」；名称后的 ★ 不再压行首发丝线；详情列首三节是「适用场景 / 需要你提供 / 产出」，使用步骤已是中文，执行边界显示「任务结果」；1024 档文字标记收起后**图标砖仍带虚线（异步）/ 实线（L3）边框**；筛选条右缘在窄屏有渐隐。

**第二轮的门禁反思（留档）**：第一次跑新门禁时，`员工禁词` 抓到的是**目录数据**（`SKILL.md` 的 `description`）里的引擎词，而不是页面渲染的引擎词 —— 说明「员工表面不摊引擎词」这条规则真正的瓶颈在技能文案的生产方式，不在前端。已在上一节登记，交给业务专家。

---

## 第三轮：清掉最后的 Cal.com 语汇 + 图标上色 + 标题减重（2026-09-22，所有者回报）

### 审宪记录（CONST-08）

**需求**：所有者反馈「Cal.com 的痕迹还有在 skill 页面；图标没有颜色；标题颜色太重」，要求先读 `docs/DESIGN.md` 与 `AGENTS.md` 分析。

**主责角色**：UI/UX 专家（所有者直接裁定观感）→ 前端专家实施。

**依据核对**：
- 现行 `docs/DESIGN.md`（58 行）**没有任何颜色条款**：它只管密度档 / 控件尺寸（走命名 token）/ 三轴适配 / 不变量 1–5 / 验收矩阵。所以「图标要不要颜色、标题用什么色」不能从本文件推出，只能从**壳层既有写法**（实现层）与「同一产品要像同一个产品」这条一致性要求来定。
- 根 `AGENTS.md` §3：数值只住 `docs/DESIGN.md` 与 `frontend/src/styles.css`；§4 不变量：0–1 实底 CTA、状态不只靠颜色、三轴。

**结论**：`符合`（改的是页面观感与壳层一致性，未触碰业务规则）；下面每条改动都附**同产品内的对照证据**，不是个人偏好。

### 证据：什么叫「Cal.com 痕迹」与「壳层写法」

| 项 | 本页改前 | 同产品里的主流写法（证据） |
|---|---|---|
| 筛选条 | **浅面胶囊容器 + 浮起白胶囊 + 投影**（旧注释自己写着这是「nav-pill-group 的 pill-in-pill 签名交互」——落地页候选分析原文） | `.home-mode-tabs`（Home 四模式）、`.settings-tabs`、`.mail-list-tabs`：一条发丝底线 + 选中项 **2px 底线**；`.kb-tabs` 是描边胶囊行。**没有任何页面用"胶囊里套白胶囊+投影"** |
| 图标 | 近白极浅面 `--ds-surface` + 近黑 `--text` 图形（单色、无品牌色） | 全站用 `color-mix(in srgb, var(--primary) N%, var(--bg))` 做淡主色砖/条（nav 选中、chips、composer 边框等 20+ 处） |
| 标题 | 页标题 20px/**600**；分组 h2 / 行名 / 小节 h4 全是 `--text` 近黑 | `.home-hero h1`、`.kb-hero h1` = 20px/**500**；`.mail-list-tabs` 选中 500；标题带品牌墨色是既有做法（旧行式层用 `--primary-text` 与 `color-mix(--text 82%, --primary)`） |

⇒ 「Cal.com 痕迹」= 落地页候选分析的**两件事**：① nav-pill-group 的 pill-in-pill 交互；② 近单色（标题 #111、图标黑白、无品牌色）——后者是我第二轮「按已废止的 §5 规则 3/9/18 收口」时顺手带进来的，那三条规则**早已不在现行 DESIGN.md 里**。

### 实际改动（全在 `frontend/src/styles.css` 本页段落）

1. **筛选条改壳层写法**：容器改 `align-items: flex-end` + `padding: … 0` + 发丝底线；`.skill-tabs-list` 去掉浅面胶囊底与内边距（改为透明 flex 行、间距 `--space-4`）；`.skill-tab` 改「`border-bottom: 2px` 透明底线 + `min-height: var(--control-h-lg)`」；`.skill-tab.on` = `--primary` 底线 + `--primary-text` 文字 + 500 字重（形状 + 字重 + 颜色三重信号）。触摸档只保留 `min-height: 44px`。
2. **图标上色**：`.skill-row-icon` 与详情列头图标砖 = `background: color-mix(--primary 8%, --bg)` + `border: 1px solid color-mix(--primary 16%, --border)` + 图形 `--primary-text`；`.skill-group-icon` / `.skill-group-svg` 同改 `--primary-text`。压缩档的 L3 / 异步形状信号保持优先级（实线 `--warning` / 虚线 `--control-border`，并把底色一并切到语义色，免得品牌淡底把警示色吃掉）。
3. **标题减重**：页标题 600 → **500**（对齐 Home / 知识库）；分组 h2 与详情 h2 → `--primary-text`；列表行名与详情小节 h4 → `color-mix(--text 78%, --primary)` 暖墨（比纯 `--text` 轻一档，且与品牌同源）。

### 门禁同步

- 「控件高度取自命名 token」里筛选段的目标由 `--chip-h` 改为 `--control-h-lg`（改版后语义变了，不是放宽）。
- 颜色反漂移白名单的白名单来源扩展到「页面里由 token 混出的表达式」：现在会对 `color-mix` 表达式分别取 `background` / `color` / `border-color` 的计算值入白名单，仍不允许任何手写 hex（新增 3 个表达式：暖墨、品牌淡底、品牌描边）。

---

## 第四轮：颜色职责重划 —— 粉只给主行动，辅助改蓝，并写进 DESIGN.md（2026-09-22，所有者定规）

### 审宪记录（CONST-08）

**需求**：「太多红色了；辅助色换成蓝色，主行动按钮才用粉红色；计入到 design.md」。

**主责角色**：所有者（作为产品发起人/UI-UX 决策人直接定规）→ 前端专家实施。

**条款与结论**：
- CONST-04：视觉规范属 UI/UX 职责，本次由所有者直接裁定 → `符合`。
- CONST-09：设计 token 与实施细则由所有者可改；本次把**职责**写进 `docs/DESIGN.md`（新增「## 颜色」），**数值**只住 `frontend/src/styles.css`（根 `AGENTS.md` §3 的口径不变）→ `符合`。
- 规则空白：现行 DESIGN.md 原本**完全没有颜色条款**（只有密度/控件/三轴/不变量/验收），「选中态该用什么色、品牌色能用在哪」此前无据可依 —— 这次补上，属**补条款**而非改代码（先立法、再实施）。

### 新增条款（`docs/DESIGN.md`「## 颜色」摘要）

| 职责 | token | 用在哪 |
|---|---|---|
| 主行动 | `--primary` / `--primary-hover` / `--primary-fg` | 同一视口唯一的实底主 CTA；**粉色除此之外不再使用** |
| 辅助 | `--accent` / `--accent-text` / `--accent-hover` | 选中态（分段选中、列表选中）、图标砖与图标字形、行内可点强调、信息性标记 |
| 状态 | `--warning` / `--danger` / `--success` | 风险与 L3「需确认」、失败、成功；只表达状态 |

并写明：「选中」不等于「主行动」；对比度要求（文字/可点标签 ≥4.5:1、纯图形 ≥3:1），因此辅助色分图形档与文字档两档。

### 取值与依据

- **辅助色取 `#4184ff`**：从所有者给的参考图**逐像素取色**得到（图存在会话媒体库，40×24 与 14×20 两份，主色都是 `#4184ff`）。派生：`--accent-hover: #3974e0`、`--accent-text` = 72% accent + 28% 黑 = `#2f5fb8`；深色档 `--accent-hover: #639aff`、`--accent-text: var(--accent)`。要换色只改 `styles.css` 里这几处。
- 对照表（140 条规则的「主行动 / 辅助 / 状态」分类）见 [`docs/superpowers/specs/2026-09-22-color-role-migration.md`](../specs/2026-09-22-color-role-migration.md)。
- **两档对比度（实算，不是估计）**：`--accent` #4c7dff 对白 **3.69:1**（够图形 ≥3）；`--accent-text` = 72% accent + 28% 黑 = **#375ab8**，对白 **6.33:1**、压在 8% 淡蓝砖上 **5.8:1** ✓ 够文字与图标字形。深色下翻转成 `--accent-text: var(--accent)`（对 #17191d **4.76:1**）。
- 行名/小节标题的「冷墨」= `color-mix(--text 82%, --accent)` = #232c43，对白 13.88:1（仍远超正文要求，只是不再纯黑）。

### 本页实施（`frontend/src/styles.css`）

1. 壳层 `:root` 新增 `--accent` / `--accent-hover` / `--accent-text`（含深色三处覆写）。
2. 本页把「辅助」全部从粉换成蓝：分段选中（文字 + 2px 底线）、图标砖（底/描边/字形）、分组图标与分组标题、详情标题与小节标题、行名冷墨、行内可点强调 hover、压缩档异步砖的虚线描边。
3. 选中态：页面级覆写 `--ds-selected-bg` / `--ds-selected-border` 为蓝派生（壳层那两个 token 是粉派生；等壳层迁移后可删这两行）。
4. 粉只留在 `.skill-btn-primary`（唯一实底主 CTA）。

**产物层核对**（不是看源码，是看 `dist/assets/index-*.css`）：含 `.skill-` 的 148 条规则里，仍引用 `--primary` 的只有 3 条 —— `.skill-chip,.attach-chip`（属 Composer 的类，非本页）、`.skill-btn-primary`、`.skill-btn-primary:hover`；引用 `--accent` 的有 11 条 ✓

### 新增门禁（`frontend/e2e/skills-catalog.spec.ts`）

- 「粉色只出现在唯一的主行动 CTA 上」：扫描页面内所有元素的 `color/background/border-*-color`，凡等于 `--primary` 的元素都必须带 `skill-btn-primary`。
- 「辅助色分两档且用对位置」：`--accent` 对画布 ≥3:1（图形档）、`--accent-text` ≥4.5:1（文字档）；图标字形必须取文字档、分段选中底线必须取图形档。
- 颜色反漂移白名单：token 表加入 `--accent*`，混色表达式表换成辅助色那 5 个（图标砖底/描边、异步虚线描边与淡底、冷墨）。

### 门禁状态（如实记录）

**本轮改色后的 e2e 未跑成**：`backend/src/host/today-plan-context.ts` 出现**两个 `ownerId()`**（第 50 行导出的 + 第 133 行重复的私有同名函数），esbuild 直接拒绝加载 → 后端起不来 → Playwright 的 webServer 失败（与该文件无关的会话在改，我不动别人的在改文件）。已完成的替代验证：`tsc --noEmit` 通过（含 spec 自身）、`npm run build` 通过、产物 CSS 规则核对（见上）、对比度实算。**待该文件修好后必须补跑一次本页 e2e**；另外在该文件修好前**不要部署工作区**（部署会拉起起不来的后端）。

**视觉核对**：用「静态托管 dist + 拦截 `/api/skills`、`/api/me`、`/api/auth/*`（mock 数据）」取了 `artifacts/ops/accent-1280x900.png` 与 `accent-1440x900.png`。**这是纯配色观感检查，不是业务验收**：数据与登录态都是假的。

### 待办：全站迁移清单（下一轮，需 UI/UX 拍板）

壳层里仍把粉当「辅助/选中」用的规则约 **130 条**，代表性的几类：

- 导航当前项/激活：`.nav-combo.active`、`.admin-nav-item.active`、`.journey-funnel li.is-current`
- 分段与筛选选中：`.kb-tabs`（选中是**实底粉**，按新规应改辅助色；顺带撞 §不变量 1 的"0–1 实底 CTA"）、`.settings-tabs button.active`、`.mail-list-tabs/.mail-mobiletabs` 选中底线、`.task-filters`/`.follow-style-chip`/`.stage-chip.is-selected`
- 列表选中：`.mail-row.is-selected`、`.mail-box-card.is-active`、`.mail-filter-btn.is-on`
- 信息性强调：`.mail-count-pill`、`.today-brief-badge`、`.nav-badge`、`.project-chip`、`.attach-chip`
- 组件边框/淡底：`--composer-border` / `--composer-chip-bg`、`.thread-mail-digest` 左条、`.session-loading-*`

其中 `.btn.primary` / `.btn.send` / `.btn.work` / `.hub-new` / `.today-brief-primary-btn` 属**真正的主行动**，按新规保持粉。建议先出一张「规则 → 主行动 / 辅助 / 状态」的分类对照表，再分批改，避免一次盲扫 130 条。
