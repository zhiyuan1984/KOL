---
id: creator_library_sync
title: 达人同步入库
description: 将候选达人幂等同步到红人库
category: 线索
profile: lead
output: task_result
funnel: reach
mcp: ["starrykol.pageKolProfiles", "starrykol.addKolProfile"]
required_inputs: []
permissions: ["starrykol:write"]
actions: ["sync"]
aliases: ["添加达人","同步达人"]
in_market: true
employee_quick: 已有发现批次与同步结果
employee_agent: 新发现分析、异步采集；正式导入独立确认
---
# 达人同步入库

Codex app-server 在本 Skill 的 turn 中先调用 Starry KOL MCP `pageKolProfiles` 按联系邮箱和名称查重，再调用 `addKolProfile`（`kolName` + `contactEmail`）。缺少名称或联系邮箱时返回待补充字段，不执行写入。

## 禁止事项

- 禁止发信。
- 禁止改官方阶段。
- 禁止擅自解密联系方式。

## 是否发信

不发信。

## 是否改阶段

不改官方阶段。
