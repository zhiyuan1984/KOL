---
id: wecom_ontology_read
title: 企业微信组织本体只读来源
runtime_agent_id: agent:platform-sync
description: 仅通过已配置的企业微信 MCP 读取成功发布的组织、人员同步快照，供公司管理员确认导入独立本体来源快照。
category: 平台治理
profile: lead
output: task_result
mcp: ["wecom-mcp.wecom_get_sync_status", "wecom-mcp.wecom_list_departments", "wecom-mcp.wecom_list_department_users"]
required_inputs: []
context: {"requires":[],"prefers":[]}
permissions: ["wecom:read"]
actions: ["read"]
aliases: ["企微组织来源读取"]
in_market: false
employee_visible: false
side_effects: none
creates_session: false
auto_ok: true
---
# 企业微信组织本体只读来源

仅限平台同步 Agent 使用。读取工具只用于版本固定的部门和人员来源预览；不创建或修改本地组织、人员、成员关系、账号、角色、权限或 Agent 绑定。

## 边界

- 仅允许 `wecom_get_sync_status`、`wecom_list_departments` 和 `wecom_list_department_users` 三个已发现的只读工具。
- 读取到的 `activationStatus` 是外部原始字段，不得推断或写入 HR 在职、离职、账号活跃或权限状态。
- 部门、人员与关系只按公司/来源/外部 ID 引用；不按姓名合并。
