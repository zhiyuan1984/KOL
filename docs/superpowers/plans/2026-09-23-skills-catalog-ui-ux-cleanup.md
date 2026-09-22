# 技能目录页（/skills）UI/UX 收口：批注 1–7 + 专家补充（实施记录）

日期：2026-09-23 · 主责角色：UI/UX 专家（视觉裁定，CONST-04）→ 前端专家（实施）· 门禁口径：测试经理

## 审宪记录（CONST-08：需求 → 主责角色 → 宪法条款 → 基本法条款 → 结论与证据 → 下一步）

**需求**：按员工批注修正 `/skills` 的呈现（阶段分隔符基线、字号 / 字重、图标砖颜色、异步标签、行内动作图标）。

**宪法条款**：CONST-04（UI/UX 专家决定视觉与组件呈现）、CONST-09（token 与测试是实施细则，不得覆盖上位条款，也不得为通过而偷改法）、CONST-10（交付必须可验证）。

**基本法条款**：本项由实施细则 `docs/DESIGN.md`（唯一视觉数值来源）、`docs/ia-information-architecture.md` §1、`docs/07-mcp-data-contract.md` 裁定；`TECHNOLOGY.md` / `PRODUCT.md` 无前端视觉条款。

**结论与证据**

| 项 | 结论 | 证据 |
|---|---|---|
| 分隔符基线、行名 / 组名字号字重、星标颜色、组间边界 | 符合（组件呈现，UI/UX 权限内） | `.skill-tabs-list` 用 `flex-end` + `.skill-tab-sep` `line-height:1` 盒底贴 tab 下内边距；`.skill-row-name` 14px/600、`.skill-group-header h2` 16px/600 + 辅助蓝；星标走 `--warning`（DESIGN.md §颜色：语义色只表达状态） |
| 图标砖按类别多色 | **违反实施细则**（先改细则再改码） | DESIGN.md §颜色「颜色只承担三种职责，不得互相串用」；实现统一 `--accent`，门禁把「字形 = `--accent-text`」写死 ⇒ 先增补第 4 职责「类别」再实施 |
| 移除行内「异步 · 可取消」文字标签 | 符合 | `07-mcp-data-contract.md` 只要求「不得伪装成同步」；本页动作是「填入输入框」，不执行作业。改为图标砖虚线形状信号常驻，详情列口径保留 |
| 行内动作去掉 ↓ 图标 | 符合 | 旧图（向下箭头 + 底线）＝通用「下载」图形 |

**下一步**：已按下述改动实施并验收。

## 改动

| 文件 | 改动 |
|---|---|
| `docs/DESIGN.md` | §颜色：三种职责 → 四种，增补「类别」（`--cat-*` / `--cat-*-text`）与三条约束（不承担交互 / 状态；不得成为唯一信号；两档对比度、浅深各验） |
| `frontend/src/styles.css` | ① 类别色四件套 token（浅 + 深色两套覆盖）；② 阶段组左侧发丝竖线（`[data-kind="stage"]`）；③ `.skill-tab-sep` 垂直居中 + 字号 12→13px；④ 组名 / 行名 → 13px / 500，组名墨色改 `--text`；⑤ 两处星标改 `--accent-text`；⑥ `.skill-row-icon` 三件套改读 `--tile-*`，四个 `[data-tone]` 块；⑦ 异步虚线砖提到基础规则（线色 = 砖内字形档）；⑧ 删 `.skill-link-svg` |
| `frontend/src/pages/SkillCatalog.tsx` | ① `SOURCE_TONE` / `skillTone()` + `data-tone`（列表行与详情列头）；② 行内异步文字标签移除（`is-write` 标记保留）；③ 行内动作去图标；④ 组标题 ★ 补 `aria-hidden`；⑤ tab 列表补 `data-kind`；⑥ 清理失效条号引用 |
| `frontend/e2e/skills-catalog.spec.ts` | 见下「门禁口径变更」 |
| `artifacts/ops/skills-ui-*.png` | 验收截图（1440×900 / 1280×720 / 1024×630 / iPhone 13 + 局部：筛选条、组头、异步砖、受控砖） |

