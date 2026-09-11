---
id: wikiskill_evolve
title: WikiSkill 抽取与演化
description: 从 Raw 抽取 pending wiki；在 shadow profile 提出 Skill / 模板补丁。禁止写生产 SKILL.md。
category: 管理
profile: commander
output: task_result
mcp: []
required_inputs: []
permissions: []
actions: []
aliases: []
in_market: false
---
# WikiSkill evolve（框架元技能）

本包是 WikiSkill 的 Maintainer / Proposer 说明书，**不是**运营工作台里的可点技能，也不进入技能市场。
不放在 `backend/skills/` 下，避免被任务注册表扫成可执行 Skill。

三层：

1. **Raw**：会话痕迹、草稿、发送审计、阶段变更、管理员上传（md/pdf/docx/eml）。系统只写，不可变。
2. **Wiki**：知识页。管理员抽取 / 编辑 / 审批。版本化。Skill 回滚后 wiki 与否决记录仍在。
3. **Skill**：`SKILL.md` + 已发布 `mail_template`。管理员发布；运营只能引用。可回滚。

规则：

- Inference Agent **不得**阅读 wiki 全文。
- 抽取只产生 `pending_review` 页，**禁止**自动改生产 `SKILL.md`。
- 人审是门禁。编辑 = 新版本；已发送邮件钉住当时版本。
- 演化只在 **shadow / isolated** profile 里提案，提案进审批队列。
- 跨品牌模板转移必须通过品牌 From 白名单（LT / RO / PQ）。
- 否决记录保留，避免 Proposer 重复同一补丁。
