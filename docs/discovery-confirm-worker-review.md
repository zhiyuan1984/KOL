# 发现采集确认故障修复审查

需求：解决 Issue #224 中的后端启动故障。主责：后端专家；验收：测试经理。依据 CONST-03/04/05/08/10、TECH-BE-01/02/03/04/08、TECH-FE-03、TECH-TEST-01/02/03/04。结论：**符合**。

生产问题由主服务和 Worker 的绝对发布路径不同触发；相同技能正文产生不同授权指纹。修复选择统一 systemd 工作目录与入口，而非修改 `runtimeSkillVersion` 的全局算法，因此已发布知识技能的 pin、既有确认快照与权限变更失效机制保持不变。部署脚本增加发布路径预检，避免以后只重启旧目录 Worker。

确认执行在校验出快照失效、尚未 claim 和 dispatch 时，按拥有者及原 snapshot 原子地把 pending 动作记为 rejected，并通过 `ExecutionNotDispatched` 使后台作业记为 failed 而非 uncertain。并发已 claim/已完成动作不能被覆盖；远端已下发、失联或错误回执仍保留 uncertain，不放宽重试。

仅已证实未下发的 snapshot_stale 拒绝允许重新提出待确认动作；重新提出不是执行采集。员工仍需核对当前范围并确认。前端 pending+execution.uncertain 显示真实 uncertain 而不是 dispatching。

指定历史作业只在原动作、作业和数据库审计同时证实 snapshot_stale、dispatched=false、无 crawl 且状态未变化时做定点状态修正。保留原审计和旧回执，记录修复审计；不重置 attempts，不重新投递旧作业，不自动重新采集。

验证包括 PostgreSQL 隔离集成测试、并发确认与远端不确定回执回归、前后端类型检查与发现页回归。生产验证使用真实受控连接器的只读工具发现与完整快照重算，不通过新采集、导入或发信证明修复；真实远端采集仍待员工确认。
