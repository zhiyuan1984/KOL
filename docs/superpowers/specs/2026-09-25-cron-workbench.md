# 定时任务工作台实施记录

| 需求 | 主责角色 | 宪法条款 | 基本法条款 | 结论与证据 | 下一步 |
|---|---|---|---|---|---|
| 列表首屏更快、更密集 | UI/UX、前端、后端专家 | CONST-07、CONST-10 | PROD-PLAT-06；TECH-FE-01、TECH-BE-04 | 符合：列表仅查摘要列与少量 schedule 字段；详情和历史按选择加载，系统作业仅在缺失时计算首次调度。`cron-workbench.spec.ts` 检查首屏请求数和行内更新。 | 发布时观察 `/api/cron/jobs` 耗时。 |
| 复用今日任务输入与执行 | 智能体产品经理、架构师、后端专家 | CONST-03、CONST-05、CONST-07 | PROD-AGENT-01、PROD-AGENT-08；TECH-ARCH-02、TECH-BE-02/04 | 符合：编辑器使用同一 `ComposerDock`，保存其提交快照；后台以当前有效所有者身份走既有 `from-text → task run → session message` 链，运行记录保存会话入口。写副作用技能不允许无人执行。`cron-jobs.test.ts` 覆盖提交链。 | 对真实 Codex 与连接器授权环境做集成验收。 |
| 周期、间隔、单次和生效区间 | 平台产品经理、后端专家 | CONST-05、CONST-10 | PROD-PLAT-06；TECH-BE-03/04 | 符合：持久化 schedule 条件，下次执行与 worker 共同使用 `nextScheduledAt`；暂停清空下次时间，开启重算。单元测试覆盖单次与间隔窗口。 | 在部署环境验证外部 tick 与时区。 |

验证范围：本地 stub 单元和浏览器测试证明接口、状态与导航契约；真实 Codex、外部连接器和定时 tick 仍需部署环境验收。连接器选择的执行语义沿用今日任务现有 Host 链，不在定时任务中另造一套授权或工具调用。
