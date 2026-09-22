---
id: stage_sop
title: 阶段 SOP
description: 输出合作阶段的完整轨道，以及当前正式阶段的输入、证据、完成条件和下一步。只展示资料，不发信，不修改阶段。
category: 线索
profile: lead
output: task_result
mcp: ["starry.get_collaboration"]
required_inputs: []
permissions: ["starrykol:read"]
actions: ["present_sop"]
aliases: ["阶段SOP", "八个阶段", "本阶段SOP", "阶段资料", "阶段资料包", "异常SOP", "异常流程", "八阶段异常"]
in_market: true
---
# 八个阶段 SOP

sop_id: STAGE_SOP
version: 2026-09-08.1

对照 `backend/src/sops.ts` 的八个展示阶段。正式阶段仍是 15 个主阶段；本技能只把它们收成八段轨道，并输出当前正式阶段 SOP。异常是旁路，不是第九段。由 Codex app-server 按本 Skill 展示，不发信、不改阶段。

- 发送邮件走 `email_compose`，必须「确认发送」。
- 正式阶段写入走 `confirm_stage`，必须人确认。
- 来信分析只出建议，不自动改阶段。
- 不修改已确认的报价、寄样、发货和阶段规则。

## 禁止事项

- 禁止发信。
- 禁止改正式阶段。
- 禁止把异常旁路写成第九段。
- 禁止修改已确认的报价、寄样、发货和阶段规则。

## 是否发信

不发信。

## 是否改阶段

不修改阶段。只展示八段轨道和当前 SOP。
