---
id: creator_library_all
title: 达人库全量
description: 按当前账号可见范围列出全部红人画像
category: 线索
profile: lead
output: task_result
funnel: reach
mcp: ["starrykol.listAllKolProfiles"]
required_inputs: []
permissions: ["starrykol:read"]
actions: ["analyze"]
aliases: ["全量达人库","全部红人画像"]
in_market: true
employee_visible: false
employee_quick: 授权档案、画像、筛选与已有摘要
employee_agent: 新画像分析、补查新事实走 AI 助理或已配置同步
icon: database
badge: "达人库"
result_title: "达人库全量结果"
next_actions: [{"action_id":"skill:creator_profile","when":"has_results","note":"查看达人画像"},{"action_id":"skill:creator_owner_update","when":"has_results","note":"更新红人负责人"},{"action_id":"skill:creator_library_query","when":"no_results","note":"换关键词再查"},{"action_id":"skill:email_compose","when":"no_results","note":"写合作邮件"}]
---
# 达人库全量

Codex app-server 在本 Skill 的 turn 中调用 Starry 达人库的 `listAllKolProfiles`。结果受账号自身范围限制。禁止裸 HTTP；远程工具由本 turn 在已授权范围内调用。并展示红人负责人字段（若接口返回）。不调用 `decryptKolContact`。

## 禁止事项

- 禁止发信。
- 禁止改官方阶段。
- 禁止擅自解密联系方式。

## 是否发信

不发信。

## 是否改阶段

不改官方阶段。
