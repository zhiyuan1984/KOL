# 员工连接器使用面宪法 / 契约扫描（2026-09-14）

> **Note (2026-09-15):** 扫描当时用 `UX-COPY-ENGINE` 作验收标签。该 ID 已废；员工禁词原则仍在 `04` / `UX-EMPLOYEE`。

对照基准：`origin/main` @ `54e1752d31e1d64cdfa43e770c9fb611945a057e`（短 SHA `54e1752`）。只读、无应用代码改动、无 LIVE。本文件是审查记录，不是实施单。

**事实 vs 建议：** 带「事实」的段落只陈述该 SHA 的仓库现状；带「建议」的段落未实施。

---

## Meta

| 项 | 值 |
|---|---|
| 日期 | 2026-09-14 |
| 扫描基线 | `git rev-parse HEAD` = `54e1752d31e1d64cdfa43e770c9fb611945a057e`（与 `origin/main` 一致） |
| 基线提交 | `54e1752 docs: introduce layered product and UI contracts` |
| 角色 | 员工 `/connectors`（ConnectorUse）及员工「连接器使用」入口 |
| 非范围 | 管理端枢纽/详情实施质量、Pipeline/Home/Chat 改版、FE 重构 |
| LIVE | 否。本审查不发信、不写阶段、不改凭据、不跑远端治理 |

判定用词：`PASS` / `FAIL` / `PARTIAL` / `DEBT`。

---

## 一行结论

员工 `/connectors` 已是独立支撑能力面，不是 `/admin/connectors` 的只读镜像；员工默认路径不深链治理枢纽或凭据编辑。产品职责与权限边界 **PASS**。本页无 L3 绑定表（Starry 只链 Settings）**PASS**。空态诚实；错误无恢复动作 **PARTIAL**。MASTER / OpenAI 对照只记视觉债 **DEBT**。不阻断 kol 把该面当使用面。

---

## Sources

按 `docs/README.md` 任务类型加载（验收 / 契约对照，不是 UI 实现）：

| 权威 | 本扫描用到的条款 |
|---|---|
| `docs/CONSTITUTION.md` §4 表面职责 | 连接器 = 支撑能力面；禁止复制 Home / Chat / Pipeline / Admin |
| `docs/CONSTITUTION.md` §5 风险 | L3 高影响须确认；本页若有绑定/解绑只能去 Settings |
| `docs/CONSTITUTION.md` §6 可用性 | 加载 / 空 / 错误 / 无权限须有状态与可恢复动作 |
| `docs/employee-surface-contracts.md` | 并列能力面主权；侧栏资产簇可挂 `/connectors`；禁止深链治理、禁止能力图鉴、禁止进数字员工簇 |
| `docs/21-admin-employee-page-roles.md` 「员工使用面（`/connectors`）」 | 只答三句：已授权可用哪些、当前意味着什么、个人绑定去哪。禁止启停/凭据/授权编辑、禁止深链 `/admin/connectors`、禁止再挂 `StarryBindForm` |
| `docs/21` 导航规则 | 侧栏可选「连接器」只链 `/connectors`；用户菜单不含连接器或 Starry；SkillHub 砖仅显式调试且 admin |
| `docs/04-ux-ui-system.md` L9 | 员工端隐藏连接器**配置**；已授权使用/状态面合法 |
| `docs/design-system/kol-workbench/MASTER.md` | token、标题阶、状态、触控、禁止散落样式 |
| `docs/references/openai-style.md` | 对照参考，不是实施规范 |
| `docs/CONTEXT-MANIFEST.md` | 员工连接器先读员工表面契约，治理再读 `21` |

实现只读：

- `frontend/src/pages/ConnectorUse.tsx`
- `frontend/src/connectorUse.ts`
- `frontend/src/App.tsx`
- `frontend/src/layout/Workbench.tsx`
- `frontend/src/components/UserMenu.tsx`
- `frontend/src/pages/SkillHub.tsx`
- `frontend/src/pages/AdminConsole.tsx`（员工进 `/admin/*` 的拦截）
- `frontend/src/components/StarryBindForm.tsx`（Settings，对照 L3 是否误挂本页）
- `frontend/src/pages/AccountSettings.tsx`
- `backend/src/routers/enterprise.ts` `GET /connectors`
- `frontend/e2e/workbench.spec.ts` 员工 persona / docs/21 用例

无 `design-system/kol-workbench/pages/connectors.md`（事实）。

---

## Surface map

员工「连接器使用」在该 SHA 的落点：

