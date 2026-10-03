# 任务与调度子系统：差距审计与执行计划

**审计时间：** 2026-10-03  
**设计依据：** `2026-10-02-task-scheduling-product-technical-design.md`  
**审计基线：** `main@622f1656bf2eeb1bdd86ffc1ecda1cf8cea04e02`  
**审计范围：** 产品、接口、信息架构、员工与管理端 UI、PostgreSQL/BullMQ 执行链、规则治理、权限与运维。  
**审计方式：** 六个独立领域并行代码审计，所有结论以当前仓库实现、测试和详细设计为证据。

> **结论：** 当前系统是具备 M0/M1/M3 基础能力的受控试点，而不是已经闭环的任务与调度子系统。不得将 `scheduling_rules` 登记表视为已发布业务规则、将运行成功视为工单验收完成，或将 `owner_user_id` 视为责任分配关系。

## 1. CONST-08 审查

| 需求 | 主责角色 | 依据 | 结论 | 证据与下一步 |
|---|---|---|---|---|
| 修复工单终态可绕过、生命周期事件可改写 | 后端专家 | CONST-03/05/06/10；TECH-BE-02/03/04；PROD-AGENT-08 | **符合，可立即实施** | 不改变业务规则，只统一技术闸门、事务与不可变性。P0 立即执行。 |
| 多租户/范围隔离、Worker 领取后复核 | 后端专家 | CONST-05/06；TECH-BE-01/03/04；组织权限细则 | **符合，可立即实施** | 需要数据迁移与范围回填，不等同业务规则发布。 |
| 正式创建、责任分配、依据和验收闭环 | 后端专家 + KOL 业务专家 | BIZ-16；PROD-AGENT-08；设计 §1.2/§4.3 | **部分可实施；部分规则空白** | 可先建字段、关系、审计和 fail-closed 闸门；自动派单、验收规则仍待发布。 |
| 自动派单、SLA、逾期升级、自动建案 | KOL 业务专家 | CONST-04/05；BIZ-16；设计 §5.3/§6 | **规则空白，保持关闭** | 等待可分配主体、时区、阈值、升级对象、处置权和规则版本。 |
| 规则发布/回滚、案件裁决、接管职责 | 产品经理 + KOL 业务专家 | CONST-04/05/10；PROD-PLAT-03/05 | **规则空白** | 技术侧可先交付草案、模拟、审计与人工接管工作流。 |

## 2. 已实现基线

| 领域 | 已实现且应保留的基线 |
|---|---|
| 工单与运行 | `tickets` 是正式工单真相源；`task_runs`、`task_events`、`task_artifacts` 分别保存运行、过程和产物。 |
| 今日/待办 | 服务端 `GET /api/workbench/tasks` 维持 `Today ⊆ Todo`、稳定游标、`membership_reason` 与来源字段。 |
| 读取与命令 | Ticket、Run、Timeline、Summary 读取骨架；正式 `complete/cancel` 已有版本与幂等基础。 |
| 持久执行 | PostgreSQL `execution_jobs + execution_outbox` 同事务入库，Outbox 发布 BullMQ，Worker 原子领取，Cron/手动执行统一进入作业脊柱。 |
| 运维基础 | Worker 心跳、Outbox/积压/Job 管理读模型，低风险失败 Job 可显式重投。 |
| 员工与管理页面 | Home 的统一投影与计划入口、Cron 页面、管理概览/调度监控/审计事件检索均已接入真实读取，而非占位。 |

## 3. 实施差距总览

### 3.1 必须优先修复的技术缺口

| 优先级 | 差距 | 影响 | 设计依据 | 处理阶段 |
|---|---|---|---|---|
| P0 | 遗留 `/api/tasks/:id/complete` 可绕过验收证据、版本和幂等，且可同时终结运行与工单 | 运行成功与工单验收语义被破坏 | §1.3、§4.3、§5.2 | 阶段 0 |
| P0 | `task_events` 同时承载生命周期与可更新 trace，生命周期事实可被 upsert 覆盖 | 审计链不可回放 | §1.3、§5.2 | 阶段 0 |
| P0 | Outbox `publishing` 无租约回收，Worker lease 无续约，重试不保证重新派发 | 静默漏执行或重复执行 | §5.1、M2 | 阶段 3 |
| P0 | 无 RLS/租户/组织/品牌/区域强制范围，Worker 领取后不复核当前权限/规则状态 | 跨范围读取或撤权后继续执行 | §4.1、§5.1、TECH-BE-01 | 阶段 1 |
| P0 | Home 和 `/tasks` 未消费游标；任务超过默认窗口会静默漏项 | 今日/待办和任务中心不完整 | §2.2、M1 验收 | 阶段 4 |
| P1 | 正式 Ticket 创建、候选采纳、责任历史、依据链、结构化验收条件/证据未闭环 | 无法追溯“为何创建、谁负责、按何证据验收” | §1.2、§1.4、§4.3 | 阶段 2 |
| P1 | 缺 SSE `after` 续接、run cancel/retry、管理员 takeover | 长运行恢复与 trace 不完整 | §4.3/§4.4 | 阶段 4、6 |
| P1 | 任务摘要未有独立 `task_summaries`、来源指纹、失败保留旧版 | 摘要新鲜度和证据不可靠 | §5.2 | 阶段 5 |
| P1 | 调度缺 RunDetail/Trace、案件详情/笔记/裁决/导出 | 管理端无法完成调查和受控处置 | §3.3、§4.4 | 阶段 6 |
| P1 | MediaCrawler、摘要、发现等长运行未全部迁入统一 Job handler；无 DLQ/按类型容量 | API 内存路径与队列争抢资源 | §5.1、M2 | 阶段 3 |
| P1 | PostgreSQL 备份恢复演练、连接池容量与生产负载签署缺失 | 无法证明可恢复、可扩展 | §6 M0、TECH-BE-09 | 阶段 8 |

