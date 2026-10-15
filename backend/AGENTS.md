# 后端开发执行入口

本文件适用于 `backend/` 及其子目录；先继承仓库根 [`../AGENTS.md`](../AGENTS.md)，不替代宪法、技术基本法或业务规则。

## 开工与路由

1. 读取根入口、[`../docs/CONSTITUTION.md`](../docs/CONSTITUTION.md) 和 [`../docs/TECHNOLOGY.md`](../docs/TECHNOLOGY.md)。
2. 按 [`../docs/governance/development-execution.md`](../docs/governance/development-execution.md) 同时提交用户意图与改动路径运行 preflight，并将真实生成的 loading bundle 交给实现入口。
3. **纯后端且与 UI/异步/文档无关的改动**只会加载 `governed-task-routing`，不会被迫加载整套 UI 技能。涉及 worker、队列、outbox、作业意图、知识路径或用户报告的等待问题时，必须遵守 task contract 追加的异步、状态和证据要求。

## 后端职责与边界

- **后端专家**决定事务、持久状态、并发、幂等、执行事实、进度持久化、恢复和不确定结果；**前端**仅投影后端允许的状态与动作；**UI/UX**决定用户可见反馈。不要让浏览器猜测入队、完成或审批事实。
- 知识路径 `frontend/src/admin/knowledge/**` 或 `backend/src/knowledge/**` 必须同时加载 UI、异步作业与文档保真相关技能，交付 `state-and-action-map`、`async-contract`、`preview-contract` 等适用产物。
- 数值进度只来自真实完成量；心跳、最后读取时间和业务进展分开。失败、取消、重试与 `uncertain` 只在服务端真实支持且授权时暴露。

## 完成前

使用 verify CLI 校验 task contract、产物、测试报告和源哈希。缺失、失败、`skipped`、`pending` 或 source hash 变化均阻止验证通过。浏览器/人工复核必须由具名人员提交记录；脚本不能代替该复核。
