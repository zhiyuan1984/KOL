# 账户块：员工端 / 管理端统一的新账户区（切换 · 设置 · 退出，去掉弹窗）

> 决策件，不是现行法。规则本体在 [`docs/DESIGN.md`](../../DESIGN.md)（§控件尺寸、§颜色、§不变量）
> 与 [`docs/ia-information-architecture.md`](../../ia-information-architecture.md)（§4 导航密度）；
> 数值只住 `frontend/src/styles.css`，组件实现是 `frontend/src/components/AccountBar.tsx`。
> 变更记录见 [`docs/DECISIONS.md`](../../DECISIONS.md) 的 ADR-2026-09-26「账户块取代账户菜单」。
>
> 2026-09-26 同日修订：按用户要求改为**单行**并**去掉角色文案**（原两行版含「管理员 / 员工」行）。

## 0. 审宪记录（CONST-08）

- **需求**：用户页面和管理页面统一新的账户区——第一个图标切换用户端 / 管理端，第二个个人设置，第三个退出；
  图标要更好；**弹窗不再需要**；随后追加：**一行排布、空间利用率要高、去掉「管理员」文案**。
- **主责角色**：UI/UX 专家（布局、导航交互、组件呈现与无障碍）、平台产品经理（员工端 / 管理端通用入口），CONST-04。
- **宪法条款**：CONST-04、CONST-07（两类界面由产品与 UI/UX 规范约束）、CONST-08、CONST-10。
- **细则条款**：`ia-information-architecture.md` §3 使用 ≠ 治理、§4 导航密度（第 84 行已同步为「仅账户块的『管理端』分段」）；
  `DESIGN.md` §控件尺寸（尺寸只引 token）、§颜色（选中态走 `--accent*`）、§不变量 1 / 4 / 5、§验收矩阵；
  `TECHNOLOGY.md` TECH-FE（不在页面重写权限、审批与阶段判定）。
- **结论**：**符合**。admin 判据仍是 `available_modes` / `roles`（`isAdminAccount`），无该模式时不渲染管理段；
  选中态用辅助色 + 形状 + `aria-current`，不使用 `--primary`，不占实底主 CTA；退出登录是会话动作，
  不新增 L3 闸门，也不与发送、删除、解密合并；页脚在矮视口与移动抽屉里都给内容让路。
  去掉角色文案不损失受控信号：管理端入口由分段本身表达，考试阻断仍有 `/exam` 闸门与侧栏「考试 · 待完成」徽标。
- **下一步**：按 §3 几何与 §5 证据实施并逐项截图核对。

> 注：本分支 `DESIGN.md` 尚无「管理端治理表面」一节（该节把账户区写作「账户菜单」）。合入含该节的版本时，
> 需把那两处措辞同步为「账户块」（头像 + 账号名 + 员工端⇄管理端分段 + 个人设置 + 退出登录，同一行常驻控件）。

## 1. 单行怎么放得下

用户要求一行放完「账号名 + 切换 + 设置 + 退出」。员工侧栏轨道锁 260px（`--left-width`），
可用内容宽约 236px；实测单行占用 **235px**：

```text
头像 28 + 间距 8 + 账号名（弹性，约 67px）+ 间距 8 + 分段 68 + 间距 4 + 设置 28 + 间距 4 + 退出 28 ≈ 235
```

三个前提：① **去掉角色文案**（管理员 / 员工，按用户要求），身份只留账号名；② 控件高度统一降到
`--control-h`（28px），分段段宽 30px、图标按钮 28px；③ 去掉分段与图标之间的 1px 分隔线。
账号名超长时省略号截断（`text-overflow: ellipsis`）；折叠 56px 轨道与移动端仍按竖排 / 单行各自适配。

## 2. 结构（`frontend/src/components/AccountBar.tsx`）

```text
.account-bar[data-account-bar]                      ← 一行（flex row）
├─ .account-identity.account-pedestal[data-account-pedestal][data-exam]   （flex: 1 1 auto，min-width: 0）
│   ├─ .account-avatar                       首字，辅助色淡底 + --accent-text
│   └─ .account-copy > .account-name[data-account-name]
└─ .account-actions                                 （flex: 0 0 auto）
    ├─ nav.surface-switch[data-surface-switch-group][aria-label=工作界面]   ← 仅 admin 可用时渲染
    │   ├─ a[data-surface-switch=employee] → "/"      title=员工端  aria-current(非 /admin/* 时 = page)
    │   └─ a[data-surface-switch=admin]    → "/admin" title=管理端  aria-current(/admin/* 时 = page)
    ├─ a.account-icon-btn[data-account-settings] → /settings（个人设置）
    └─ button.account-icon-btn[data-account-logout] → logout()（退出登录）
```

