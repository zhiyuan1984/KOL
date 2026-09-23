---
id: mail_translate
title: 邮件翻译
description: 增量读取本地邮件记忆，为缺译文或正文已变的邮件补齐中文译文并写回记忆；不回写 SMTP、不发信、不改阶段
category: 邮件
profile: lead
output: task_result
funnel: biz
mcp: ["starrykol.translateEmailToChinese"]
required_inputs: []
permissions: ["starrykol:read"]
actions: ["analyze"]
aliases: []
in_market: false
employee_visible: false
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
