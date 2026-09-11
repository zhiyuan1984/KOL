---
id: creator_owner_update
title: 更新红人负责人
description: 更新红人画像上的负责人绑定，不是邮箱账号负责人
category: 线索
profile: lead
output: task_result
mcp: ["starrykol.getKolProfileDetail", "starrykol.updateKolProfile"]
required_inputs: []
permissions: ["starrykol:write"]
actions: ["update"]
aliases: ["更新达人负责人","分配红人负责人","改红人负责人"]
in_market: true
---
# 更新红人负责人

Codex app-server 在本 Skill 的 turn 中先 `getKolProfileDetail` 读取现有负责人字段名，再 `updateKolProfile`（`requestJson` 为 ProfileUpdateRequest），最后回读详情核验。没有 `assignKolOwner` 专用工具。必须指定达人 UID（或可唯一解析的名称）以及负责人。不猜测未出现在详情中的字段名。

## 禁止事项

- 禁止改品牌邮箱账号负责人。
- 禁止写官方合作阶段。
- 禁止发信。

## 是否发信

不发信。

## 是否改阶段

不改官方阶段。
