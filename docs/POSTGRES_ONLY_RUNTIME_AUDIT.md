# PostgreSQL-only 运行时依赖审计

**审计日期：** 2026-10-03  
**范围：** KOL 的正式工单、任务中心、执行作业、Outbox/Worker、Cron 调度与其 HTTP 启动路径。  
**目标：** PostgreSQL 是唯一权威库；禁止 SQLite 文件、`PostgresSyncConn` 桥接、运行时 fallback、历史数据迁移窗口或归档依赖进入该子系统。

> 本文是收敛清单，不代表整个历史 KOL 应用已经完成 PostgreSQL-only。所有标为“阻断”的路径在生产切换前必须迁移、移除或明确从正式入口隔离。

正式子系统的环境、启动、tick 与故障边界见 [`POSTGRES_ONLY_OPERATIONS.md`](POSTGRES_ONLY_OPERATIONS.md)。该手册不构成生产切换授权。

## 已原生化并已验证

| 能力 | PostgreSQL 原生实现 | 验证 |
|---|---|---|
| 正式工单创建、编辑、授权列表/详情/时间线 | `ticket-domain/create-ticket.ts`、`edit-ticket.ts`、`read-tickets.ts`、独立 `routers/tickets.ts`；员工详情展示责任、依据、事件、组织/工单版本、验收、运行回执与审计索引 | 空库迁移 + PG 集成请求测试、前端 typecheck/build |
| 生命周期与责任 | PostgreSQL `ticket-lifecycle.ts`、`assign-ticket.ts`；受理、转办、验收、重开、不可变验收历史。SQLite-shaped 实现已拆至 `ticket-lifecycle-legacy.ts`，不被 PostgreSQL-only HTTP 导入 | PG 生命周期集成测试、原生静态导入审计 |
| 协同受理 | `collaborate-ticket.ts`；一个主受理人加多名协同受理人，协同人取得授权可见性但不取得受理/验收权 | PG 创建/命令路由集成测试、前端 typecheck/build |
| 执行作业、Outbox、租约、重试 | `execution-jobs/contracts.ts`、`postgres-store.ts`、Worker、Outbox publisher；正式 Worker 直接要求 PostgreSQL `DATABASE_URL`，原生模块不再导入 SQLite-shaped 仓储或配置 | PG execution-jobs 集成测试、原生静态导入审计 |
| Cron 调度状态与调度运维读模型 | `cron/postgres-store.ts`、`cron/worker.ts`、`routers/cron.ts` | PG Cron 集成测试 |
| Cron 正式工单只读处理器 | `overdue-scan`、`daily-task-snapshot` 直接读取 PostgreSQL formal tickets | PG Cron 处理器集成测试 |
| 个人授权工单原始计数 | `ticket-domain/reports.ts` | PG 创建/报表集成测试 |
| 组织授权工单原始计数 | `ticket-domain/reports.ts`；范围仅由绑定组织负责人或已绑定公司管理员派生 | PG 创建/报表路由集成测试、前端 typecheck/build |
| 组织分类与阶段原始存量 | `ticket-domain/reports.ts`；复用组织负责人/公司管理员范围，只输出分类、阶段与状态当前数量；治理页与有范围授权的员工任务中心均可见摘要 | PG 创建/报表路由集成测试、前端 typecheck/build |
| 员工工单详情时间线 | `Tasks.tsx` 只读取 `/tickets/:id/timeline`，不再订阅 legacy `/runs/*` SSE | 前端 typecheck/build/relevant tests |
| 正式工单身份 | 现有工作台会话是唯一浏览器登录；`ticket-domain/auth.ts` 将服务端已认证的主体映射为 PostgreSQL principal，记录 `workbench_principal_bindings` 与不可变绑定事件；已移除工单账号、密码、Cookie 与首次管理员页面 | PG 工作台主体映射集成测试、前端 typecheck/build |
| 工作台主体—组织人员受控绑定 | 管理员 `GET/POST /admin/work-orders/account-bindings/*`；仅可选择已进入工作台并同步的主体，变更保留不可变 `ticket_account_organization_bindings` 审计 | PG 路由/创建集成测试、前端 typecheck/build |
| PostgreSQL-only HTTP 启动 | `KOL_RUNTIME_MODE=postgres-only` 不再提供独立工单登录；在共享工作台身份提供方尚未原生化前，浏览器正式路由明确返回 `workbench_identity_provider_required`，不会回退或偷建密码页 | PG-only HTTP 应用集成测试 |
| 空库 baseline 兼容 | 兼容 PostgreSQL 16 执行由 PostgreSQL 18 `pg_dump` 生成的 baseline；原生工单/作业/Cron 读取归一 bigint 与 JSON 文本/JSONB 形态 | 空 PostgreSQL 16 migration + 7 个原生集成文件、14 tests |
| Cron 授权与风险读取 | `cron/authz.ts`、Cron Worker/handlers 使用 PostgreSQL ticket identity；风险面只查询正式工单 | PG-only HTTP + Cron 集成测试 |
| 规则草稿、模拟与发布治理 | `rule-governance.ts`、规则模拟/审计/回执表；管理员才可草稿、模拟、发布、停用或从历史版本恢复为新草稿 | PG 规则治理集成测试、前端 typecheck/build |
| 首批业务事件→规则评估 | `ticket_business_events`、`event-rule-evaluation.ts`；只接收已核验邮件/期限/风险/审批资料缺失事件，评估已发布且显式绑定的人工确认规则；授权员工可在关联工单详情/时间线读取安全摘要与证据引用 | PG 规则治理集成测试、前端 typecheck/build |
| 规则成效与人工确认原始计数 | `rule-effectiveness.ts`、不可变 `ticket_rule_confirmation_decisions`；按规则版本汇总评估、事件、关联工单、确认与驳回，确认事实本身不触发执行 | PG 规则治理集成测试、前端 typecheck/build |
| Task → AI Work Order 原生模型 | `task-work-orders.ts`；新 Task 根复用 PostgreSQL `tickets(task_type=business_task, profile=task-root)`，`work_orders`/模板/责任/依据/决定/阶段事件是明确子关系；父 Task 不会因工单或运行完成而完成 | 空库 migration + PG Task/Work Order 聚合集成测试 |
| Jev AI 工单影子判断 | `work-order-jev.ts`、`work-order-shadow.ts`；仅对已发布模板做 TypeSafe System One 有界选择，写不可变 `work_order_decisions(decision_mode=shadow)` 与输入哈希/模型/概率/gate，端点仅管理员可触发 | PG 集成测试验证高置信命中、重放与零建单/分派/阶段/完成副作用 |
| AI 工单模板发布治理 | `work-order-template-governance.ts`、`/admin/work-orders/templates/*`；草稿、发布、发布版本退役、停用和命令回执都在 PostgreSQL，A1/A2/A3 发布校验事件/验收/路由/阶段边界；管理端明确显示自动执行未启用 | PG 模板治理集成测试、前端 typecheck/build |
| A1/A2 受控物化与发布开关 | `work-order-automation-release.ts`、`work-order-executor.ts`；模板发布之外仍需可审计 release，阈值、`task_owner` 唯一路由、幂等与 Task 状态共同闸门通过后，才在一个事务写子工单、主受理、阶段事实、物化尝试和 `work_order.materialized` Outbox；任务不会被完成 | PG 集成测试覆盖无 release 跳过、启用后创建、重放去重、分派、Outbox 与 Task 状态不变；前端 typecheck/build |

