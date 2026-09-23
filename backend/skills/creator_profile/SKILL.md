---
id: creator_profile
title: 达人画像
description: 查看红人详情、平台数据和绑定的负责人
category: 线索
profile: lead
output: task_result
funnel: reach
mcp: ["starrykol.pageKolProfiles", "starrykol.getKolProfileDetail", "starrykol.listKolPlatformData", "starrykol.pageEmailConversations"]
required_inputs: []
permissions: ["starrykol:read"]
actions: ["analyze"]
aliases: ["创作者画像","红人详情","查看红人负责人"]
in_market: true
employee_quick: 授权档案、画像、筛选与已有摘要
employee_agent: 新画像分析、补查新事实走 AI 助理或已配置同步
---
# 达人画像 creator_profile · Lead

Codex app-server 在本 Skill 的 turn 中调用 Starry KOL MCP：`pageKolProfiles` 解析达人 UID，再 `getKolProfileDetail`（含红人负责人绑定）→ `listKolPlatformData`，并可附带该达人的 `pageEmailConversations`。没有单独的 getKolOwnerRelation 工具。

**输出**：把事实交给 Codex app-server 写成给运营看的中文画像话术（谁是这个人、阶段、缺什么、建议怎么跟）。只使用有数据支持的字段；不得虚构受众、互动、转化或明文联系方式，也不调用 `decryptKolContact`。员工面禁止出现「这项信息」「摘要数据」或原始枚举码墙。

## 禁止事项

- 禁止发信。
- 禁止改官方阶段。
- 禁止擅自解密联系方式。

## 是否发信

不发信。

## 是否改阶段

不改官方阶段。
