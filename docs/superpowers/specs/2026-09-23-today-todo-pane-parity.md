# 今日任务 / 我的待办：同一工作台（UI/UX 一致化）

> 日期：2026-09-23
> 范围：`frontend/src/home/*`、`frontend/src/pages/Home.tsx`、`frontend/src/home/*.css`、`frontend/src/styles.css`、`backend/src/routers/home-today.ts` 与相关测试
> 目标：两个页签由同一个工作台组件渲染，**除请求路径与 scope 文案/数据切片外没有结构差异**。

## 1. 审宪记录（CONST-08）

| 项 | 内容 |
|---|---|
| 需求 | 「我的待办」与「今日任务」的 UI/UX 一致，允许的差异只有后端请求（含必要文案与数据切片）。 |
| 主责角色 | 前端专家（组件/样式）、后端专家（响应契约对称）、产品经理（两页签一页一问与文案）、测试经理（一致性证据）。 |
| 宪法条款 | CONST-04（前端只实现已定义规则，未重写分桶/权限/审批）；CONST-09（未改法以迁就实现）；CONST-10（一致性有可执行证据，不以截图代验收）。 |
| 基本法条款 | `TECHNOLOGY.md` TECH-FE-01/03、TECH-BE-01、TECH-TEST-01/02；`PRODUCT.md` PROD-PLAT-02（Home 模式与入口契约）；`BUSINESS.md` `:157`/`:164`（today_plan/todo_plan 与 creator_daily_tasks 边界）；`docs/ia-information-architecture.md` §1（两页签同属平台任务脊柱，各自一页一问）；`docs/DESIGN.md` §不变量 1（同一视口 0–1 实底主 CTA）、§不变量 4/5、§三轴适配。 |
| 结论与证据 | **符合**。同时落定两条既有偏差：① 今日任务页签的板头启动入口曾被条件排除（`scope !== "today"`），与 `frontend/src/home/entryRegistry.ts:96-113` 登记及三份 e2e 契约矛盾 —— 本次恢复为两 scope 都渲染；② 待办页签曾同时出现两个实底主 CTA（板头启动 + 提问框发送），违反 DESIGN.md §不变量 1 —— 板头启动降为描边。 |
| 规则空白 | 今日/待办的行切片规则（`isTodayScheduled`，`frontend/src/home/schedule.ts:1` 自注「Constitution does not encode this」）无法条来源；本次**未改**该规则，仅登记。 |
| 下一步 | 见 §4 文件清单与 §5 验证证据。 |

## 2. 现状差距（改动前）

| 维度 | 今日任务 | 我的待办 |
|---|---|---|
| 骨架 | 两列工作台（中列 AI 工作区 + 右侧可折叠任务栏） | 单列全宽，只有一块板 |
| 标题 | 中列 h1 + 统计行 | 无 h1，只有页面级统计行 |
| AI 规划流 | 中列（带空态与刷新滚动锚点） | 塞在任务板内部 |
| 启动入口 | 被 `scope !== "today"` 排除，`plan-today` 不存在 | 板头按钮 + 提问框两条 |
| 提问框 | 中列底部 | 页面底部 |
| 板宽 | 右栏 `clamp(600px,56%,820px)` | 全宽 |
| 行投影 | `sortTodayTodos + applyLayoutWhy` | 死 prop + pane 内二次过滤 |
| 实底主 CTA | 1 个 | 2 个（违反 DESIGN.md §不变量 1） |
| 命名 | — | 复用 `today-*` 类名渲染「我的待办」 |

## 3. 目标态与差异白名单

