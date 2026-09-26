# 管理端左侧菜单复刻员工端侧栏外壳（除菜单文字外）

> 决策件，不是现行法。规则本体在 [`docs/DESIGN.md`](../../DESIGN.md)（§三轴适配、§控件尺寸、§不变量）、
> [`docs/ia-information-architecture.md`](../../ia-information-architecture.md)（§3 使用 ≠ 治理、§4 导航密度）、
> [`docs/org-permissions.md`](../../org-permissions.md)（§管理端配套套件）。
> 数值只住 `frontend/src/styles.css`，条目契约是 `frontend/src/layout/adminNav.ts`，
> 外壳实现是 `frontend/src/layout/Workbench.tsx`。变更记录见 [`docs/DECISIONS.md`](../../DECISIONS.md)
> 的 ADR-2026-09-26「管理端左侧菜单复刻员工端外壳（单壳共用）」。

## 0. 审宪记录（CONST-08）

- **需求**（用户 2026-09-26）：「除了菜单文字内容外，管理页的左侧菜单必须和用户端的左侧菜单完全复刻。」
- **主责角色**：UI/UX 专家（导航外壳、三轴适配与组件呈现）、平台产品经理（管理端 IA 不降级）、
  前端专家（实现）、测试经理（证据）；CONST-04、CONST-07。
- **宪法条款**：CONST-04（前端不重写权限判定）、CONST-07（两类界面各由产品与 UI/UX 规范约束）、
  CONST-08（先审宪再审法）、CONST-10（不得用测试通过冒充生产能力）。
- **细则条款**：
  - `ia-information-architecture.md` §3（配套 ≠ 副本：同一对象、不同问题）、§4（侧栏禁发明可见组标题、
    簇间只用分割线、管理端顶栏不得跳员工开工入口、员工进管理端仅账户块分段）；
  - `org-permissions.md` §管理端配套套件（管理端只回答谁 / 权限 / 审计；两侧共用 MASTER 语义 token，
    不得另开平行色盘，不得做成第二套 Home / Agents）；
  - `DESIGN.md` §三轴适配（导航轨道锁 260px、抽屉与触摸命中区）、§控件尺寸（尺寸只引 token）、
    §不变量 1 / 4 / 5、§验收矩阵；
  - `TECHNOLOGY.md` TECH-FE（不在页面重写权限、审批与阶段判定）。
- **结论**：**符合**。复刻范围是**导航外壳**——几何、条目解剖、分簇节奏、页脚、折叠与抽屉行为；
  不复制员工端的**信息架构**：管理端仍只回答「谁能用 / 用到哪 / 连到哪 / 是否发布 / 审计能否回放」，
  页头（当前账户 + 管理 chip + 健康条 + 返回员工工作台）与九个面板不动；`/admin` 条目集合仍是治理面。
  员工条目（新工作任务 / 进行中 / 定时任务 / 通讯）在 `/admin/*` 不渲染，管理端条目也不进员工侧栏，
  因此不构成「同一 chrome 的副本」。admin 判据仍是 `available_modes` 含 `admin`（`AdminConsole` 保留重定向）。
- **下一步**：按 §2 结构实施，按 §5 取证。

## 1. 范围

| | 员工端 | 管理端（本次改后） |
|---|---|---|
| 条目来源 | `Workbench.tsx` 内联（含徽标、懒加载 spinner、动态进行中链接） | `layout/adminNav.ts` 的 `ADMIN_NAV_GROUPS` |
| 外壳 | `Workbench.tsx` 唯一侧栏实例 | **同一实例**（`/admin/*` 时换条目集合） |
| 可见差异 | — | 只有菜单文字（9 个治理条目与其图标） |

## 2. 复刻达标清单（验收即按此逐项比对截图）

1. 轨道：桌面锁 260px（`--left-width`），`.workbench` 的 `data-left-width` = 260 / 折叠 56。
2. 头部：同一 `sidebar-head` = `BrandLockup` + Lucas 头像 + `collapse-toggle`；折叠按钮可点、
   写 `ui:left-collapsed` 与 `left_sidebar_collapsed` 偏好，刷新后保持。
3. 条目：`min-height 38px`、`padding 8px 10px`、`radius var(--radius-nav)`、18px 描边图标（stroke 1.85）、
   `gap 10px`、hover 底 `color-mix(--text 6%)`、active 底 `--color-ash`、`aria-current="page"`。
4. 分簇：`nav.nav-group` 共 5 簇，簇间 `border-top: 1px solid var(--border)`；
   **无可见组标题**（组名只进 `aria-label`）。
5. 页脚：`.sidebar-foot` = 应用版本号 + `AccountBar`（同一组件、同一几何）。
6. 滚动：`.sidebar-scroll` 细滚动条；`.sidebar-foot` 为 `flex: 0 0 auto`，矮视口不裁切内容。
7. ≤860px：`.sidebar` 隐藏为 `min(300px, 88vw)` 抽屉，`.mobile-top` 的 ☰ 打开；
   管理面顶栏文案为 `管理`，**不含**员工开工入口（`/`、`/agents` 链接为 0）。