| 表面 | 路径 / 控件 | 角色（事实） | 是否员工默认 |
|---|---|---|---|
| 使用面 | `/connectors` → `ConnectorUse`（`App.tsx` L42） | 已授权条目 + 业务含义 + 状态；Starry CTA → `/settings?tab=starry` | 是。侧栏资产簇 `data-nav="connectors"` |
| 个人绑定 | `/settings?tab=starry` → `StarryBindForm` | 个人发件箱绑定 / 解绑；JWT 可选粘贴 | 是，但是 Settings，不是使用面本体 |
| 治理枢纽 | `/admin/connectors`、`/admin/connectors/:id` | 启停、凭据引用、员工 read/write | 否。无 admin 时 `Navigate to="/"` |
| 侧栏 | `Workbench` 资产簇 | 「连接器」→ `/connectors`；数字员工簇无连接器 | 是 |
| 用户菜单 | `UserMenu` | 员工工作台 / 管理控制台 / 个人设置；无「连接器」、无 Starry | 菜单无连接器入口 |
| SkillHub 砖 | `/market/skills` `CONNECTORS[]` | `starrykol` / `kolclaw` / `enterprise_mail` / `wecom` → `/admin/connectors/...` | **仅** `debug && admin` |
| Composer `@` | `ComposerDock` `filteredConnectors` | 调试态 `@` 提词插入连接器标签，不导航治理页 | 否（`debug` 才出现） |
| 专家中心 | `/agents` | 无连接器 chrome / pills（本扫描 `Agents.tsx` 零命中） | 不涉及 |
| Home | `/` | 无连接器入口 | 不涉及 |
| 遗留管理配置 | `SimplePages` `Admin`（`/admin/kol`） | 同时链枢纽与员工使用面 | 管理端「配置」页，非员工默认 |

员工打开治理 URL（E2E 事实）：

```text
员工 persona → GET /admin/connectors → URL 变为 /
```

`AdminConsole.tsx` L99：`available_modes` 不含 `admin` 则 `<Navigate to="/" replace />`。另：`/admin/starry` → `/settings?tab=starry`（L100）。**没有**把员工从 `/admin/connectors` 送到 `/connectors`；拦截目标是 Home，不是使用面。

---

## Checklist

### 1. 表面职责（使用 vs 治理）

**判定：PASS**

| 契约 | 现状（事实） | 判定 |
|---|---|---|
| 只回答：已授权可用哪些、意味着什么、个人绑定去哪（`21` L73–L86） | 页头：「你已被授权可用哪些连接能力、对你意味着什么。启用、凭据和组织策略不在本页。」（`ConnectorUse.tsx` L60–L62） | PASS |
| 不是 `/admin/connectors` 只读镜像 | 消费 `api.connectors()`（员工 `GET /api/connectors`），不用 `api.adminConnectors()`；不渲染启停、凭据引用、授权矩阵、治理表 | PASS |
| 不复制 Home 四模式 / Chat / Pipeline / Admin IA（宪法 §4） | 无今日任务、待办桶、会话开工、15 阶段、治理健康条 | PASS |
| 不隶属数字员工、不因「有进行中任务」才存在（员工表面契约） | 侧栏资产簇常驻；与 `/agents` 簇分离（`Workbench.tsx` L133–L176） | PASS |
| 禁止做成能力图鉴 / 技能上级目录 | 本页不列 Skill；`connectorUse.ts` 写明「Do not import adminGovernance」 | PASS |
| KOL / 合作只作含义文案，不定义 IA | Starry 含义提到「我跟进的红人」过滤，列表仍按连接器条目（`connectorUse.ts` L17–L27） | PASS |

使用面行模型（事实）：`id` + `connectorUseLabel` + `connectorUseMeaning` + `connectorUseStatus`（可用 / 需个人绑定）。标签表去 MCP/Codex 词（`connectorUse.ts` L43–L50）。`preferCanonicalConnectors` 去掉与短名并存的遗留 id（`starry`/`emailmcp` vs `starrykol` 等）。

### 2. 权限边界

**判定：PASS**

| 契约 | 现状（事实） | 判定 |
|---|---|---|
| 侧栏若有入口，只链 `/connectors` | `NavLink to="/connectors"` `data-nav="connectors"`（`Workbench.tsx` L173–L176） | PASS |
| 任何员工默认路径不深链 `/admin/connectors` | 侧栏无该 href。E2E：`docs/21 employee sidebar has no admin connectors deep-link`；员工 persona 同断言 | PASS |
| 不进数字员工簇、无可见组标题 | 连接器在 `aria-label="资产"`；数字员工簇默认只有 `/agents`；`.nav-label` 由 E2E 断言为 0 | PASS |
| 用户菜单不含连接器或 Starry（`21` 导航） | `UserMenu.tsx` L29–L44：员工工作台、条件「管理控制台」、调试、个人设置、退出。E2E 断言菜单「连接器」count=0 | PASS |
| 员工进管理端仅账户菜单「管理控制台」 | 无 admin 则无该链；有 admin 才 `/admin` | PASS |
| SkillHub 砖仅显式调试且 admin | `connectorTiles`：`if (!debug \|\| !admin \|\| view !== "catalog") return []`（`SkillHub.tsx` L349–L353）；芯片「连接器」同样 gated（L332）。员工 persona E2E：`data-connector="starrykol"` count=0 | PASS |
| 只列出 `GET /api/connectors` 已授权且已启用 | 后端：非 admin 走 `user_connector_grants` ∩ `enabled=1`（`enterprise.ts` L191–L201）。admin/authDisabled 看全部已启用。使用面不前端补「未授权」行 | PASS |
| 员工专家中心无连接器状态主 IA | `Agents.tsx` 无 connectors / remote-pill 命中 | PASS |
| `UX-COPY-ENGINE`：员工默认不出现 MCP / Codex / LIVE | 使用面 E2E：body 不含 `Starry KOL MCP` / `LIVE` / `Codex`；无 `textarea[name=bearer]`、无启停按钮 | PASS |