```
Home（mode = today | todo）
└─ ScopeWorkspace(scope)                      ← 两页签同一组件
   ├─ 中列 .scope-workspace-center[data-scope-ai-workspace]
   │   ├─ centerHeader（h1 + 统计行，文案按 scope）
   │   ├─ notice 槽（待办去重提示；今日传空）
   │   ├─ TodayPlanProgress(scope, candidates, plannedTasks)
   │   ├─ PlanSummary(brief, label=scope 文案)
   │   ├─ 空态（idle 且无 brief/events）
   │   └─ centerFooter（快捷任务条 + ComposerDock）
   └─ 右栏 aside .scope-task-rail[data-scope-task-rail]（可折叠，按 scope 记忆）
       └─ TaskBoard(scope, rows, planButton)   ← 板内不再嵌 AI 流
```

差异白名单（其余一律视为回归）：

1. **请求**：`/api/home/{today|todo}-brief`、`-tasks`、`-brief/plan`（打开记忆与行内动作两 scope 相同）；
2. **行切片**：`scopeRows` 里 today = 今日范围、todo = 今日范围之外；
3. **文案**：`SCOPE_CONFIG`（`heroTitle/boardTitle/railLabel/railToggleLabel/railStorageKey/emptyCopy/streamEmpty/planSummaryLabel/boardIdleLabel/boardAgainLabel`）；
4. **数据事实**：待办去重提示 `dedupeNotice`。

## 4. 文件变更清单

### 4.1 前端

| 文件 | 变更 |
|---|---|
| `frontend/src/home/ScopeWorkspace.tsx` | **新建**：由 `TodayPane` 泛化，两页签共用；`data-scope-*` 选择器、按 scope 的折叠键、notice 槽、`PlanSummary` label |
| `frontend/src/home/scopeRows.ts` | **新建**：`scopeRows(scope, tasks, layout)` —— 两页签唯一行投影 |
| `frontend/src/home/TodoPane.tsx`、`TodayPane.tsx` | 删除 |
| `frontend/src/home/TaskBoard.tsx` | 去掉 `scope !== "today"` 特例（恢复 `plan-today`）；删 `stream` prop；空态文案读 `SCOPE_CONFIG`；类名 `today-board-*` → `task-board-*` |
| `frontend/src/home/BoardRow.tsx` | 类名 `today-board-*` → `task-board-*` |
| `frontend/src/home/todayPlan.ts` | `FrontendScopeConfig` 增 pane 文案字段并填值 |
| `frontend/src/home/todayTasksApi.ts` | `fetchScopeTasks(scope)` 单一请求点，`fetchTodayTasks/fetchTodoTasks` 变成别名 |
| `frontend/src/home/PlanSummary.tsx` | 摘要标题改为 scope 文案（默认「今日计划摘要」） |
| `frontend/src/pages/Home.tsx` | 两段渲染分支合一为 `<ScopeWorkspace>`；删 `todoFilter/visibleTodoItems/matchesTodoFilter` 与死 prop；外层 hero 与页面底部提问框只留给 discovery/pool/lifecycle；新增 `data-home-workspace={scope}`（固定视口工作台布局的开关，两页签同值语义） |
| `frontend/src/home/today-plan-board.css` | `.today-workspace*/.today-task-rail*` → `.scope-workspace*/.scope-task-rail*`；`.today-board*` → `.task-board*`（**不用 `board-*`：styles.css 已有 .board 看板网格，会互相污染**）；删 `.board-stream`；启动按钮改描边（唯一实底 CTA 归提问框）；右栏板头改成「标题行 + 工具行」，容下搜索与启动按钮 |
| `frontend/src/styles.css` | 同步改名；删死样式 `.today-work-inline`、`[data-home-pane="todo"] .task-filters*`；把原 `[data-home-active-mode="today"]` 的 22 条工作台几何规则改为 `[data-home-workspace]` —— 固定视口工作台（stage 不滚、中列与右栏各自滚、提问框钉在列底）自此对**两个**页签生效，而不是只有今日 |

### 4.2 后端

| 文件 | 变更 |
|---|---|
| `backend/src/routers/home-today.ts` | `/home/{scope}-brief/plan` 响应统一带 `task_type: cfg.taskType`（原仅 todo 返回） |

