# PostgreSQL-only 运行时依赖审计

**审计日期：** 2026-10-03  
**范围：** KOL 的正式工单、任务中心、执行作业、Outbox/Worker、Cron 调度与其 HTTP 启动路径。  
**目标：** PostgreSQL 是唯一权威库；禁止 SQLite 文件、`PostgresSyncConn` 桥接、运行时 fallback、历史数据迁移窗口或归档依赖进入该子系统。

> 本文是收敛清单，不代表整个历史 KOL 应用已经完成 PostgreSQL-only。所有标为“阻断”的路径在生产切换前必须迁移、移除或明确从正式入口隔离。

正式子系统的环境、启动、tick 与故障边界见 [`POSTGRES_ONLY_OPERATIONS.md`](POSTGRES_ONLY_OPERATIONS.md)。该手册不构成生产切换授权。

## 已原生化并已验证

| 能力 | PostgreSQL 原生实现 | 验证 |
|---|---|---|
| 正式工单创建、编辑、授权列表/详情/时间线 | `ticket-domain/create-ticket.ts`、`edit-ticket.ts`、`read-tickets.ts`、独立 `routers/tickets.ts` | 空库迁移 + PG 集成请求测试 |
| 生命周期与责任 | `ticket-lifecycle.ts`、`assign-ticket.ts`；受理、转办、验收、重开、不可变验收历史 | PG 生命周期集成测试 |
| 执行作业、Outbox、租约、重试 | `execution-jobs/postgres-store.ts`、Worker、Outbox publisher | PG execution-jobs 集成测试 |
| Cron 调度状态与调度运维读模型 | `cron/postgres-store.ts`、`cron/worker.ts`、`routers/cron.ts` | PG Cron 集成测试 |
| Cron 正式工单只读处理器 | `overdue-scan`、`daily-task-snapshot` 直接读取 PostgreSQL formal tickets | PG Cron 处理器集成测试 |
| 个人授权工单原始计数 | `ticket-domain/reports.ts` | PG 创建/报表集成测试 |
| 员工工单详情时间线 | `Tasks.tsx` 只读取 `/tickets/:id/timeline`，不再订阅 legacy `/runs/*` SSE | 前端 typecheck/build/relevant tests |
| 正式工单身份与会话 | `ticket_accounts`、`ticket_auth_sessions`、`ticket-domain/auth.ts`；初始管理员 setup、登录、登出、Cookie 会话；员工 `/tasks` 原生身份门禁 | PG 身份集成测试、前端 typecheck/build |
| 账号—组织人员受控绑定 | 管理员 `GET/POST /admin/work-orders/account-bindings/*`；不可变 `ticket_account_organization_bindings` 审计；治理页只显示明确的可选项 | PG 路由/创建集成测试、前端 typecheck/build |
| PostgreSQL-only HTTP 启动 | `KOL_RUNTIME_MODE=postgres-only` 动态装配 `postgres-only-app.ts`；只挂载 ticket auth、tickets、Cron，旧 `/tasks` 等路由明确 404 | PG-only HTTP 应用集成测试 |
| Cron 授权与风险读取 | `cron/authz.ts`、Cron Worker/handlers 使用 PostgreSQL ticket identity；风险面只查询正式工单 | PG-only HTTP + Cron 集成测试 |

## 已安全隔离或停用

| 项目 | 状态 | 理由与后续动作 |
|---|---|---|
| `ownership-release` Cron | **disabled** + 调用时 `needs_takeover` | 仍依赖协作/邮件域的旧仓储；需先构建 PostgreSQL 协作状态仓储与发布规则。 |
| `mail-memory-increment` Cron | **disabled** + 调用时 `needs_takeover` | 仍依赖旧邮件记忆表；需迁移邮件事实/记忆仓储。 |
| `ai-task` Cron | `needs_takeover` | 不得经由旧任务/会话写入链执行；需明确 PostgreSQL-native run contract 后再发布。 |
| `discovery-search` Cron | disabled | 没有已发布的实时采集规则；禁止伪造运行或写入候选人。 |

## 阻断 PostgreSQL-only 启动的遗留路径

