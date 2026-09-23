---
id: email_app_conversation_list
title: 应用邮件会话
description: 按关键词、风险标签或达人 UID 查询应用侧邮件会话
category: 线索
profile: lead
output: task_result
funnel: biz
mcp: ["starrykol.pageAppEmailConversations"]
required_inputs: []
permissions: ["starrykol:read"]
actions: ["analyze"]
aliases: ["应用邮件","应用侧会话"]
in_market: true
employee_visible: false
employee_quick: 已同步邮件列表、往来摘要与已授权邮箱索引
employee_agent: 新回复理解走 AI 助理；读取敏感正文仍执行权限规则
employee_summary: 按关键词、风险标签或达人查询应用内邮件会话
---
# 应用邮件会话

Codex app-server 在本 Skill 的 turn 中调用 Starry KOL MCP `pageAppEmailConversations`。与品牌合作会话列表不同，这是应用侧会话查询。

## 禁止事项

- 禁止发信。
- 禁止改阶段。
- 禁止猜测会话或邮箱。

## 是否发信

不发信。

## 是否改阶段

不改官方阶段。
