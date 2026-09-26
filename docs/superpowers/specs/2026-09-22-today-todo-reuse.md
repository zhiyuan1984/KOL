# 「我的待办」复用「今天任务」前后端架构

> 日期：2026-09-22
> 范围：前端 `frontend/src/home/*`、后端 `backend/src/host/*` / `backend/src/routers/home-today.ts`
> 结论：「我的待办」不是独立功能，而是与「今天任务」共享同一套规划/执行管线的第二个 `scope`。

## 1. 设计目标

- 让「我的待办」与「今天任务」共用同一套前端组件、后端执行器和 Skill 管线。
- 仅通过 `scope` 参数区分数据范围、brief 指针表和展示记忆。
- 避免复制粘贴代码，保证业务行为一致。

## 2. 概念模型

```text
┌─────────────────────────────────────────────────────────────┐
│                        PlanScope                             │
│              "today"                  "todo"                 │
│                 │                       │                    │
│   ┌─────────────▼──────────┐  ┌─────────▼──────────┐         │
│   │ employee_today_briefs  │  │ employee_todo_briefs│        │
│   │ task_artifacts.today_* │  │ task_artifacts.todo_*│       │
│   └─────────────┬──────────┘  └─────────┬──────────┘         │
│                 │                       │                    │
│                 └───────────┬───────────┘                    │
│                             ▼                                │
│              today-plan-run.ts 执行器                         │
│              today-plan-context.ts HOST PACK                  │
│              today-brief.ts / today-tasks.ts                  │
│                             │                                │
│              ┌──────────────┴──────────────┐                 │
│              ▼                              ▼                 │
│      /api/home/today-brief          /api/home/todo-brief      │
│      /api/home/today-tasks          /api/home/todo-tasks      │
│      /api/home/today-brief/plan     /api/home/todo-brief/plan │
└─────────────────────────────────────────────────────────────┘
```

## 3. 前端复用

### 3.1 入口与路由

| 项 | 文件 | 说明 |
|---|---|---|
| 页面 | `frontend/src/pages/Home.tsx` | 同一页面，按 URL query `?tab=` 切换 today/todo |
| 路由 | `frontend/src/App.tsx:41` | `/` 映射 `Home`，`?tab=today` / `?tab=todo` |
| 模式解析 | `frontend/src/home/modes.ts` | `HOME_MODES = ["today","todo","discovery","pool","lifecycle"]` |

### 3.2 共享组件

| 组件 | 路径 | 复用方式 |
|---|---|---|
| `TaskBoard` | `frontend/src/home/TaskBoard.tsx` | 通过 `scope` prop 切换按钮文案与事件：`"启动今日任务"` / `"启动待办任务"` |
| `BoardRow` | `frontend/src/home/BoardRow.tsx` | 单行渲染，数据属性通用 |
| `TodayPlanProgress` | `frontend/src/home/TodayPlanProgress.tsx` | 规划思考流，`scope` 区分 today/todo |
| `PlanSummary` | `frontend/src/home/PlanSummary.tsx` | brief 摘要，复用 |

### 3.3 共享规划链

文件：`frontend/src/home/todayPlan.ts`

```ts
export async function runTodayPlanRefresh(
  client: TodayPlanClient,
  onStep: (step: TodayPlanStep) => void,
  options?: {
    pollMs?: number;
    signal?: AbortSignal;
    sleep?: (ms: number) => Promise<void>;
    scope?: "today" | "todo";
    startPlan?: boolean;
  },
): Promise<TodayPlanStep>
```

- `options.scope` 决定调用 `/api/home/{scope}-brief` 与 `/api/home/{scope}-brief/plan`。
- `options.startPlan=false` 时只做记忆读取，不触发模型。
- 缓存隔离：`lingong:today-plan-cache` / `lingong:todo-plan-cache`，TTL 5 分钟。

### 3.4 API 封装

文件：`frontend/src/api.ts`

```ts
todayBrief: () => request<TodayBriefResponse>("/api/home/today-brief"),
planToday:  () => request<TodayPlanResult>("/api/home/today-brief/plan", { method: "POST" }),
todoBrief:  () => request<TodayBriefResponse>("/api/home/todo-brief"),
planTodo:   () => request<TodayPlanResult>("/api/home/todo-brief/plan", { method: "POST" }),
```

### 3.5 数据分流规则

文件：`frontend/src/home/schedule.ts`

```ts
export function isTodayScheduled(task: Task): boolean
```

今日判定条件：
- 高风险
- 今天开始
- 临期到期（未来两日内到期）/ 今天到期 / 逾期

运行中、审批中和高优先级**本身不构成**今日条件；只要仍未完成但不满足上述条件，就属于「我的待办」。

`TodoPane` 使用 `!isTodayScheduled(task)` 过滤，避免 todo 列表重复展示今日任务。