| 优先级 | 路径/模块 | 当前行为 | 收敛动作 |
|---|---|---|---|
| P0（兼容模式） | `backend/src/app.ts` 的 `getConn()`、`seedIfEmpty()`、`reconcileTickets()` 等启动调用 | 历史兼容 HTTP 应用启动即初始化 SQLite-shaped bridge。 | **`KOL_RUNTIME_MODE=postgres-only` 已绕开该入口**；兼容模式只能留作迁移开发，不能作为正式工单/调度生产入口。 |
| P0（兼容模式） | `backend/src/index.ts` 的 `failStuckPlans()`、`failInterruptedTaskRuns()`、邮件/库同步启动调用 | 仅在动态加载的兼容分支进入旧任务/同步仓储。 | PG-only 启动分支不导入也不启动这些服务；未迁移副作用不在正式模式运行。 |
| P0（兼容模式） | `backend/src/routers/tasks.ts` 的 `/tasks`、`/workbench/tasks`、`/runs/*` 与旧任务创建/运行端点 | 同一个 legacy router 仍保留大量 `getConn()` 调用。 | PG-only 模式不装配该 router，旧 `/tasks`/`/workbench/tasks`/`/runs/*` 返回 404；正式入口只使用 `/tickets`。 |
| P0 | `backend/src/auth.ts`、`exam.ts`、`runtime/organization-tree.ts` | 历史应用的登录、权限与组织读取仍走 bridge。 | **正式 `/tickets` 已改用独立 PostgreSQL 身份/会话与受控人员绑定**；仍需将全应用登录与组织读取迁走，未完成前不能宣称全应用 PG-only。 |
| P1 | `routers/work-report.ts` | 管理报表仍读取旧 tickets/event 投影。 | 先只保留个人原始计数；组织报表应在规则、范围、时区与授权口径发布后原生实现。 |
| P1 | `home-today`、`home-board`、`home-discovery` | 首页任务投影和建议仍使用 legacy task/collaboration 数据。 | 迁移为 PostgreSQL ticket read-model；不能以 SQLite 任务投影支撑正式工单界面。 |
| P1 | 协作、邮件、发现、知识、运行时连接器等领域 | 广泛直接使用 `getConn()`。 | 每个领域先定义权威 PostgreSQL schema/repository，再按对外契约迁移；禁止桥接作为长期生产路径。 |

## 迁移边界与强制规则

1. **新代码不准导入** `db.ts`、`postgres/sync.ts`、`SqliteConn`、`getConn()` 或 `txImmediate()`；PostgreSQL 查询使用 `postgresPool()` / `postgresTransaction()` 和 `$n` 参数。
2. 正式工单 `/tickets`、Cron、Outbox 和 execution worker 必须要求 `DATABASE_URL`，不得根据环境回退 SQLite。
3. 未迁移且会产生副作用的作业必须 **disabled** 或返回可审计的 `needs_takeover`；不得静默降级。
4. 数据库 migration 只能新增；不能修改已经记录 checksum 的 migration。
5. 每个收敛阶段至少验证：后端 typecheck、空 PostgreSQL 库 migration、对应 PG integration tests；前端改动还需 typecheck/build/relevant tests。
6. `KOL_RUNTIME_MODE=postgres-only` 仅代表正式工单与调度 HTTP 子系统可作为 PostgreSQL-only 部署；兼容应用仍含旧模块，不能把整个历史 KOL 产品称作已完成 PostgreSQL-only。

## 下一批可执行工作

1. 为 PostgreSQL-only 模式补充发布运行手册、环境变量校验与部署前健康检查；不执行生产切换，待明确批准。
2. 在兼容界面与 PostgreSQL-only 登录域之间完成全应用的明确切换；其余历史页面不能暗中复用两套会话。
3. 迁移个人任务/首页 read-model；旧 `/tasks`/`/workbench/tasks` 在 PG-only 部署模式下已 retired。
4. 在正式工单与正式协作状态均已原生化后，重建 `ownership-release` 和邮件记忆作业，走规则 draft/simulate/publish 闸门。