### 3.2 依赖业务规则、不得擅自启用的能力

| 能力 | 当前状态 | 所需业务发布 |
|---|---|---|
| Today 最终成员 | 服务器兼容谓词 `task-workbench.v1` | 成员并集、时区、无期限、逾期和优先级细则。 |
| 自动派单/转派 | 关闭 | 可分配人员/团队、对象责任、例外、人工队列和权限。 |
| SLA/升级/自动建案 | 关闭 | 阈值、时区、升级对象、处置权、案件 SLA/熔断。 |
| 按票型自动验收 | 关闭 | Criteria schema、证据、验收者/审批人和规则版本。 |
| 规则发布与高风险接管 | 技术登记仅只读 | 发布审批角色、回滚职责、接管权限和边界。 |

## 4. 分期执行计划

### 阶段 0 — P0 生命周期防绕过（立即实施）

**目标：** 让正式工单的取消和终态写入只有一条受控路径；将不可变 lifecycle fact 与可更新运行 trace 分离；清理目录与真实 producer 的语义冲突。

1. 为生命周期事件增加显式类别、幂等关联和数据库不可更新/删除约束；trace 保留受控更新能力。
2. 抽出 `TicketTransitionService.cancel()`：在一个事务内做版本/范围校验、更新 ticket、追加不可变 `task.cancelled`、写 command receipt。
3. 正式 `/api/tickets/:id/commands` 只调用该服务；旧 `/api/tasks/:id/cancel` 只允许完整协议的严格代理。
4. 将 `/api/tasks/:id/complete` 置为 `410 legacy_write_endpoint_retired`；任何运行结束只能写 Run 事实，不能自动终结 Ticket。
5. 清理 `today-plan` 等 Host 直写 Ticket 终态；更新 `event-catalog` 的 carrier、producer 和 `task.accepted`/`task.completed` 语义。
6. 新增 SQLite 与 PostgreSQL 回归：并发、幂等重放、事务回滚、生命周期不可变、运行成功不完成工单、旧端点不可绕过。

**非目标：** 不定义 Today 业务谓词；不启用自动派单/SLA/升级；不允许 run/模型自动验收。

### 阶段 1 — P0 范围安全与 Worker 领取后复核

1. 对 tickets、runs、events、artifacts、jobs/outbox、brief/snapshot、audit 设计并回填可信 tenant/company/scope。
2. 最小权限数据库角色 + RLS；API 与 Worker 注入可信 tenant context。
3. Worker claim 后重核 scope、actor、ticket/run 终态、Cron 当前状态和规则版本；不匹配写 `skipped/cancelled` + 审计。
4. 为非管理员、受限管理员、跨公司/品牌/区域、撤权和禁用/改版 Cron 建 PostgreSQL 集成负测。

### 阶段 2 — P0/P1 正式 Ticket 领域模型与命令面

1. 以 expand/backfill/verify/enforce 迁移补齐 `goal`、`company_id`、`timezone`、`due-or-reason`、`next_action`。
2. 新增 `ticket_basis_refs`、`ticket_assignments`、结构化 acceptance criteria/evidence/decision。
3. 实现唯一 `TicketTransitionService`，统一 `POST /api/tickets`、候选采纳、assign/reassign、complete/cancel。
4. 创建缺目标/对象/依据/期限或理由/验收条件返回 `422`；无法回填旧数据返回 `missing_fields[]`。

### 阶段 3 — P0/P1 可靠执行内核

1. Outbox 加 `publishing` lease/watchdog；Worker lease 续约；retry 原子写新 Outbox 或可靠 DB sweeper。
2. 统一 handler registry 与 contract：超时、取消 token、风险、外部幂等键、外部回执/uncertain。
3. 迁移 MediaCrawler、通用模型、发现、知识文档等 API/内存长运行。
4. 增加按类型 limiter、全局 admission control、MediaCrawler=1、429/503 + `retry_after`、权威 DLQ 与审计。
5. systemd timer/独立 scheduler、healthcheck/restart/资源限制，以及真实 PostgreSQL+Redis/BullMQ 故障注入。

### 阶段 4 — P1 读模型、SSE 与员工端全量可见

