# 员工连接器使用面宪法复扫 v3（2026-09-14）— rescan2

> **Note (2026-09-15):** 扫描当时用 `UX-COPY-ENGINE` 作验收标签。该 ID 已废；员工禁词原则仍在 `04` / `UX-EMPLOYEE`。

对照基准：**`origin/main` merge commit `41227bb8eadcd18f8c1418f29ab0eb03642601af`**（短 SHA `41227bb`）= **Merge pull request #97** `cursor/docs-strip-sidebar-pipeline-ban-fb82`。`git rev-parse HEAD` 在本审查开分支时 = 该完整 SHA。只读、无应用代码改动、无 LIVE。本文件是审查记录，不是实施单。

**事实 vs 建议：** 带「事实」的段落只陈述该 SHA 的仓库现状；带「建议」的段落未实施。

权威是**已合并的平台法**（`CONSTITUTION.md` §4.1–4.2 + ADR-023），OpenAI style = **对照 only**（`docs/references/openai-style.md`），不是实施规范。连接器 = 第一等能力 **#6**。范围只覆盖员工 `/connectors`（`ConnectorUse`）及员工「连接器」入口。

---

## Meta

| 项 | 值 |
|---|---|
| 日期 | 2026-09-14 |
| 扫描基线 SHA | `git rev-parse HEAD` @ branch start = **`41227bb8eadcd18f8c1418f29ab0eb03642601af`** |
| 基线提交 | `41227bb Merge pull request #97 from zhiyuan1984/cursor/docs-strip-sidebar-pipeline-ban-fb82` |
| 基线分支 | `origin/main` @ `41227bb` |
| 角色 | 员工 `/connectors`（`ConnectorUse`）及员工「连接器」入口；对照第一等能力 **#6** |
| 非范围 | 管理端枢纽/详情实施质量、Pipeline/Home/Chat 改版、FE/BE 重构、LIVE |
| LIVE | 否。本审查不发信、不写阶段、不改凭据、不跑远端治理 |
| 前次扫描 | PR #93 `docs/evidence-ui-constitution-scan-connectors-2026-09-14.md`，基线 **`54e1752`**（旧宪法，无 ADR-023）。**已在本 SHA 树上。** |
| 前次复扫 | PR #95 `docs/evidence-ui-constitution-rescan-connectors-2026-09-14.md`，基线 **`5b21867`**（ADR-023 入 main）。**已在本 SHA 树上。** |

判定用词：`PASS` / `FAIL` / `PARTIAL` / `DEBT`。

### 一行结论

相对 **`41227bb` 已合并法**：使用 ≠ 治理 **PASS**；员工默认路径不深链 `/admin/connectors` 凭据/枢纽 **PASS**。连接器是 **第一等 #6**（「支撑」≠ 二等、不隶属 KOL Agent）— **文档 + 路由/侧栏 IA = PASS（同侪）**。空/错 **PARTIAL**（错误无重试）。MASTER / OpenAI 对照 **DEBT**。页头 kicker「账户」、契约「可选」、含义文案偏 KOL 试点仍可读成二等 — **残余，不 FAIL**。相对前两次扫描：**FE/BE 零 diff**；变的是法已和解、前证已入树、Pipeline 不再写成平台轨入口。不阻断 kol 把该面当已立法的使用面。

---

## Sources

先读本 SHA 的法，再对照实现。不信任 `54e1752` 旧「支撑能力面」位阶用语。

