# 平台工作规划 Agent

**状态：已实现并进入发布验证（2026-09-26）。**

## 归属

`today_plan`、`todo_plan` 与 `today_analyze` 属于平台工作台的只读规划能力，统一由：

```text
agent:workspace-planner
```

执行。它不是 KOL 业务 Agent，也不代表员工端的 KOL 数字员工。

## 已发布契约

| 项目 | 约束 |
|---|---|
| 运行身份 | `agent:workspace-planner` |
| 运行范围 | 当前认证员工拥有的工作区数据 |
| 技能 | `today_plan`、`todo_plan`、`today_analyze` |
| 外部连接器 | 无 |
| MCP 工具 | 无 |
| 外部写入 | 禁止 |
| 正式任务 / 阶段 | 不创建、不修改 |
| 授权要求 | 活动认证身份；不要求 KOL 业务技能授权 |

## 一次性生产迁移

服务启动时，Runtime 创建并审计 `runtime.workspace-planner.v1`：

1. 初始化 `agent:workspace-planner → {today_plan, todo_plan, today_analyze}` 的启用绑定；
2. 将上述随版本发布的内置平台 Skill 初始化为 `published`；
3. 对已存在的绑定和非 `draft` 生命周期状态不覆盖，保留管理员的停用与测试决定；
4. 写入 `runtime.workspace_planner.migrated` 审计事件。

迁移不会配置 Starry、不会审批 MCP 工具、不会赋予 KOL 连接器权限。

## 验证

- 今日/待办规划 API 仍由固定入口锁定对应 Skill；
- Worker 根据 `runtime_agent_id` 从 Skill 声明选择 Agent，不再硬编码 KOL Agent；
- 真实 Worker 协议夹具验证 Planner 的工具目录为空、运行身份正确、可产出 `today_brief`；
- 生产发布后应以认证员工执行一次「今日任务」并查看运行事件是否进入 Codex、产出 `today_brief`。
