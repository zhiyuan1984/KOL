# 员工定时任务：高密度工作台实施契约

## 1. 审宪与审法

| 需求 | 主责角色 | 宪法 / 基本法 | 结论与证据 | 下一步 |
|---|---|---|---|---|
| 员工自动任务清单，任务定义、时间计划、运行实例分层 | 平台产品经理、UI/UX 专家 | CONST-01/04/07；PROD-PLAT-06；PROD-AGENT-08/09 | 符合；保留 `/cron` 独立能力面，不迁移 Home | 以六列摘要与按需 Drawer 实施 |
| 服务端返回真实能力与允许动作 | 后端专家、前端专家 | CONST-03/05；TECH-FE-01；TECH-BE-01/03/04 | 符合；只读投影既有 principal、handler、运行回执，不扩大员工权限 | 仍由原写接口最终授权 |
| 状态 Tabs、紧凑搜索、唯一粉色 CTA | UI/UX 专家、前端专家 | CONST-04；TECH-FE-03；DESIGN.md §§1/4/5/6/9/24/25 | 符合；Ant Design 受控状态视图，保留路由/回执深链 | 用真实 DOM 行高、焦点与视口测试确认 |
| 北京时间展示与带时区的输入转换 | 前端专家、测试经理 | CONST-06/10；TECH-FE-03；TECH-TEST-01/02 | 符合；不按浏览器时区误解释，不重写历史时区 | 非中国时区与 DST 单元 / 呈现测试 |
| 2031 年持久调度时间 | 后端专家、测试经理 | CONST-05/06/10；TECH-BE-04；TECH-TEST-03 | 独立数据问题；只读审计确认不是 UI 格式问题 | 未获重排范围确认前不修改生产计划 / 回执 |

## 2. 设计读取与保留契约

模式：**Redesign · Preserve**。受众为员工；视觉沿用 `data-dense-dashboard`、项目品牌粉主行动和辅助色交互。

设计参数：结构变异 2（稳定六列）、动效 1（状态反馈）、信息密度 8（单行可比较摘要）、资产依赖 1（原工作台品牌/图标）、品牌保真 10（局部 Ant Token 桥接）。阅读距离为笔记本工作距离；语气克制；所有扩展信息按需展开。

保留：`/cron`、`/cron/:jobId`、`/cron/new`、`#cron-receipt`；任务 / 运行 ID；ComposerDock 的内容、技能、附件与范围载荷；保存草稿再核对启用的顺序；原权限、处理器风险与 worker。

改善：任务与频率拆列、计划与结果分轴、搜索提交与输入分离、真实计数、详情 Drawer、上下文与焦点恢复、固定 Composer 保存区。

移除：逐行 `Asia/Shanghai`、默认频率的“上海时间”、系统（平台已发布）、下次时间 + 倒计时重复堆叠、每行描边动作、列表下方详情。

颜色、字号、间距、圆角来自 `docs/DESIGN.md` 及 `styles.css`。正常行 44、表头 36、主信息 13、辅助 12；搜索和新建同为 32。`styles.css` 未落地的已登记抽屉宽 720、水平 padding 20、代码最大高 320 在本页 CSS 局部桥接，不覆盖全局和同期工作台。抽屉内部有效内容宽不足 720，独立字段与表单采用单列。

## 3. 生命周期视图映射

本页根据已批准的 Ant Design 方向使用 `Tabs type="line"`，登记为同一授权任务数据集的状态视图，真 `tablist/tab/tabpanel`，不修改既有通用 `LifecycleNavigation` 的筛选按钮语义。

| 状态视图 | 权威字段 | URL 参数 |
|---|---|---|
| 全部 | 不筛选 status | 无 status |
| 已启用 | published | status=published |
| 已暂停 | paused | status=paused |
| 草稿 | draft | status=draft |
| 未启用 | disabled | status=disabled |

计数来自成功读取的同一员工授权集合，保留搜索 `q` 和独立最近异常条件 `attention=1`，只忽略当前计划状态与分页。加载 / 失败不显示伪造 0。`attention=1` 仅指最近终态失败 / 待接管，不宣称问题未解决。页码 `page` 每页 20。状态 / 搜索变更恢复第一页；排序由员工显式触发，缺失时间在任一方向排最后；异步行更新不重排。

## 4. 最小服务端公开读模型

列表、详情、创建 / PATCH / run polling 回显使用一致的：

