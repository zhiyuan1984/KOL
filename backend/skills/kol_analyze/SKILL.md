---
id: kol_analyze
title: 红人分析简报
description: 只读分析公海或跟进红人，产出 kol_analyze_brief，不发信不改阶段不解密
category: 线索
profile: lead
output: kol_analyze_brief
mcp: ["starrykol.pageKolProfiles", "starrykol.getKolProfileDetail"]
required_inputs: ["kol_uids"]
permissions: ["starrykol:read"]
actions: ["claim_follow", "compose_draft", "confirm_send", "confirm_stage", "open_thread", "release_follow", "handoff", "retry_sync", "none"]
aliases: ["红人分析", "KOL分析"]
in_market: true
employee_summary: 只读分析公海或我跟进的红人，产出分析简报；不发信、不改阶段、不解密
funnel: reach
---
# 红人分析 kol_analyze · Lead

只读思考任务。入口锁定 `task_type=kol_analyze`，禁止从自由文本做意图识别。单次最多 8 人；进行中+排队硬顶 3。产物 `artifact_type=kol_analyze_brief`。

建议动作只允许白名单动词，且不得自行执行：`claim_follow`、`compose_draft`、`confirm_send`、`confirm_stage`、`open_thread`、`release_follow`、`handoff`、`retry_sync`、`none`。领取与释放必须走独立 L3 命令。

## 禁止事项

- 禁止发信。
- 禁止改官方阶段。
- 禁止解密联系方式（禁止 `decryptKolContact`）。
- 禁止从自由文本识别任务意图。
- 禁止把领取瞬间记为有效往来。

## 是否发信

不发信。

## 是否改阶段

不改官方阶段。