- 不再渲染角色文案（原 `.account-role[data-account-role]`）、分隔线（原 `.account-actions-split`）、
  弹窗（原 `.user-menu-wrap` / `.user-popover` / `.account-more`）。
- 用 `Link` 而不是 `NavLink`：当前工作面由 `aria-current` 显式表达（`/settings`、`/kb` 等员工面路径都算员工端）。
- 退出登录单次点击（会话动作，不在 L3 清单内），沿用 `AuthGate.logout()`。
- 管理端页头「← 返回员工工作台」保留不动。
- 图标在本组件内联渲染（`Ico`），与侧栏导航同一绘制口径；不新增跨模块图标依赖。

## 3. 图标（Lucide ISC，24×24 描边，线宽 1.85，`currentColor`）

| 位置 | 语义 | `d` |
|---|---|---|
| 员工端 | 单人胸像 | `M12 3a5 5 0 0 1 0 10 5 5 0 0 1 0-10 M20 21a8 8 0 0 0-16 0` |
| 管理端 | 盾牌（无勾） | `M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11z` |
| 个人设置 | 齿轮 + 中心圆 | `M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915 M15 12a3 3 0 0 1-6 0 3 3 0 0 1 6 0` |
| 退出登录 | 门框 + 外出箭头 | `M16 17l5-5-5-5 M21 12H9 M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4` |

- 三条取自 Lucide 官方源（`user-round` / `settings` / `log-out`，ISC，已核对 24×24 描边源文件），
  盾牌复用仓库既有盾形（管理导航同源）。
- 备选与取舍：退出可用电源符号（更简，但中文「退出登录」更贴门+箭头）；管理端可用建筑/仪表（语义更窄），
  盾牌在员工/管理切换里最易辨且与治理面一致。

## 4. 状态与三轴（DESIGN §组件状态覆盖 / §不变量 4）

| 状态 | 呈现 |
|---|---|
| 未选中段 | 透明底，`.nav-ico` 继承 `--text-muted`（图形 ≥3:1） |
| 选中段 | 实底 `--accent-text` + 图标 `--accent-fg`（与 `.nav-badge`、`.mail-count-pill.is-solid` 同一实底惯例）；另加 `aria-current="page"` 与 `title`，不只靠颜色 |
| hover | `color-mix(in srgb, var(--text) 6%, transparent)` 底 + `--text` 图标；选中段 hover 保持实底 |
| focus-visible | 全局 `outline: 2px solid var(--focus-ring)` |
| 账号名过长 | `overflow: hidden` + 省略号；身份段 `flex: 1 1 auto; min-width: 0`，不挤压右侧控件 |
| 触摸（`pointer: coarse`） | 分段与图标按钮 `min-width / min-height: 44px`，分段容器高度改 `auto` |
| 折叠 56px | 单行改竖排：头像 32px → 分段（`--control-h` 边长，竖排）→ 设置 → 退出；版本号整行隐藏（56px 放不下，避免 `.sidebar` 静默裁切） |
| ≤860px 管理顶栏 | 沿用单行（基础即单行）；≤720px 隐 `.account-copy`，只留头像 + 三个控件 |
| 移动抽屉（≤860px） | 抽屉 `height: auto` 让 `top/bottom` 生效，页脚控件完整落在视口内 |
| 矮视口 | 不加隐藏规则：`.sidebar-foot` 为 `flex: 0 0 auto`，`.sidebar-scroll` 自行滚动，页脚不裁切内容 |

## 5. 验证与证据

- `frontend`：`npm run typecheck`、`npm run build`；`backend`：`npx vitest run sidebarNav`。
- `frontend`：`E2E_MODE=stub E2E_AUTH_MODE=disabled npx playwright test e2e/workbench.spec.ts -g "(account bar switches|collapse persists|employee persona|employee partners|bind Starry mailbox)"`。
- 目视矩阵（截图脚本 `artifacts/account-footer/capture.cjs`）：1440×900 / 1280×700 / 1260×630 / 1024×589（指针）、
  1280×900 折叠 56px、390×844 触摸抽屉、管理端 1440×900 / 820×900 顶栏 / 390×844、键盘焦点、个人设置管理员工具面板。
- 实测（stub 服务端）：展开账户块 **243×28**（身份段 103、控制段 132、分段 68×28、图标 28×28）；
  管理端 1440 为 227×28、820 顶栏 202×28、390 顶栏 168×28；折叠轨道 47×160；触摸抽屉命中区 44×44。
