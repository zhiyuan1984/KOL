# 法律目录（A–K）

本文件是规范权威顺序的目录。**先按字母层判断问题属于哪一层，再打开该层正文。** 旧 `00`–`21` 编号只是路径别名（C/D 已并入单一正文），不是阅读顺序，也不是位阶。

冲突时：高层不能发明底层事实；底层不能改写高层产品法。ADR（`DECISIONS.md`）只记「为什么改 / 何时改」，**不能**覆盖 A–K 现行正文。

完整导航入口：[`README.md`](README.md)。按任务少加载：[`CONTEXT-MANIFEST.md`](CONTEXT-MANIFEST.md)。

## 权威顺序（高 → 低）

| 层 | 名称 | 现行路径 | 拥有 | 禁止写入 |
|---|---|---|---|---|
| **A** | 愿景 | [`00-platform-charter.md`](00-platform-charter.md) | 产品是什么、不变量、共创角色与退出条件 | 页面 IA、阶段边、MCP 字段、token、实现细节 |
| **B** | 产品宪法 | [`CONSTITUTION.md`](CONSTITUTION.md) | 跨页面硬规则、十六项一等能力、KOL=试点、L1–L3、发送 ≠ 推进阶段 | 单页布局、合法转移矩阵、物理工具形状、视觉 token |
| **C** | 组织 / 权限 | [`org-permissions.md`](org-permissions.md) | 租户/组织/品牌范围、PEP、确认/审批/审计、使用 ≠ 治理与管理端配套套件 | 阶段图、UI 皮肤、MCP 物理目录、把治理做成第二套 Home |
| **D** | 业务对象 / 关系 | [`domain-objects.md`](domain-objects.md) | 对象是什么、彼此关系、字典值与展示名 | 谁可以转哪一阶段、交互原则、物理 request 形状 |
| **E** | 业务规则与过程 | [`business-rules/stage-transitions.md`](business-rules/stage-transitions.md)（机器副本 [`../config/stage-transitions.json`](../config/stage-transitions.json)；别名 [`stage-graph.md`](stage-graph.md)） | 合法转移 / 过程图（15 + `exception`；ADR-027） | 不把 Starry hop / 原生码 walk 写成产品边（回 K） |
| **F** | 业务动作 | [`specs/`](../specs/) 剩余 `FS-*`、[`policies/`](../policies/)、索引 [`03-prd-and-functional-spec.md`](03-prd-and-functional-spec.md)；Skill/Policy 说明 [`05-agent-workflow-skill-policy.md`](05-agent-workflow-skill-policy.md)；KOL 试点动作 [`12-kol-agent.md`](12-kol-agent.md) | 可开发动作、闸门、副作用、Given/When/Then | 新开平台法、复活已删 FS-006/010、改写 E 阶段图 |
| **G** | 交互原则 | [`specs/UX-EMPLOYEE.md`](../specs/UX-EMPLOYEE.md) | 从 B 派生的瘦员工 UX；门禁只认 `SEND_NE_STAGE`、`L3_CONFIRM`；助理优先（ADR-032） | 新平台法、排序键表、四带教条、字段黑名单、强制 CTA、跟进面耐久芯片/六 Tab/筛选目录 |
| **H** | IA 约束 | [`ia-information-architecture.md`](ia-information-architecture.md) | 导航、簇、谁答哪一问；跟进面=对象管理（不得抄待办状态桶 / 15 段主筛）；对象管理可表现为助理结果 | 视觉 token、阶段边、权限 PEP 细则（回 C）；跟进面耐久芯片/Tab/筛选目录 |
| **I** | UI 设计 | [`design.md`](design.md) | 页面视觉与布局法；视觉链 CONSTITUTION → ui-ux-pro-max → design.md → MASTER；默认观感 = OpenAI-quiet（[`references/openai-style.md`](references/openai-style.md) 为 mood/spec；quiet/white/hairline/capsule 冲突时 **OpenAI 胜**；主填充 = 产品粉红，hex 只住 MASTER） | **token 仍只住** [`design-system/kol-workbench/MASTER.md`](design-system/kol-workbench/MASTER.md)；不把 MASTER 改成产品宪法；冲突 hex 必须和解 |
| **J** | 技术宪法 | [`technical-constitution.md`](technical-constitution.md) | Host / harness / 内核边界、实现门禁 | 产品表面职责（回 B）、业务对象定义（回 D）、物理工具目录（回 K） |
| **K** | 集成 / 物理 | [`07-mcp-data-contract.md`](07-mcp-data-contract.md)、[`../schemas/`](../schemas/)、[`starry-kol-mcp-server.md`](starry-kol-mcp-server.md)、[`median_mcp_server.md`](median_mcp_server.md) | 真实 MCP、IO schema、适配与接口漂移 | 业务编排、员工文案、合法转移矩阵 |
| **ADR** | 变更日志 only | [`DECISIONS.md`](DECISIONS.md) | 决策时间线、废止与取舍理由 | 现行法正文；不得用 ADR 覆盖 A–K |