```ts
execution_capability: { ready: boolean; reason?: string; code?: string }
allowed_actions: {
  edit: boolean; pause: boolean; resume: boolean; publish: boolean;
  run_now: boolean; run_reason?: string
}
last_result_label: string
```

来源为服务端 `TicketPrincipal`、`canSeeJob/canMutateJob`、已登记 handler 的迁移状态、condition.enabled、实际 active run 和最近终态回执。前端缺字段时不自行授予动作，不依据用户的管理端显示模式授权。

- 普通员工不能编辑 / 暂停 / 恢复 / 发布系统任务。
- 系统任务手动触发资格沿用现有服务端可见与执行门槛；不是看到“系统”就一概开放或一概禁止。
- 本页 `run_now` 仅 published、条件启用、没有 queued/running 且能力就绪；不改变后端此前对 paused 的 `assertJobRunnable`。
- `ai-task / ownership-release / mail-memory-increment` 原生仓储未迁移仍隔离；本次不恢复其执行能力。
- discovery 成功且有真实 crawl_job_id 为“已入队”；没有排队回执为“待核对回执”；ai-task 历史成功为“已提交”。均不冒充业务完成。
- 首屏结果只保留简短文字；异常错误全文在回执中按需读取。当前执行与上次终态可同时表达。
- 同一次 job SQL 投影读取 active 状态和最近终态回执；不对每行请求详情 / 历史。不向列表返回原始回执。

`status` 始终为计划状态权威。`enabled` 仅统一旧摘要 / 详情条件口径，不以该布尔值代替 published / paused / draft / disabled。

## 5. 时间契约

新建默认 `Asia/Shanghai`，列表下次运行统一北京时间，只给一个可读时间值（精确值通过 title / 详情）。正常频率不逐行重复默认时区；非中国时区频率保留调度时区标识。

单次与区间输入显式按选定时区转换 UTC。非法日历、无效时区、DST 不存在 / 歧义时间拒绝保存，避免浏览器本地解释。按执行方式只提交相应 schedule 字段；高级区间生效设置在未改动时仍保留。自定义 Cron 无法可靠转换时保留原表达式，编辑名称 / 内容不隐式重写。

## 6. 详情与恢复

列表在 Drawer 打开时仍挂载。搜索、状态、异常条件和页码通过 URL 保留；原列表滚动和入口焦点在当前浏览上下文中恢复。直接深链 / 刷新不触发运行，读取失败在原地址保留重试入口。

详情：计划状态与能力 → 最近回执与动作 → 频率 / 时间 / 范围 → 折叠任务内容、模板、运行记录、技术诊断。仅真实 session_id 才提供会话入口。不暴露未开通的专家解读按钮。

新建 / 编辑复用 ComposerDock，保存区固定在 Drawer footer，时间设置独立滚动。保存中阻止重复提交和关闭，失败保留内容；未保存关闭 / 返回先确认。

## 7. 调度异常的只读证据（2026-10-09）

在 `BEGIN READ ONLY` 事务内确认系统作业：

- overdue-scan：无 start_at 生效约束，下次为 `2031-01-02T00:00:00Z`，最近完成时刻 `2031-01-01T08:00:02Z`。
- daily-task-snapshot：无 start_at 生效约束，下次为 `2031-01-01T23:15:00Z`。
- ownership-release：最近待接管时刻 `2031-01-01T03:00:02Z`。
- 上述时间与 `backend/tests/postgres-cron.integration.test.ts` 的固定测试槽位逐秒吻合；创建日期为 2026-10-08。

结论：前端没有制造 2031；持久状态高度吻合测试固定时间写入，需单独追查测试数据库隔离与写入来源。本次不声称已经完成历史数据修复，也不重排或删除现有回执。本轮 PostgreSQL 验证在 sandbox 新建独立 `cron_ui_test` 数据库进行。

## 8. 验证与发布登记

测试证据、活动版本、PR、回滚与剩余缺口在交付记录登记，不以此文档本身冒充发布或无人执行完成。使用本页隔离呈现测试；旧 cron-workbench live 用例含真实计划变更与运行，本轮不对生产执行。所有发布只触及登记文件，保护当前活动目录及同期任务 / 采集 / 知识改动。

## 参考

- [Ant Design Input.Search](https://ant.design/components/input-cn/)
- [Ant Design Tabs](https://ant.design/components/tabs-cn/)
- [Ant Design Table](https://ant.design/components/table-cn/)
- [Ant Design 数据列表](https://ant.design/docs/spec/data-list-cn/)
