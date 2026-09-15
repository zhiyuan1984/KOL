# 员工连接器使用面宪法复扫（2026-09-14）— 新平台法

> **Note (2026-09-15):** 扫描当时用 `UX-COPY-ENGINE` 作验收标签。该 ID 已废；员工禁词原则仍在 `04` / `UX-EMPLOYEE`。

对照基准：**`origin/main` merge commit `5b218671875fd9633db32a9cc479fe3a91c012b7`**（短 SHA `5b21867`）= **Merge pull request #94** `cursor/agent-platform-law-docs-5661`（ADR-023 / 十六项一等能力）。只读、无应用代码改动、无 LIVE。本文件是审查记录，不是实施单。

**事实 vs 建议：** 带「事实」的段落只陈述该 SHA 的仓库现状；带「建议」的段落未实施。

权威是**已合并的新平台法**（`CONSTITUTION.md` §4.1–4.2 + ADR-023），**不是** `54e1752` 上旧「KOL Workbench / 支撑能力面」宪法。与旧法冲突时以本 SHA 为准。

---

## Meta

| 项 | 值 |
|---|---|
| 日期 | 2026-09-14 |
| 扫描基线 SHA | `git rev-parse HEAD` @ branch start = **`5b218671875fd9633db32a9cc479fe3a91c012b7`** |
| 基线提交 | `5b21867 Merge pull request #94 from zhiyuan1984/cursor/agent-platform-law-docs-5661` |
| 基线分支 | `origin/main`（含 ADR-023）。**不再**以未合并的 `cursor/agent-platform-law-docs-5661` 为唯一权威 |
| 角色 | 员工 `/connectors`（`ConnectorUse`）及员工「连接器」入口；对照第一等能力 **#6** |
| 非范围 | 管理端枢纽/详情实施质量、Pipeline/Home/Chat 改版、FE/BE 重构、LIVE |
| LIVE | 否。本审查不发信、不写阶段、不改凭据、不跑远端治理 |
| 前次扫描 | PR #93 `docs/evidence-ui-constitution-scan-connectors-2026-09-14.md`，基线 **`54e1752`**（旧宪法，无 ADR-023） |

判定用词：`PASS` / `FAIL` / `PARTIAL` / `DEBT`。

### 一行结论

相对**新法**：使用 ≠ 治理仍 **PASS**；员工默认路径不深链 `/admin/connectors` 凭据/枢纽仍 **PASS**。连接器在宪法上是 **第一等 #6**（「支撑」≠ 二等、不隶属 KOL Agent）— **文档与路由/侧栏 IA = PASS（同侪）**；页头 kicker「账户」、契约「可选」、含义文案偏 KOL 试点仍可读成二等 — **记残余，不降为 FAIL**。空/错 **PARTIAL**（错误无重试）。MASTER / OpenAI **DEBT**。不阻断 kol 把该面当已立法的使用面。

---

## Sources

强调 **PR #94 已入 `main` @ `5b21867`**。先读该 SHA 的法，再对照实现。不信任 `54e1752` / 旧 main-only 措辞。

| 权威（本 SHA） | 本复扫用到的条款 |
|---|---|
| `docs/CONSTITUTION.md` §4.1 #6 | **连接器 = 一等公民**；员工使用面 ≠ 管理治理面（ADR-013 / `21`）。十六项互不隶属，**不隶属 KOL Agent** |
| `docs/CONSTITUTION.md` §4.1 段末 / §4.3 | 「支撑」只禁止复制 Home / Chat / Pipeline / Admin IA，**不是**二等、不是 KOL Agent 附属 Tab |
| `docs/CONSTITUTION.md` §4.2 | KOL 是首个试点不是平台壳；使用 ≠ 治理仍服从 ADR-015 |
| `docs/CONSTITUTION.md` §5–§6 | L3 不在本页；加载 / 空 / 错误须有状态与可恢复动作 |
| ADR-023（`docs/DECISIONS.md`） | 十六项一等；「支撑」≠ 二等；不变量：连接器使用 ≠ 管理治理。本 ADR **不改 JSX** |
| `docs/employee-surface-contracts.md` | 一等能力面含连接器使用面；资产簇可挂 `/connectors`；禁止隶属 KOL Agent、禁止深链治理、禁止进数字员工簇 |
| `docs/21-admin-employee-page-roles.md` | 使用面只答三句；禁止启停/凭据/授权编辑；侧栏若有入口只链 `/connectors` |
| `docs/design-system/kol-workbench/MASTER.md` | token、标题阶、状态、触控。路径名是试点皮肤，不是产品身份（ADR-023） |
| `docs/references/openai-style.md` | **对照 only**，不是实施规范 |
| `docs/evidence-platform-law-gap-2026-09-14.md` | PR #94 修宪证据：旧「支撑能力面」易降等；#6 锁定为连接器（使用 ≠ 治理） |
| `docs/04-ux-ui-system.md` L9 / L13 | 隐藏连接器**配置**；表面分类以宪法 §4.1–4.2 为准 |
| `docs/README.md` | 平台能力 vs KOL 试点；连接器使用 ≠ 治理 → `21` + ADR-013 |
| `docs/CONTEXT-MANIFEST.md` | `/kb`、`/agents`、员工连接器同路由行（同侪加载） |