1. `GET /api/runs/:id/stream?after=`，SSE 重连去重和分页 fallback。
2. `POST /api/tickets/:id/runs`、`POST /api/runs/:id/cancel|retry`，由 `allowed_actions` 控制。
3. Workbench 计划统一 envelope、ETag、`source_revision` 校验与容量错误语义。
4. Home 累积 cursor/虚拟分页，完全以服务端 `is_today`/`membership_reason` 为准；display memory 只能 enrich，不能丢 Ticket。
5. `/tasks` 迁移到 formal Ticket/Run/Summary/Timeline；补详情、产物、依据、摘要版本、审计入口、幂等/409 回执。
6. 修复移动/键盘/读屏：≤860 行卡、触控最小命中、dialog/nav focus trap、Escape、焦点回归、200%/reduced-motion 测试。

### 阶段 5 — P1 摘要与事件目录收口

1. 独立 `task_summaries` + outbox，按 fingerprint 去重、保留历史可用版、`current/stale/failed`、证据引用。
2. 读取摘要绝不调用模型；来源变化或失败时保留旧版并标状态。
3. catalog 与真实 producer/carrier 同步测试；去掉 `work_items` 载体，明确 `task.accepted` 为验收完成。

### 阶段 6 — P1/P2 管理员调查与受控恢复

1. `GET /api/admin/scheduling/runs` + detail，支持 scope-filtered cursor、状态/对象/触发/规则/Worker/时间过滤和脱敏 Trace。
2. retry/cancel/takeover 的 `allowed_actions`、版本、幂等、证据和不可变审计；高风险/uncertain 不盲重试。
3. 最小人工案件模型、`/admin/audit/cases/:id`、证据链、笔记、责任人、裁决和导出；未开放路由明确 feature-not-enabled。
4. 扩展 audit 的 object/action/result/time/actor/trace/business/approval 关联检索和 E2E/RBAC 负测。

### 阶段 7 — P2 已发布业务规则后的受控开通

仅在规则版本、审批主体、scope 和回滚方案齐备后，采用 feature flag 逐项开通 Today 最终谓词、人工/自动分配、票型验收、SLA/升级/案件触发。每次决策写 `rule_id/version`、输入事实、例外和人工覆盖；不确定时 fail closed 到人工队列。

### 阶段 8 — 贯穿式发布门禁和生产运营

1. 用 expand → shadow compare → enforce → 删除旧端点推进迁移；旧 `/tasks` 和旧 plan/display 路径先埋点，零写流量后移除。
2. PostgreSQL 周期备份、加密/保留、异地、`pg_restore` 演练、RPO/RTO 与补偿流程。
3. 用真实 PostgreSQL、Redis/BullMQ、多 Worker 压测签署 p95、事件循环、SQL、连接、队列年龄/深度、失败/uncertain 与每类型配额。
4. 将 Outbox publishing age、DLQ、Worker 心跳、RLS 拒绝、备份失败纳入 health/readiness、部署和告警。

## 5. 里程碑验收

| 阶段 | 必须证明的结果 |
|---|---|
| 0 | 旧无保护 complete 无法写入；取消只走 canonical 事务；lifecycle event 无法 UPDATE/DELETE；run 成功不完成 ticket。 |
| 1 | 跨 scope/撤权/禁用规则都不能读写或继续执行；Worker 领取后复核生效。 |
| 2 | 工单的目标、对象、依据、责任、验收条件与证据可回放；所有写入无半提交。 |
| 3 | Redis/Publisher/Worker 故障、重复消息、取消和 lease 过期均受控结束；无永久 publishing；MediaCrawler 严格为 1。 |
| 4 | 多页 Ticket 无漏项；SSE 重连/去重/fallback 正确；员工只见 allowed actions；移动和无障碍验收通过。 |
| 5 | 摘要有来源版本、失败/过期语义和旧版保留；catalog 与真实 producer 一致。 |
| 6 | 管理员可在授权范围内调查、恢复或接管，所有动作和案件处置有审计回执。 |
| 7 | 任何自动业务决策均能回放规则版本、输入事实、范围与人工覆盖。 |
| 8 | 已完成备份恢复演练和容量签署；发布/回滚证据可审计。 |

## 6. 当前执行状态

- [x] 差距审计与分期计划
- [x] 阶段 0：生命周期防绕过（已收敛正式 complete/cancel 命令、停用无保护 complete、任务事件区分 lifecycle/run_trace/legacy，并完成 SQLite/PostgreSQL 不可变约束、事务回归与发布验证）
- [ ] 阶段 1：范围安全与 Worker 复核
- [ ] 阶段 2：正式 Ticket 领域模型
- [~] 阶段 3：可靠执行内核（已实现 Worker 归属租约续约、低风险失败/租约到期的原子重新派发、PostgreSQL Outbox 发布租约抢回，以及调度监控；仍待长运行 handler 全面迁入、按类型限流和 DLQ）
- [ ] 阶段 4：实时读模型与员工端
- [ ] 阶段 5：摘要与目录
- [ ] 阶段 6：调查/恢复/案件
- [ ] 阶段 7：业务规则开通
- [ ] 阶段 8：运营与发布门禁
