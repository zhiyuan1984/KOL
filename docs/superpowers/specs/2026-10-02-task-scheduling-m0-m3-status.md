# 任务调度 M0–M3 实施登记

- 设计依据：`2026-10-02-task-scheduling-product-technical-design.md`
- M0–M3 首批合并：`c4d4b2a`（`main`）
- PostgreSQL/BullMQ 实施分支：`manus/postgres-bullmq-migration`
- 基线：`a8eaaba`；M2 数据与执行架构于 2026-10-02 增补
- 当前运行模式：**PostgreSQL 为唯一权威持久层 + 事务 Outbox + Redis/BullMQ 多 Worker**。独立执行 Worker 在没有 `DATABASE_URL` 时拒绝启动；SQLite 仅保留在隔离单元测试夹具中，运维读模型显式标记为 `sqlite_test_fixture_only`。

## CONST-08 审查记录

| 需求 | 主责角色 | 宪法/基本法依据 | 实施结论与证据 | 当前边界 |
|---|---|---|---|---|
| 今日任务是“我的待办”的子集 | 平台/后端 | 服务端裁决、单一任务真相 | `/api/workbench/tasks` 先限定正式开放待办，再计算今日成员；稳定游标不会因非今日行漏页。 | 今日成员规则尚未迁入版本化 `BusinessRule`。 |
| 计划读取与启动使用统一入口 | 平台/后端 | 真实状态、禁止 UI 伪造 | `/api/workbench/plan` 与 `/api/workbench/plan-runs` 共用 canonical plan 指针；`deterministic_organize` 与 `agent_plan` 均写入同一持久 Job 回执，`calls_model` 与 producer 一致。 | 计划快照暂复用不可变 `task_artifacts`/指针，尚未拆出独立 `work_plan_snapshots` 表。 |
| 所有既有数据库数据迁至 PostgreSQL | 架构/后端 | TECH-ARCH-01、TECH-BE-03/04/09 | `db:migrate:postgres` 动态读取 SQLite 的全部应用表、字段、索引、外键和行，复制后按每表排序内容计算 SHA-256 指纹；空白验收源验证 **88 表 / 13 行 / 全表指纹一致**。 | 生产切换须先停止 SQLite 写入，再执行迁移与 `db:verify:postgres`；工具拒绝覆盖非空 PostgreSQL 目标，除非显式 `--replace`（仅限可丢弃验证库）。 |
| 长运行迁出 API 并支持多 Worker | 架构/后端 | TECH-BE-03/04 | PostgreSQL `execution_jobs + execution_outbox` 事务落库；发布器用 `FOR UPDATE SKIP LOCKED` 领取 Outbox，BullMQ 消息只派发，Worker 再以权威 Job 状态领取防重；`cron.run`、`work_plan.run`、`today_analyze.run` 均经统一 Dispatcher 执行。 | 采集、摘要等其余长运行仍需逐项迁移。 |
| 运行成功与工单验收分离 | 产品/后端 | 状态语义可解释、证据优先 | `task_runs` 保存运行，`POST /api/tickets/:id/commands` 的 `complete` 必须携带验收证据，并写 `task.accepted`。 | 当前命令仅实现 `complete`、`cancel`；未实现派单/转派/SLA。 |
| 管理界面不伪造运维能力 | 平台/管理员 | 管理读模型必须读权威记录 | `/admin/scheduling` 读取 Job、Outbox 积压和 Worker 心跳；失败的 low-risk Job 可由管理员显式重新投递，重投递与审计/Outbox 原子写入。 | 高风险及 `uncertain` 仍只可人工接管，不提供盲重试。 |

## M0/M1 产品和读模型（已实施）

1. 正式任务仍以 `tickets` 为单一工单实体；`task_runs`、`task_events`、`task_artifacts` 只记录运行、过程和产物。
2. `/api/workbench/tasks?view=today|todo&cursor=&limit=` 输出 `ticket_id`、`source_ref`、`membership_reason`、`request_id`、`as_of`；Today 维持 `Today ⊆ Todo`。
3. `/api/workbench/plan`、`/api/workbench/plan-runs` 已统一读取和启动入口；旧 scope 路由仍保留兼容。
4. Ticket、Run、Timeline、Summary 读模型及带版本/幂等键的 `complete`/`cancel` 工单命令已落地。

## M2 PostgreSQL 数据切换与多 Worker（已实施）

### 数据库迁移