实现只读（相对 `54e1752` **无 FE/BE diff**；`git diff --stat 54e1752..5b21867 -- frontend/ backend/` 为空）：

- `frontend/src/pages/ConnectorUse.tsx`
- `frontend/src/connectorUse.ts`
- `frontend/src/App.tsx` L42
- `frontend/src/layout/Workbench.tsx` L158–L176
- `frontend/src/components/UserMenu.tsx`
- `frontend/src/pages/SkillHub.tsx`（调试砖）
- `frontend/src/pages/AdminConsole.tsx` L99（无 admin → `Navigate to="/"`）
- `frontend/src/pages/AccountSettings.tsx` / `StarryBindForm.tsx`
- `backend/src/routers/enterprise.ts` `GET /connectors`
- `frontend/e2e/workbench.spec.ts`（员工 persona / docs/21 / 使用面独立）

无 `design-system/kol-workbench/pages/connectors.md`（事实，与前次扫描同）。

---

## Delta vs prior scan

前次：PR #93，文件 `docs/evidence-ui-constitution-scan-connectors-2026-09-14.md`，基线 **`54e1752`**。该文件**不在** `5b21867` 的 `main` 树上（只在 PR #93 分支）。

| 项 | 前次（旧法 @ `54e1752`） | 本次（新法 @ `5b21867`） |
|---|---|---|
| 产品身份 | 宪法把连接器收在「**支撑能力面**」一行（Agents / KB / 审批 / 考试 / 连接器 / Settings） | §4.1 **十六项一等**；连接器是 **#6**。ADR-023：旧「支撑」表易读成二等 / 隶属 KOL Agent |
| 前次结论用语 | 「员工 `/connectors` 已是独立**支撑能力面**」 | **作废该位阶用语。** 「支撑」只剩 IA 禁令（不做第二套 Home），不是降等 |
| 使用 ≠ 治理 | PASS | **仍 PASS**（FE 未变；新法明确保留该不变量） |
| 不深链 admin 凭据 | PASS | **仍 PASS** |
| 空 / 错误 | PARTIAL（错误无重试） | **仍 PARTIAL**（FE 未变） |
| MASTER / OpenAI | DEBT | **仍 DEBT**（FE 未变） |
| **新增检查** | 无「第一等 #6 / 是否同侪」 | 见下节 checklist #5 |
| FE/BE | ConnectorUse 已落地 | **同 SHA 区间零 diff**。变的是法，不是页 |

PR #94（`01dfbaa`）只改文档：宪法、ADR-023、员工契约、`21` 轻同步、`04` 指针、`README` 路由。**不实施 FE。**

---

## Checklist

### 1. 使用表面 ≠ 治理

**判定：PASS**

| 契约（新法） | 现状（事实 @ `5b21867`） | 判定 |
|---|---|---|
| 只回答：已授权可用哪些、意味着什么、个人绑定去哪（`21` 员工使用面） | 页头：「你已被授权可用哪些连接能力、对你意味着什么。启用、凭据和组织策略不在本页。」（`ConnectorUse.tsx` L60–L62） | PASS |
| 不是 `/admin/connectors` 只读镜像 | 消费 `api.connectors()`，不调用 `adminConnectors()`；无启停、凭据引用编辑、授权矩阵、治理表 | PASS |
| 不复制 Home / Chat / Pipeline / Admin IA（§4.1「支撑」禁令 = IA，不是降等） | 无今日任务、待办桶、会话开工、15 阶段、治理健康条 | PASS |
| 不隶属数字员工、不因进行中任务才存在 | 侧栏资产簇常驻；与 `/agents` 簇分离（`Workbench.tsx` L133–L176） | PASS |
| 禁止能力图鉴 / 技能上级目录 | 本页不列 Skill；`connectorUse.ts`：「Do not import adminGovernance」 | PASS |

