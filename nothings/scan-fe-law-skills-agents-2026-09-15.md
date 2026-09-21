# 前端法律扫描 · Skills / Agents / Teams / Cron

- **日期：** 2026-09-15
- **基线：** `cursor/docs-org-domain-canons-a1e1` @ `f76512c`（PR #111，ADR-028 C/D 单一正文之后）
- **性质：** 只读扫描。本文件是诊断，**不含补丁、不改 JSX、不 LIVE**。
- **Track：** Skills / SkillHub / `/partners` / Agents / Teams / Cron
- **读过的法：** LAW-MAP → B `CONSTITUTION.md` §4 → H `ia-information-architecture.md` → C `org-permissions.md`（使用 ≠ 治理细则）→ G `specs/UX-EMPLOYEE.md` → I `design.md` + `design-system/kol-workbench/MASTER.md`

## 1. 范围与方法

只打开下列实现面（及它们直接引用的 chrome / token）：

| 表面 | 文件 |
|---|---|
| 技能目录 / 工作伙伴 | `frontend/src/pages/SkillHub.tsx` |
| 我的技能 | `frontend/src/pages/SimplePages.tsx`（`Skills`） |
| 数字员工 | `frontend/src/pages/Agents.tsx` |
| `/teams` 旧 URL | `frontend/src/pages/AgentTeams.tsx` |
| 定时任务 | `frontend/src/pages/Cron.tsx` |
| 侧栏簇 | `frontend/src/layout/Workbench.tsx` |
| 路由 | `frontend/src/App.tsx` |
| 会话里残留团队轨 | `frontend/src/components/TeamRail.tsx`（Teams 残余，不是侧栏） |
| 本簇样式 | `frontend/src/styles.css`（`.hub-*` / `.expert-*` / `.list-page` / `.panel`） |

**不扫：** Home / Chat 主路径、Pipeline 页、`/admin/*` 治理正文、Composer 技能菜单（只在「技能是否压过任务脊柱」时点名）。`SimplePages.tsx` 的未挂路由 `Admin()` 不进本 track 结论。

对照题（用户锁定）：

1. 技能一等，但不是压过任务脊柱的图鉴；调试技能不得错误落在数字员工簇。
2. `/agents` 只召唤岗位专家，不是技能图鉴 / 连接器治理。
3. `/partners` 无 Pipeline / Admin 出血。
4. 无「数字团队」假导航。
5. 视觉 token vs MASTER；员工禁词。

严重度：

- **P0** — 默认员工路径已经违宪（一页一问、使用 ≠ 治理、假导航、图鉴压脊柱）。
- **P1** — 本面仍答错问题，或默认员工能看见引擎/治理/Pipeline IA。
- **P2** — token / 触控 / 文案密度 / 死代码；不改产品对错。

## 2. 五题结论

| # | 题 | 结论 | 最高档 |
|---|---|---|---|
| 1 | 技能一等 ≠ 图鉴压脊柱；调试技能不进数字员工簇 | **通过。** `/skills`、`/market/skills` 是独立路由。默认侧栏不挂技能（密度，ADR-023 允许）。调试时技能在 `nav[aria-label="技能"]`，数字员工簇仍只有 `/agents`。 | 无 P0。P2：默认露出不对称 |
| 2 | `/agents` = 只召唤 | **通过。** 列表 / 详情只做推荐·我的·全部·搜索·固定·召唤。无连接器 pill、无技能目录 CTA、无 Admin 深链。 | 无 P0 |
| 3 | `/partners` 无 Pipeline / Admin 出血 | **半通过。** #102 已拆掉 Pipeline 英雄 / 品牌小队 / Admin 链。仍用 `api.pipeline()` 灌达人，并展示 `stage_label`。 | **P1** |
| 4 | 无数字团队假导航 | **侧栏通过。** `/teams` → `/agents`；无 `data-nav="teams"`。会话 `TeamRail` 仍是未实现 #3 的冒名进度条。 | **P1**（非侧栏） |
| 5 | token / 员工禁词 | Agents 主文案干净。Cron 默认页写 `T8`；调试技能砖写 `Starry KOL MCP`；本簇大量迁移别名与小于 MASTER 的触控。 | **P1**（Cron 行话）+ P2 token |

