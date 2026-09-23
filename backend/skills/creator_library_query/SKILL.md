---
id: creator_library_query
title: 达人库查询
description: 按关键词、合作阶段和风险标签分页查询红人库
category: 线索
profile: lead
output: task_result
funnel: reach
mcp: ["starrykol.pageKolProfiles", "starrykol.getKolProfileSidebarMetrics"]
required_inputs: []
permissions: ["starrykol:read"]
actions: ["analyze"]
aliases: ["查询达人库","达人筛选"]
in_market: true
employee_quick: 授权档案、画像、筛选与已有摘要
employee_agent: 新画像分析、补查新事实走 AI 助理或已配置同步
---
# 达人库查询

Codex app-server 在本 Skill 的 turn 中调用 Starry KOL MCP `pageKolProfiles`，可选附带 `getKolProfileSidebarMetrics`。列表字段若包含负责人则一并展示。禁止裸 HTTP；远程工具由本 turn 按授权 MCP 调用。不调用 `decryptKolContact`。

## 禁止事项

- 禁止发信。
- 禁止改官方阶段。
- 禁止擅自解密联系方式。

## 是否发信

不发信。

## 是否改阶段

不改官方阶段。
