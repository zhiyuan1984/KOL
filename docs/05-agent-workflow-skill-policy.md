# Agent、Workflow、Skill 与 Policy

## 分工

- **Agent**：岗位目标、角色语气、知识和可用能力的发布包。
- **Workflow**：入口、步骤、分支、完成条件、超时、重试、补偿和人工接管。
- **Skill**：一个可复用业务意图的输入/输出/工具/禁止事项契约。
- **Policy**：数据范围、风险、审批、工具白名单、频率、重试和保留规则。

Agent 不拥有独立运行时；所有 Agent 共用平台内核和 Codex harness。

## Skill 最低契约

```yaml
id: email_compose
version: 1.0.0
description: 生成指定合作阶段的邮件草稿
profile: kol
required_inputs: [company_id, brand_id, collaboration_id, mailbox, recipient, subject]
output: draft_email
mcp: [starry-kol]
permissions: [read_collaboration, read_mailbox, preview_email]
actions: [draft]
risk_level: L2
approval_policy: send_requires_confirmation
in_market: true
```

正文还必须写示例输入、缺口、禁止事项、是否产生副作用、失败后的下一步和版本兼容性。需要 Starry/MediaCrawler 的 Skill 必须在 `mcp` 声明远程工具，不能留空后让 Host 代调。

## 风险等级

L1 是只读查询/分析；L2 是草稿/预览，正式发送需确认；L3 是改正式阶段或商务生效，必须确认并按 Policy 审批。L1-L3 是风险标签，不等于所有动作都必须组织审批。

## 阶段模型

展示层固定 8 段，用于 Home/Journey/SOP；**产品写入节点**是 15 个正式 `stage_code` + `exception`（旁路/异常），不能压缩成 8 个枚举。产品边权威：`docs/business-rules/stage-transitions.md`（ADR-027）。

人确认目标使用 `legalTargets`：**允许**跨段前进、回退、进出异常，跨段 / 回退 / 异常必须写原因。自动事实使用 `autoLegalTargets`，不能替人纠正或跳过（精神不变，比人路径更严）。唯一官方写入口是 `confirm_stage`，必须带 `expected_version`。

「远程必须相邻写入 / 跨段只能逐格 walk」**不是**产品法（ADR-011 已废止）。

### 物理适配（Starry，不是产品边）

Host 本地码与 Starry 原生码仍通过 `LEGACY_STAGE_ALIASES` / `toLegacyStarryStage` 互转：读入归一成 Host-local；`changeLifecycleStage` 顶层 `{ lifecycleId, requestJson }`，`requestJson.toStageCode` 发原生码（如 `NEGOTIATING` → `BUSINESS_NEGOTIATION`）。这是适配器字段形状。Starry 若仍只吃相邻 hop，由 adapter / `planStarryAdjacentWalk` 处理，**不得**回写成产品边。详见 `docs/07-mcp-data-contract.md` 与宪法 §4.2。LIVE walk 本轮不改。

## 反旁路规则

业务入口必须是已发布 Skill；前端、Prompt、MCP 和 Host 不得直接发信或改阶段。业务目录、缺口、推荐和口令抽取在 Skill/Workflow；硬状态机、审批、幂等和副作用在 Host。
