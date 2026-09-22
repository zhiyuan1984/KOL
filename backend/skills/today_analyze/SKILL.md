---
id: today_analyze
title: 今日对象分析
description: 分析已选对象并建议下一步，不自动写状态；对人可附 stage_sop
category: 线索
profile: commander
output: task_result
mcp: []
required_inputs: []
permissions: []
actions: ["analyze"]
aliases: ["今日分析","分析今天","today analyze"]
in_market: false
employee_visible: false
side_effects: none
creates_session: true
auto_ok: false
---
# 今日对象分析 today_analyze

分析 Host 指定的对象（正式任务、发现批次、失败 run、跟进对象），给出建议动作。不自动写正式状态，不创建正式待办。

## 输入

- 已选对象列表（id / kind / object_type / person_id）。
- 只读 history 摘录。不要读取 runner 的「最近 20 条 memory_entries」。

## 输出

`task_result`：说明对象现状、建议动作、风险。建议动作不得自动执行。

- 发现批次且没有 person ID：只允许 `retry_crawl` / `open_batch` / `analyze`，禁止 `follow`。
- 对人（有 person_id / collaboration）：可以附上适用的 `stage_sop` 作为分析附件，仍不写阶段。
- 禁止把「处理」「待补阶段」当作主建议文案。

## 禁止事项

- 禁止发信、跟进确认、confirm-stage、改正式状态。
- 禁止自动写入 stage / send / follow。
- 禁止创建正式待办。

## 是否发信

不发信。

## 是否改阶段

不改官方阶段。
