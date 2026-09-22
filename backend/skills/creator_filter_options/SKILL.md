---
id: creator_filter_options
title: 达人筛选字典
description: 查询合作阶段、风险标签和达人相关字典选项
category: 线索
profile: lead
output: task_result
mcp: ["starrykol.listDictionaryOptions", "starrykol.listCooperationStageOptions", "starrykol.listRiskTagOptions"]
required_inputs: []
permissions: ["starrykol:read"]
actions: ["analyze"]
aliases: ["达人筛选项","合作阶段选项","风险标签选项"]
in_market: true
employee_visible: false
---
# 达人筛选字典

Codex app-server 在本 Skill 的 turn 中调用 `listDictionaryOptions`（含 `kol_primary_platform` / `kol_niche` / `kol_follow_style`）、`listCooperationStageOptions`、`listRiskTagOptions`，供达人库筛选使用。

## 禁止事项

- 禁止发信。
- 禁止改官方阶段。
- 禁止擅自解密联系方式。

## 是否发信

不发信。

## 是否改阶段

不改官方阶段。
