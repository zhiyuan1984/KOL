---
id: discovery_brief
title: 发现简报
description: 采集空闲后，按 Host 已过滤的候选人写 discovery_brief/v1。不入库、不建联。
category: 线索
profile: lead
output: task_result
funnel: reach
mcp: []
required_inputs: []
permissions: []
actions: []
aliases: ["发现简报","discovery brief"]
in_market: false
---
# 发现简报 discovery_brief · Lead

Host 已完成采集与过滤。CONTEXT 只包含：发现 spec、裁剪后的候选人、library_hits。不要读取或拼接最近记忆消息。

只输出 `discovery_brief/v1`。不要启动采集、不要导入、不要发信、不要改阶段、不要解密、不要 follow。禁止召唤 `creator_discovery`。MediaCrawler 不是 Skill。正式入库走 Host `POST /api/home/discovery/ingest`（L3），本 Skill 不得执行。

缺粉丝 / 近 10 均播时保留 `metrics_missing=true`，**禁止编造** followers、views、email。

## 输出

本回合的输出 schema 只接受 `task_result`，且 **`brief` 是必填字段**：把下面 JSON 整段放在 `task_result.brief` 里（**不要**只把它塞进 `title` / `summary` / `metrics`，Host 只从 `brief` 读取，放在别处等于没有产出）。`ranking[].candidate_id` 必须逐字取自 CONTEXT 候选人列表里的 `id`，不要自己编。

```json
{
  "schema": "discovery_brief/v1",
  "headline": "...",
  "counts": { "raw": 0, "after_host_filter": 0, "shown": 0, "dropped": 0 },
  "ranking": [{
    "candidate_id": "...",
    "score": 0,
    "band": "high",
    "why": [],
    "gaps": [],
    "fit": "...",
    "recommend": "ingest"
  }],
  "dropped": [{ "candidate_id": "...", "reason": "..." }],
  "gaps": [],
  "next_actions": ["ingest", "ignore"]
}
```

`band` 只能是 `high` / `mid` / `low` / `uncertain`。`recommend` 只能是 `ingest` / `ignore` / `need_human`。缺少 `ranking` 视为失败，不要用半段 JSON 当封面。

## 禁止事项

- 禁止调用 `start_crawl` / `upload_creators` / import / `sendEmailNow` / `changeLifecycleStage` / `decryptKolContact` / follow。
- 禁止在本回合写 Starry 或把「已入 Starry」当作采集完成。
- 禁止把 入库 说成 领取跟进 或 建联。
- 禁止拼接最近 20 条记忆冒充本轮证据。
- 禁止把 MediaCrawler 包装成本 Skill 的工具。
- 禁止把国内平台写进计划。

## 是否发信

不发信。

## 是否改阶段

不改官方阶段。