| 权威（本 SHA） | 本复扫用到的条款 |
|---|---|
| `docs/CONSTITUTION.md` §4.1 #6 | **连接器 = 一等公民**；员工使用面 ≠ 管理治理面（ADR-013 / `21`）。十六项互不隶属，**不隶属 KOL Agent** |
| `docs/CONSTITUTION.md` §4.1 段末 / §4.3 | 「支撑」只禁止复制 Home / Chat / Pipeline / Admin IA，**不是**二等、不是 KOL Agent 附属 Tab |
| `docs/CONSTITUTION.md` §4.2 | KOL 是首个试点不是平台壳；Pipeline **页**仍在（`FS-KOL-010`），只许深链 / 产品内 CTA；使用 ≠ 治理仍服从 ADR-015 |
| `docs/CONSTITUTION.md` §5–§6 | L3 不在本页；加载 / 空 / 错误须有状态与可恢复动作 |
| ADR-023（`docs/DECISIONS.md` L464–L500） | 十六项一等；「支撑」≠ 二等；不变量：连接器使用 ≠ 管理治理。本 ADR **不改 JSX** |
| `docs/employee-surface-contracts.md` | 一等能力面含连接器使用面；资产簇可挂 `/connectors`；禁止隶属 KOL Agent、禁止深链治理、禁止进数字员工簇。**仍无独立「连接器 / 只回答」专节**（细则在 `21`） |
| `docs/21-admin-employee-page-roles.md` | 使用面只答三句；禁止启停/凭据/授权编辑；侧栏若有入口只链 `/connectors`；资产簇「可选连接器使用面」 |
| `docs/design-system/kol-workbench/MASTER.md` | token、标题阶、状态、触控。路径名是试点皮肤，不是产品身份（本 SHA 已改题为「智能体中台工作台」） |
| `docs/references/openai-style.md` | **对照 only**，不是实施规范 |
| `docs/CONTEXT-MANIFEST.md` L29 | `/kb`、`/agents`、员工连接器同一路由行（同侪加载） |
| 前次扫描 / 复扫（本树） | `docs/evidence-ui-constitution-scan-connectors-2026-09-14.md`；`docs/evidence-ui-constitution-rescan-connectors-2026-09-14.md` |

实现只读（相对 `54e1752` **与** `5b21867`：`git diff --stat` 对 `frontend/` `backend/` **均为空**）：

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

无 `design-system/kol-workbench/pages/connectors.md`（事实；`pages/` 仍仅 home / chat / pipeline / admin）。

---

## Delta vs prior scan + rescan

| 项 | 扫描 v1（PR #93 @ `54e1752`） | 复扫 v2（PR #95 @ `5b21867`） | 本复扫 v3（@ `41227bb`） |
|---|---|---|---|
| 证据文件是否在 `main` | 当时不在（仅 PR 分支） | 当时不在（仅 PR 分支） | **两者均已入树**（#93 / #95 merge） |
| 产品身份 | 宪法「支撑能力面」一行 | §4.1 **#6 一等**；ADR-023 | **同 v2**。另：PR #96 和解 + #97 侧栏 Pipeline 用语 |
| 前次「支撑能力面」用语 | 结论正文使用 | v2 **作废**该位阶 | **继续作废** |
| 使用 ≠ 治理 | PASS | PASS | **仍 PASS**（FE 未变） |
| 不深链 admin 凭据 | PASS | PASS | **仍 PASS** |
| 空 / 错误 | PARTIAL（无重试） | PARTIAL | **仍 PARTIAL** |
| MASTER / OpenAI | DEBT | DEBT | **仍 DEBT** |
| #6 同侪 | 未立法此项 | PASS（同侪 IA）+ 残余二等读法 | **仍 PASS + 同残余**。法侧更清晰：资产簇有连接器、**无** Pipeline 轨入口 |
| FE/BE | ConnectorUse 已落地 | `54e1752..5b21867` 零 diff | **`5b21867..41227bb` 与 `54e1752..41227bb` 对 connector 实现文件均为空** |

本 SHA 相对 `5b21867` 的**法**变化（与本面相关，不改 JSX）：

1. **前证入树。** PR #93 扫描、PR #95 复扫现可在 `main` 交叉引用。
2. **ADR-023 和解（PR #96）+ 侧栏 Pipeline 用语（PR #97）。** `21` 员工侧栏必须列：平台工作入口 + 资产簇（知识库 / 审批 / 考试 / **可选连接器使用面** / 占位）。Pipeline **页**仍是 KOL 试点资产，**不是**该列入口（只许深链 / CTA）。`employee-surface-contracts.md` 资产簇已去掉「生命周期（Pipeline 主表面）」。
3. **MASTER 改题。** 「KOL Workbench Design System」→「智能体中台工作台 Design System」，声明路径是试点皮肤。视觉债清单不因此消失。
4. **§4.2 补句。** Pipeline 页仍存在（`FS-KOL-010`），只许深链或产品内 CTA。强化「KOL ≠ 平台壳」，不改变使用 ≠ 治理。

**不构成新的产品 FAIL。** 使用面 JSX / CSS / API / E2E 与 v1/v2 同一实现快照。

---

## Surface map（本 SHA 事实）

