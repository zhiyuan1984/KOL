# 灵工数字员工中台文档体系

本文件是项目规范的唯一使用入口。**先按 A–K 法律层判断任务，再加载最少权威上下文。** 不要从 `00`–`21` 编号顺序全量阅读。完整目录、每层拥有/禁止写入：[`LAW-MAP.md`](LAW-MAP.md)。按任务路由：[`CONTEXT-MANIFEST.md`](CONTEXT-MANIFEST.md)。

给 Codex 下达任务时，可以直接要求：“先按 `docs/LAW-MAP.md` 的 A–K 定位法律层，再按 `docs/README.md` 加载所需规范，再实施和验证。”

`references/` 只用于研究和追溯，默认不进入实现上下文。ADR 只回答「为什么」，不能覆盖现行契约。

## 权威顺序 A–K

| 层 | 读什么 | 何时打开 |
|---|---|---|
| **A** 愿景 | [`00-platform-charter.md`](00-platform-charter.md) | 产品是什么、不变量、角色否决权 |
| **B** 产品宪法 | [`CONSTITUTION.md`](CONSTITUTION.md) | 任何产品 / UI 任务的固定入口（§4.1–4.2、L1–L3） |
| **C** 组织 / 权限 | [`01`](01-organization-tenancy.md)、[`08`](08-permission-approval-audit.md)、[`21`](21-admin-employee-page-roles.md) | 租户、范围、确认/审批、使用 ≠ 治理 |
| **D** 对象 / 关系 | [`02`](02-domain-model.md)、[`DATA_DICTIONARY.md`](DATA_DICTIONARY.md) | 对象是什么、字典值 |
| **E** 规则与过程 | [`business-rules/stage-transitions.md`](business-rules/stage-transitions.md) | 合法转移（15 + `exception`；ADR-027） |
| **F** 业务动作 | [`specs/FS-*`](../specs/)、[`policies/`](../policies/)、[`03`](03-prd-and-functional-spec.md)、[`05`](05-agent-workflow-skill-policy.md)、[`12`](12-kol-agent.md) | 可开发动作与闸门 |
| **G** 交互原则 | [`specs/UX-EMPLOYEE.md`](../specs/UX-EMPLOYEE.md) | 员工 UX；门禁只认 `SEND_NE_STAGE`、`L3_CONFIRM` |
| **H** IA 约束 | [`ia-information-architecture.md`](ia-information-architecture.md) | 导航 / 簇 / 谁答哪一问（一页一问、使用 ≠ 治理） |
| **I** UI 设计 | [`design.md`](design.md) | 页面视觉法；**token 仍是** [`MASTER.md`](design-system/kol-workbench/MASTER.md) |
| **J** 技术宪法 | [`technical-constitution.md`](technical-constitution.md) | Host / Codex / MCP / Gateway / 仓库边界 |
| **K** 集成 / 物理 | [`07`](07-mcp-data-contract.md)、[`../schemas/`](../schemas/)、物理 MCP 目录 | 真实工具、schema、接口漂移 |
| **ADR** | [`DECISIONS.md`](DECISIONS.md) | 只追溯决策；不覆盖 A–K |

A–K 正文均已落地。E 权威是 [`business-rules/stage-transitions.md`](business-rules/stage-transitions.md)（[`stage-graph.md`](stage-graph.md) 只作别名）。已删的 `04` / `19` / `evidence-*` 不是任何一层。

## 最终使用方法

### UI 设计或前端实现

```text
B CONSTITUTION.md
→ C 若涉及权限 / 使用≠治理
→ F 对应 FS（如有）+ G UX-EMPLOYEE 硬不变量
→ H ia-information-architecture.md（导航 / 一页一问 / 使用≠治理）
→ I design.md（视觉入口）+ MASTER token + pages/<当前页>.md
→ 仅针对未解决问题调用 ui-ux-pro-max
→ 按 UX 硬不变量、视口和无障碍验证
```

### 业务、API 或后端实现

```text
B 中相关边界
→ C 组织 / 权限（如涉及范围或闸门）
→ D 对象 / 字典
→ E 阶段图（`business-rules/stage-transitions.md`；闸门仍走 F 的 Policy）
→ F 对应 FS / Policy
→ J `technical-constitution.md`（Host / Codex / Gateway 边界）
→ K MCP / schema（`06` / `07` / `14` 为细则）
→ traceability 测试与红线
```

安全、权限、租户边界和真实数据永远以 C / F / K 为准，不能被 G 或 I 覆盖。Host / Codex / Gateway 边界以 J 技术宪法为准。

### 验收或回归

```text
改动对应的 F（FS）/ G（UX 硬不变量）
→ specs/traceability.json 或 specs/ux-traceability.json
→ 对应自动化测试、截图、回执或脱敏 Trace
```

没有追踪关系的交互只能标记为“规格存在”，不能标记为“体验验收通过”。

### 研究、追溯和历史决策

只有需要回答“为什么这样设计”时才读取 `DECISIONS.md` 或 `references/`。它们不能覆盖现行契约。

## 文档裁决