**残余（不降为 FAIL）：**

- SkillHub `CONNECTORS` 仍硬编码 `to: "/admin/connectors/..."`，标题含「Starry KOL MCP」（`SkillHub.tsx` L68–L96）。契约允许调试+admin 指向枢纽；**不得**出现在员工默认路径。现状符合「允许调试、禁止默认」。
- `GET /api/connectors` 的 `connectorPublic` 展开整行，含 `credential_ref` / `credential_reference`（`enterprise.ts` L68–L75）。使用面不渲染这些字段。属 API 投影偏胖，不是本页治理 UI。
- 员工深链 `/admin/connectors` 被送到 Home，不是使用面。边界成立；若产品希望「用错 URL 时落到使用面」，那是未立法的体验选项（建议，不实施）。

### 3. L3 绑定 / 解绑

**判定：PASS**（使用面无 L3；Starry → Settings only）

宪法 §5：外发、导入、删除、解密、权限或敏感信息变更属 L3，须确认。`21`：可绑定能力 CTA 只指向 `/settings?tab=starry`；本页不得再挂 `StarryBindForm` 或 JWT 粘贴框。

| 动作 | 在 `/connectors`？ | 去向（事实） |
|---|---|---|
| 绑定 Starry | 否。仅 `Link`「去个人设置绑定」（`ConnectorUse.tsx` L89–L93），条件为 `needs_personal_bind` | `/settings?tab=starry` |
| 页脚绑定说明 | 否。文案链到同一 Settings（L99–L105） | 同上 |
| JWT / Bearer 输入 | 无 | Settings `StarryBindForm` L86–L88 |
| 解绑 | 无 | Settings：`confirm(...)` 后 `DELETE /api/me/starry-binding`（`StarryBindForm.tsx` L125–L141） |
| 启停 / 凭据引用 / 授权 | 无 | 仅 `/admin/connectors/:id` |

`isBindableConnector` 只匹配 `/starry/i`（`connectorUse.ts` L39–L41）。过期或未绑定显示「需个人绑定」，已绑定显示「可用」。本页不执行写入。

Settings 对照（非本页，避免误判「双挂」）：

- `AccountSettings.tsx` L64、L90：tab「连接 Starry」渲染唯一 `StarryBindForm`。
- `AdminConsole` 无 Starry 导航项；`/admin/starry` 重定向到 Settings。E2E：`admin and settings expose bind Starry mailbox menus`。
- 绑定保存无独立确认卡；解绑用浏览器 `confirm`。若按宪法完整「触发 → 确认 → 执行中 → 持久回执」审 Settings，属 **Settings 债**，不是 ConnectorUse 违约。

### 4. 空 / 错误 / 无权限

**判定：PARTIAL**

宪法 §6：加载、空、错误、无权限、部分成功均需明确状态与**可恢复动作**。`21`：缺行用空态「目前没有已授权给你的」，不要前端补治理目录。

| 状态 | 实现（事实） | 判定 |
|---|---|---|
| 加载 | `rows === null && !error`：「正在读取已授权的连接能力…」（`ConnectorUse.tsx` L65） | PASS（有状态）。无 skeleton / `aria-busy` → 记视觉/无障碍 DEBT |
| 空 | `data-connector-use-empty`：「目前没有已授权给你的连接能力。需要开通请联系管理员。」（L66–L70） | PASS 对契约文案。恢复是「联系管理员」，无应用内 CTA → 可接受（授权不在本页） |
| 错误 | `role="alert"` + `error`；失败时 `setRows([])`（L27–L31） | **PARTIAL**：有错误文案，**无重试**或其它恢复控件 |
| 无权限（本页） | `/connectors` 对已登录员工开放，无单独 403 页。零授权 = 空态，符合「API 不返回未授权行」 | PASS（空态即无授权） |
| 无权限（治理 URL） | 员工 `/admin/connectors` → Home，不渲染枢纽 | PASS（拦截在 Admin 壳）。不是使用面上的「无权限」文案 |
| 部分成功 | 列表一次拉取；无部分成功语义 | 不适用 |