| 表面 | 路径 / 控件 | 角色 | 是否员工默认 |
|---|---|---|---|
| 使用面 | `/connectors` → `ConnectorUse`（`App.tsx` L42） | 已授权条目 + 业务含义 + 状态；Starry CTA → `/settings?tab=starry` | 是。侧栏资产簇 `data-nav="connectors"` |
| 个人绑定 | `/settings?tab=starry` → `StarryBindForm` | 个人发件箱绑定 / 解绑 | 是，但是 Settings，不是使用面本体 |
| 治理枢纽 | `/admin/connectors`、`/admin/connectors/:id` | 启停、凭据引用、员工 read/write | 否。无 admin 时 `Navigate to="/"` |
| 侧栏 | `Workbench` 资产簇 | 「连接器」→ `/connectors`；数字员工簇无连接器；**无** Pipeline /「生命周期」链 | 是 |
| 用户菜单 | `UserMenu` | 员工工作台 / 条件「管理控制台」/ 调试 / 个人设置 / 退出。无「连接器」、无 Starry | 菜单无连接器入口 |
| SkillHub 砖 | `/market/skills` `CONNECTORS[]` | `starrykol` / `kolclaw` / `enterprise_mail` / `wecom` → `/admin/connectors/...` | **仅** `debug && admin` |
| 专家中心 | `/agents` | 无连接器 chrome / pills（`Agents.tsx` 零命中） | 不涉及 |
| Home | `/` | 无连接器入口 | 不涉及 |
| 移动顶栏 | `Workbench` L95–L99 | 仅「任务」「数字员工」 | 密度 UX；连接器与 KB/审批同样未上顶栏 |
| 遗留管理配置 | `SimplePages` `Admin`（`/admin/kol`） | 同时链枢纽与员工使用面（L241–L242） | 管理端配置页，非员工默认 |

员工打开治理 URL（E2E 事实，`workbench.spec.ts` L2746–L2748）：

```text
员工 persona → GET /admin/connectors → URL 变为 /
```

`AdminConsole.tsx` L99：`available_modes` 不含 `admin` 则 `<Navigate to="/" replace />`。另：`/admin/starry` → `/settings?tab=starry`（L100）。**没有**把员工从 `/admin/connectors` 送到 `/connectors`。

---

## Checklist

### 1. 使用表面 ≠ 治理

**判定：PASS**

| 契约（本 SHA） | 现状（事实） | 判定 |
|---|---|---|
| 只回答：已授权可用哪些、意味着什么、个人绑定去哪（`21` 员工使用面 L73–L86） | 页头：「你已被授权可用哪些连接能力、对你意味着什么。启用、凭据和组织策略不在本页。」（`ConnectorUse.tsx` L60–L62） | PASS |
| 不是 `/admin/connectors` 只读镜像 | 消费 `api.connectors()`，不调用 `adminConnectors()`；无启停、凭据引用编辑、授权矩阵、治理表 | PASS |
| 不复制 Home / Chat / Pipeline / Admin IA（§4.1「支撑」= IA 禁令，不是降等） | 无今日任务、待办桶、会话开工、15 阶段、治理健康条 | PASS |
| 不隶属数字员工、不因进行中任务才存在 | 侧栏资产簇常驻；与 `/agents` 簇分离（`Workbench.tsx` L133–L176） | PASS |
| 禁止能力图鉴 / 技能上级目录 | 本页不列 Skill；`connectorUse.ts`：「Do not import adminGovernance」 | PASS |
| KOL / 合作只作含义文案，不定义 IA（ADR-015） | Starry 含义提到「我跟进的红人」过滤；列表仍按连接器条目（`connectorUse.ts` L17–L27） | PASS（IA）；文案偏试点 → 见 #5c |

行模型未变：`id` + `connectorUseLabel` + `connectorUseMeaning` + `connectorUseStatus`（可用 / 需个人绑定）。标签去 MCP/Codex。`preferCanonicalConnectors` 折叠遗留 id。

L3 绑定不在本页（对照，非单独 FAIL 轴）：「去个人设置绑定」仅 `Link` → `/settings?tab=starry`（`ConnectorUse.tsx` L89–L93）。无 `StarryBindForm`、无 JWT、无启停。`isBindableConnector` 只匹配 `/starry/i`。

### 2. 无深链管理端凭据 / 枢纽

**判定：PASS**

