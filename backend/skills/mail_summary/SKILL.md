---
id: mail_summary
title: 邮件总结
description: 根据当前邮件会话生成往来摘要并写回本地记忆；不发信、不改阶段、不写远端
category: 邮件
profile: lead
output: task_result
funnel: biz
mcp: []
required_inputs: ["conversation_id"]
input_schema: [{"key":"conversation_id","label":"邮件会话","kind":"text","required":true,"reason":"由通讯页当前选中的会话提供，不猜测会话。","prefill":"entities.conversation_id"}]
interaction: {"purpose":"根据当前选中的邮件会话，提炼往来中的合作进展、关键约定、待办与风险，生成供运营阅读的中文摘要。","steps":["确认当前选中的邮件会话及其授权范围。","读取本地已同步的会话正文，不扩大邮箱或会话范围。","通过本技能生成摘要并写回本地邮件记忆，在右栏展示最新结果。"],"output_title":"往来摘要与生成状态","constraints":["只处理当前选中的会话。","摘要不能替代阶段变更或发送确认。","正文不可写入外发草稿。"]}
permissions: []
actions: ["analyze"]
aliases: []
in_market: true
employee_visible: true
employee_quick: 已同步邮件会话的往来摘要与关键进展
employee_agent: 当前会话的摘要生成走邮件总结技能；阶段判断和发信仍需分别使用对应技能
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

## 知识库提示词模板

系统提示词：你是 KOL 邮件运营摘要助手。请根据同一邮件主题下的完整往来，生成一段简洁、准确、可执行的中文往来摘要。必须覆盖合作进展、双方关键诉求或承诺、待办事项、时间/价格/交付等约定和潜在风险；按时间顺序理解上下文，区分已完成与待处理事项；不得编造邮件中没有的信息，不复述无意义寒暄，不输出邮箱地址，不改变合作阶段。若本次输入包含旧摘要，必须在保留仍有效事实的基础上吸收新邮件，输出完整的最新摘要，而不是只输出增量片段。只返回摘要正文。

用户输入模板：

```text
邮件主题：{{subject}}
已有摘要：{{previous_summary}}
邮件往来（按时间顺序）：
{{messages}}
```

首选模型为 `gpt-5`，API Key 从运行环境的 `.env` 中读取 `openai_api_key`/`OPENAI_API_KEY`；若当前 OpenAI 网关明确不提供该模型，自动使用 `gpt-5-mini` 完成同一提示词，结果只写入本地邮件记忆。

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