- `backend/scripts/migrate-sqlite-to-postgres.ts`：`npm run db:migrate:postgres -- --source /absolute/path/lingong.db`。
- 迁移器从真实 SQLite 元数据构造 PostgreSQL 表、主键、唯一/普通/部分索引、外键以及不可变 `business_events` / `stage_transitions` 触发器；随后批量复制所有行并校验表级 SHA-256 指纹。
- `npm run db:verify:postgres -- --source …` 只读比较 SQLite 快照与 PostgreSQL 当前真相；运行后目标库若有新写入会如实失败，而不会把不一致伪报为成功。
- `DATABASE_URL` 启用 PostgreSQL 同步仓储桥：现有同步仓储调用仍走同一契约，桥接层转换参数、`IFNULL`、`json_extract`、SQLite 冲突语义及 `BEGIN IMMEDIATE` 到 PostgreSQL。Schema 缺失时 API/Worker 明确拒绝启动，不会回退写 SQLite。

### 作业与队列

1. `execution_jobs` / `execution_outbox` 仍在同一 PostgreSQL 事务写入，包含幂等键、租约、尝试、风险、回执、错误及作业关联。
2. `backend/src/queue/outbox-publisher.ts` 使用 `FOR UPDATE SKIP LOCKED` 领取 Outbox，成功投递 BullMQ 后才将投递账本置为 `published`；Redis 停用时已接受的作业保留在 PostgreSQL 并转为可重试投递。
3. `backend/src/queue/execution-worker.ts` 使用 BullMQ 多消费者，并在业务执行前再次原子领取 `execution_jobs`；重复消息只返回 duplicate，不会重复执行 Cron handler。
4. Worker 的心跳写入 `execution_worker_heartbeats`；租约恢复沿用低/中风险受控重试、高风险 `uncertain` 的语义。
5. `npm run worker:outbox` 运行发布器，`npm run worker:execution` 在 PostgreSQL 模式下运行 BullMQ Worker；`docker-compose.yml` 提供 PostgreSQL、Redis、API、发布器和 Worker 服务。
6. `work_plan.run` / `today_analyze.run` 在 API 事务中同时写入 session、ticket、task_run、不可变 `run.queued` 事件、execution job 与 Outbox；API 只返回 `202 queued`，绝不在请求线程调用模型。

## M3 工单、运行、时间线读模型（已实施）

| 接口 | 行为 |
|---|---|
| `GET /api/tickets` | 当前用户授权范围的 cursor 分页工单列表；支持 `status`、`kind`、`object_ref`。 |
| `GET /api/tickets/:id` | 工单详情、最新运行、规则摘要、`missing_fields`、`allowed_actions`、来源引用。 |
| `GET /api/tickets/:id/summary` | 规则生成的快速摘要；不调用模型，输出来源指纹和证据引用。 |
| `GET /api/tickets/:id/timeline` | 单调 `task_events.sequence` 时间线，并把关联业务事实作为独立引用返回。 |
| `GET /api/runs/:id`、`GET /api/runs/:id/events` | 运行及事件流；读取前校验工单归属。 |
| `POST /api/tickets/:id/commands` | 带 `expected_version` 和 `Idempotency-Key` 的 `complete`/`cancel`；完成必须有验收证据。 |
| `GET /api/workbench/plan` | 返回计划 artifact 快照、producer、来源 revision、生成时间及 `stale_reason`；源集合变化时保留上次可用计划并明确标过期。 |
| `/admin/scheduling` | Job 状态、Outbox 积压、Worker 心跳和 failed low-risk Job 的显式重新投递；不对高风险/不确定作业伪造恢复能力。 |

## 明确未实施（不得当作完成）

- PostgreSQL Row-Level Security、租户级 policy、备份演练和生产密钥/连接池参数；当前权限仍由应用层先过滤。
- `ScheduleSpec`/`ScheduleRun`、`BusinessRule`/`ProjectionSnapshot` 的独立正式模型和规则发布回放。
- 采集、任务摘要等其余长运行注册为 BullMQ handler；规划和今日对象分析已迁离 API 进程，但不能据此声称全部业务执行路径均已迁离。
- DLQ 可视化、跨类型全局并发配额（尤其 MediaCrawler=1）、完整 SSE 续接、接管/补跑/案例处置 UI。
- 派单/转派、SLA、升级与业务规则审批发布；规则空白仍保持自动决策关闭。

## 验收证据（本批）

| 检查 | 结果 |
|---|---|
| `backend npm run typecheck` | 通过 |
| `backend tests/postgres-sync.test.ts` | 3/3 通过 |
| SQLite → PostgreSQL 迁移 | 88 表 / 13 行，逐表 SHA-256 指纹一致 |
| PostgreSQL 同步仓储桥 | PostgreSQL 查询、串行事务写入、读取均通过 |
| PostgreSQL Outbox → Redis/BullMQ → Cron Worker | 1 个 Cron 作业从 queued 到 succeeded；Outbox=published；2 个 Worker Heartbeat=running |
| SQLite 兼容回归 | `execution-jobs`、`cron-jobs`、`ticket-api` 共 24/24 通过 |
| `git diff --check` | 待本分支最终复核 |
