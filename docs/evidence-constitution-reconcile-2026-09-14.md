# Evidence: ADR-023 残留违宪条款和解 + 侧栏硬锁（2026-09-14）

> **Note (2026-09-15):** 下文 `UX-COPY-ENGINE` 指当时 `04` 验收表行。该 ID 已废；员工禁词原则仍在 `04` / `UX-EMPLOYEE`。现行 UX 派生见 `docs/evidence-ux-rederive-from-constitution-2026-09-15.md`。

- **Date:** 2026-09-14
- **Authority:** `CONSTITUTION.md` §4.1–4.2 + ADR-023（`5b21867`+）仍最高。本文件只列删改，不另立法。
- **Mode:** 文档 only。**No LIVE.** 不改 JSX / CSS / API。不删除 Pipeline 页，不改 `FS-KOL-010`。
- **User lock (do not weaken):** 产品 = 智能体中台；16 项一等能力；KOL = 首个试点。Pipeline / Home「AI发现」/「我跟进的红人」= 试点特化，不是平台一等清单。技能可见 = UX 密度，仍禁图鉴压过任务脊柱。数字团队 = 一等未实现；禁专家团假导航；不得永久禁名词「数字团队」。「支撑」≠ 二等。发送 ≠ 阶段、L1–L3、使用 ≠ 治理仍在。

ADR-023 修宪后，下列法律仍把 Pipeline 侧栏写成硬入口或「可选密度」。本 PR **删除或改写**，不软留冲突句。

## 删改清单

| # | 文件 | 原条款（冲突读法） | 处置 |
|---|---|---|---|
| 1 | `employee-surface-contracts.md` 资产簇「员工入口」 | 「生命周期（Pipeline 主表面）」写成侧栏硬入口；后改为「可挂可不挂」 | **删除**该侧栏项。资产簇只剩知识库 / 审批 / 考试 / 连接器 / 占位。禁止列写明：侧栏挂「生命周期」或 `/pipeline` 主入口 |
| 2 | `employee-surface-contracts.md` 侧栏导语 | 把 Pipeline 可见写成 UX 密度 | **改写：** **禁止**侧栏挂「生命周期」或 `/pipeline` 主入口；页只许深链 / CTA |
| 3 | `employee-surface-contracts.md` 并列能力面硬规则 | 「Pipeline 侧栏 ≠ 平台义务 / 可省略」 | **改写为硬禁：** 「禁止侧栏挂 Pipeline」。技能句仍删除「员工永远不许看见」永久禁令 |
| 4 | `employee-surface-contracts.md` P0「Agents 是工作入口」 | Home「独占四模式」含 AI发现 / 我跟进的红人，读成平台一等 | **改写：** Home 独占**平台**任务模式（今日任务 + 我的待办）；后两项标为 KOL 试点特化 |
| 5 | `employee-surface-contracts.md` 表面表 Pipeline 行 | Pipeline 像中台主表面或默认导航 | **改写：** KOL 试点页仍在；禁止侧栏主入口 |
| 6 | `21-admin-employee-page-roles.md` 导航表「员工侧栏 / 必须」 | 「工作入口停在 … Pipeline …」或「可以不挂」 | **改写：** 必须列不含 Pipeline。禁止列：**侧栏挂「生命周期」或 `/pipeline` 主入口** |
| 7 | `21-admin-employee-page-roles.md` 员工端「只回答」 | 「正式生命周期坐落在哪」与干活问句并列 | **改写：** Pipeline 是试点页，只许深链 / CTA；禁止侧栏主入口 |
| 8 | `21-admin-employee-page-roles.md` 页面表 / 配套表 Pipeline | 「默认侧栏可省略」 | **改写：** 禁止员工侧栏主入口 |
| 9 | `04-ux-ui-system.md` 双端边界 | 「员工端只展示 … 品牌、KOL、SOP」读成产品壳 = KOL | **改写：** 员工看任务 / 业务对象 / 结果；KOL 等是试点数据不是产品壳。产品名词「技能」一等，露出=UX |
| 10 | `04-ux-ui-system.md` 表面分类段 | 「缺 Pipeline 导航不是违约」软句 | **改写：** **禁止**侧栏挂「生命周期」或 `/pipeline` 主入口 |
| 11 | `19-ui-ux-constitution.md` | 兼容页未阻断历史侧栏义务 | **改写：** 禁止侧栏挂 Pipeline；技能入口=UX；冲突以宪法为准 |
| 12 | `CONTEXT-MANIFEST.md` | 「缺默认侧栏入口不是违宪」 | **改写：** 禁止员工侧栏出现「生命周期」或 `/pipeline` |
| 13 | `14-implementation-contract.md` 知识库契约 | 员工 `/kb` 产品面仍指向已退役入口 `19` | **改写：** 改指 `employee-surface-contracts.md` + `CONSTITUTION.md` §4。不重写 FS / Expert API |
| 14 | `15-conformance-gaps.md` 结论 | 「KOL 试点原型」易被读成平台壳现状即法律 | **改写：** 现行 KOL 偏重 chrome 是实现快照，不是平台 IA；清单以宪法 §4.1–4.2 为准 |
| 15 | `17-code-conformance-scan.md` | 无「平台=Pipeline 一等 / 员工永不见技能」再陈述 | **不改**（代码扫描，不重述错误 IA） |
| 16 | `CONSTITUTION.md` §4.2 | 曾写「默认侧栏=UX 密度」 | **改写（不削弱）：** Pipeline 页仍在（FS-KOL-010）；**禁止**侧栏挂「生命周期」或 `/pipeline` 主入口 |
| 17 | `docs/README.md` 平台 vs 试点表 | 曾写 Pipeline 侧栏=UX | **改写：** 禁止侧栏挂 Pipeline；页只许深链 / CTA |
| 18 | `DECISIONS.md` ADR-012 / ADR-018 / ADR-023 | 「四页法律」或「侧栏密度=UX」 | **修订：** 四页=页职责；侧栏硬禁「生命周期」/ `/pipeline` |