## 门禁口径变更（逐条理由，CONST-09）

1. 「列表上出现任意 `.skill-mark`」→「出现 `.skill-mark.is-write`」：异步行改形状信号后，列表行上的文字标记只剩 L3「需确认」；异步另断言图标砖 `border-style: dashed`。
2. 链接式动作「必须带语义图标」→「不得再带图标」：↓ 图形被读成下载，UI/UX 裁定移除；「1 个动作 / 无框 / 常驻下划线」保留。
3. 「图标字形 = `--accent-text`」→ 类别色字形档 + 两档对比度断言（新增浅色与深色两组，含 `data-tone` 落位核对）。
4. `contrastOf` 支持 `color(srgb r g b)`（0–1）：Chromium 对 `color-mix` 结果返回该形式，旧解析把派生 token 读成 ≈0 的暗色、对比度恒为 1 —— 这是**修正**而非放宽；修正后 `--accent` 3.52:1、`--accent-text` 6.09:1 真实成立。
5. 反漂移白名单：加 `--cat-*` 全部 token；删已移除的 `accent 5% / 45%` 配方。

## 验收证据

| 项 | 结果 |
|---|---|
| `cd frontend && npm run typecheck` | 通过 |
| `cd frontend && npx playwright test e2e/skills-catalog.spec.ts` | **45 passed**（本页全部用例，含新增类别色浅 / 深两条） |
| `cd frontend && npm run build` | 通过（`tsc --noEmit` + `vite build`） |
| 目视（截图） | `›` 与词居中、组间竖线可见、4 色砖可辨（靛蓝 / 紫 / 青 / 石墨）、组名与行名与 tab 同档、异步砖虚线且无文字标签、行内动作无下载图标 |

页面门禁跑在**独立数据目录**（`data-e2e-verify`）：同一时刻工作区另有测试在跑，共用 `data-e2e` 会互相抢 SQLite 写锁（首轮 45 例里两条即因此超时 / 误报，非本页回归）。未跑全量 `npm run test:e2e`，跨页风险已按选择器核查为零：改动只落在本页选择器 + 新增 token；`.skill-mark` 基类未动（`composer/PlusMenu.tsx` 不受影响），`pages/Admin.tsx` 只用 `data-skill-market`。

## 遗留与边界（如实记录）

- **常用块 × 阶段块的重复**（同屏同一技能出现两次）：设计使然（常用是跨阶段捷径、阶段是规范位置），本轮登记不改；如要改＝「全部」视图下阶段分组剔除常用块 id，需产品点头。
- **员工面英文残留**：`backend/skills/discovery_brief/SKILL.md` 无 `employee_summary`，员工目录回落到引擎 `description`（「采集空闲后，按 Host 已过滤的候选人写 discovery_brief/v1」），撞 `specs/UX-EMPLOYEE.md` §员工禁词（英文 Skill 时序 / 原始堆栈）。修法是业务专家补一行 `employee_summary`；属业务文案，不在本页 UI 收口范围。
- **并发写入风险（2026-09-23 01:12 实测）**：同一工作区另有进程在改 `frontend/src/styles.css`（`today-board*` → `task-board*` 改名），01:12:02 它把整份文件回退到 HEAD，一次抹掉本页全部 CSS 改动（`.tsx` / spec / DESIGN.md 未受影响）。已重新落盘并在当前工作树上复验（45 passed）；本页的 11 个 hunks 另存为 `.local-backups/skills-catalog-ui-ux-styles.patch`，可用 `git apply` 一对一回放。自检：`git diff -- frontend/src/styles.css` 里应同时能看到 `--cat-*` / `data-kind="stage"` 等本页改动。
- 未改业务：取数、筛选口径、URL 深链、权限、阶段判定、Composer 语义一律未碰。
