---
name: async-job-observability
description: 构造持久异步任务的真实阶段、批次进度、入队交接和恢复契约。停刷、排队、长等待、失败、uncertain、断线或取消重试任务时使用。
---

# 异步真实进展与恢复构造

版本：1.0.0 · 来源：KOL 项目原创实施资产 · 许可证：见 references/provenance.md

## 输入与责任

读取用户目标、受影响路径、实际服务端契约与代码基线。以 **backend/frontend** 职责作决定；遵守 TECH-BE-03, TECH-BE-04, TECH-FE-03, TECH-TEST-02，不修改权限、业务状态或审批口径。技能不是基本法。

## 构造流程

1. 从实际 PG 持久作业、队列/outbox 与结果记录推导状态；记录 authorized intent，不能让页面轮询充当唯一调度器。
2. 实例化 templates/async-contract.json；采用 shared/knowledge-scope.ts 契约，后端主责决定事务与幂等边界。
3. 索引到提炼的交接必须有可恢复持久事实；旧资料没有自动意图不能无限等待。前端按服务端 handoff/job 状态做有界刷新，权限失败停止并保留恢复。
4. 只在真实批次完成后写 done/total 和 last_progress_at；明确 attempt 重置。心跳、轮询读取时间和业务进展分开，未知总量不生成百分比。
5. 覆盖入队间隙、worker重启、瞬断、长期无进展、failed/uncertain/cancelled、同名资料切换。uncertain 先查事实不自动重跑；只显示服务端支持且允许的动作。

## 可实例化资产与交接

- 用 `templates/async-contract.json` 构造 **async-contract**，将样例替换为本次任务事实，保持 draft 直到实际验收。
- 从仓库根运行 `python3 .agents/skills/governed-task-routing/scripts/instantiate.py async-job-observability <任务ID> <输出目录>` 生成草案；该脚本不能证明设计或实现通过。
- 查询 `docs/governance/development-component-catalog.md` 的实际源码和模板组合；源码是实现唯一位置，技能内不复制维护组件。
- 最终将产物、源码、运行日志与未验证项交给 ui-evidence-verification / 执行器 verify。

## 验证与失败处理

确认依赖真实存在且锁定版本匹配。相关组件或接口变更执行领域测试、类型检查和浏览器任务验证。缺依赖、缺产物或规则冲突只阻塞相关部分；禁止捏造调用记录、百分比、生产验收或人工决定。