## 明确不改

- 任何 frontend / backend / CSS / e2e（Workbench 若已省略左栏 Pipeline，本 PR 不改代码）
- 不删除 `employee-surface-contracts.md` 全文；只剪冲突段
- 不删除 Pipeline 页、`FS-KOL-010`、或设计系统 `pages/pipeline.md`
- 不实施数字团队 UI，不强制侧栏加技能
- 发送 ≠ 阶段、L1–L3、连接器使用 ≠ 治理
- `references/` 与过期 evidence 扫描正文保持历史快照

## employee-21 hunt（6 REWRITE / 0 delete）

文件未入 checkout。对照现行正文：

| ID | 要求 | 落地 |
|---|---|---|
| ESC-KOL-01/02 | 「会话/KOL 工作台」→ 中台/会话工作台 | 已改（`employee-surface-contracts.md` 闭环段 + §1） |
| ESC-PIPE-01 | 侧栏「生命周期（Pipeline）」不是平台义务 | **强于 hunt：** 资产簇已删除该项；禁止侧栏挂「生命周期」或 `/pipeline`（硬锁优先于「可挂 UX」） |
| ADM-PIPE-01 | `21` 员工总「只回答」勿把生命周期当平台问句 | 已移到 Pipeline 行并标试点页；员工总行禁止侧栏主入口 |
| ESC-LIST-01 | 十六项括注含数字团队或见 §4.1 全表 | 已写「十六项全表（含数字团队预留…见宪法清单）」 |
| CM-ROUTE-01 | CONTEXT 补技能/数字团队/审批/考试/cron | 路由表已补四行 |
| 21 L154 keep | Pipeline 为「KOL 试点资产」 | **页**身份保留为 KOL 试点资产；**左栏必须列不含该入口**（硬锁） |

## Hunt 续扫（文件未入本工作区；按用户摘要落地）

`docs/evidence-unconstitutional-clauses-ux-visual-2026-09-14.md`（8 hits）、`…-mainline-00-18-…`（30 rows）、`…-employee-21-…`（6 REWRITE）未出现在本 checkout。下列按用户/队列摘要 **DELETE/REWRITE**，侧栏 Pipeline 仍服从硬锁（禁止左栏，不是「可挂 UX」）。

| 主题 | 落地 |
|---|---|
| P0：`04` 员工可见面缺 §4.1 十六项 | `04` 双端边界改为平台任务/会话 + 十六项清单，删除 KOL 专用枚举 |
| `UX-COPY-ENGINE` / `TC-UX-004` 未分家产品「技能」 | `04` L51、`16` TC-UX-004 / F-EMPLOYEE：只禁英文 Skill 时序 |
| MASTER / pages 路径像 KOL-only | MASTER 改题并声明试点皮肤；`pages/pipeline.md` / `home.md` / `20` 加试点标签 |
| 「会话/KOL 工作台」壳身份 | `employee-surface-contracts.md` 改为中台/会话工作台 |
| §4.1 括注漏数字团队 | 表面分工改为「十六项全表（含数字团队预留…）」 |
| CONTEXT 缺技能/数字团队/审批/考试/cron | 路由表补行 |
| DECISIONS 四页法律 / ADR-016 禁 Skill / ADR-015 漏项 | **删除**活义务「不改/不削弱四页法律」。ADR-012 决定改为平台脊柱+试点页。索引 ADR-012/013/015/016 已改。`04`/`16` Skill 分家与十六项清单已落地。`02`/`12`/`14`/`15` 软注脚已加。01/03/05–11/13/17/18 未整篇改写 |
| 02 / 12 / 14 / 00 软注脚 | 平台 vs 试点一句，不重写 FS |

## 交叉引用

- 宪法：`CONSTITUTION.md` §4.1–4.3
- 员工契约：`employee-surface-contracts.md`
- 双端：`21-admin-employee-page-roles.md`
- 决策：ADR-023 硬锁修订；ADR-012 页职责读法
- 路由：`docs/README.md`「平台能力 vs KOL 试点」