已删、不得复活：`docs/evidence-*`、`04-ux-ui-system.md`、`19-ui-ux-constitution.md`、`employee-surface-contracts.md`（ADR-025）。C/D 旧编号文件已并入单一正文后删除（ADR-028）；不得再写成旧文件组合。历史只在 git。

## 兄弟 track 预留

| 路径 | 谁写 | 本 track |
|---|---|---|
| `docs/business-rules/stage-transitions.md` | 阶段图 track（**已落地**，ADR-027） | 正文见该文件；`stage-graph.md` 只作别名 |
| `docs/stage-graph.md` | 阶段图 track | 别名跳转，不写边 |
| `docs/ia-information-architecture.md` | IA track（**已落地**） | 正文见该文件；本目录只链路径 |
| `docs/design.md` | 设计 track（**已落地**） | 正文见该文件；MASTER 仍是 token 源；默认观感 OpenAI-quiet（mood 冲突时 OpenAI 胜；主填充 = 产品粉红，ADR-031 修订） |
| `docs/technical-constitution.md` | 技术宪法 track（**已落地**） | 正文见该文件；本目录只链路径 |
| ADR-011 | 阶段图 track **已废止**（ADR-027） | 废止正文仍留档；产品边改读 ADR-027 |

## 编号别名（次要）

需要从旧文件名跳转时用这张表。不要按编号当主线。

| 旧编号 / 文件 | 现属层 |
|---|---|
| `00` | A |
| `CONSTITUTION.md` | B |
| `01`、`08`、`21`（已并入 C 单一正文） | C [`org-permissions.md`](org-permissions.md) |
| `02`、旧字典文件（已并入 D 单一正文） | D [`domain-objects.md`](domain-objects.md) |
| `business-rules/stage-transitions.md`、`stage-graph.md`（别名）、`config/stage-transitions.json` | E |
| `03`、`05`、`12`、`specs/FS-*`、`policies/*` | F |
| `specs/UX-EMPLOYEE.md` | G |
| `ia-information-architecture.md` | H |
| `design.md`；token = `MASTER.md`（mood 和解到 OpenAI，主填充和解到产品粉红）；`openai-style.md` = 默认观感 mood/spec（黑钮不是产品 CTA 法）；`ui-ux-pro-max` = 视觉链必经分析；`20` 与 `pages/*` 是 I 的皮肤/迁移索引 | I |
| `technical-constitution.md` | J |
| `07`、`schemas/`、`18`、`codex/`、物理 MCP 目录 | K |
| `DECISIONS.md` | ADR 日志 |

实现与运营（**不是** A–K 法律层）：`06`、`09`、`10`、`11`、`13`、`14`、`15`、`16`、`17`、`90`、模板、`references/`（`openai-style.md` 除外：I 层默认观感 mood/spec；quiet/white/hairline/capsule 冲突时 OpenAI 胜；主填充以 MASTER `--primary` 粉红为准）。J 落地后，内核/门禁类说明以 J 为准，上述文件降为手册或索引。
