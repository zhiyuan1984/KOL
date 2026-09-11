---
id: creator_budget_report
title: KOL 预算报告
description: 查询当前或指定投放项目的达人预算报告
category: 增长
profile: settlement-growth
output: task_result
mcp: ["kolclaw.get_budget_report"]
required_inputs: []
permissions: ["kolclaw:read"]
actions: ["analyze"]
aliases: ["达人预算","KOL预算"]
in_market: true
---
# KOL 预算报告

Codex app-server 在本 Skill 的 turn 中调用 KOL Claw `get_budget_report`。只展示预算、预计支出和待定达人，不执行付款或预算变更。

## 禁止事项

- 禁止发信。
- 禁止改官方阶段。
- 禁止擅自解密联系方式。

## 是否发信

不发信。

## 是否改阶段

不改官方阶段。
