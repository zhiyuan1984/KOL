---
id: discovery_plan
title: 发现计划
description: 把已确认 Brief 收成可执行的发现计划。不启动采集，不导入正式库。
category: 线索
profile: lead
output: crawl_plan
mcp: []
required_inputs: []
permissions: []
actions: []
aliases: ["发现计划","discovery plan"]
in_market: true
funnel: reach
---
# 发现计划 discovery_plan · Lead

把已确认 Brief 收成发现计划（平台 allowlist、目标数量上限、关键词）。本 Skill 只出计划，不调用 MediaCrawler，不创建达人，不发信。正式采集由已登记的后台作业执行；正式入库走 Host `import_creator` L3 闸门。

## 禁止事项

- 禁止把 MediaCrawler 包装成本 Skill。
- 禁止在本 Skill 里启动采集、导入 Starry 或领取跟进。
- 禁止国内平台。目标数量不得超过已发布政策上限。

## 是否发信

不发信。

## 是否改阶段

不改官方阶段。
