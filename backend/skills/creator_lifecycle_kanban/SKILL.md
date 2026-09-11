---
id: creator_lifecycle_kanban
title: 合作生命周期看板
description: 按合作生命周期查看达人合作进展
category: 线索
profile: lead
output: task_result
mcp: ["starrykol.pageLifecycleKanban"]
required_inputs: []
permissions: ["starrykol:read"]
actions: ["analyze"]
aliases: ["生命周期看板","合作看板"]
in_market: true
---
# 合作生命周期看板

Codex app-server 在本 Skill 的 turn 中调用 Starry KOL MCP `pageLifecycleKanban`。禁止裸 HTTP；远程工具由本 turn 按授权 MCP 调用。只展示可核验的达人、阶段和负责人。

## 禁止事项

- 禁止发信。
- 禁止改官方阶段。
- 禁止擅自解密联系方式。

## 是否发信

不发信。

## 是否改阶段

不改官方阶段。