| 契约 | 现状（事实） | 判定 |
|---|---|---|
| 侧栏若有入口，只链 `/connectors` | `NavLink to="/connectors"` `data-nav="connectors"`（`Workbench.tsx` L173–L176） | PASS |
| 员工默认路径不深链 `/admin/connectors` | 侧栏无该 href。E2E：`docs/21 employee sidebar has no admin connectors deep-link`（L2663–L2668）；员工 persona 同断言（L2416–L2417） | PASS |
| 用户菜单不含连接器或 Starry | `UserMenu.tsx` L29–L44。E2E 菜单「连接器」count=0 | PASS |
| SkillHub 砖仅 `debug && admin` | `connectorTiles` gated（`SkillHub.tsx` L349–L353）。员工 persona：`data-connector="starrykol"` / `data-hub-chip="connectors"` = 0 | PASS |
| 只列出 `GET /api/connectors` 已授权且已启用 | `enterprise.ts` L191–L201：非 admin = grants ∩ `enabled=1`。不前端补未授权行 | PASS |
| `/agents` 无连接器状态主 IA | `Agents.tsx` 零命中 connector / 连接器 | PASS |
| `UX-COPY-ENGINE` | E2E：body 无 `Starry KOL MCP` / `LIVE` / `Codex`；无 `textarea[name=bearer]`、无启停（L2737–L2742） | PASS |
| 员工打开 `/admin/connectors` | `AdminConsole.tsx` L99 → Home。E2E L2746–L2748 | PASS |

**残余（不降 FAIL）：**

- SkillHub `CONNECTORS[]` 仍硬编码 `to: "/admin/connectors/..."`，`starrykol` 标题含「Starry KOL MCP」（`SkillHub.tsx` L68–L96）。仅调试+admin，符合 `21`。
- `connectorPublic` 仍展开 `credential_ref` / `credential_reference`（`enterprise.ts` L68–L75）。使用面不渲染。API 投影偏胖，不是本页治理 UI。
- 误开治理 URL 落到 **Home**，不是 `/connectors`。边界成立；改落到使用面未立法（建议，不实施）。
- `SimplePages` `Admin`（`/admin/kol`）同时链枢纽与员工使用面 — 管理端配置页，非员工默认。

### 3. 空 / 错误状态

**判定：PARTIAL**（与 v1/v2 同；FE 未变）

宪法 §6：加载、空、错误须有明确状态与**可恢复动作**。`21`：空态写「目前没有已授权给你的」，不要补治理目录。

| 状态 | 实现（事实） | 判定 |
|---|---|---|
| 加载 | 「正在读取已授权的连接能力…」（`ConnectorUse.tsx` L65） | PASS 有状态。无 skeleton / `aria-busy` → DEBT |
| 空 | `data-connector-use-empty`：「目前没有已授权给你的连接能力。需要开通请联系管理员。」 | PASS 对 `21`。恢复=联系管理员，无应用内 CTA — 可接受（授权不在本页） |
| 错误 | `role="alert"`；失败 `setRows([])`（L27–L31） | **PARTIAL**：有文案，**无重试** |
| 无权限（本页） | 已登录即可进 `/connectors`；零授权 = 空态 | PASS |
| 无权限（治理 URL） | 员工 → Home | PASS |
| 部分成功 | 一次拉取，无该语义 | 不适用 |

建议（不实施）：错误加「再试一次」；加载加 `aria-busy`。不要为「无权限」画未授权目录。

### 4. MASTER + OpenAI 视觉债（只列）

**判定：DEBT**（与 v1/v2 同；不构成 #1–#3 / #5 产品违约）

MASTER：现有页面完成度不是设计基准。OpenAI style = **对照 only**。

#### MASTER

| 债 | 证据 |
|---|---|
| 页标题 `--font-title`（24px）而非 `--font-page-title`（28px） | `.connector-use-page h1`（`styles.css` L4532）；MASTER §3 |
| `h1` 内联 `style={{ marginTop: 0 }}` | `ConnectorUse.tsx` L59。宪法 §3：组件不得自行定义与设计系统冲突的间距 |
| 状态字用迁移别名 `--font-meta` | L4556 |
| 列表圆角 `--radius-sm`（6px）；面板应为 `--radius-md`（10px） | L4535 |
| `.muted` 魔法数 `margin: 4px 0 0` | L4549 |
| 状态另加 `--success` / `--warning` | L4560–L4561。有文字「可用 / 需个人绑定」，未只靠颜色 |
| 加载为 muted 字，无 skeleton | L65 vs MASTER §5 |
| 「去个人设置绑定」`btn ghost sm` 约 36px 高 | MASTER 触控 44×44 |
| 无 `pages/connectors.md` | `pages/` 仅 home / chat / pipeline / admin |
| `data-visual="docs20"` | 旧视觉标记 |

