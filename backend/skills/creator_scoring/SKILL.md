---
id: creator_scoring
title: 达人评分
description: 根据影响力与合作适配度生成评分
category: 线索
profile: lead
output: task_result
funnel: reach
mcp: ["kolclaw.analyze_creator", "kolclaw.analyze_creators"]
required_inputs: []
permissions: ["kolclaw:read"]
actions: ["analyze"]
aliases: ["创作者评分"]
in_market: true
employee_quick: 已有预算报告与评分
employee_agent: 新评分、预测、策略与报表解读走 AI 助理
---
# 达人评分 creator_scoring · Lead

Codex app-server 在本 Skill 的 turn 中调用 KOL Claw `analyze_creator` / `analyze_creators` 获取确定性评分与定价。推荐只包含可核验字段，并标记 `contact-needed`；不得虚构互动、转化或邮箱。

## 禁止事项

- 禁止发信。
- 禁止改官方阶段。
- 禁止擅自解密联系方式。

## 是否发信

不发信。

## 是否改阶段

不改官方阶段。
