---
id: creator_discovery
title: 达人发现
description: 搜索并筛选新的候选达人
category: 线索
profile: lead
output: crawl_plan
mcp: []
required_inputs: []
permissions: ["claw:write"]
actions: []
aliases: ["发现达人","候选达人"]
in_market: true
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