MASTER 本 SHA 改题（试点皮肤声明）**不**清掉上表。

#### OpenAI 对照（非规范）

| 对照 | 使用面现状 |
|---|---|
| 单色画布、唯一实心黑 CTA | 靛蓝 `--primary`；状态用成功/警告色 |
| 按钮 pill 9999px、靠留白 | `ghost sm`；1px `--border` 列表 |
| 页标题 28px editorial | 24px + kicker「账户」 |
| 无侧栏 | 落在 Workbench 左栏（产品 IA，不是本页独有） |

对照差不单独升级为 FAIL。实施权威仍是 MASTER + 宪法。

### 5. 第一等 #6 — 同侪还是 KOL 下属 / 二等「支撑」？

**判定：PASS（同侪 IA）+ 残余二等读法（不 FAIL）**

本轮要确认的不只是「还是不是使用面」（v1 已 PASS），而是：**在 `41227bb` 已和解的法下，FE / 文档 IA 是否把连接器当成与知识库、审批、考试同侪的第一等能力，而不是 KOL Agent 下属或 Pipeline 轨附件。**

#### 5a. 文档 IA（本 SHA）— PASS

| 来源 | 事实 | 同侪？ |
|---|---|---|
| `CONSTITUTION.md` §4.1 表 #6 | 「连接器 \| 一等 \| 员工使用面 ≠ 管理治理面」 | 是。与 #1–#16 同行 |
| §4.1 段末 / ADR-023 决定 3 | 「支撑」≠ 二等；不是 KOL Agent 附属 Tab | 是。明确反降等 |
| §4.2 / `21` 侧栏必须列 | Pipeline 是试点**页**，不是本列入口；资产簇含可选连接器 | 是。**连接器与 KB/审批/考试同簇；不跟 Pipeline 绑成 KOL 轨** |
| `employee-surface-contracts.md` | 连接器使用面列入一等清单；禁止「把能力面隶属 KOL Agent」 | 是 |
| `21` L73–L77 | 「独立的员工一等能力面」；与数字员工 / 今日任务解耦 | 是 |
| `CONTEXT-MANIFEST.md` L29 | `/kb`、`/agents`、员工连接器同一路由行 | 是（加载同侪）。细则仍指向契约「对应章节」——连接器无专节，见 5c |

旧宪法（`54e1752` §4）把连接器塞进「支撑能力面」一行 — **已被 PR #94 废止，本 SHA 维持。** v1 结论里的「支撑能力面」位阶用语继续作废。

相对 v2：资产簇去掉 Pipeline「生命周期」硬入口后，#6 更不像 KOL 壳附件。这是**法**变清晰，不是页变同侪。

#### 5b. FE IA — PASS（不隶属 KOL / 数字员工）

| 信号 | 事实 | 读法 |
|---|---|---|
| 独立路由 `/connectors` | `App.tsx` L42，与 `/kb` `/approvals` `/exam` 并列 | 同侪 |
| 侧栏一级「连接器」 | 资产簇，在知识库 / 审批 / 考试之后；**不在** `aria-label="数字员工"` | 同侪。`21` 允许资产簇或 Settings 邻接 |
| 不进数字员工簇 | 该簇默认只有 `/agents`；技能目录仅 debug | 非 KOL-Agent 下属 |
| 不因进行中任务才出现 | 无 task-gate | 符合 §4.1 |
| 侧栏无 Pipeline /「生命周期」 | `Workbench.tsx` 资产簇有连接器、无 `/pipeline` | 实现快照：#6 不挂在试点轨下。法：Pipeline 不是本列入口 |
| 专家中心无连接器 chrome | `Agents.tsx` 零命中 | 符合 ADR-016 / 023 |
| Home 无连接器入口 | `Home.tsx` 零命中 | 不是任务 Tab |

#### 5c. 仍可读成二等的措辞 / UI（残余，建议不实施）