**本 track 无 P0。** #101 / #102 之后，默认员工侧栏与 `/agents` 已对齐宪法 §4.1 #2 / #4 与 H §4。

## 3. 已对齐（不要回退）

### 3.1 技能是一等入口，不是数字员工的图鉴

`Workbench.tsx` 数字员工簇只挂一条：

```136:147:frontend/src/layout/Workbench.tsx
        <nav className="nav-group" aria-label="数字员工">
          <NavLink
            to="/agents"
            ...
            <span className="sidebar-label">数字员工</span>
          </NavLink>
        </nav>
```

调试技能是**下一簇**，不是数字员工的孩子：

```149:162:frontend/src/layout/Workbench.tsx
        {debug ? (
          <nav className="nav-group" aria-label="技能">
            <NavLink
              to="/skills"
              ...
              <span className="sidebar-label">技能目录</span>
            </NavLink>
          </nav>
        ) : null}
```

默认员工看不到 `[data-nav="skills"]`。任务脊柱（新工作任务 / 进行中）仍在「今日」簇最前。这符合 H §4「技能若露出，必须是独立一等入口」和「禁止图鉴压过任务脊柱」，也符合「侧栏露出 = UX 密度」。

### 3.2 `/agents` 只答「找谁协作」

`Agents.tsx` 主 CTA 是「召唤专家」。擅长 / 可以帮你 / 你可以这样说是岗位说明，不是技能市场，也不 `nav("/skills")`。无 `remote-pill`、无连接器状态、无 Codex / MCP / Thread。`/teams` 被 `AgentTeams.tsx` 诚实折到 `/agents`，页上不出现「数字团队」「专家团」。

### 3.3 `/partners` 英雄区已瘦身

`SkillHub.tsx` 的 partners 视图不再渲染「全生命周期管理」、品牌小队、`/pipeline`、`/admin` 链。Lead 是「当前合作中的达人，用于当前任务。」E2E `employee partners path has no pipeline hero or admin squad links` 锁的是这条。

### 3.4 Cron 坐落正确

`/cron` 在「今日」簇（新工作任务 → 进行中 → 定时任务），不在资产簇，也不是第二套 Home 四模式。符合 H §2 #14 与 H §4「簇间只用分割线」。

### 3.5 连接器调试砖有闸门

`SkillHub.tsx` 的 `CONNECTORS` 只在 `debug && admin && view === "catalog"` 出现，目标是 `/admin/connectors/:id`。这是 C「导航规则 / 调试视图」允许的形态，**不是**默认员工路径。

---

## 4. P0

无。

默认员工打开工作台：技能不挂侧栏、不进数字员工簇；`/agents` 不卖目录；`/teams` 不冒充数字团队；`/partners` 不再挂 Pipeline 英雄或 Admin 小队。没有需要立刻停发布的本 track 违宪项。

---

## 5. P1

### P1-1 `/partners` 仍是 Pipeline 数据面

**法：** B §4.3 / H §1 — Pipeline 只答正式生命周期资产；一等能力面不得抄 Pipeline IA。C 把 `/partners` 标成「调试或目录实验页」，不是第二套资产板。

**证据：** `SkillHub.tsx`

- L276–289：`view === "partners"` 时 `api.pipeline()`，把 `groups` 拍扁成伙伴列表。
- L418–428：砖文案 `` `${brand} · ${platform} · ${stage_label}` ``，+ 号开 `email_compose` 并带 `collaboration_id`。

英雄区没了，但**数据源和主字段仍是正式阶段板**。员工从 `/skills` chrome 的「工作伙伴」一跳就到。这不是 Admin 出血，是 Pipeline 出血。

