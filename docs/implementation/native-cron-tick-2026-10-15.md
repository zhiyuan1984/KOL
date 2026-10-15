# PostgreSQL 原生 Cron 常驻入队补接

## 状态与适用范围

- 基线：已上线 `f113b829c14b7db97782b129fc4e0057aadc0c46`。
- 本切片：补齐服务器常驻 Cron 入队轮询，不新增业务 handler，不在轮询进程执行 handler。
- 当前状态：隔离验证完成，30/30定向测试通过；生产轮询启用、逾期恢复方式与两条2031年系统调度时间的调整等待用户明确选择。
- 生产只读清单：六条系统任务；五条 published、一条 disabled；其中三条逾期、两条下次执行在2031年。用户配置的 `ai-task` 为零，不能假称已有线上AI运行回执。

## 审宪记录

| 需求 | 主责角色 | 宪法与基本法 | 结论与证据 | 下一步 |
|---|---|---|---|---|
| 关闭网页后已发布作业继续调度 | 后端专家、架构师 | CONST-01/03/10；PROD-PLAT-06；TECH-ARCH-01/02；TECH-BE-04 | 符合。现状仅有入队函数与API入口，缺少常驻调用 | 独立Cron Tick进程，由systemd监督 |
| 原生持久入队、同客户端事务与去重 | 后端专家 | CONST-05；TECH-BE-03/04 | 符合。沿用PG Serializable事务、SKIP LOCKED与唯一(job_id,scheduled_for) | 隔离PG验证并发与外层回滚 |
| 停用任务不能被初始化自动重新发布 | 后端专家 | CONST-05；PROD-PLAT-06；TECH-BE-01 | 符合。移除运行时disabled→published回填；保留新库种子与已存在发布状态 | 测试停用、条件和时钟保全 |
| 逾期恢复策略与2031年时钟纠正 | 用户作为产品发起人、作业治理责任人 | CONST-04/05/08；TECH-BE-04/08 | 会改变真实调度执行，不能默默选择。现有API默认逐窗口重放，新常驻入口要求显式policy | 用户选择后才启用或调整生产时间 |
| 不创造员工AI任务或假成果 | 后端专家、测试经理 | CONST-05/10；PROD-AGENT-08；TECH-TEST-03 | 符合。测试仅在专属PG库使用合成任务，入队不等于AI分析完成 | 保留真实执行身份、技能与审批闸门 |
| 业务时间文案为北京时间 | 后端专家 | CONST-04；TECH-FE-01 | 符合已明确用户要求。只改文案，不改内部IANA时区 | 校验频率文案不暴露Asia/Shanghai |

## 实现契约

1. `scripts/worker.sh cron-tick` 使用既有非执行式dotenv解析，不读取或打印秘密值。
2. `src/cron-tick-worker.ts` 运行独立进程，缺少恢复策略或正式schema时明确失败。
3. `CRON_MISSED_RUN_POLICY` 必须显式为 `replay` 或 `coalesce`，没有生产默认选择：
   - `replay` 保留现有API逐窗口推进语义。
   - `coalesce` 每项逾期入队一轮，下一时点按当前时间重新计算；保持最早到期窗口作为稳定去重键，并在execution/outbox中持久记录恢复元数据。
   - 如用户要求跳过旧窗口，这属于启用前的一次性、精确范围时钟恢复；常驻服务仍按正常未来周期入队，不能把每一次正常迟到都当作永久跳过。
4. `cron_runs`、`execution_jobs`、`execution_outbox` 与 `next_run_at` 在同一PG事务提交；回执仍为空、状态仍为queued，不能冒充业务执行成功。
5. 正式业务仅由既有BullMQ Execution Worker的受控入口执行。轮询不调用 `executeCronRun`、不外发邮件、不发布资产、不修改员工账号或权限。
6. 轮询顺序执行，不重叠；成功心跳仅在入队提交后更新。三次连续失败明确退出，交由systemd重启。
7. SIGTERM/SIGINT/Abort等待当前事务完成，取消等待，登记停止心跳并关闭PG池。
8. 复用 `execution_worker_heartbeats`，`worker_kind=cron-tick`；不新增migration。新进程重启更新时间，成功时间在details中可见。
9. 独立service复用当前生产路径与资源护栏；部署必须校验全部五个进程的路径、具体角色和逐个存活，且在构建前验证恢复策略已显式配置。

## 验证边界

- 所有写入测试只在新建专属PG数据库，使用合成身份、任务与日期；禁止生产测试写入。
- 验证循环退出、失败恢复、不重叠、无失败成功心跳、角色绑定、默认API兼容。
- 真实PG覆盖持久入队、重复tick、并发、外层回滚、停用保全、单次窗口、AI仅入队与实际resident worker退出。
- 此处不以合成任务的queued状态或单元测试证明真实AI分析完成；生产没有配置AI定时任务，必须如实说明。
- 没有用户恢复策略选择前，不安装启用新服务、不重写生产调度日期、不手动触发公海/邮件。

## 最终隔离验证

- 2026-10-15：`tsc --noEmit`、`validate:contracts`、`validate:registry`均通过。
- 四个明确选定的测试文件：30/30通过；未降低原测试门槛、未运行全站E2E。
- 真实PG验证包含实际resident worker启动、durable enqueue、停止心跳、信号监听清理及池关闭。
- 新增超时回归：正常running不触发stale标志；只有真正超时进入needs_takeover，回执为副作用未知、需核验，而非伪造none/未创建会话。
- 专属测试数据库正常DROP，没有终止其他数据库连接；生产业务库测试写入为零。
- 生产仍运行已验证原生基线f113b829；本切片尚未发布，也未纠正2031年时钟。
