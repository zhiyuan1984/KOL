---
id: creator_filter_options
title: 达人筛选字典
description: 查询合作阶段、风险标签和达人相关字典选项
category: 线索
profile: lead
output: task_result
funnel: reach
mcp: []
capabilities: [{"id":"creator.dictionary.options","version":1},{"id":"creator.stages.options","version":1},{"id":"creator.risks.options","version":1}]
ontology: [{"object":"kol_profile","revision":2}]
applicable_objects: ["kol_profile"]
required_inputs: []
context: {"requires":[],"prefers":[]}
permissions: ["starrykol:read"]
actions: ["analyze"]
aliases: ["达人筛选项","合作阶段选项","风险标签选项"]
in_market: true
employee_visible: false
employee_quick: 授权档案、画像、筛选与已有摘要
employee_agent: 新画像分析、补查新事实走 AI 助理或已配置同步
icon: filter
badge: "达人库"
result_title: "达人筛选字典"
---
# 达人筛选字典

在原 Codex harness turn 中使用已挂载的稳定业务能力：

1. “读取达人字典选项”按 `parent_key` 读取现行字典节点，例如原技能已使用的 `kol_primary_platform` / `kol_niche` / `kol_follow_style`。未知父节点不编造选项；不把员工姓名或邮箱当节点。
2. “读取合作阶段选项”和“读取风险标签选项”分别读取现行来源字典。不要合并阶段与风险，也不要将达人画像、跟进关系、合作或任务状态视为同一个状态。
3. 复用真实来源返回的编码、名称与层级生成现有 task_result；区分有效空结果、缺失字段和读取失败。字典仅用于解释或选择，不修改本体定义，不推进合作阶段，不改变负责人。

保留原技能ID、Agent装配和工具风险闸门。技能不依赖页面当前达人，不因此要求先选中达人。

## 禁止事项

- 禁止发信。
- 禁止改官方阶段。
- 禁止擅自解密联系方式。

## 是否发信

不发信。

## 是否改阶段

不改官方阶段。
