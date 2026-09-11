---
id: creator_outreach
title: 达人建联话术
description: 基于达人数据生成私信和加微信话术
category: 线索
profile: lead
output: task_result
mcp: ["kolclaw.generate_outreach_script", "kolclaw.list_creators"]
required_inputs: []
permissions: ["kolclaw:read"]
actions: ["analyze"]
aliases: ["生成建联话术","达人话术"]
in_market: true
---
# 达人建联话术

Codex app-server 在本 Skill 的 turn 中解析达人身份并调用 KOL Claw `generate_outreach_script`。输出仅为待人工复核话术，不自动发送、不更新状态。

## 禁止事项

- 禁止自动发送话术。
- 禁止更新官方阶段。

## 是否发信

不发信。

## 是否改阶段

不改官方阶段。
