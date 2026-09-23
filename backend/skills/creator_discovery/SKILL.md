---
id: creator_discovery
title: 达人发现
description: 搜索并筛选新的候选达人
category: 线索
profile: lead
output: crawl_plan
funnel: reach
mcp: []
required_inputs: []
permissions: ["claw:write"]
actions: []
aliases: ["发现达人","候选达人","红人线索","AI发现"]
in_market: true
employee_quick: 已有发现批次与同步结果
employee_agent: 新发现分析、异步采集；正式导入独立确认
input_schema: [{"key":"platforms","label":"平台","kind":"multiple","required":false,"max":1,"options_source":"api:/home/discovery/template#platforms","prefill":"entities.platform"},{"key":"region","label":"地区","kind":"single","required":false,"options_source":"api:/home/discovery/template#regions"},{"key":"directions","label":"方向","kind":"multiple","required":false,"max":8,"options_source":"api:/home/discovery/template#directions"},{"key":"keywords","label":"关键词","kind":"text","required":false,"prefill":"entities.keywords"},{"key":"min_followers","label":"粉丝数下限","kind":"number","required":false},{"key":"max_followers","label":"粉丝数上限","kind":"number","required":false},{"key":"min_avg_plays_10","label":"近10条均播","kind":"number","required":false},{"key":"expect_count","label":"期望人数","kind":"number","required":false}]
result_type: discovery_candidates
memory_policy: {"kind":"skill_result","scope":"owner","auto_persist":"on_complete","stale_refs":["discovery_run","candidate_snapshot"]}
supports: {"cancel":true,"retry":true,"resume":false}
---
# 达人发现 creator_discovery · Lead

先读取 CONTEXT `extra.entities` 中的 platform / keywords / specified_ids / creator_ids，输出对应 `crawl_plan`；缺省平台才使用 youtube。不得把 YouTube / Instagram / Facebook 改写成 xhs 或其他国内平台。输出必须同时包含 keywords、specified_ids、creator_ids 三个数组，当前模式不用的数组填 `[]`。本 Skill 的 turn 只出 `crawl_plan`，不创建达人、不发信、不推测联系方式。内核收到该 Item 后启动远程采集并监控结果。

## 禁止事项

- 禁止在本 Skill 里创建达人或启动采集；采集由内核在收到 `crawl_plan` 后启动。
- 禁止创建达人。
- 禁止发信或推测联系方式。

## 是否发信

不发信。

## 是否改阶段

不改官方阶段。