| 问题 | 层 | 读取并服从 |
|---|---|---|
| 产品是什么、不变量 | A | `00-platform-charter.md` |
| 产品闭环、一等能力、KOL=试点 | B | `CONSTITUTION.md` §4.1–4.2 |
| 安全、权限、租户、审批 | C | `01`、`08`、`21` |
| 对象与字典 | D | `02`、`DATA_DICTIONARY.md` |
| 合法转移 / 过程图 | E | `business-rules/stage-transitions.md`（ADR-027）；Starry hop ≠ 产品边 |
| 可开发动作与闸门 | F | FS、Policy |
| 可执行交互与发布验收 | G | `UX-EMPLOYEE.md`（派生自 B §4–5） |
| 导航 / 簇 / 页面只答一问 | H | `ia-information-architecture.md`；配套套件仍在 `21` |
| 页面视觉与布局 | I | `design.md`（入口）；token = `MASTER.md` |
| Host / 内核边界 | J | `technical-constitution.md` |
| 真实 MCP 与 IO | K | `07`、`schemas/`、物理目录 |

### 平台能力 vs KOL 试点

| 问题 | 读取并服从 |
|---|---|
| 哪些面是一等能力、KOL 是否等于平台壳 | B `CONSTITUTION.md` §4.1–4.2（ADR-023） |
| Host / Codex / MCP / Gateway / 仓库边界 | J `technical-constitution.md`；细则 `06` / `07` / `14` |
| 跨页面 IA（一页一问、导航密度、使用 ≠ 治理） | H `ia-information-architecture.md`；配套套件仍在 C `21` |
| 视觉入口 / token | I `design.md` → `MASTER.md`（禁止在 `design.md` 复制 hex） |
| 使用 ≠ 治理 | H `ia-information-architecture.md`、C `21`、ADR-013 |
| KOL 试点域（Pipeline、AI发现、我跟进的红人、报价邮件） | B §4.2、F `12-kol-agent.md`。Pipeline 页可深链 / CTA，不是必挂侧栏 |
| KOL 产品阶段边（15 + exception；人可跨段/回退） | E `business-rules/stage-transitions.md`（ADR-027）。Starry hop ≠ 产品 |

## 编号文件（次要别名）

需要从旧文件名跳转时见 [`LAW-MAP.md`](LAW-MAP.md)「编号别名」。不要按 `00`–`21` 当主线。实现与运营手册（`06`、`09`–`11`、`13`–`17`、`90`）不是法律层。

## 事实来源（K）

- `starry-kol-mcp-server.md`：Starry KOL MCP 的物理工具目录
- `median_mcp_server.md`：MediaCrawler MCP 的物理工具和异步作业
- `DATA_DICTIONARY.md`：真实字典（对象层 D；值来自物理源）
- `codex/`：Codex app-server 版本对应的协议 schema
- `../schemas/`：写入闸门 IO schema

这些文件描述外部事实，不负责业务编排。若物理接口与业务文档冲突，先记录接口漂移，再由适配层处理，禁止在 Skill 或前端偷偷复制一套映射。

## 模板与决策

- `SPEC-TEMPLATE.md`：功能规格模板。
- `EVAL-TEMPLATE.md`：Agent 评价样例模板。
- `DECISIONS.md`：ADR 变更日志（近期：ADR-027 产品阶段图并废止 ADR-011；ADR-026 法律层 A–K；ADR-025 删除 evidence/04/19；ADR-024 删除过细 UX-KOL）。
- `business-rules/stage-transitions.md`：KOL 试点产品阶段图（15 + `exception`）。Starry hop 限制见 `07`，不是产品边。

历史重复规范已删除；追溯使用 Git 历史。业务规则只在 E / F 的 canonical 位置维护；物理接口只在 K 维护。任何冲突必须写 ADR 并更新追踪矩阵。

## 可执行资产

- `../config/org-registry.yaml`、`../config/brand-registry.yaml`：公司、组织、品牌、区域和 PEP 范围事实（C）。
- `../config/stage-transitions.json`：产品阶段图机器可读副本（ADR-027 / E）。
- `../agents/kol/manifest.yaml`：KOL Agent 唯一发布包入口。
- `../experts/kol/manifest.yaml`：数字员工发布资产（API `/api/experts`，`expert:kol`）。
- `../workflows/`、`../policies/`、`../schemas/`、`../evals/`：运行契约、写入闸门、输入输出 schema 和评价样例。
- `../specs/traceability.json`、`../specs/ux-traceability.json`：FS/BR/TEST/EVAL 与 UX/测试/E2E 追踪。
- `../backend/scripts/validate-contracts.mjs`：唯一契约校验入口；同时校验 UX 追踪，不另建编译器。
- `../backend/scripts/validate-tb-binding.mjs`：TB 本地字典、远端品牌字典和邮箱品牌列表三方绑定校验。
- `../backend/scripts/release-gate.mjs`、`../.github/workflows/release-gate.yml`：本地和 CI 的统一发布门禁。

`docs/evidence-*` 已全部删除（ADR-025）。历史快照只在 git。
