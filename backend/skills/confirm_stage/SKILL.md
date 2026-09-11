---
id: confirm_stage
title: 提出阶段变更
description: 按 Starry 阶段定义提出指针变更，等人在会话里确认后再写入
category: 商机
profile: opportunity
output: propose_stage
mcp: ["starry.get_collaboration"]
required_inputs: ["collaboration_id"]
actions: ["propose_stage"]
aliases: ["记状态","推进阶段","确认阶段"]
in_market: true
permissions: ["starrykol:read"]
---
# 阶段变更建议 confirm_stage · Opportunity

Codex app-server 按本 Skill 只推荐一个具体 `stage_code`。CONTEXT 列出三条轨道供 turn 使用，合法目标来自 `legalTargets`（人确认，无相邻约束），不是 Host 业务目录：

- **主流程**：下一格，以及纠正记错（回退到更早的正式阶段）。
- **分支流程**：跳过中间阶段，例如合同后不寄样，直接进入内容策划。
- **异常流程**：已暂停 / 争议中 / 已流失 / 已拒绝 / 已取消。

人在会话确认卡里拥有最终确认权。确认后内核闸门写本地阶段缓存，并在已绑定 `kol_uid` 时调用 Starry KOL MCP `changeLifecycleStage`。Worker / Codex 不得自己写阶段。

禁止 Worker 写阶段、发信或走企微审批。禁止把发送邮件当成阶段变更。管理员同样必须等人确认后才写入。自动事实写入不走 `legalTargets`，不能替人跳过或纠正。

## 禁止事项

- 禁止 Worker 写阶段、发信或走企微审批。
- 禁止把发送邮件当成阶段变更。
- 禁止口令「下一阶段」；必须给出具体 `stage_code`。
- 禁止自动跳过寄样或自动回退；这两类只能作为确认卡选项由人选定。
- 管理员同样必须等人确认后才写入。

## 是否发信

不发信。

## 是否改阶段

仅人在会话确认后写入官方阶段。管理员同样必须等人确认。
