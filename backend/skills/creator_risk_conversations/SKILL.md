---
id: creator_risk_conversations
title: 达人风险会话
description: 查询并汇总与达人相关的风险会话
category: 异常
profile: commander
output: task_result
mcp: ["starrykol.pageRiskConversations", "starrykol.summarizeRiskConversations"]
required_inputs: []
permissions: ["starrykol:read"]
actions: ["analyze"]
aliases: ["风险会话","红人风险会话"]
in_market: true
---
# 达人风险会话

Codex app-server 在本 Skill 的 turn 中调用 Starry KOL MCP `pageRiskConversations`，并附带 `summarizeRiskConversations`。不修改会话，不推进阶段。

## 禁止事项

- 禁止发信。
- 禁止改官方阶段。
- 禁止擅自解密联系方式。

## 是否发信

不发信。

## 是否改阶段

不改官方阶段。
