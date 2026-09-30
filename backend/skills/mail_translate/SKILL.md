---
id: mail_translate
title: 邮件翻译
description: 根据当前选中的邮件生成中文译文并写回本地记忆；不回写 SMTP、不发信、不改阶段
category: 邮件
profile: lead
output: task_result
funnel: biz
mcp: ["starrykol.translateEmailToChinese"]
required_inputs: ["message_id"]
input_schema: [{"key":"message_id","label":"邮件消息","kind":"text","required":true,"reason":"由通讯页当前选中的邮件提供，不猜测消息。","prefill":"entities.message_id"}]
interaction: {"purpose":"将当前选中的英文邮件正文翻译为供运营阅读的中文内部译稿。","steps":["确认当前选中的邮件消息及其授权范围。","读取本地已同步的正文，不扩大邮箱或会话范围。","通过本技能生成中文译稿并写回本地邮件记忆，在右栏展示最新结果。"],"output_title":"中文译稿与生成状态","constraints":["只处理当前选中的邮件。","译稿仅供内部阅读，不进入外发正文。","正文不可写入发送草稿。"]}
permissions: ["starrykol:read"]
actions: ["analyze"]
aliases: []
in_market: true
employee_visible: true
employee_quick: 已同步邮件正文的中文内部译稿
employee_agent: 当前邮件的中文翻译走邮件翻译技能；发送仍以英文原文和独立确认流程为准
side_effects: none
creates_session: false
auto_ok: true
---
# 邮件翻译 mail_translate · 后台记忆作业

本技能由「邮件记忆增量」作业调用（定时任务 + 收取新邮件后触发一次）：按增量条件扫描本地邮件记忆，逐封补齐中文译文，结果**只写回本地记忆**（`kol_mail_items.translation_zh`）。邮箱通讯页第四栏只读这份译稿。

## 增量条件（只处理这两类，其余跳过）

1. 该封没有译文（`translation_zh` 为空）且正文非空。
2. 正文指纹变化：`memory_fingerprint` 与当前正文算出的哈希不一致（远端改写过正文就重译）。

指纹相同即跳过；已有译文且正文未变时不重复调用，避免无谓的模型开销。

## 知识库提示词模板

系统提示词：你是 KOL 邮件内部翻译助手。请把当前选中的英文邮件完整翻译成自然、准确、忠实的简体中文，保留原文的语气、段落、列表、数字、币种、日期、链接和专有名词；不得总结、改写、补充、删减或改变合作意图。译文仅供内部阅读，不得进入外发邮件。只返回中文译文正文。

用户输入模板：

```text
邮件主题：{{subject}}
邮件正文：
{{body}}
```

首选模型为 `gpt6-luna-low`，API Key 从运行环境的 `.env` 中读取 `openai_api_key`/`OPENAI_API_KEY`；若当前 OpenAI 网关明确不提供该模型，自动使用网关可用的 `gpt-5.5` 完成同一提示词，结果只写入本地邮件记忆。

## 执行

1. 优先走已授权的 Starry 工具 `translateEmailToChinese`。
2. 不可用时用 Codex app-server 单次调用（输入是本地已缓存的正文）。
3. 两者都不可用：把来源标为 `pending`，保留「未翻译」的真实状态，等下次增量补算。

## 回写内容

译文只写本地记忆：`translation_zh` 与来源（`starry_mcp` / `codex_memory` / `luna`）、内容指纹、产出时间。译稿是**内部中文译稿**，不得进入任何外发通道（BIZ-11）。

## 禁止事项

- 禁止发信。
- 禁止写正式阶段。
- 禁止把内部译稿拼进任何待发草稿或外发正文。
- 禁止在拿不到译文时用占位文本冒充已翻译。

## 是否发信

不发信。

## 是否改阶段

不改阶段。