**建议（下个 FE，本文件不改）：** 伙伴列表改走跟进/协作 API（与 Home「我跟进的红人」同对象），砖上只留 handle / 品牌 / 平台；`stage_label` 若要显示，写成跟进状态而不是正式阶段列。不要再 `import` Pipeline 组。

### P1-2 员工技能 chrome 上的「+ 新建技能」深链 Admin

**法：** H §4 / C 导航规则 — 员工进管理端**仅**账户芯片「管理控制台」→ `/admin`。禁止 SkillHub 砖链进 Admin 治理。独立技能面不得做成治理入口。

**证据：** `SkillHub.tsx` L242–246：`admin && <Link to="/admin/skills" className="hub-new">+ 新建技能</Link>`。

此链看 `admin`，**不看 `debug`**。管理员走员工 `/skills` 或 `/market/skills`（业务视图）也会看到治理开工 CTA。E2E `admin skill page exposes create form...` 还把 `data-hub-new[href="/admin/skills"]` 写成绿项。

**建议：** 员工 SkillHub chrome 去掉 `hub-new`。建技能只留 `/admin/skills`。管理员要治理走账户菜单，不从员工图鉴开闸。

### P1-3 `/cron` 答成 KOL 风险板，并写出 `T8`

**法：** B §4.1 #14 / H §2 #14 — `/cron` 只答「今天或按点要跑什么」，不得做成第二套 Home，也不得做成 Pipeline。G 员工禁词：员工面不摊内部代号 / 引擎词。B §6：加载 / 空 / 错误要有状态。

**证据：** `Cron.tsx` 全文（37 行）

- L6：`items: { handle, stage_label, days_in_stage }` — 与 Pipeline 卡同构。
- L21–22：kicker「我的」；说明「P0 仅 T8 失联与延期扫描。不接经营早报 / 加班审批。」
- L25：无数据时标题回退 `"T8"`。
- L26–29：`@handle · stage_label · N 天`。
- 无 loading / error / 空态；`h1` 内联 `style={{ marginTop: 0 }}`。

默认侧栏就能进。这是员工主路径上的内部排期单 + 迷你阶段条。

**建议：** 页只列「下次/现在要跑的自动化」业务名（如「失联与延期扫描」），去掉 `T8` / 「P0 仅…不接…」。人行用业务标签，不用正式阶段列。补加载失败与空列表。定时规格比视觉先。

### P1-4 未实现的「数字团队」仍有会话冒名轨

**法：** B §4.1 #3 / H §4 — 数字团队一等、尚未实现；禁止专家团假导航；**不得**把「数字团队」写成永久禁词。禁止用未实现面冒充已完成。

**证据：**

- 侧栏：无 `data-nav="teams"`。`AgentTeams.tsx` L3–5 只 `Navigate` 到 `/agents`。此项 **OK**。
- `frontend/src/components/TeamRail.tsx` L20–36：Chat 读 `manifest.teams`，标题链回 `/agents`，步骤 `title` 带 `REMOTE_BACKEND_LABEL`（可出 `Starry KOL MCP`）。
- `frontend/src/agentWork.ts` L10–53：死类型 `AgentPageTab = "work" | "teams" | "spec"` 与 `parseAgentTab`。`Agents.tsx` 已不用。

侧栏没有假入口，但会话轨仍假装有一支「团队」在走阶段。这是 #3 尚未落地时的冒名 chrome。

**建议：** 数字团队未立法实现前，会话不渲染 `TeamRail`。`parseAgentTab` 删掉或移出员工面，避免下个 PR 把 teams tab 接回来。保留产品名词「数字团队」，继续禁「专家团」。

### P1-5 技能三路由共用市场壳，`/partners` 被当成技能子页

**法：** H §1 — 一页一问。#4 技能答「用哪项已授权能力」；`/partners` 不是十六项之一，更不是技能。

**证据：**

- `SkillHubChrome`（`SkillHub.tsx` L215–247）在 `/market/skills`、`/partners`、`/skills`（via `SimplePages.Skills`）上同一套：技能目录 | 工作伙伴 | 我的技能。
- `Workbench.tsx` L62–65：`skillsActive` 包含 `/partners`，调试时「技能目录」会在伙伴页亮起。