行模型未变：`id` + `connectorUseLabel` + `connectorUseMeaning` + `connectorUseStatus`（可用 / 需个人绑定）。标签去 MCP/Codex。`preferCanonicalConnectors` 折叠遗留 id。

### 2. 无深链管理端凭据 / 枢纽

**判定：PASS**

| 契约 | 现状（事实） | 判定 |
|---|---|---|
| 侧栏若有入口，只链 `/connectors` | `NavLink to="/connectors"` `data-nav="connectors"`（`Workbench.tsx` L173–L176） | PASS |
| 员工默认路径不深链 `/admin/connectors` | 侧栏无该 href。E2E：`docs/21 employee sidebar has no admin connectors deep-link`；员工 persona 同断言 | PASS |
| 用户菜单不含连接器或 Starry | `UserMenu.tsx`：员工工作台 / 条件「管理控制台」/ 调试 / 个人设置 / 退出。E2E 菜单「连接器」count=0 | PASS |
| SkillHub 砖仅 `debug && admin` | `connectorTiles` gated（`SkillHub.tsx` L349–L353）。员工 persona：`data-connector="starrykol"` / `data-hub-chip="connectors"` = 0 | PASS |
| 只列出 `GET /api/connectors` 已授权且已启用 | `enterprise.ts` L191–L201：非 admin = grants ∩ `enabled=1`。不前端补未授权行 | PASS |
| `/agents` 无连接器状态主 IA | `Agents.tsx` 零命中 connector / 连接器 | PASS |
| `UX-COPY-ENGINE` | E2E：body 无 `Starry KOL MCP` / `LIVE` / `Codex`；无 `textarea[name=bearer]`、无启停 | PASS |
| 员工打开 `/admin/connectors` | `AdminConsole.tsx` L99：无 admin → `<Navigate to="/" replace />`。E2E：URL 回 `/`，不渲染枢纽 | PASS |

**残余（不降 FAIL）：**

- SkillHub `CONNECTORS[]` 仍硬编码 `to: "/admin/connectors/..."`，标题含「Starry KOL MCP」。仅调试+admin，符合 `21`。
- `connectorPublic` 仍展开 `credential_ref`（API 偏胖）。使用面不渲染。
- 误开治理 URL 落到 **Home**，不是 `/connectors`。边界成立；改落到使用面未立法（建议，不实施）。
- `SimplePages` `Admin`（`/admin/kol`）同时链枢纽与员工使用面 — 管理端配置页，非员工默认。

### 3. 空 / 错误状态

**判定：PARTIAL**（与前次同；FE 未变）

宪法 §6：加载、空、错误须有明确状态与**可恢复动作**。`21`：空态写「目前没有已授权给你的」，不要补治理目录。

| 状态 | 实现（事实） | 判定 |
|---|---|---|
| 加载 | 「正在读取已授权的连接能力…」（L65） | PASS 有状态。无 skeleton / `aria-busy` → DEBT |
| 空 | `data-connector-use-empty`：「目前没有已授权给你的连接能力。需要开通请联系管理员。」 | PASS 对 `21`。恢复=联系管理员，无应用内 CTA — 可接受（授权不在本页） |
| 错误 | `role="alert"`；失败 `setRows([])`（L27–L31） | **PARTIAL**：有文案，**无重试** |
| 无权限（本页） | 已登录即可进 `/connectors`；零授权 = 空态 | PASS |
| 无权限（治理 URL） | 员工 → Home | PASS |
| 部分成功 | 一次拉取，无该语义 | 不适用 |

建议（不实施）：错误加「再试一次」；加载加 `aria-busy`。不要为「无权限」画未授权目录。

### 4. MASTER + OpenAI 视觉债（只列）

