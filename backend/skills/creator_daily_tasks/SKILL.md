---
id: creator_daily_tasks
title: 今日 KOL 任务
description: 汇总待打招呼、待跟进、待报价和谈判中达人
category: 线索
profile: lead
output: task_result
funnel: reach
mcp: ["kolclaw.get_daily_tasks"]
required_inputs: []
permissions: ["kolclaw:read"]
actions: ["analyze"]
aliases: ["KOL今日任务","今日KOL任务","达人每日任务"]
in_market: true
employee_quick: 我的任务、阶段索引、已识别风险
employee_agent: 新风险分析与跟进建议走 AI 助理；确定的定时规则走后台
---
# 今日 KOL 任务

Codex app-server 在本 Skill 的 turn 中调用 KOL Claw `get_daily_tasks`，按远程事实生成结构化任务列表，不修改达人状态。

## 禁止事项

- 禁止发信。
- 禁止改官方阶段。
- 禁止擅自解密联系方式。

## 是否发信

不发信。

## 是否改阶段

不改官方阶段。
