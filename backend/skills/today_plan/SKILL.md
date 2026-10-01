---
id: today_plan
runtime_agent_id: agent:workspace-planner
runtime_access: authenticated
title: 今日规划
description: 按「今日任务」面（Host 打包的历史记忆与来源增量）产出封面 today_brief 和任务行 display_tasks，不写正式待办或状态
category: 线索
profile: commander
output: today_brief
funnel: reach
mcp: []
required_inputs: []
permissions: []
actions: ["analyze"]
aliases: ["今日规划","规划今天","today plan"]
in_market: false
employee_visible: false
employee_summary: 按「今日任务」面把历史记忆与新增事项整理成今日简报与任务行；不写正式待办或状态
side_effects: none
creates_session: true
auto_ok: false
---
# 今日规划 today_plan

Host 已锁定本 Skill。CONTEXT.md 里的 **HOST PACK（history / delta / now_counts）只是输入**，不是展示任务，也不是 today_brief。禁止把 Host 文件、任务标题列表或计数模板抄成正文。

不要读取 runner 的「最近 20 条 memory_entries」，也不要调用写工具。本轮是只读规划会话。禁止 follow / send / confirm-stage。禁止创建正式待办。Artifacts 不是正式状态。

## 何时使用

- 员工在「今日任务」快捷入口提交时，由 Host 直接锁定 `today_plan`；不得再走自然语言意图识别。
- 页面首次进入只读取正式任务记忆和上次展示结果，不自动启动模型。
- `creator_daily_tasks` 是员工端入口标签和旧的远程任务查询能力，不是本规划会话实际执行的 task type；实际运行、审计和 artifact 均记为 `today_plan`。

## Host 执行契约

1. 前端读取 `/api/tasks?view=open`、`/api/home/today-brief` 和 `/api/home/today-tasks`，先展示已有记忆。
2. 员工明确提交后，前端调用 `POST /api/home/today-brief/plan`。已有同一员工的运行中规划时附着原运行，不重复启动。
3. Host 从正式任务、上一份 brief、失败运行和发现批次打包 `history / delta / now_counts`，再挂载本 Skill 提交 Codex app-server。
4. 模型只生成下述 `today_brief` 的摘要、主建议和候选任务解释；Host 负责事实筛选、优先级排序、完整任务行和 `work_item_id` 全量覆盖。
5. 校验通过后，Host 分别保存封面 artifact 和任务展示记忆；失败时保留上一版可用展示，并写入真实失败事件。
6. 前端轮询 brief 状态，完成后重新读取展示任务；任务表始终以正式任务为底，不把 artifact 当正式状态。

本 Skill 不直接使用 MCP 或知识库。所需事实由 Host 按员工权限从本地正式记忆和已同步来源组包；模型不得自行扩大读取范围。

## 输入

- 员工必填参数：无。提交动作本身代表“按当前员工范围重新规划今天”。
- `history`：Host 预筛选的必要候选任务、上一份摘要。
- `delta`：必要的 added / removed 摘要；unchanged 不重复发送。
- `now_counts`：当前未了结、发现批次异常、失败 run 等计数。
- 空 delta 仍必须可规划：未了结任务必须保留。

## 输出

只产出一份 `today_brief` JSON。任务列表由 Host 确定性生成；如进入异步摘要模式，模型只负责正文和候选任务解释。

### 1. 封面（摘要·展示，不是列表）

- `lead`：一句话今日要点。
- `sections`：必填数组。按来源分组说明为什么要做。
- `primary`：今天唯一主建议。`verb` 只能是 `retry_crawl` / `open_batch` / `analyze` / `open` / `approve`。发现批次且没有 person ID 时禁止 `follow`。
- `reasoning`：必填数组。3–5 条中文短句，向用户交代推理过程：读了哪些记忆与增量、为什么这样排序和取舍。只写决策理由，不贴原文、不写工具名。

### 2. 展示任务行（任务·展示记忆，用户看的列表）

`display_tasks` 由 Host 根据正式任务目录生成。模型必须输出空数组或只输出候选任务解释；不要尝试重写全部任务。

Host 会将正式任务目录中的每一个 `work_item_id` 恰好生成一行，并负责排序、分组和兜底文案。模型只对输入候选任务提供自然语言覆盖。

```json
{
  "work_item_id": "tsk_xxx",
  "title": "重试北美户外达人的 YouTube 采集",
  "why": "上轮采集失败，今天先把批次拉起来",
  "rank": 1,
  "verb": "retry_crawl",
  "label": "重试采集",
  "icon": "⚠️",
  "group": "重要"
}
```

- `title`：给用户看的标题。禁止原样复制 Host 的「AI发现 · youtube · …」。
- `why`：为什么今天做。禁止写「待处理」「待补阶段」「已记录打开/处理」。
- `verb`：`retry_crawl` / `open_batch` / `analyze` / `open` / `approve` / `edit` / `handle`（`edit`=需要用户编辑任务字段，`handle`=一般处理）。
- `label`：箭头按钮文案。禁止「处理」——除非 `verb` 是 `handle`；其余动词保持原禁令。
- `rank`：从 1 开始，按严重度排序：重要紧急（important_urgent）在最前，其次重要（important）、紧急（urgent），其余在后。
- `icon`：单个拟人化 emoji，按任务性质选（如 ✉️📋⚠️🔎）。
- `group`：按优先级严重度分组：`重要紧急` / `重要` / `紧急` / `其他`。优先级∈{重要紧急,重要,紧急}或开始日期为当天的行排入今日语义（用 `group` 体现），其余放后面。

Host 负责 `stats` / `source_cursor` / `increment_summary`、任务排序、`display_tasks` 以及 today/todo 视图归属。模型摘要不再是首屏任务列表的必要条件。

`todo_layout` 已并进 `display_tasks`，不要再单独产出一套只有 id/rank/why 的布局。

## 禁止事项

- 禁止发信、跟进、确认阶段、改正式状态。
- 禁止把发现批次（无 person ID）建议为 follow。
- 禁止把「待补阶段」写进 lead、primary、title、why、label；「处理」只允许作为 `verb=handle` 行的 label。
- 禁止用写工具；`mcp` 为空。
- 禁止把 HOST PACK 原文或任务标题列表当 brief 正文或展示行交差。

## 是否发信

不发信。

## 是否改阶段

不改官方阶段。