**判定：DEBT**（与前次同；不构成 #1–#3 / #5 产品违约）

MASTER：现有页面完成度不是设计基准。OpenAI style = 对照 only。

#### MASTER

| 债 | 证据 |
|---|---|
| 页标题 `--font-title`（24px）而非 `--font-page-title`（28px） | `.connector-use-page h1`（`styles.css` L4532）；MASTER §3 |
| `h1` 内联 `style={{ marginTop: 0 }}` | `ConnectorUse.tsx` L59 |
| 状态字用迁移别名 `--font-meta` | L4556 |
| 列表圆角 `--radius-sm`（6px）；面板应为 `--radius-md`（10px） | L4535 |
| `.muted` 魔法数 `margin: 4px 0 0` | L4549 |
| 状态另加 `--success` / `--warning` | L4560–L4561。有文字「可用 / 需个人绑定」，未只靠颜色 |
| 加载为 muted 字，无 skeleton | L65 vs MASTER §5 |
| 「去个人设置绑定」`btn ghost sm` 约 36px 高 | MASTER 触控 44×44 |
| 无 `pages/connectors.md` | `pages/` 仅 home / chat / pipeline / admin |
| `data-visual="docs20"` | 旧视觉标记 |

#### OpenAI 对照（非规范）

| 对照 | 使用面现状 |
|---|---|
| 单色画布、唯一实心黑 CTA | 靛蓝 `--primary`；状态用成功/警告色 |
| 按钮 pill 9999px、靠留白 | `ghost sm`；1px `--border` 列表 |
| 页标题 28px editorial | 24px + kicker「账户」 |
| 无侧栏 | 落在 Workbench 左栏（产品 IA，不是本页独有） |

对照差不单独升级为 FAIL。

### 5. 相对新法：第一等 #6 — 同侪还是二等「支撑」？

**判定：PASS（同侪 IA）+ 残余二等读法（不 FAIL）**

新法要问的不是「还是不是使用面」（前次已 PASS），而是：**FE / 文档 IA 是否把它当成与知识库、审批、考试同侪的第一等能力，而不是 KOL Agent 下属的二等「支撑」。**

#### 5a. 文档 IA（本 SHA）— PASS

| 来源 | 事实 | 同侪？ |
|---|---|---|
| `CONSTITUTION.md` §4.1 表 #6 | 「连接器 \| 一等 \| 员工使用面 ≠ 管理治理面」 | 是。与 #1–#16 同行 |
| §4.1 段末 / ADR-023 决定 3 | 「支撑」≠ 二等；不是 KOL Agent 附属 Tab | 是。明确反降等 |
| `employee-surface-contracts.md` | 连接器使用面列入一等清单；禁止「把能力面隶属 KOL Agent」 | 是 |
| `21` L73–L77 | 「独立的员工一等能力面」；与数字员工 / 今日任务解耦 | 是 |
| `CONTEXT-MANIFEST.md` | `/kb`、`/agents`、员工连接器同一路由行 | 是 |
| `docs/README.md` | 平台能力 vs KOL 试点；连接器使用 ≠ 治理单独成行 | 是 |

旧宪法（`54e1752` §4）把连接器塞进「支撑能力面」一行 — **已被 PR #94 废止。** 前次扫描结论里的「支撑能力面」位阶用语与新法冲突，本次作废。

#### 5b. FE IA — PASS（不隶属 KOL / 数字员工）

| 信号 | 事实 | 读法 |
|---|---|---|
| 独立路由 `/connectors` | `App.tsx` L42，与 `/kb` `/approvals` `/exam` 并列 | 同侪 |
| 侧栏一级「连接器」 | 资产簇，在知识库 / 审批 / 考试之后；**不在** `aria-label="数字员工"` | 同侪。`21` 允许资产簇或 Settings 邻接 |
| 不进数字员工簇 | 该簇默认只有 `/agents`；技能目录仅 debug | 非 KOL-Agent 下属 |
| 不因进行中任务才出现 | 无 task-gate | 符合 §4.1 |
| Pipeline 甚至不在侧栏 | 资产簇有连接器、无「生命周期」链 | 反证：不是 KOL 壳的附属 Tab |
| 专家中心无连接器 chrome | `Agents.tsx` 零命中 | 符合 ADR-016 / 023 |

#### 5c. 仍可读成二等的措辞 / UI（残余，建议不实施）

