---
id: email_conversation_read
title: 邮件会话详情
description: 按会话 ID 读取邮件会话正文和消息
category: 线索
profile: lead
output: task_result
mcp: ["starrykol.getEmailConversation"]
required_inputs: []
permissions: ["starrykol:read"]
actions: ["analyze"]
aliases: ["读取邮件会话","查看邮件会话"]
in_market: true
employee_visible: false
---
# 邮件会话详情

Codex app-server 在本 Skill 的 turn 中调用Starry KOL MCP `getEmailConversation`。必须指定会话 ID；缺少字段时返回待补充提示，不猜测会话。

## 禁止事项

- 禁止发信。
- 禁止改阶段。
- 禁止猜测会话或邮箱。

## 是否发信

不发信。

## 是否改阶段

不改官方阶段。
