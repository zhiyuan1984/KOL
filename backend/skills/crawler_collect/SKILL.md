---
id: crawler_collect
title: 采集线索
description: 提出受控的远程采集请求，并读取已授权任务的进度和结果
category: 线索
profile: lead
output: task_result
funnel: reach
mcp: ["claw.start_crawl", "claw.get_crawl_status", "claw.get_crawl_logs", "claw.get_creators", "claw.stop_crawl"]
required_inputs: []
permissions: ["claw:write"]
actions: []
side_effects: write
aliases: ["采集线索","查看采集进度","停止采集"]
in_market: true
employee_quick: 已有采集任务的进度与回执
employee_agent: 核对采集平台、目标与范围，提出采集或取消请求
supports: {"cancel":true,"retry":true,"resume":true}
---
# 采集线索

通过 skill_runtime 发现当前已装配的工具。先明确一个海外平台（YouTube、Instagram 或 Facebook）、模式与目标，缺失时询问用户；不自行扩大范围。

start_crawl 与 stop_crawl 都只提出待确认动作。收到 action_id 后说明等待用户核对，不声称远端已经执行，不重复提议同一动作，不要求用户复制确认编号。执行按钮由平台呈现，模型不能代替用户确认。

采集是持久异步任务。取得真实 task_id 后结束当前等待；后续通过该 task_id 查询状态、日志与结果。没有终态回执不得报告完成；idle 不代表当前任务成功。结果不确定时请用户核对，不自动重新启动。

只读取当前用户有权访问的任务。get_creators 若服务端不支持按 task_id 隔离，停止读取并报告接口限制，不能改为全局读取。采集失败后的新尝试需要重新核对范围；停止任务独立确认。

采集结果是候选线索，不是正式档案。不得调用上传、导入、发信、解密或阶段修改；如需导入，交由独立导入技能及其业务确认入口。
