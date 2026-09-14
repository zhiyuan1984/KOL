# Evidence: ADR-023 残留违宪条款和解（2026-09-14）

- **Date:** 2026-09-14
- **Authority:** `CONSTITUTION.md` §4.1–4.2 + ADR-023（`5b21867`+）仍最高。本文件只列删改，不另立法。
- **Mode:** 文档 only。**No LIVE.** 不改 JSX / CSS / API。不删除 Pipeline 页，不改 `FS-KOL-010`。
- **User lock (do not weaken):** 产品 = 智能体中台；16 项一等能力；KOL = 首个试点。Pipeline / Home「AI发现」/「我跟进的红人」= 试点特化，不是平台一等清单。技能可见 = UX 密度，仍禁图鉴压过任务脊柱。数字团队 = 一等未实现；禁专家团假导航；不得永久禁名词「数字团队」。「支撑」≠ 二等。发送 ≠ 阶段、L1–L3、使用 ≠ 治理仍在。

ADR-023 修宪后，下列法律仍把 Pipeline 侧栏或技能隐藏写成硬义务。本 PR **删除或改写**，不软留冲突句。

## 删改清单

| # | 文件 | 原条款（冲突读法） | 处置 |
|---|---|---|---|
| 1 | `employee-surface-contracts.md` 资产簇「员工入口」 | 「生命周期（Pipeline 主表面）」写成侧栏硬入口 | **改写：** Pipeline / 生命周期 = KOL 试点 UX 密度；默认侧栏可以不挂；缺导航不是 P0 / 违约。禁止再写成平台默认侧栏义务 |
| 2 | `employee-surface-contracts.md` 侧栏导语 | 入口密度只覆盖技能 / 数字团队 | **改写：** 加上 Pipeline 可见 ≠ 必须挂默认侧栏；缺 Pipeline 导航不是 P0 / 违约 |
| 3 | `employee-surface-contracts.md` 并列能力面硬规则 | 无「缺 Pipeline 导航 = 违约」的反句；技能句仍易被读成「不是员工默认入口」 | **增补：** 「Pipeline 侧栏 ≠ 平台义务」；技能句删除「技能目录不是员工默认入口」永久禁令读法 |
| 4 | `employee-surface-contracts.md` P0「Agents 是工作入口」 | Home「独占四模式」含 AI发现 / 我跟进的红人，读成平台一等 | **改写：** Home 独占**平台**任务模式（今日任务 + 我的待办）；后两项标为 KOL 试点特化 |
| 5 | `employee-surface-contracts.md` 表面表 Pipeline 行、Home 四模式节、专家中心边界 | Pipeline 像中台主表面；四模式像平台清单 | **改写：** Pipeline 标 KOL 试点页（页仍在，不是默认侧栏硬入口）；Home 前两项平台、后两项试点 |
| 6 | `21-admin-employee-page-roles.md` 导航表「员工侧栏 / 必须」 | 「工作入口停在 … Pipeline（KOL 试点资产）…」= 强制员工导航 | **改写：** 平台默认入口不含 Pipeline。Pipeline = 试点 UX 密度，可省略；缺则不是 P0 / 违约。禁止列改为「把 Pipeline 写成必须入口或缺则违约」 |
| 7 | `21-admin-employee-page-roles.md` 员工端「只回答」 | 「正式生命周期坐落在哪」与干活问句并列，读成默认义务 | **改写：** Pipeline 是 KOL 试点页，不是默认侧栏义务；禁止「缺 Pipeline 导航 = P0」 |
| 8 | `21-admin-employee-page-roles.md` 页面表 / 配套表 Home·Pipeline | Home 四模式、Pipeline「正式生命周期坐落」未标试点 / 可省略 | **改写：** Home 平台 vs 试点挂件分家；Pipeline 默认侧栏可省略 |
| 9 | `04-ux-ui-system.md` 双端边界 | 「员工端只展示 … 品牌、KOL、SOP」读成产品壳 = KOL | **改写：** 员工看任务 / 业务对象 / 结果；KOL 等是试点数据不是产品壳。产品名词「技能」一等，露出=UX |
| 10 | `04-ux-ui-system.md` 表面分类段 | 已有试点指针，但未写「缺 Pipeline 导航 ≠ 违约」 | **改写：** 明确 Pipeline 不是平台默认侧栏义务；Home 平台模式 vs 试点挂件 |
| 11 | `19-ui-ux-constitution.md` | 兼容页未阻断历史「四页法律 ⇒ Pipeline 必须进侧栏」 | **改写：** 历史四页不得再读成默认侧栏义务；技能入口=UX；冲突以宪法为准 |
| 12 | `CONTEXT-MANIFEST.md` | Pipeline 任务路由未声明试点 / 非导航义务 | **改写：** 固定入口与路由表标明试点特化；缺默认侧栏入口不是违宪 |
| 13 | `14-implementation-contract.md` 知识库契约 | 员工 `/kb` 产品面仍指向已退役入口 `19` | **改写：** 改指 `employee-surface-contracts.md` + `CONSTITUTION.md` §4。不重写 FS / Expert API |
| 14 | `15-conformance-gaps.md` 结论 | 「KOL 试点原型」易被读成平台壳现状即法律 | **改写：** 现行 KOL 偏重 chrome 是实现快照，不是平台 IA；清单以宪法 §4.1–4.2 为准 |
| 15 | `17-code-conformance-scan.md` | 无「平台=Pipeline 一等 / 员工永不见技能」再陈述 | **不改**（代码扫描，不重述错误 IA） |
| 16 | `CONSTITUTION.md` §4.2 | 已写 Pipeline=试点特化，未写侧栏密度 | **增补（不削弱）：** Pipeline 页仍在（FS-KOL-010）；默认侧栏=试点 UX 密度；缺导航不是 P0 / 违约 |
| 17 | `docs/README.md` 平台 vs 试点表 | 侧栏密度未覆盖 Pipeline | **改写：** 技能 + Pipeline 默认侧栏都是 UX；Pipeline 页仍在 |
| 18 | `DECISIONS.md` ADR-012 / ADR-018 / ADR-023 | 「四页法律」可被读成 Pipeline 必须进侧栏 | **修订：** 四页=页职责不是导航义务；ADR-023 和解条；索引加读法 |

## 明确不改

- 任何 frontend / backend / CSS / e2e
- 不删除 `employee-surface-contracts.md` 全文；只剪冲突段
- 不删除 Pipeline 页、`FS-KOL-010`、或设计系统 `pages/pipeline.md`
- 不实施数字团队 UI，不强制侧栏加技能或去掉现行 Pipeline 链
- 发送 ≠ 阶段、L1–L3、连接器使用 ≠ 治理
- `references/` 与过期 evidence 扫描正文（如 `evidence-agents-digital-employee-constitution-2026-09-13.md`）保持历史快照

## 交叉引用

- 宪法：`CONSTITUTION.md` §4.1–4.3
- 员工契约：`employee-surface-contracts.md`
- 双端：`21-admin-employee-page-roles.md`
- 决策：ADR-023 和解修订；ADR-012 页职责读法
- 路由：`docs/README.md`「平台能力 vs KOL 试点」