明确不动：`POST /home/today-brief/enqueue`（today_analyze，前端无调用者，仅登记）、`GET /home/today-task-memory`、`CATALOG_FILTERS` 的 todo 目录切片、记忆种类表、表结构。

## 5. 验证证据

| 类型 | 内容 |
|---|---|
| 单元 | `frontend/src/home/scopeParity.test.ts`（新增）：两切片互补且不相交、单一请求点、禁 scope 分支（含 `scope !== "today"` 回归哨兵）；`todayPlan.test.ts` 增 `SCOPE_CONFIG` 文案字段与「两 scope 渲染同一组件」断言；`backend/tests/today-plan.test.ts` 新增「两条 `/plan` 响应键集合相同」并把 `task_type` 断言收紧为相等 |
| E2E | `frontend/e2e/home-pane-parity.spec.ts`（新增）：①两页签骨架选择器集合相同 ②各自只发自己 scope 的 `/api/home/{scope}-brief/-tasks` 且条数相同 ③每页签实底主 CTA ≤ 1 ④两页签滚动架构与页脚几何完全相同（stage 不滚 / 中列与右栏 `auto` / 提问框贴视口底） |
| 回归 | 今日/待办既有 pane、plan-cache、four-panel、workbench、plan-trace、chip-metrics 用例按新结构更新后全绿；`home-plan-trace` 的「唯一滚动容器 = stage」两条断言按 2026-09-22 起的固定视口工作台改写为「只允许中列/右栏滚动，且提问框在滚动区之下、完整在视口内」——该断言在本次改动前即已为红（基线复跑见 §8） |
| 命令 | `cd backend && npm test && npm run typecheck`；`cd frontend && npm run typecheck && npm run test:e2e` |
| 人工 | `artifacts/ops/home-pane-parity-{today,todo}-{1280x900,1440x900}.png` |

## 6. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 待办表进入右栏后变窄 | 保留折叠开关；≤1280 断点隐藏序号列；parity 与 four-panel 用例保留「无横向滚动」断言 |
| `board-*` 与既有 `.board` 撞名 | 已改名为 `task-board-*` 并在本文登记原因 |
| e2e 选择器批量改名漏改 | 与实现同一变更集；`npm run test:e2e` 全量兜底 |
| 页签正文断言被 chrome（tab 行/提问框）带偏 | 断言下沉：`paneBodyText()` 去掉 chrome 后再断内容 |

回滚：除后端一行外皆为前端，无数据迁移，`git revert` 即可。

## 7. 不做的事

- 不改行切片规则、后端路由、权限与审批；不改 `发送/暂存/导入/解密/删除` 语义。
- 不合并「今日任务 / 我的待办」两个页签。
- 不动 discovery / pool / lifecycle 三面。
- 未重命名 `today-plan-*`（规划流组件自身命名空间）与 `data-today-plan-*` 属性。

## 8. 并行改动与基线复跑（证据）

- **基线复跑**：把本任务改动 stash 后复跑 `home-plan-trace`「唯一滚动容器」与 `home-four-panel`「followed toolbar」两条用例 —— 前者仍红、后者 flaky，证明它们**先于本次改动**存在（前者源于 2026-09-22 的固定视口工作台布局，其 spec 未同步）。
- **并行会话**：`18a31da`（composer + 菜单）与类别色 token 改动由另一会话在本次工作期间提交，并一度覆盖 `frontend/src/styles.css`；本任务的改名/删样式已在该文件最新版本上重放（脚本断言类别色 token 未受影响），`onOpenDiscoveryTemplate` 调用点按对方提交说明保留。**同一文件被两个会话并发编辑**已发生一次，后续应串行。
- 归属说明：`workbench.spec.ts` 中 composer 选择器（`data-skill-option`）与 `skills-catalog.spec.ts` 的失败来自上述并行提交，与本次改动无关；本次改动覆盖的页签用例集（pane-parity / today / todo / four-panel / plan-cache / plan-trace / chip-metrics）为 0 failed。