## 已安全隔离或停用

| 项目 | 状态 | 理由与后续动作 |
|---|---|---|
| `ownership-release` Cron | **disabled** + 调用时 `needs_takeover` | 仍依赖协作/邮件域的旧仓储；需先构建 PostgreSQL 协作状态仓储与发布规则。 |
| `mail-memory-increment` Cron | **disabled** + 调用时 `needs_takeover` | 仍依赖旧邮件记忆表；需迁移邮件事实/记忆仓储。 |
| `ai-task` Cron | `needs_takeover` | 不得经由旧任务/会话写入链执行；需明确 PostgreSQL-native run contract 后再发布。 |
| `discovery-search` Cron | disabled | 没有已发布的实时采集规则；禁止伪造运行或写入候选人。 |
| `work_plan.run`、`today_analyze.run` 执行作业 | `needs_takeover` + `uncertain` 终态 | PostgreSQL Worker 分发器不再静态导入旧今日计划处理器；收到此类已领取作业会明确隔离且禁止重试，待建立 PostgreSQL-native task-run/artifact contract 后再发布。 |

## 阻断 PostgreSQL-only 启动的遗留路径

| 优先级 | 路径/模块 | 当前行为 | 收敛动作 |
|---|---|---|---|
| P0（兼容模式） | `backend/src/app.ts` 的 `getConn()`、`seedIfEmpty()`、`reconcileTickets()` 等启动调用 | 历史兼容 HTTP 应用启动即初始化 SQLite-shaped bridge；同时它是当前唯一的工作台登录提供方。 | 正式工单/调度业务事实仍只写 PostgreSQL，但浏览器认证暂由已登录工作台会话承载。共享身份提供方完成 PostgreSQL 原生化前，不启用浏览器 PostgreSQL-only 模式。 |
| P0（兼容模式） | `backend/src/index.ts` 的 `failStuckPlans()`、`failInterruptedTaskRuns()`、邮件/库同步启动调用 | 仅在动态加载的兼容分支进入旧任务/同步仓储。 | PG-only 启动分支不导入也不启动这些服务；未迁移副作用不在正式模式运行。 |
| P0（兼容模式） | `backend/src/routers/tasks.ts` 的 `/tasks`、`/workbench/tasks`、`/runs/*` 与旧任务创建/运行端点 | 同一个 legacy router 仍保留大量 `getConn()` 调用。 | PG-only 模式不装配该 router，旧 `/tasks`/`/workbench/tasks`/`/runs/*` 返回 404；正式入口只使用 `/tickets`。 |
| P0 | `backend/src/auth.ts`、`exam.ts`、`runtime/organization-tree.ts` | 历史应用的登录、权限与组织读取仍走 bridge。 | 正式 `/tickets`、Cron 与治理端点复用已认证的工作台会话，并将主体/组织权限事实写入 PostgreSQL；仍需将**同一套工作台登录**与组织读取迁走，未完成前不能启用独立浏览器 PostgreSQL-only 模式或宣称全应用 PG-only。 |
| P1 | `routers/work-report.ts` | 管理报表仍读取旧 tickets/event 投影。 | 先只保留个人原始计数；组织报表应在规则、范围、时区与授权口径发布后原生实现。 |
| P1 | `home-today`、`home-board`、`home-discovery` | 首页任务投影和建议仍使用 legacy task/collaboration 数据。 | PostgreSQL-only 前端已将 `/` 入口重定向到正式 `/tasks`，不再加载旧首页作为隐式回退；后续可按独立 PostgreSQL read-model 重建首页。 |
| P1 | 协作、邮件、发现、知识、运行时连接器等领域 | 广泛直接使用 `getConn()`。 | 每个领域先定义权威 PostgreSQL schema/repository，再按对外契约迁移；禁止桥接作为长期生产路径。 |