| 残余 | 位置 | 为何像二等 |
|---|---|---|
| 页头 kicker **「账户」** | `ConnectorUse.tsx` L58；`AccountSettings.tsx` 同词 | 视觉上挂到个人设置，不像 #6 能力面（知识库 kicker 是资料类，审批是「审批」） |
| 契约写「**可选**连接器使用面」 | `employee-surface-contracts.md` 资产簇表；`21` 导航「可选『连接器』入口」 | 「可选」本意是侧栏密度=UX，易被读成能力本身可有可无 |
| 含义文案偏 KOL 试点 | `connectorUse.ts`：「红人库与跟进邮箱」「首页『我跟进的红人』」「达人评分与建联」 | ADR-015 允许数据作示例；整页含义仍像 KOL 工具箱，不是中台连接器面 |
| 员工契约无独立「连接器 / 只回答」节 | 细则在 `21`；KB / `/agents` / 技能有专节 | 加载顺序上像「治理附件」而不像员工面专章 |
| 无 `pages/connectors.md` | 设计系统只有 home/chat/pipeline/admin | 视觉立法缺页，像未入一等皮肤 |
| 移动顶栏 | 仅「任务」「数字员工」 | 密度 UX；与 KB/审批同样未上顶栏，不单独判二等 |

以上**不**把 #6 打成 FAIL：路由与侧栏已是同侪，且不隶属 KOL Agent。kicker「账户」是最强的二等 chrome。

---

## Findings

1. **法已换、页未换（事实）。** `5b21867` 相对 `54e1752` 零 FE/BE。使用 ≠ 治理、不深链凭据、空/错、视觉债与 PR #93 扫描相同。变的是位阶：从「支撑能力面」改为 **第一等 #6**。
2. **使用 vs 治理仍然拆开（事实）。** `ConnectorUse` 只读员工 API + Starry 绑定态；写路径在 `AdminConnectors`。E2E `employee connector use surface is independent of admin hub` 仍覆盖。
3. **员工默认 chrome 进不了配置/凭据（事实）。** 侧栏、菜单、专家中心、Home 不链 `/admin/connectors`。误开治理 URL → Home。
4. **L3 不在本页（事实）。** Starry CTA → `/settings?tab=starry`；无 `StarryBindForm`、无 JWT、无启停。
5. **#6 同侪：文档 + 侧栏 PASS；kicker/「可选」/KOL 含义是残余二等读法（事实）。** 不是 KOL Agent 下属，也不是任务 Tab。
6. **错误恢复仍不足（事实）。** 符合 `21` 空态；不符合宪法「错误须有可恢复动作」。
7. **建议（不实施）：** 错误重试；kicker 从「账户」改为能力面自称（如「连接器」或去掉）；契约「可选」只修饰侧栏密度；`pages/connectors.md`；员工契约补「连接器使用面 / 只回答」专节。不要做成启停表，不要深链 `/admin/connectors`。

---

## Conclusion（给 kol）

- **基线：** `origin/main` **`5b21867`**（PR #94 合并）。权威 = ADR-023 + `CONSTITUTION.md` §4.1 #6，不是 `54e1752` 的「支撑能力面」表。
- **使用 ≠ 治理：PASS。** `/connectors` 只答已授权 / 含义 / 绑定去哪；不是枢纽副本。员工默认「连接器」只去 `/connectors`；菜单无连接器；`/admin/connectors` 回 Home。必须继续禁止主路径进配置/凭据。
- **第一等 #6：文档与 FE 路由/侧栏按同侪落地（PASS）。** 不隶属 KOL Agent，不因进行中任务才存在。「支撑」在新法里不是降等。残余：kicker「账户」、文案「可选」、含义偏红人/跟进 — 读起来仍像设置邻接或 KOL 工具，**未**构成违约。
- 本页无绑定表、无 JWT、无启停。Starry 只链 Settings。
- 空态可用；错误缺重试。无授权不要画未授权目录。
- 视觉相对 MASTER / OpenAI 有债，不构成本轮产品违约，也不是改 FE 授权。
- 本审查 **docs-only**。不 LIVE。kol 可继续把该面当已立法的使用面；后续若改 chrome，优先去二等读法（kicker / 「可选」），不要动使用≠治理边界。