建议（不实施）：错误行加「再试一次」；加载容器加 `aria-busy`。不要为了「无权限」画未授权治理目录。

### 5. MASTER + OpenAI 视觉债（只列，不改 FE）

**判定：DEBT**

MASTER 写明：现有页面完成度不是设计基准。下列为债，不构成第 1–3 条产品违约。

#### MASTER

| 债 | 证据 |
|---|---|
| 页标题用 `--font-title`（24px）而非 `--font-page-title`（28px） | `.connector-use-page h1`（`styles.css` L4532）；MASTER §3 页面标题 28px |
| `h1` 内联 `style={{ marginTop: 0 }}` | `ConnectorUse.tsx` L59。宪法 §3：组件不得自行定义与设计系统冲突的间距 |
| 状态字用迁移别名 `--font-meta` | `styles.css` L4556；MASTER：新代码用核心 token |
| 列表圆角 `--radius-sm`（6px），面板应为 `--radius-md`（10px） | L4535；MASTER §3 面板 10px |
| `.muted` 魔法数 `margin: 4px 0 0` | L4549。间距阶梯允许 4px，但是写死在页面局部 |
| 状态额外靠颜色（`--success` / `--warning`） | L4560–L4561。有文字「可用 / 需个人绑定」，未只靠颜色；仍属强调色债 |
| 加载为一段 muted 字，无稳定 skeleton | L65 vs MASTER §5 加载 |
| 「去个人设置绑定」`btn ghost sm` `min-height: 36px` | `styles.css` L3951–L3952。MASTER 触控目标 44×44 |
| 无 `pages/connectors.md` | `design-system/kol-workbench/pages/` 仅 home / chat / pipeline / admin |
| `data-visual="docs20"` | 旧视觉标记，不是 MASTER 页规范 |

#### OpenAI style对照（`references/openai-style.md`，参考不是规范）

| 对照 | 使用面现状 |
|---|---|
| 单色编辑画布、唯一实心黑 CTA | 工作台靛蓝 `--primary`；状态用成功/警告色 |
| 按钮 pill 9999px、卡片 6px、靠留白不靠重分隔 | `ghost sm` 中性按钮；列表 1px `--border` 分区 |
| 页标题 28px editorial | 24px `--font-title` + kicker「账户」 |
| 无侧栏、顶栏极简 | 落在 Workbench 左栏壳内（产品 IA 要求，对照差是壳层不是本页独有） |

OpenAI 对照差不单独升级为 FAIL；实施权威仍是 MASTER + 宪法。

---

## Findings

1. **使用 vs 治理已拆开（事实）。** `ConnectorUse` 只读消费员工连接器 API + Starry 绑定状态；治理写路径在 `AdminConnectors`。页内文案与 E2E（`employee connector use surface is independent of admin hub`）一致。
2. **员工不能从默认 chrome 走进配置/凭据（事实）。** 侧栏、用户菜单、专家中心、Home 均不链 `/admin/connectors`。SkillHub 砖与 Composer `@` 连接器只在调试。
3. **员工打开 `/admin/connectors` 被打回 Home（事实）。** 不是使用面 403，也不是治理只读镜像。
4. **L3 不在本页（事实）。** 绑定 CTA 只导航 Settings；解绑/JWT 只在 `StarryBindForm`。
5. **空态合规，错误恢复不足（事实）。** 符合 `21` 的空态法律；不符合宪法「错误须有可恢复动作」。
6. **视觉未按 MASTER 重做（事实）。** list-page + token 混用别名 + 内联 margin。记 DEBT。
7. **建议（不实施）：** 错误重试；`pages/connectors.md`；标题 token；不要把 SkillHub 调试砖暴露给默认员工（已 gated，保持）。不要把使用面做成启停表。

---

## Conclusion（给 kol）

- 员工 `/connectors` 是支撑能力面的**使用面**，只回答已授权能力 / 含义 / 绑定去哪；不是治理枢纽副本。
- 员工默认「连接器」入口只去 `/connectors`；菜单无连接器；深链 `/admin/connectors` 回 Home。必须继续禁止员工主路径进配置/凭据。
- 本页无绑定表、无 JWT、无启停。Starry 需绑定时只链 Settings。不要在本页或 Admin 再挂一份 `StarryBindForm`。
- 空态可用；错误缺重试。无授权不要画未授权目录。
- 视觉相对 MASTER / OpenAI 有债，不构成这轮产品违约，也不是本 PR 的改 FE 授权。
- 本审查 docs-only。不 LIVE。kol 可把该面当已立法的使用面继续用。