## 迁移边界与强制规则

1. **新代码不准导入** `db.ts`、`postgres/sync.ts`、`SqliteConn`、`getConn()` 或 `txImmediate()`；PostgreSQL 查询使用 `postgresPool()` / `postgresTransaction()` 和 `$n` 参数。
2. 正式工单 `/tickets`、Cron、Outbox 和 execution worker 必须要求 `DATABASE_URL`，不得根据环境回退 SQLite。
3. 未迁移且会产生副作用的作业必须 **disabled** 或返回可审计的 `needs_takeover`；不得静默降级。
4. 数据库 migration 只能新增；不能修改已经记录 checksum 的 migration。
5. 每个收敛阶段至少验证：后端 typecheck、空 PostgreSQL 库 migration、对应 PG integration tests；前端改动还需 typecheck/build/relevant tests。
6. `KOL_RUNTIME_MODE=postgres-only` 在共享工作台身份提供方原生化前，仅适用于受信任的内部 tick/worker 场景；浏览器请求会明确拒绝，绝不展示或恢复独立工单登录。兼容应用仍含旧模块，不能把整个历史 KOL 产品称作已完成 PostgreSQL-only。

## 下一批可执行工作

1. 将**现有工作台**认证与组织读取统一迁移到 PostgreSQL 身份提供方，保持同一登录 UI、会话名和账号语义；不得再新建工单账号域。
2. 将已完成的 PostgreSQL Task → Work Order 只读聚合投影到今日任务、我的待办、任务中心和工作战报，保持 Task 顶层语义。
3. 将已实现的模板 release 与 A1/A2 确定性物化器接到已核验业务事件 → Jev decision → execution job 的异步管道；当前只允许管理员受控 materialization，不宣称生产事件会自动建单。
4. 在正式工单与正式协作状态均已原生化后，重建 `ownership-release` 和邮件记忆作业，走已实现的规则 draft/simulate/publish 闸门。
5. 仅在事件、组织、置信度、路由和人工边界闸门全部满足后，按公司/规则/模板 feature flag 渐进启用 AI 工单自动化。
