---
id: risk_scan
title: 超时/风险扫描
description: 扫描红人风险会话，并列出失联、延期合作
category: 异常
profile: commander
output: task_result
funnel: exception
mcp: ["starrykol.pageRiskConversations", "starrykol.summarizeRiskConversations", "starry.list_collaborations"]
required_inputs: []
permissions: ["starrykol:read"]
actions: ["analyze"]
aliases: ["风险扫描","超时扫描","失联扫描","扫描在途风险","T8"]
in_market: true
employee_quick: 我的任务、阶段索引、已识别风险
employee_agent: 新风险分析与跟进建议走 AI 助理；确定的定时规则走后台
---
# 风险扫描 risk_scan（T8）

Codex app-server 在本 Skill 的 turn 中调用 Starry KOL MCP `pageRiskConversations` 和 `summarizeRiskConversations`（截图红人风险会话接口）。同时读取本地逾期合作，列出 T8 失联与延期。不写阶段、不发信。

## 禁止事项

- 禁止写阶段。
- 禁止发信。

## 是否发信

不发信。

## 是否改阶段

不改官方阶段。
