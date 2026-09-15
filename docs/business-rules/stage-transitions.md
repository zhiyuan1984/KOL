# 产品阶段转移图

**权威（产品法）**：本文件 + `config/stage-transitions.json`。  
**决策**：ADR-027。ADR-011「远程必须相邻写入」**已废止**，不得再当产品边。  
Host `confirm_stage` **按本图闸门**（`config/stage-transitions.json`）。Starry 逐格 walk 仍是物理适配，不能回写产品边。

节点锁定为现行 Host 15 个正式阶段码 + 一条异常旁路，与 `frontend/src/kolStages.ts` 的 `MAIN_STAGE_TABS` + `EXCEPTION_TAB` 一致。

## 1. 节点

| # | `stage_code` | 中文 | 能力域 | 推荐推进模式（展示，不定义产品边） |
|---|---|---|---|---|
| 1 | `INITIAL_CONTACT` | 初步接触 | Lead | 自动记录 |
| 2 | `INTERESTED` | 已回复-有兴趣 | Opportunity | AI 建议 + 人确认 |
| 3 | `EVALUATING` | 合作评估 | Opportunity | AI 建议 + 人确认 |
| 4 | `QUOTE_PENDING` | 报价待确认 | Negotiation | 事实触发 |
| 5 | `NEGOTIATING` | 商务谈判 | Negotiation | 受控执行 |
| 6 | `PLAN_PENDING` | 方案待确认 | Negotiation | 必须审批 |
| 7 | `CONTRACTING` | 合同签署 | Execution | 必须审批 |
| 8 | `SAMPLE_PENDING` | 待寄样 | Execution | 规则 / 人工 |
| 9 | `SHIPPED` | 已发货 | Execution | 物流事实自动 |
| 10 | `TESTING` | 已签收-测试中 | Execution | 物流事实自动 |
| 11 | `CONTENT_PLANNING` | 内容策划 | Execution | AI 建议 + 人确认 |
| 12 | `CONTENT_REVIEW` | 内容审核 | Execution | 必须审核 |
| 13 | `PUBLISH_PENDING` | 待发布 | Execution | 审核通过后推进 |
| 14 | `PUBLISHED` | 已发布 | Execution | 平台事实自动 |
| 15 | `SETTLING` | 结算中 / 已付款 | Settlement-Growth | 财务事实 / 审批 |
| — | `exception` | 异常（旁路） | — | 人确认进出 |

展示层 8 段（Home / Journey / SOP）只是折叠，**不能**压缩这 16 个写入节点。

`exception` 是**一个**产品节点。Host 实现里的 `PAUSED` / `DISPUTED`（可回主流程）与 `LOST` / `REJECTED` / `CANCELLED`（终态）是异常**种类**，不是第 17–21 个产品节点。`COMPLETED` 是结算后的 Host 侧终态，**不是**产品图节点，也不是第 16 个主阶段。

## 2. 边种类

一条边可叠加多种标记。

| 种类 | 含义 |
|---|---|
| `allow_human` | 人确认路径允许 |
| `allow_auto` | 自动事实路径允许 |
| `forbid` | 该执行者不得走这条边 |
| `require_approval` | 落地前必须按 Policy / 审批队列过闸（L3 仍要人确认） |
| `require_reason` | 确认卡必须填写原因，并写入审计 |

主链 +1（下一正式阶段）是推荐轨道，**不是**人确认的唯一合法边。

## 3. 产品法（人确认）

人确认**可以**：

1. **跨段前进**：从任一主阶段跳到任一更后的主阶段（例如 `CONTRACTING` → `CONTENT_PLANNING`）。
2. **回退**：从任一主阶段回到任一更前的主阶段（纠正记错的阶段）。
3. **进入 / 离开 `exception`**：从主流程进入异常旁路，或从异常回到任一指定主阶段。

以上三类（跨段、回退、进出异常）**必须** `require_reason`。相邻 +1 前进 `allow_human`，原因可选。

这是产品法，不是 Starry API 的能力说明书。前端不得把目标列表收成「只能选下一格」。

进入下列阶段时，在人确认之外再叠 `require_approval`（与现行 `approvalKindForStage` 精神一致）：

`PLAN_PENDING`、`CONTRACTING`、`CONTENT_REVIEW`、`PUBLISH_PENDING`、`SETTLING`。

唯一官方写入口仍是 `confirm_stage`，必须带 `expected_version`。发送 ≠ 推进阶段。

## 4. 自动路径（更严）

自动事实**不得**替人纠正或跨段跳过。精神对齐现行 `autoLegalTargets`（实现仍在 `backend/src/stages.ts`，本 PR 不改 LIVE 闸门）：

| 从 | 自动可去 | 标记 |
|---|---|---|
| 主阶段（非终态） | 主链下一格 | `allow_auto` |
| 主阶段（非终态） | `exception`（旁路/流失等侧出口） | `allow_auto` |
| `exception`（可回种类，如暂停/争议） | 指定主阶段 | `allow_auto` |
| `exception`（终态种类） | （无） | `forbid` |
| 任意 | 跨段前进、回退、替人纠正 | `forbid` |

有证据指针时，自动最多指到「连续已证事实的当前指针」，仍不能一次 hop 越过未完成前置。发送路径永远不写阶段。

## 5. 推荐主链（happy path）

人与自动都认这条 +1 链为默认建议，**不**把它读成「只能相邻写」：

```text
INITIAL_CONTACT → INTERESTED → EVALUATING → QUOTE_PENDING → NEGOTIATING
→ PLAN_PENDING → CONTRACTING → SAMPLE_PENDING → SHIPPED → TESTING
→ CONTENT_PLANNING → CONTENT_REVIEW → PUBLISH_PENDING → PUBLISHED → SETTLING
```

任一主节点 ⇄ `exception`（人：`allow_human` + `require_reason`；自动：仅侧出口 / 可回种类，见 §4）。

## 6. 物理适配（不是产品边）

Starry `changeLifecycleStage` 的相邻 hop、`planStarryAdjacentWalk` 逐格 walk、原生码 `toStageCode`，都是 **Host ↔ Starry 适配器** 的物理限制与字段形状。

- **不得**用「远程只接受相邻前进」改写 §3 / §4。
- 字段形状与 hop 残差见 `docs/07-mcp-data-contract.md`（「物理适配」）与宪法 §4.2 的 `stage_code` 句。
- 本 PR **不**改 LIVE walk。后续 code PR 必须按本图放宽 Host 产品闸门；适配器若仍只能一格一格写，应留在 `07` / Starry adapter，并在确认卡上诚实说明「产品已允许、远程仍在逐格同步」。

## 7. 机器可读副本

`config/stage-transitions.json` 与本文件同义。冲突时以本 Markdown 与 ADR-027 为准。`validate-contracts` 不把该 JSON 当发布门禁编译项（本轮只立法）。