结果：技能使用面（`/skills`）被目录实验壳包住；伙伴页在 IA 上变成技能图鉴的一个 mode。

**建议：** `/skills` 只留「我的技能」使用面，不要市场 mode 条。`/partners` 要么撤实验、要么独立问「当前任务要用哪位合作达人」，不要挂在技能 chrome / `skillsActive` 上。

---

## 6. P2

### P2-1 默认侧栏：连接器露出、技能不露出

`Workbench.tsx`：`/connectors` 在资产簇默认挂着；技能只在 `debug` 挂。ADR-023 允许密度选择，所以**不是降等**。但不对称：同列一等能力，员工更容易走到连接器使用面，技能只靠 Composer 或深链。

**建议：** 若密度目标是「图鉴不进脊柱」，保持现状并在扫描里写死。若目标是「技能与连接器同样可找」，在**独立**技能簇加一条「技能」，仍不要塞进数字员工簇。

### P2-2 调试技能砖的 MCP 行话

`SkillHub.tsx` L85：连接器标题 `"Starry KOL MCP"`。`SimplePages.tsx` L69：调试徽章 `REMOTE_BACKEND_LABEL[remoteForSkill(s.id)]`，可显示同一句。

C 允许显式调试 + admin 出现连接器砖。G 仍不希望员工面摊 MCP。调试砖请用治理短名（如「Starry 红人库」），MCP 留给 `/admin/connectors`。

### P2-3 生命周期漏斗字典仍住在员工 SkillHub 模块

`SkillHub.tsx` L7–47：`FUNNEL` / `SKILL_FUNNEL` / `skillFunnel`（建联…结算…异常旁路）。员工目录已不再画漏斗 chip（#102），但 `Admin.tsx` 仍从本文件 import，按漏斗编治理目录。

员工技能模块继续拥有 Pipeline 漏斗分类，下次改 SkillHub 容易把图鉴漏斗加回来。

**建议：** 漏斗字典迁到 admin 专用模块。员工 `SkillHub.tsx` 不再 export 阶段漏斗。

### P2-4 MASTER token / 触控 / 标题阶梯

本簇没有 `pages/skills.md` / `pages/agents.md` / `pages/cron.md`（`design.md` §3：无单页规范时只用 MASTER + 只答一问）。对照 MASTER：

| 点 | 指针 | 与 MASTER |
|---|---|---|
| 页标题 24px 不是 28px | `styles.css` `.expert-hero h1` 用 `--font-title`（L3128–3131）；Cron `h1` 走 `.list-page` 的 `--font-page-title` | Agents 矮一阶 |
| 迁移别名 | `.expert-*` 大量 `--font-ui` / `--font-meta`；`.panel` 用 `--canvas` / `--line`（L5284–5288）；`.page-kicker` 用 `--muted`（L419）；Cron / Agents 主按钮在非 `.agent-page` 时走 `.btn.work` 的 `--star`（L4268–4271） | 新代码应走 `--text` / `--text-muted` / `--bg` / `--primary` |
| 触控 | `.hub-plus` 26×26（L6400–6411）；`.expert-pin` 高 28px（L3270–3276）；`.expert-skill` 高 22px（L3327–3337） | 桌面控件 36–40；触控 44 |
| 搜索焦点 | `.hub-search:focus { outline: none; }`（L6262）；替代在 `.hub-search-wrap:focus-within` | 有替代，可接受；不要再裸 `outline: none` |
| 摘要字号 | `.hub-tile-body p` 为 `--font-xs`（13px，L6392–6398） | 13px 只给数据标签，不给关键说明 |
| emoji 当图标 | `Agents.tsx` L48：固定用 ★/☆ | MASTER §5：不以 emoji 当产品图标 |
| 陈旧皮肤标记 | `Agents.tsx` L275 / L361：`data-visual="docs20"`；`styles.css` L423 注释仍写 docs/20 | I：`20` 只是迁移索引 |
| 未立法变量 | `--leading-hero`（`styles.css` L48，专家 h1 在用） | 不在 MASTER §2 表；是 `--leading-tight` 别名 |
| Cron / 进行中同图标 | `Workbench.tsx` L126 与 L131 同一 clock path | 定时应有独立字形 |
| 内联样式 | `Cron.tsx` L21 | 用 spacing token，不要 `style=` |

