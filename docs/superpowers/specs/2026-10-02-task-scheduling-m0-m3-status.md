# 任务调度 M0–M3 实施登记

- 设计依据：`2026-10-02-task-scheduling-product-technical-design.md`
- 实施分支：`manus/task-scheduling-m1`
- 基线：`a8eaaba`
- 登记日期：2026-10-02
- 当前执行模式：**SQLite 单 Worker 过渡实现**；不是 PostgreSQL + Redis/BullMQ 多 Worker 的生产结论。

## CONST-08 审查记录

| 需求 | 主责角色 | 宪法/基本法原则 | 已落地证据 | 当前边界 |
|---|---|---|---|---|
| 今日任务是“我的待办”的子集 | 平台/后端 | 服务端裁决、单一任务真相 | `GET /api/workbench/tasks` 先限定正式开放待办，再计算今日成员；游标以最后**发出**的工单为准，不会因中间非今日行遗漏后页。 | 今日成员规则仍是服务端代码，尚未迁入版本化 `BusinessRule`。 |
| 计划读取与启动使用统一入口 | 平台/后端 | 真实状态、禁止 UI 伪造 | `/api/workbench/plan` 与 `/api/workbench/plan-runs` 使用同一 canonical plan 指针；确定性整理明确返回 `calls_model:false`。 | 真实 `agent_plan` producer 尚未启用。 |
| 作业可恢复且不因进程重启丢失 | 平台/后端 | 持久状态、幂等、租约 | `execution_jobs` 与 `execution_outbox` 在同一 SQLite 事务写入；具备幂等键、领取租约、最大尝试数、过期恢复、高风险不盲重试而进入 `uncertain`。 | 仅 SQLite 单 Worker；未完成 PostgreSQL `SKIP LOCKED`、Redis/BullMQ publisher、DLQ。 |
| 运行成功与工单验收分离 | 产品/后端 | 状态语义可解释、证据优先 | `task_runs` 继续保存运行，`POST /api/tickets/:id/commands` 的 `complete` 必须携带验收证据，并写 `task.accepted`。 | 当前命令仅实现 `complete`、`cancel`；未实现派单/转派/SLA。 |
| 管理界面不伪造运维能力 | 平台/管理员 | 管理读模型必须读权威记录 | `/api/admin/scheduling/execution-jobs` 直接读 `execution_jobs`、`execution_outbox`，明确返回 `execution_mode: sqlite_single_worker_transition`。 | 尚未添加完整 ScheduleSpec/Worker Heartbeat/案例处置 UI。 |

## M0 基线与 M1 加固

1. 主任务实体仍是 SQLite `tickets`；运行、事件、产物仍是 `task_runs`、`task_events`、`task_artifacts`，没有创建第二张工单主表。
2. `/api/workbench/tasks?view=today|todo&cursor=&limit=` 输出 `ticket_id`、`source_ref`、`membership_reason`、`request_id`、`as_of`；今日页稳定分页并维持 `Today ⊆ Todo`。
3. 首页 Today/Todo 消费服务端 `plan_view`，前端只保留兼容性回退，不再裁决互斥范围。
4. `/api/workbench/plan`、`/api/workbench/plan-runs` 将读取和启动收敛到统一入口；旧 scope 路由仍保留兼容。

## M2 过渡执行链（已实施）

1. 新增 `execution_jobs`、`execution_outbox` 与索引：一次入队在同一 SQLite 事务记录作业和待投递事实。
2. 作业契约已保存 `job_type`、租户/执行者/对象引用、规则及版本、风险级别、幂等键、作用域快照、优先级、尝试与租约、回执和错误摘要。
3. `cron_runs` 创建后同时创建 `cron.run` 持久作业；Cron 的触发路径先领取该作业，再把 `cron_runs` 置为 `running` 并执行 handler。
4. 新增 `npm run worker:execution` 入口，轮询领取 `cron.run` 并在启动时恢复过期租约。当前 HTTP `run now`/内部 tick 仍调用相同领取契约作同步过渡，以维持既有路由兼容；这不等同于生产中已把所有长任务移出 API 进程。
5. 高风险租约超时进入 `uncertain`，不会自动重试；低/中风险只在剩余尝试次数内进入 `retrying`。

## M3 工单、运行、时间线读模型（已实施）

| 接口 | 行为 |
|---|---|
| `GET /api/tickets` | 当前用户授权范围的 cursor 分页工单列表；支持 `status`、`kind`、`object_ref`。 |
| `GET /api/tickets/:id` | 工单详情、最新运行、规则摘要、`missing_fields`、`allowed_actions`、来源引用。 |
| `GET /api/tickets/:id/summary` | 规则生成的快速摘要；不调用模型，输出来源指纹和证据引用。 |
| `GET /api/tickets/:id/timeline` | 单调 `task_events.sequence` 的工单时间线，并把关联业务事实作为独立引用返回，避免把业务事实冒充为运行进度。 |
| `GET /api/runs/:id`、`GET /api/runs/:id/events` | 运行及其事件流；读取前校验工单归属。 |
| `POST /api/tickets/:id/commands` | 带 `expected_version` 和 `Idempotency-Key` 的 `complete`/`cancel`；完成必须有验收证据，重复投递只返回原回执。 |

前端 API 客户端已公开上述目标接口及 `adminExecutionJobs`；现有任务中心尚保持兼容 `/api/tasks` 消费，尚未重做为正式 Ticket 工作台。

## M4 管理读模型（部分实施）

- `GET /api/admin/scheduling/execution-jobs`：管理员读取 Job 状态、Outbox 聚合、时间戳与过渡模式，不会启动作业或制造假指标。
- Cron 页面继续显示既有计划与 Run；完整的治理控制台、Worker Heartbeat、失败案例处置、补跑、依赖图和静默告警仍未实现。

## 明确未实施（不得当作完成）

- PostgreSQL + Row-Level Security、`ScheduleSpec`/`ScheduleRun`、`BusinessRule`/`ProjectionSnapshot` 的正式数据迁移。
- Redis/BullMQ、独立 Outbox publisher、DLQ、跨进程全局并发额度及多 Worker `SKIP LOCKED` 领取。
- 所有长任务（特别是今日计划、模型调用、采集）迁离 API 进程；本批仅将 Cron 接入过渡执行链。
- 规则审批发布、版本回放、节假日/时区策略、补跑策略和审计案件 UI。
- `POST /tickets/:id/runs` 正式启动、派单/转派、依赖、SLA、升级、升级批准与完整管理员操作台。

## 验收证据（本批）

| 检查 | 结果 |
|---|---|
| `backend npm run typecheck` | 通过 |
| `frontend npm run typecheck` | 通过 |
| `backend npx vitest run tests/execution-jobs.test.ts` | 3/3 通过 |
| `backend npx vitest run tests/ticket-api.test.ts` | 3/3 通过 |
| `backend npx vitest run tests/cron-jobs.test.ts` | 18/18 通过 |
| `git diff --check` | 通过 |
