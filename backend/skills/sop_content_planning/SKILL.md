---
id: sop_content_planning
title: SOP · 内容策划
description: 内容策划 的版本化 SOP。只准备资料和下一步，不自动发信，不自动改正式阶段。
category: 内容
profile: execution
output: task_result
mcp: ["starry.get_collaboration"]
required_inputs: []
permissions: ["starrykol:read"]
actions: ["present_sop"]
aliases: ["内容策划SOP", "SOP内容策划"]
in_market: true
---
# SOP · 内容策划

sop_id: CONTENT_PLANNING
version: 2026-09-08.1

对照 `backend/src/stages.ts` 的主阶段 CONTENT_PLANNING。Codex app-server 按本 Skill 展示当前步骤、需要输入、完成证据和下一步。不发信、不改阶段。

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
