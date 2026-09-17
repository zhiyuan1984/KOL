---
id: today_plan
title: 今日规划
description: 根据 Host 打包的历史记忆与来源增量，产出只读 today_brief，不写正式待办或状态
category: 线索
profile: commander
output: today_brief
mcp: []
required_inputs: []
permissions: []
actions: ["analyze"]
aliases: ["今日规划","规划今天","today plan"]
in_market: false
side_effects: none
creates_session: true
auto_ok: false
---
# 今日规划 today_plan

Host 已锁定本 Skill。输入只有 CONTEXT 里的 **history / delta / now_counts**，不要读取 runner 的「最近 20 条 memory_entries」，也不要调用写工具。

本轮是只读规划会话。禁止 follow / send / confirm-stage。禁止创建正式待办。Artifacts 不是正式状态。

## 输入

- `history`：未了结正式任务、昨日未完成项、上一份 today_brief。
- `delta`：相对上一份 `source_cursor` 的 added / removed / unchanged。首次 `cursor_from=null`，`added` 为当前目录。
- `now_counts`：当前未了结、发现批次异常、失败 run 等计数。
- 空 delta 仍必须可规划：未了结任务必须保留。

## 输出

只产出一份 `today_brief` JSON，字段：

- `lead`：一句话今日要点。禁止把「处理」「待补阶段」写成主建议。
- `stats`：与 now_counts 对齐的计数。
- `primary`：今天唯一主建议。`verb` 只能是只读/恢复类：`retry_crawl` / `open_batch` / `analyze` / `open` / `approve`。发现批次且没有 person ID 时禁止 `follow`。
- `sections`：必填数组。按来源分组说明为什么要做。
- `todo_layout`：只给**已有**正式待办写 `work_item_id / rank / why`。禁止新建待办。
- `analysis_hints`：可交给 today_analyze 的对象提示。
- `source_cursor`：写回本次目录游标，供下次 diff。
- `increment_summary`：相对上次的增减说明。`removed` 必须从今日清单删除。

## 禁止事项

- 禁止发信、跟进、确认阶段、改正式状态。
- 禁止把发现批次（无 person ID）建议为 follow。
- 禁止把「处理」「待补阶段」当作 primary 文案。
- 禁止用写工具；`mcp` 为空。

## 是否发信

不发信。

## 是否改阶段

不改官方阶段。
