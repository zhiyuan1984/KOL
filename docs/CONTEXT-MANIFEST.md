# Context Manifest：按 A–K 渐进加载

> 目标：按法律层加载最少的权威上下文。不要默认把 `docs/`、`specs/` 或历史决策全部送入模型。不要按 `00`–`21` 编号当加载顺序。目录与每层禁写：[`LAW-MAP.md`](LAW-MAP.md)。

## 固定入口

1. 用 [`LAW-MAP.md`](LAW-MAP.md) 判断问题属于 A–K 哪一层。
2. 任何实现任务再读 **B** [`CONSTITUTION.md`](CONSTITUTION.md)（§4.1 十六项一等能力；§4.2 KOL=首个试点）。Host / Codex / MCP / Gateway / 仓库边界任务再读 **J** [`technical-constitution.md`](technical-constitution.md)。
3. 只有任务触发某个条件时，才继续读取该层正文。

Pipeline / Home「AI发现」「我跟进的红人」是 KOL 试点特化，不是平台一等清单。

## UI 任务顺序

```text
B CONSTITUTION.md
→ F 对应 FS（如有）/ G UX-EMPLOYEE 硬不变量（SEND_NE_STAGE、L3_CONFIRM）
→ H ia-information-architecture.md（导航 / 一页一问 / 使用≠治理）
→ I design.md（视觉入口；默认观感 OpenAI-quiet）+ MASTER.md（token only；主按钮 `--primary`）
→ I references/openai-style.md（mood；主按钮色除外）
→ I pages/<当前页面>.md
→ 仅针对未解决的设计问题调用 ui-ux-pro-max（对照 only）
```

先建立 B / F / G 事实，再使用 `ui-ux-pro-max`。其输出是候选建议，不能覆盖 A–K。

## 路由表

| 任务 | 默认法律层 | 条件触发后再加载 |
|---|---|---|
| Home | B §4.2；I `pages/home.md` | 发送 / 阶段 / 导入：G 硬不变量；阶段边：E `business-rules/stage-transitions.md` |
| Chat / 任务执行 | B §5；I `pages/chat.md` | 按动作加载 F 对应 FS |
| Pipeline（KOL 试点页；深链 / CTA） | B §4.2；I `pages/pipeline.md` | 阶段写入：B §5 + E `stage-transitions.md` + F `policies/change_stage.yaml` |
| 阶段转移 / confirm_stage | E `docs/business-rules/stage-transitions.md`、ADR-027 | 物理 hop / 原生码：K `07`（adapter ≠ 产品边） |
| Admin | I `pages/admin.md`；C `org-permissions.md` | 权限 / 连接器 / 审计：同 C |
| `/kb`、`/agents`、员工连接器 | B §4.1 | 连接器治理再加载 C `org-permissions.md` |
| 技能（一等；侧栏露出=UX） | B §4.1 | 禁止图鉴压过任务脊柱 |
| 数字团队（一等；尚未实现） | B §4.1 | 禁止专家团假导航；不得永久禁该名词 |
| 审批 / 考试 | B §4.1；C `org-permissions.md`；I `pages/approvals.md` | 管理闸门再加载同 C |
| `/cron` 定时 | B §4.1 | 不得做成第二套 Home |
| 导航 / 一页一问 / 使用≠治理 | H `ia-information-architecture.md` | 配套套件、枢纽字段再加载 C `org-permissions.md` |
| 纯视觉 / 组件 | I `design.md` → `MASTER.md` + 当前页 | token 只改 MASTER；禁止在 `design.md` 复制 hex。默认观感 mood 读 `references/openai-style.md`（主按钮仍 `--primary`）。追溯迁移才读 `20` |
| 组织 / 范围 / PEP | C `org-permissions.md` | 注册表：`config/org-registry.yaml` |
| 对象 / 字典 | D `domain-objects.md` | 物理值冲突时记 K 接口漂移，不改 D 编造 |
| API / 后端 | J `technical-constitution.md`；F 对应 FS；D `domain-objects.md` | 副作用 / 确认：C `org-permissions.md`；物理 IO：K `07` / `schemas/`；细则 `06` / `07` / `14` |
| 回归 / 验收 | 改动对应的 F / G 硬不变量 | 追溯决策时读 ADR，不把 ADR 当现行法 |

## 默认不加载

- `references/`：历史提示词与其它风格研究不是实施规则。例外：`references/openai-style.md` 是默认观感 mood 来源（主按钮色除外；token hex 仍只住 MASTER）。
- `DECISIONS.md`：仅用于追溯具体决策（ADR 不是法律层）。
- 已删除的 `docs/evidence-*`、`04`、`19`、`employee-surface-contracts.md`：不要从 git 历史恢复为现行法。
- `06`、`09`–`11`、`13`–`17`、`90`：实现与运营手册，不是 A–K；仅在任务明确需要细则时打开。
- 完整 F 目录：只读当前动作对应的 FS / Policy。

## 检索纪律

1. 先确定法律层、页面、用户动作、风险等级和验收 ID。
2. 用 `rg` 定位相关标题或 ID，只读取命中段落及必要上下文。
3. 外部建议只进入当前研究笔记；未经验证不得写入 B、G、I 的 MASTER / `design.md`。
4. 任务完成后只持久化稳定规则、明确决策和验收变更，不保存冗长研究过程。
5. 阶段边只服从 E `docs/business-rules/stage-transitions.md`（ADR-027）。禁止在对话里发明边；Starry hop ≠ 产品边。

## 维护规则

- 新增跨页面硬约束：改 **B** `CONSTITUTION.md`。
- 新增 Host / Codex / Gateway / 仓库边界硬约束：改 **J** `technical-constitution.md`。
- 修改 KOL 产品阶段边：改 **E** `docs/business-rules/stage-transitions.md`（及 `config/stage-transitions.json`）；Starry hop 只改 K `07`，不得回写产品图。
- 新增或收紧跨页面 IA（一页一问、导航密度、使用≠治理原则）：改 **H** `ia-information-architecture.md`，不得与宪法 §4 冲突。
- 修改全局视觉 token：改 **I** 的 `MASTER.md`，并同步实现 token。`design.md` 是设计法入口，禁止写入 hex。
- 修改单页布局或行为：只改对应 `pages/*.md`。
- 修改业务状态、权限或验收：改 C / D / F / G，不把业务事实复制进视觉文档。
- ADR 只追加变更日志，不把新法只写在 `DECISIONS.md`。
