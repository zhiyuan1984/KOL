---
id: deal_memory
title: 谈判纪要
description: 整理谈判事实、约束和待确认事项
category: 谈判
profile: negotiation
output: task_result
funnel: biz
mcp: ["starry.deal_memory", "starry.get_collaboration", "starrykol.updateKolProfile"]
required_inputs: []
permissions: ["starrykol:read"]
actions: ["analyze"]
aliases: ["交易记忆","谈判纪要"]
in_market: true
employee_quick: 明确内容的记忆记录、修改、查询
employee_agent: 修改远端正式档案备注是业务写入，不能与本地记忆混为一谈
---
# Deal Memory deal_memory · Negotiation

Codex app-server 在本 Skill 的 turn 中读取会话摘要与红人缓存备注，整理谈判事实、承诺和未决项。需要记到红人画像时，本 turn 调用 Starry `updateKolProfile` 写备注。不得发送消息或修改阶段。

## 禁止事项

- 禁止发送消息。
- 禁止修改阶段。

## 是否发信

不发信。

## 是否改阶段

不改官方阶段。