`.hub-*` 主体已走 `--primary` / `--bg-elevated` / `--radius-*` / `--space-*`，比 Cron 面板更接近 MASTER。重做优先 Cron 与专家触控，不要新开色盘。

### P2-5 Agents 卡片墙密度

`Agents.tsx` 列表是 `auto-fill` 专家卡（`styles.css` `.expert-list` L3225–3232）。B §3 禁止用卡片墙挤工作区；MASTER §5 允许「真实可独立操作对象」用卡。现在只有一名 `expert:kol`，尚未挤脊柱。专家变多时先改成一行一专家 + 召唤，不要做成应用商店墙。

### P2-6 技能页缺状态

`SkillHub.tsx` / `SimplePages.Skills`：`api.skillMarket()` / `api.skills()` / `api.pipeline()` 无 `catch`，失败即空网格。「没有匹配的技能」分不清「未授权」和「加载失败」（B §6）。

Agents 已有 loading / error / 空态，技能三页应对齐那种语言。

---

## 7. 按文件对照

| 文件 | 一页一问 | 使用 ≠ 治理 | 员工禁词 | MASTER |
|---|---|---|---|---|
| `Workbench.tsx` | 今日 / 数字员工 / 调试技能 / 资产 分开 | 连接器走 `/connectors`；技能不进员工簇 | 侧栏无 MCP | cron 与进行中同图标 |
| `SkillHub.tsx` | 目录问「用哪项技能」；partners 问错成 Pipeline 切片 | 调试砖→Admin OK；`+ 新建技能` 不 OK | 调试标题含 MCP | hub token 较好；+ 过小 |
| `SimplePages.tsx` `Skills` | 我的技能 | 无治理 CTA | 调试徽章可出 MCP | 同 hub |
| `Agents.tsx` | 找谁协作 | 无治理 / 无连接器状态 | 干净 | 标题阶梯、emoji 针、触控 |
| `AgentTeams.tsx` | 旧 URL 诚实折回 | — | — | — |
| `Cron.tsx` | 做成 KOL 风险板 | 无 Admin 链 | **T8 / P0 行话** | 内联样式、别名面板、无状态 |
| `TeamRail.tsx` | 未实现 #3 的进度轨 | title 可出远端引擎名 | 调试标签 | 旧 `--ok` / `--orange` 轨 |

## 8. 建议的下一刀（仍不在本 PR）

只排序，不实施：

1. **P1-1** 切断 `/partners` → `api.pipeline()`，去掉砖上的正式 `stage_label`。
2. **P1-2** 员工 SkillHub 去掉 `+ 新建技能`；修正把该链当绿的 E2E。
3. **P1-3** 重写 `/cron` 为自动化列表；去掉 `T8`；补空/错/忙。
4. **P1-4** 数字团队落地前拿掉 `TeamRail`；删员工面 `parseAgentTab`。
5. **P1-5** `/skills` 脱离市场 mode 条；`/partners` 退出 `skillsActive`。
6. P2 token / 触控随上述页面一起收，不要单独开视觉 PR 改法。

## 9. 非目标

- 不改 `CONSTITUTION` / IA / C / UX / MASTER。
- 不实施数字团队，不发明专家团。
- 不把本扫描写成发布门禁绿项（G 门禁仍只认 `SEND_NE_STAGE`、`L3_CONFIRM`）。
- 不扫 `/admin/skills` 治理漏斗或「发布并写入 Codex」（管理端，C 允许引擎词）。
- 不扫 Composer `+` 技能菜单（任务输入容器，不是本簇导航）。
