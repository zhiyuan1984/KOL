---
id: discovery_plan
title: 发现计划
description: 描述你想找的红人方向，我整理成一份可确认的发现计划。只写计划草稿：不采集、不入库。
category: 线索
profile: lead
output: task_result
funnel: reach
mcp: []
required_inputs: []
permissions: []
actions: []
aliases: ["发现计划","discovery plan"]
in_market: false
employee_visible: false
---
# 发现计划 discovery_plan · Lead

Host 已锁定本轮 Skill。只根据 CONTEXT 里的员工目标写出 `discovery_spec/v1` 草稿。

本回合 **不采集、不入库、不建联、不发信、不改阶段**。禁止调用 `start_crawl`、`upload_creators`、`importKolProfilesFromCrawler`、`sendEmailNow`、`changeLifecycleStage`、`decryptKolContact`、`follow`。禁止召唤 `creator_discovery`。MediaCrawler 不是 Skill。正式采集由已登记的后台作业执行；正式入库走 Host `POST /api/home/discovery/ingest`（L3），本 Skill 不得执行。

## 输出

写一份 JSON，放在 `task_result` 的 `spec` 字段：

```json
{
  "schema": "discovery_spec/v1",
  "platforms": ["youtube"],
  "mode": "search",
  "keywords": ["clean beauty"],
  "directions": [],
  "brand": "LT",
  "region": "global_en",
  "thresholds": {
    "min_followers": 10000,
    "max_followers": 2000000,
    "min_avg_views_10": 5000,
    "target_count": 30
  }
}
```

平台只能是 `youtube` / `instagram` / `facebook`。不要写国内平台码。不要编造粉丝、播放或邮箱。目标数量不得超过已发布政策上限。

## 禁止事项

- 禁止采集、入库、建联、发信、改正式阶段、解密联系方式。
- 禁止 from-text 自由编排；本 Skill 只写 spec 草稿。
- 禁止把 MediaCrawler 包装成 Skill 或自行启动采集。
- 禁止国内平台。

## 是否发信

不发信。

## 是否改阶段

不改官方阶段。
