# 任务中心布局迁移记录

- **页面 / 路由：** `frontend/src/pages/Tasks.tsx`；保留 `/tasks`、`/tasks/:id`、`/tasks?businessTask=…`，以及既有的协作会话链接 `/s/:session_id`。
- **范围：** 仅展示层。未修改路由、字段名、请求、筛选查询参数、确认、权限、风险、阶段、审批、数据加载或写入行为。
- **依据：** `docs/CONSTITUTION.md`（CONST-04/05/10）、`docs/TECHNOLOGY.md`（TECH-FE-01/03、TECH-TEST-01/02）、`docs/DESIGN.md`（13px 基准、表格与 L3 动作）、`docs/ia-information-architecture.md`（任务/会话入口与深链）、以及批准计划 `deliverables/kol-global-layout-goals-plan.md`。

## 实际修改

| 位置 | 最小迁移 | 展示结果 |
|---|---|---|
| `frontend/src/pages/Tasks.tsx` | 将本页 Agent 任务抽屉中的本地 `dl` 改为 `PropertyList` | 状态、任务 ID、创建时间采用左标签—24px 留白—右值；共享组件默认标签列为 112px，正文仍为 13px。 |
| `frontend/src/pages/Tasks.tsx` | 将本地抽屉中的长“说明”从短属性组拆为独立详情节 | 完整内容在第二层自然换行，不为了单行压缩或删除。 |
| `frontend/src/pages/Tasks.tsx` | 将执行事件项改为 `RecordRow`，并将会话入口容器改为 `ActionGroup` | 事件标题与时间元信息保持单行阅读，事件摘要明确进入 `detail` 第二层；既有会话链接和可达性保留。 |
| `frontend/src/pages/Tasks.tsx` | 在现有表格任务标题单元使用 `TruncatableText` | Agent 与业务任务长标题仍在任务名列；溢出时提供可聚焦、可点击的“展开”入口，而不是只依赖 hover/title。 |
| `frontend/src/pages/global-layout-tasks.css` | 新增两条完全限定到 `.tasks-page[data-task-center]` 的适配规则 | 只让共享标题组件填充既有任务名列并维持标题字重；未改共享 `styles.css`、共享组件或其他页面。 |

## 已合规并保留

- **任务明细是语义数据表，未改成 div 列表。** 原有“任务名 / 状态 / 更新时间 / 操作”列、`colgroup`、`thead`、`tbody` 和展开明细行均保留；常规记录的标题、状态与动作仍在同一表格行。
- 所有现有 `api.*` 调用、查询参数、筛选、刷新、分页/加载更多、批量取消确认、详情打开/返回、会话跳转、业务任务读取、登记已核验事件的表单 ID 与确认逻辑均未改变。
- 已有错误、无访问权限、读取失败、逾期、等待/待确认、运行中、取消与完成等真实状态文案和现有显示逻辑均保留；没有以紧凑为由隐藏异常或风险信息。

## 需要多行的例外

1. 任务说明可能为长文本，已保留为独立“说明”详情节。
2. 执行事件摘要为完整事实文本，保留在 `RecordRow.detail` 第二层；标题/时间保持摘要行。
3. 表格的 Agent/业务展开行继续承载摘要、阻塞原因、事实及标准工单明细；这些不是常规 44px 行内可安全压缩的短字段。
4. 业务任务的已核验事件登记、确认回执、技术来源与追溯等内容继续在其既有详细组件中呈现，避免篡改已受控写入和审计阅读流。

## 未覆盖范围 / 明确边界

- 本页没有可在 `Tasks.tsx` 内迁移的短编辑 `Form`；业务任务登记表单位于 `frontend/src/tasks/BusinessTaskDetailContent.tsx`，根据本任务的单文件限制未修改。
- `AgentExpandedDetails`、`BusinessExpandedDetails`、`TaskRowActions` 和 `TaskDetailDrawer` 也位于任务允许范围外；其现有展开事实、动作槽位和抽屉契约未改。本批只迁移 `Tasks.tsx` 自己拥有的属性块、事件记录及会话动作组。
- 这不是全站审计或全站完成声明；未迁移页面、外部任务组件和真实用户场景均不在本批验证范围内。

## 本地检查与证据

- 复核了 `Tasks.tsx`：语义表格结构、已有路由/深链、`api.*` 调用、`window.confirm`、`data-task-center` 和业务表单标识仍在。
- 复核了新 CSS：所有选择器均以 `.tasks-page[data-task-center]` 限定。
- 尝试运行 `npm run typecheck`；结果**未通过，且不能作为本次代码有效性的通过证据**。当前 `frontend/node_modules` 为空，`react`、`react-dom`、`@types/react` 和 `@types/react-dom` 均缺失，TypeScript 随之在全项目报告大量 JSX/模块解析错误（包括既有文件）。未安装依赖、未启动共享浏览器、未进行真实用户测试或生产验证。
