---
id: reply_analysis
title: 回复分析
description: 按 Starry 十五阶段核对来信事实，给出指针与下一步，不改阶段、不发信
category: 商机
profile: opportunity
output: task_result
mcp: ["starrykol.pageEmailConversations", "starrykol.getEmailConversation", "starrykol.getEmailConversationSubjectGroups", "starrykol.translateEmailToChinese", "starrykol.listCooperationStageOptions", "starrykol.getStageRiskMatrix", "starrykol.getKolProfileDetail", "starrykol.pageLifecycleKanban", "starrykol.pageRiskConversations"]
required_inputs: []
permissions: ["starrykol:read"]
actions: ["analyze"]
aliases: ["分析回复","看邮件阶段"]
in_market: true
---
# 回复分析 reply_analysis · KOL Agent SOP

这是 KOL 入口上的只读分析。Codex app-server 在本 turn 中按下列顺序调用 Starry KOL MCP，并解释结果。禁止发送、禁止写入阶段、禁止企微、禁止 ingest。发送 ≠ 推进阶段。

## 工具顺序（只读）

1. `pageEmailConversations` — 按红人 / 邮箱定位会话
2. `getEmailConversation` — 读正文；需要时可 `getEmailConversationSubjectGroups`
3. `translateEmailToChinese` — 给运营看中文摘要，原文仍以英文为准
4. `listCooperationStageOptions` + `getStageRiskMatrix` — 用 Starry 原生日历，不自造阶段引擎
5. `getKolProfileDetail` 或 `pageLifecycleKanban` — 读当前指针
6. 有风险时 `pageRiskConversations`；不要在这一步改风险标签

## 十五阶段清单

对每条主阶段标注：**已完成 / 进行中 / 未开始 / 不适用 / 被前置挡住**。

- 指针 = 最早仍未完成、且前置已齐的主阶段
- 一封信可以覆盖多段：中间已完成的可以一次确认跳过
- 后面的事实（例如已发布链接）若前置未齐，标「有证据、被前置挡住」，不得当作指针
- `EXCEPTION_HANDLING` 或风险标签 DELAY / CONTENT / LOST_CONTACT：主流程堵住，先处理异常
- Thank you / 已读 ≠ 有兴趣；please confirm 仍是待确认；Invoice received 是待付款，payment sent 才是已付款
- 权重：正文明确动作 > 附件和链接 > 履约字段 > 邮件主题

## 推荐下一步（只预填对话，不执行）

把可点击文案放进 `recommended_actions`，例如：

- `写合作邮件 …` → 走既有 `email_compose`（先预览，用户改稿后「确认发送」）
- `提出阶段变更 …` → 走既有 `confirm_stage`（人在会话里确认后内核闸门才写）

禁止输出 send / confirm_stage 写动作 / 企微审批。

## 禁止事项

- 禁止发送。
- 禁止写入阶段。
- 禁止企微、禁止 ingest。
- 禁止把 Thank you / 已读当成有兴趣。

## 是否发信

不发信。

## 是否改阶段

不改阶段。只建议，人确认后才走 confirm_stage。
