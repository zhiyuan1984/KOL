# 关键决策记录入口

本文件是决策索引，不替代规范正文。涉及规范冲突、不可逆副作用、组织范围、物理接口漂移或架构取舍时，先在这里登记，再更新 canonical 文档和追踪矩阵。

## 已固化决策

| ID | 决策 | 依据 |
|---|---|---|
| ADR-001 | Codex harness = Codex app-server；Host 是内核，不是业务调度器 | `06-codex-harness.md` |
| ADR-002 | 组织树与品牌维度分离；LT/PQ/RO/TB 是品牌 | `01-organization-tenancy.md`、`12-kol-agent.md` |
| ADR-003 | 展示 8 段与正式写入 15 阶段分离 | `05-agent-workflow-skill-policy.md` |
| ADR-004 | 草稿、发送、阶段变更是独立产物和动作 | `03-prd-and-functional-spec.md`、`08-permission-approval-audit.md` |
| ADR-005 | Stub 只用于确定性测试，真实验收必须走 app-server + 授权 MCP | `06-codex-harness.md`、`10-test-evaluation.md` |
| ADR-006 | 新增 Agent 以配置、Skill、Workflow、Policy、MCP 声明为主 | `13-migration-roadmap.md` |
| ADR-007 | 新增 Agent 分为配置型、Skill 型、MCP 型、内核型；配置化不代表零代码 | `agents/kol/manifest.yaml`、`13-migration-roadmap.md` |
| ADR-008 | Starry MCP 不是独立组织授权源，但其邮箱负责人/授权结果可与已确认组织证据和 registry 绑定共同完成安培时代试点 PEP 核验 | `18-mcp-master-data-assessment.md`、`01-organization-tenancy.md` |
| ADR-009 | 安培时代部门负责人（张慧玲、刘敏）自动拥有公司全部品牌、区域和普通业务数据读写；高风险动作仍受 Gateway/确认/审批约束 | `config/org-registry.yaml`、`01-organization-tenancy.md` |
| ADR-010 | 试点 PEP 的授权证据由组织截图、100%真实邮箱负责人清单、远程 Starry MCP 只读结果和 registry 绑定共同构成；未补齐的身份元数据不阻断试点授权 | `config/org-registry.yaml`、`18-mcp-master-data-assessment.md` |
| ADR-011 | Starry 阶段写入用原生码；人确认跳过只在 Host 记账，远程只写落地阶段 | `05-agent-workflow-skill-policy.md`、`starryStageWriteFields` / `changeLifecycleStage` |

## 新增 Agent 分级

| 级别 | 典型变更 | 允许做法 | 必须门禁 |
|---|---|---|---|
| 配置型 | 已有 MCP/实体上的新流程、文案、知识、审批人 | manifest / Skill / Policy / 知识 | 契约编译、评价样例、范围校验 |
| Skill 型 | 新业务意图，但工具和实体已存在 | 新 Skill 契约、测试和 EVAL | 不得新增 Host 调度器 |
| MCP 型 | 新外部 API 或工具 | adapter、物理契约、风险标记 | 写工具必须 Gateway/审批分类 |
| 内核型 | 新主数据、状态机或副作用类型 | 平台代码、安全评审和迁移 | 不得用配置绕过内核 |

## 记录模板

```text
ID / 日期 / 状态
问题与背景
候选方案与证据
决定与不决定的范围
影响的规范、代码、测试和评价
回滚条件与复审日期
决策人：业务 / 产品 / 工程 / 测试 / 运维
```

## ADR-011 — Starry 写入原生码与 Host-only 跳过（2026-09-13）

**状态**：已固化  
**决策人**：业务 owner

### 问题与背景

Host 用 15 段 + 旁路的本地码（如 `NEGOTIATING`）做确认卡、审计和协作状态。Starry 生命周期用另一套原生码（如 `BUSINESS_NEGOTIATION`）。先前把「官方写入码」定成 Host-local，远程 `changeLifecycleStage` 收到 `NEGOTIATING` 等 Host 码。人跳过/纠正时，也不该要求 Starry 理解 skip 语义或接收中间阶段。

### 决定

1. **Starry 写入码 = Starry 原生码。** `changeLifecycleStage` / `starryStageWriteFields` / 其他阶段写 payload 经 `LEGACY_STAGE_ALIASES` 的逆映射（`toLegacyStarryStage` / `toStarryStage`）发出原生 `cooperationStageCode` 和对应中文名。例：Host `NEGOTIATING` / `商务谈判` → `BUSINESS_NEGOTIATION`。读取继续 `normalizeStage` / `codeFromLabel` 归一成 Host-local（`enrichListProfile` 用读映射，不用写映射）。
2. **人跳过是 Host-only 语义。** 人确认 skip/jump 时，Host 把 skip kind、原因、被跳过的 Host 码记在确认卡、`host.confirm_stage` 审计和本地 `collaborations`（`last_skip_*`）。远程只调用一次 `changeLifecycleStage`，只带落地阶段的 Starry 原生码和已知 `lastLifecycleId`。不向 Starry 解释 skip，不写中间阶段。自动事实路径仍走 `autoLegalTargets` / evidence pointer，不写人式 skip。

### 不决定的范围

不放宽 `LIVE_*` / Gateway / confirm-before-send。不把本 ADR 当成 LIVE 阶段写入 PASS。云上探针应再测 `QUOTE_PENDING` → `BUSINESS_NEGOTIATION`（lifecycle 320）。

### 影响

- 规范：`05-agent-workflow-skill-policy.md`（`legalTargets` vs `autoLegalTargets`，`confirm_stage` 写路径）
- 代码：`backend/src/starrykol/remote-contract.ts`、`backend/src/stages.ts`、`backend/src/host/api.ts` `hostConfirmStage` / `syncConfirmedStageToMcp`
- 测试：MCP payload 断言原生码；确认卡/审计保留 skip 原因
