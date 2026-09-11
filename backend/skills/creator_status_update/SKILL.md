---
id: creator_status_update
title: 达人状态更新
description: 更新红人画像上的备注、确认或跟进字段，不写官方合作阶段
category: 线索
profile: lead
output: task_result
mcp: ["starrykol.getKolProfileDetail", "starrykol.updateKolProfile"]
required_inputs: []
permissions: ["starrykol:write"]
actions: ["update"]
aliases: ["更新达人状态","记录达人跟进"]
in_market: true
---
# 达人状态更新

Codex app-server 在本 Skill 的 turn 中调用远端档案服务：先读红人详情，再写入备注、合作确认或微信等画像字段，最后回读核验。必须指定达人 UID 或可唯一解析的名称。这不是官方阶段写入；「标记为已签约 / 已建联」走 `confirm_stage`。这不是报价审批，也不改品牌邮箱账号负责人。

## 禁止事项

- 禁止写官方合作阶段。
- 禁止把「标记为已签约 / 已建联」当成本技能。
- 禁止改品牌邮箱账号负责人。

## 是否发信

不发信。

## 是否改阶段

不改官方阶段。只改远端画像备注、确认或跟进字段。
