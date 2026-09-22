---
id: sop_quote_pending
title: SOP · 报价待确认
description: 报价待确认 的版本化 SOP。只准备资料和下一步，不自动发信，不自动改正式阶段。
category: 商务
profile: negotiation
output: task_result
mcp: ["starry.get_collaboration"]
required_inputs: []
permissions: ["starrykol:read"]
actions: ["present_sop"]
aliases: ["报价待确认SOP", "SOP报价待确认"]
in_market: true
employee_visible: false
---
# SOP · 报价待确认

sop_id: QUOTE_PENDING
version: 2026-09-08.1

对照 `backend/src/stages.ts` 的主阶段 QUOTE_PENDING。Codex app-server 按本 Skill 展示当前步骤、需要输入、完成证据和下一步。不发信、不改阶段。

- 发送邮件走 `email_compose`，必须「确认发送」。
- 正式阶段写入走 `confirm_stage`，必须人确认。
- 来信分析只出建议，不自动改阶段。
- 不修改已确认的报价、寄样、发货和阶段规则。

## 禁止事项

- 禁止发信。
- 禁止改正式阶段。
- 禁止修改已确认的报价、寄样、发货和阶段规则。

## 是否发信

不发信。

## 是否改阶段

不改正式阶段。只展示当前步骤、输入、证据和下一步。
