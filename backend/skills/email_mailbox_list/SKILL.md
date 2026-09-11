---
id: email_mailbox_list
title: 品牌邮箱列表
description: 查询品牌邮箱和 Nylas 授权状态
category: 管理
profile: commander
output: task_result
mcp: ["starrykol.pageMailboxes", "starrykol.listNylasAccounts"]
required_inputs: []
permissions: ["starrykol:read"]
actions: ["analyze"]
aliases: ["邮箱列表","品牌邮箱","查询邮箱","查发件箱和授权","查发件箱","查询发件箱","发件箱授权"]
in_market: true
---
# 品牌邮箱列表

Codex app-server 在本 Skill 的 turn 中调用 Starry KOL MCP `pageMailboxes` 和 `listNylasAccounts`。禁止裸 HTTP；远程工具由本 turn 按授权 MCP 调用。只展示可核验的邮箱、品牌和授权状态。

## 禁止事项

- 禁止发信。
- 禁止改阶段。
- 禁止猜测会话或邮箱。

## 是否发信

不发信。

## 是否改阶段

不改官方阶段。
