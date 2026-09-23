---
id: mail_summary
title: 邮件总结
description: 增量读取本地邮件记忆，为会话与单封邮件补齐中文总结并写回记忆；不发信、不改阶段、不写远端
category: 邮件
profile: lead
output: task_result
funnel: biz
mcp: []
required_inputs: []
permissions: []
actions: ["analyze"]
aliases: []
in_market: false
employee_visible: false
side_effects: none
creates_session: false
auto_ok: true
---
# 邮件总结 mail_summary · 后台记忆作业

本技能由「邮件记忆增量」作业调用（定时任务 + 收取新邮件后触发一次）：按增量条件扫描本地邮件记忆，逐条补齐缺失或过期的中文总结，结果**只写回本地记忆**（`kol_mail_threads.digest_*`）。邮箱通讯页第四栏只读这份记忆，不在页面里跑模型。

## 增量条件（只处理这三类，其余跳过）

1. 会话没有任何模型总结（`digest_source` 为空，或只有 `body_analysis` 规则产物）。
2. 内容指纹变化：会话内各封的 `occurred_at` 与正文内容算出的哈希与 `digest_fingerprint` 不一致。
3. 上次失败且已过冷却：`digest_source = analysis_failed` 且 `failed_at` 早于冷却窗口。

同一来源版本不重复提炼；指纹相同即跳过，不做无谓的模型调用。

## 执行

Codex app-server 单次调用即可完成任务：输入是本地已缓存的邮件正文（不外发、不重新拉取），输出一段中文总结。模型不可用时**明确失败**：把来源标为 `analysis_failed` 并保留旧总结，等待下次增量补算。

## 回写内容

写回记忆时必须同时写：内容、来源（`codex_memory` / `luna` / `body_analysis`）、内容指纹、产出时间。失败只标失败与原因，**不得覆盖已有产物**。

## 禁止事项

- 禁止发信。
- 禁止写正式阶段。
- 禁止把邮件正文发往 Starry 授权范围之外的任何地方。
- 禁止用规则摘录、模板或旧总结冒充新的模型总结。

## 是否发信

不发信。

## 是否改阶段

不改阶段。