| 残余 | 位置 | 为何像二等 |
|---|---|---|
| 页头 kicker **「账户」** | `ConnectorUse.tsx` L58；`AccountSettings.tsx` L67 同词 | 视觉上挂到个人设置。对照：知识库 kicker 是「知识库」，审批是「审批」，定时是「我的」 |
| 契约写「**可选**连接器使用面」 | `employee-surface-contracts.md` 资产簇表；`21` 导航「可选『连接器』入口」 | 「可选」本意是侧栏密度=UX，易被读成能力本身可有可无 |
| 含义文案偏 KOL 试点 | `connectorUse.ts`：「红人库与跟进邮箱」「首页『我跟进的红人』」「达人评分与建联」 | ADR-015 允许数据作示例；整页含义仍像 KOL 工具箱 |
| 员工契约无独立「连接器 / 只回答」节 | KB / `/agents` / 技能有专节；连接器细则在 `21`。`CONTEXT-MANIFEST` 写「对应章节」但专节不存在 | 加载顺序上像「治理附件」 |
| 无 `pages/connectors.md` | 设计系统只有 home/chat/pipeline/admin | 视觉立法缺页 |
| 移动顶栏 | 仅「任务」「数字员工」 | 密度 UX；与 KB/审批同样未上顶栏，不单独判二等 |

以上**不**把 #6 打成 FAIL：路由与侧栏已是同侪，且不隶属 KOL Agent。kicker「账户」仍是最强的二等 chrome。

---

## Findings

1. **权威 SHA 是 `41227bb8eadcd18f8c1418f29ab0eb03642601af`（事实）。** 法已和解；v1/v2 证据已入 `main`。相对 `54e1752` 与 `5b21867`，connector 实现文件零 diff。
2. **使用 vs 治理仍然拆开（事实）。** `ConnectorUse` 只读员工 API + Starry 绑定态；写路径在 `AdminConnectors`。E2E `employee connector use surface is independent of admin hub` 仍覆盖。
3. **员工默认 chrome 进不了配置/凭据（事实）。** 侧栏、菜单、专家中心、Home 不链 `/admin/connectors`。误开治理 URL → Home。
4. **L3 不在本页（事实）。** Starry CTA → `/settings?tab=starry`；无 `StarryBindForm`、无 JWT、无启停。
5. **#6 同侪：文档 + 侧栏 PASS；kicker/「可选」/KOL 含义是残余二等读法（事实）。** 本 SHA 资产簇立法把 Pipeline 从轨入口拿掉，连接器仍与 KB/审批/考试同簇 — 更不像 KOL 下属。不是任务 Tab。
6. **错误恢复仍不足（事实）。** 符合 `21` 空态；不符合宪法「错误须有可恢复动作」。
7. **建议（不实施）：** 错误重试；kicker 从「账户」改为能力面自称（如「连接器」或去掉）；契约「可选」只修饰侧栏密度；`pages/connectors.md`；员工契约补「连接器使用面 / 只回答」专节。不要做成启停表，不要深链 `/admin/connectors`。

---

## Conclusion（给 kol）

- **基线：** `origin/main` **`41227bb8eadcd18f8c1418f29ab0eb03642601af`**（PR #97 合并）。权威 = ADR-023 + `CONSTITUTION.md` §4.1 #6，不是 `54e1752` 的「支撑能力面」表。
- **使用 ≠ 治理：PASS。** `/connectors` 只答已授权 / 含义 / 绑定去哪；不是枢纽副本。员工默认「连接器」只去 `/connectors`；菜单无连接器；`/admin/connectors` 回 Home。必须继续禁止主路径进配置/凭据。
- **第一等 #6：文档与 FE 路由/侧栏按同侪落地（PASS）。** 不隶属 KOL Agent，不因进行中任务才存在。「支撑」不是降等。本 SHA 资产簇有连接器、无 Pipeline 轨 — 不是 KOL-subordinate。残余：kicker「账户」、文案「可选」、含义偏红人/跟进 — **未**构成违约。
- 本页无绑定表、无 JWT、无启停。Starry 只链 Settings。
- 空态可用；错误缺重试。无授权不要画未授权目录。
- 视觉相对 MASTER / OpenAI 有债，不构成本轮产品违约，也不是改 FE 授权。OpenAI = 对照 only。
- 相对 v1/v2：**页未换，法更清，前证已入树。** 本审查 **docs-only**。不 LIVE。kol 可继续把该面当已立法的使用面；后续若改 chrome，优先去二等读法（kicker / 「可选」），不要动使用≠治理边界。