## 4. 后端复用

### 4.1 路由

文件：`backend/src/routers/home-today.ts`

| 方法 | today 路径 | todo 路径 | 说明 |
|---|---|---|---|
| GET | `/api/home/today-brief` | `/api/home/todo-brief` | 封面记忆 |
| GET | `/api/home/today-tasks` | `/api/home/todo-tasks` | 展示行 |
| POST | `/api/home/today-brief/plan` | `/api/home/todo-brief/plan` | 启动规划 |

### 4.2 共享执行器

文件：`backend/src/host/today-plan-run.ts`

```ts
export function startTodayPlan(
  owner: string,
  scope: PlanScope = "today",
): { work_item_id; session_id; run_id; attached; planning; }
```

- `scope: "today" | "todo"` 决定 `task_type`、`briefPointerTable`、展示记忆写入目标。
- 已有运行中规划时 `attached=true`，复用不重复启动。

### 4.3 HOST PACK 上下文

文件：`backend/src/host/today-plan-context.ts`

```ts
export type PlanScope = "today" | "todo";

export function planTaskType(scope: PlanScope): "today_plan" | "todo_plan";
export function briefPointerTable(scope: PlanScope): "employee_today_briefs" | "employee_todo_briefs";
export function collectSourceCatalog(owner: string, scope: PlanScope): Catalog;
```

`collectSourceCatalog()` 对正式未完成任务使用同一条判定作互斥分流：`today` 只保留今日条件命中的任务，`todo` 只保留其余任务，避免规划上下文或展示重复。

### 4.4 数据模型分流

| 层级 | today | todo |
|---|---|---|
| brief 指针表 | `employee_today_briefs` | `employee_todo_briefs` |
| 展示记忆 | `task_artifacts.artifact_type = "today_tasks"` | `task_artifacts.artifact_type = "todo_tasks"` |
| 规划任务类型 | `work_items.task_type = "today_plan"` | `work_items.task_type = "todo_plan"` |
| 员工记忆 kind | `task_cover` | `todo_cover` |

### 4.5 Skill 定义

- `backend/skills/today_plan/SKILL.md`：id `today_plan`
- `backend/skills/todo_plan/SKILL.md`：id `todo_plan`，明确复用 today_plan 管线，仅替换 scope 与展示记忆

## 5. 关键不变量

- **发送 ≠ 推进阶段**：规划只是生成 brief/展示记忆，不修改任务正式阶段。
- **L1/L2/L3 分档可见**：规划是只读/草稿生成（L2），必须明确标注为 Codex 产出；任何正式写入（如发送、阶段推进）走独立 L3 入口。
- **状态不能只靠颜色表达**：任务优先级、运行状态同时用文字/标签展示。
- **同一时间只跑一个同 scope 规划任务**：`one_running_today_plan` 唯一索引覆盖 `today_plan`；todo 规划目前依赖应用层检查，扩展新 scope 时需评估是否加同类约束。

## 6. 扩展新 scope 的 checklist

若未来需要第三种任务视图（如 `"week"`）：

1. 前端
   - `frontend/src/home/modes.ts` 增加模式
   - `frontend/src/api.ts` 增加 `{scope}Brief()` / `plan{Scope}()`
   - `frontend/src/pages/Home.tsx` 增加模式分支（建议先拆分 `Home.tsx` 模式分支）
2. 后端
   - `backend/src/routers/home-today.ts` 增加 `/{scope}-brief`、`-tasks`、`-brief/plan`
   - `backend/src/host/today-plan-context.ts` 扩展 `PlanScope` 与分支函数
   - `backend/src/host/memory-kinds.ts` 增加 memory kind
3. 数据库
   - 增加 `employee_<scope>_briefs` 指针表
   - `task_artifacts` 使用新的 `artifact_type`
4. Skill
   - 新增 `backend/skills/<scope>_plan/SKILL.md`
5. 同步更新
   - `home-board.ts:198` 的 `PLANNING_TASK_TYPES`
   - `today-brief.ts:263` 的 `PLANNING_TASK_TYPES`
   - 评估是否需要新的唯一索引约束

## 7. 参考文件

- 前端页面：`frontend/src/pages/Home.tsx`
- 前端模式：`frontend/src/home/modes.ts`
- 前端规划链：`frontend/src/home/todayPlan.ts`
- 前端任务表：`frontend/src/home/TaskBoard.tsx`
- 前端分流：`frontend/src/home/schedule.ts`
- 后端路由：`backend/src/routers/home-today.ts`
- 后端执行器：`backend/src/host/today-plan-run.ts`
- 后端上下文：`backend/src/host/today-plan-context.ts`
- 后端 brief：`backend/src/host/today-brief.ts`
- Skill：`backend/skills/today_plan/SKILL.md`、`backend/skills/todo_plan/SKILL.md`
