---
id: email_conversation_list
title: 邮件会话列表
description: 按关键词或状态分页查询邮件会话
category: 线索
profile: lead
output: task_result
mcp: ["starrykol.pageEmailConversations"]
required_inputs: []
permissions: ["starrykol:read"]
actions: ["analyze"]
aliases: ["邮件会话","查询邮件会话","查收件会话","查收件箱","收件会话"]
in_market: true
---
# 邮件会话列表

Codex app-server 在本 Skill 的 turn 中调用Starry KOL MCP `pageEmailConversations`。禁止裸 HTTP；远程工具由本 turn 按授权 MCP 调用。只展示会话主题、收件人和状态。空结果会标明查询关键词：这是品牌侧合作会话库，不是 Gmail / 163 收件箱；创建会话还需要收件人已有红人画像。

## 禁止事项

- 禁止发信。
- 禁止改阶段。
- 禁止猜测会话或邮箱。

## 是否发信

不发信。

## 是否改阶段

不改官方阶段。
