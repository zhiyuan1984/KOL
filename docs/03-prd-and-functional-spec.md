# 概念、PRD 与功能规格

本文件把业务目标变成可实现、可测试、可验收的契约。PRD 说明为什么做、为谁做、做什么；功能规格说明系统必须如何工作。没有功能规格不得进入编码。

## 1. 产物链

```text
业务问题 → 概念卡 → PRD → 用户故事 → 功能规格 → 任务拆解 → 代码/Skill → 测试与评价 → 发布
```

每个产物必须有唯一 ID、版本、负责人、状态和变更记录。PRD 通过评审后，每个可交付功能必须生成 `FS-*` 功能规格。

## 2. 概念卡与 PRD

概念卡必须写清目标用户、触发场景、当前人工流程、痛点、期望结果、非目标、约束、风险假设和验证方式。PRD 还必须包含：业务指标、范围优先级、组织/品牌范围、员工端与管理端、Agent/Workflow/Skill/Policy、依赖的真实接口、成本与运营方案。

## 3. 功能规格固定结构

```text
功能元数据；目标与非目标；参与者与权限；触发器与前置条件；
输入与上下文；主/备选/异常流程；状态与转移；业务规则与不变量；
数据读写与来源；Agent/Workflow/Skill/Policy/MCP 映射；双端交互；
事件通知与审计；性能/幂等/安全；Given/When/Then 验收；测试与评价追踪；发布、迁移、回滚。
```

示例元数据：

```yaml
id: FS-KOL-EMAIL-001
domain: kol
owner: 刘敏
actors: [employee, kol_business_owner, kol_agent]
risk_level: L2
related_agent: kol_agent
related_workflow: quote_communication
status: draft
```

业务负责人是业务责任人，不等于审批人、任务负责人或技术负责人。

## 4. 流程和状态要求

每一步都写明执行者、输入、输出、失败处理。必须覆盖缺字段、换品牌、重复提交、用户取消、Codex 不可用、MCP 超时、外部回执不确定、版本冲突、审批超时、断网和人工接管。

任务状态由内核维护：`created → planned → running → waiting_input → waiting_approval → succeeded/failed/cancelled/manual_takeover`。模型只能提出下一步，不能直接写平台状态。

## 5. 业务规则与追踪

每条规则有 `BR-*` 编号、执行位置和测试 ID。每条验收标准必须追踪到：

```text
需求 ID → FS ID → BR ID → Skill/Workflow/Policy → 代码模块 → 测试 ID → 评价样例 ID → 发布版本
```

规格变更必须重新评估影响范围，不能只改 Prompt 或界面文案。

## 6. KOL 报价邮件的最小规格

读取品牌、KOL 合作关系和授权邮件摘要，生成可编辑草稿与缺口；草稿不产生发送副作用；用户确认后由 Host Gateway 使用幂等键提交发送；保存回执和审计；发送不推进正式合作阶段。缺发件箱、收件人、金额或品牌范围时进入 `waiting_input`，不能猜测或默认第一只邮箱。

```gherkin
Given 用户只授权 LT-EU 且 Collaboration 属于 LT
When 用户请求生成报价沟通草稿
Then 创建 WorkItem 并由 Codex turn 调用 email_compose
And 返回草稿或缺口
And 不调用发送提交器

Given 草稿已生成且用户未确认
When 任务处于 waiting_approval
Then 展示前后 diff，允许编辑、确认或拒绝

Given 用户明确确认发送且邮箱版本仍有效
When Host 提交外部发送
Then 幂等键只产生一次发送
And 保存外部回执
And 正式阶段保持不变
```
