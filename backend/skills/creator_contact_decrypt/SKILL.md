---
id: creator_contact_decrypt
title: 解密达人联系方式
description: 按达人 UID 解密联系方式，属于敏感操作
category: 线索
profile: lead
output: task_result
funnel: reach
mcp: ["starrykol.decryptKolContact"]
required_inputs: []
permissions: ["starrykol:write"]
actions: ["analyze"]
aliases: ["解密联系方式","解密红人联系方式"]
in_market: true
employee_quick: 已授权结果、归属、备注、阶段和审批状态
employee_agent: 解密、改归属、改档案、改阶段、提交审批均为受控动作；备注不等于正式阶段
employee_summary: 按达人账号解密联系方式，属于敏感操作
---
# 解密达人联系方式

Codex app-server 在本 Skill 的 turn 中调用 Starry KOL MCP `decryptKolContact`。必须指定达人 UID。查询画像默认不解密；仅本技能显式执行。

## 禁止事项

- 禁止在普通画像或写邮件时解密。
- 禁止未指定达人 UID 就解密。
- 禁止编造达人邮箱。

## 是否发信

不发信。

## 是否改阶段

不改官方阶段。