8. 键盘：Tab 顺序与焦点环（`--focus-ring`）与员工端一致；触摸命中区 ≥44px。
9. 状态不只靠颜色：`aria-current` + 字重 + 底色同时变化。

## 3. 菜单映射（文字与 href 不变，分簇复刻员工端节奏）

员工端节奏：`今日(4) / 数字员工(1) / 技能(1) / 资产(6) / 项目(1)`。
管理端 9 条按同一语义角色落位（`layout/adminNav.ts`）：

| 簇 aria-label | 条目 label | href | `data-admin-nav` / `data-admin-tab` | 图标 |
|---|---|---|---|---|
| 治理日常 | 员工 | `/admin` | `employees` | 单人胸像（同账户块员工端图标） |
| 治理日常 | 数据 | `/admin/data` | `data` | 数据库（顶盖 + 柱身 + 中环） |
| 数字员工 | 数字员工治理 | `/admin/agents` | `agents` | 同员工端「数字员工」 |
| 技能 | 技能 | `/admin/skills` | `skills` | 同员工端「技能目录」 |
| 资产 | 知识 | `/admin/knowledge` | `knowledge` | 同员工端「知识库」 |
| 资产 | 审批 | `/admin/approvals` | `approvals` | 同员工端「审批」 |
| 资产 | 考试 | `/admin/exams` | `exams` | 同员工端「考试」 |
| 资产 | 连接器枢纽 | `/admin/connectors` | `connectors` | 同员工端「连接器」 |
| 平台配置 | 配置 | `/admin/kol` | `kol` | 滑杆（sliders-horizontal） |

- 资产簇的顺序与员工端资产簇一致（知识 → 审批 → 考试 → 连接器）；`数据` 回到「治理日常」簇第二位。
  该重排只为让分簇与员工端同形：条目文字、href、面板行为与权限闸门全部不变。
- 高亮与面板归一化同源：`adminTabOf(pathname)`（`/admin` 与未知段 → `employees`，与面板回落一致）。

## 4. 实现落点

- `frontend/src/layout/adminNav.ts`：`ADMIN_NAV_GROUPS` / `ADMIN_SECTIONS` / `adminSectionOf` / `adminTabOf`。
- `frontend/src/layout/Workbench.tsx`：`showAdminNav = onAdmin && adminAvailable`；同一 `sidebar-head`
  （品牌链接在管理面指 `/admin`）、同一 `sidebar-scroll` / `sidebar-foot`；`mobile-top` 按面切换。
- `frontend/src/pages/AdminConsole.tsx`：交出 `.admin-nav` 列与品牌块，只留 `.admin-shell > .admin-body`
  （页头 / 健康条 / 面板）；`data-admin-ia="governance"` 保留为钩子。
- `frontend/src/styles.css`：删除 `.admin-nav*`（含 `--admin-nav-width`、≤860px 横向顶条、暗色与 ≤720px 覆盖）；
  `.admin-shell` 改单列 flex，`.admin-body` 自管滚动；移除 `.workbench.admin-surface` 的隐藏与单列覆盖，
  并去掉侧栏轨道 / 折叠规则里的 `:not(.admin-surface)` 守卫（两侧同规则）。
- 过时断言与证据脚本：`frontend/src/layout/sidebarNav.test.ts`、`frontend/e2e/workbench.spec.ts`、
  `artifacts/account-footer/capture.cjs`。

## 5. 验证与证据

- `frontend`：`npm run typecheck`、`npm run build`。
- `backend`：`npx vitest run sidebarNav`（`sidebarNav.test.ts` 由 backend vitest 配置纳入）。
- `frontend`：`E2E_MODE=stub E2E_AUTH_MODE=disabled npx playwright test e2e/workbench.spec.ts -g "(admin console uses a left sidebar|admin left menu|admin agents governance|account bar switches|sidebar collapse persists)"`、
  `e2e/shell-metrics.spec.ts`、`e2e/connector-admin.spec.ts`、`e2e/admin-knowledge.spec.ts`。
- 目视矩阵（`node artifacts/account-footer/capture.cjs`）：`admin-sidebar-1440x900.png`、
  `admin-sidebar-collapsed-1440x900.png`、`admin-drawer-820x900.png`、`admin-drawer-390x844.png`，
  与同机位的 `employee-*.png` / `sidebar-rail-*.png` 对照 §2 清单逐项核对。

## 6. 边界与限制

- 不改九个管理面板内容、页头、健康条、审计切片、连接器枢纽 / 详情。
- 不新增 / 不改路由与权限判定；`available_modes` 不含 admin 时不渲染管理端条目，`/admin` 仍重定向到 `/`。
- 不给员工侧栏加管理端条目，不让管理端出现员工开工条目；不变更任何发送 / 阶段 / 解密 / 删除闸门。
- **折叠偏好两面共用**：同一 `ui:left-collapsed` 与 `left_sidebar_collapsed`。这是「同一外壳」的必然结果；
  若日后要求两面独立记忆，需另立一项并改存储键。
- 管理端配置面（`/admin/kol`）本次仍是遗留页，其内部信息架构不在本规格范围。
