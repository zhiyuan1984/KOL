# Today/Todo 复用代码重构设计

> 日期：2026-09-22
> 范围：前端 `frontend/src/pages/Home.tsx`、`frontend/src/home/*`、`frontend/src/api.ts`；后端 `backend/src/routers/home-today.ts`、`backend/src/host/*`
> 目标：消除 today/todo 镜像代码中的重复与硬编码，使新增 scope 从改 12–14 处降到 3–4 处，行为保持不变。

## 1. 审宪记录

| 项 | 内容 |
|---|---|
| 需求 | 优化「今天任务」与「我的待办」前后端复用代码，为后续扩展新 scope 做准备。 |
| 主责角色 | 架构师（接口与模块边界）、前端专家（前端 hooks 与组件）、后端专家（路由与上下文）、测试经理（回归范围）。 |
| 宪法条款 | CONST-04 角色决定权：本次重构只调整技术实现与接口组织，不改动业务权限、阶段判定或事实来源。CONST-08 先审宪、再审法：已核对 TECHNOLOGY.md 相关条款。CONST-10 交付必须可验证：重构必须通过既有测试 + 新增 todo 覆盖，并提供行为无变化的证据。 |
| 基本法条款 | TECH-ARCH-01 组件选择：不更换技术栈，仅在本栈内收敛常量与抽象。TECH-ARCH-04 共享契约：统一 scope 描述表，明确输入输出与兼容方式。TECH-FE-03 状态与恢复：重构后缓存 key、事件名保持稳定，切换页面不丢失状态。TECH-BE-01 每次访问校验权限：不改动权限校验逻辑。TECH-TEST-01/02：按规则验证，历史断言冲突时先核对规则。 |
| 结论与证据 | **符合**。本次重构是纯技术债清理，不引入新业务规则、不修改权限、不改变 today/todo 的可见数据与行为。 |
| 下一步 | 按本设计实施，完成后运行前后端测试与类型检查。 |

## 2. 当前问题

### 2.1 同一份清单多处维护

| 清单 | 副本位置 |
|---|---|
| 规划任务类型 `PLANNING_TASK_TYPES` | `backend/src/host/today-brief.ts:263`、`backend/src/host/home-board.ts:198` / `:306` / `:329`、`frontend/src/home/homeModel.ts:183` |
| today/todo scope 分支 | `backend/src/host/today-plan-context.ts` 多处三元、`frontend/src/home/todayPlan.ts` 多处三元/常量 |
| `ownerId()` | `today-plan-context.ts:96`、`home-today.ts:18`、`today-plan-run.ts:29` |

新增 scope 时，这些白名单式硬编码容易漏改。

### 2.2 前端 `Home.tsx` 两段逐行同构的 effect

`Home.tsx:1687–1754`（today）与 `:1768–1831`（todo）除了 scope、api 函数名、setter 前缀、cache key 外完全相同，约 64 × 2 行。另有 `:1756–1765` 与 `:1833–1842` 两段保存缓存的 effect 也互为镜像。

### 2.3 前后端镜像 API/路由

- 前端 `api.ts`：`todayBrief()` / `planToday()` / `todoBrief()` / `planTodo()` 四段镜像。
- 后端 `home-today.ts`：`/today-brief`、`-tasks`、`-brief/plan` 与 `/todo-brief`、`-tasks`、`-brief/plan` 三段镜像。

### 2.4 测试覆盖不对称

- `backend/tests/today-plan.test.ts` 严重偏 today，todo 缺少 previous-plan 与中间事件断言。
- `frontend/src/home/todayPlan.test.ts` 多数用例默认 today scope，todo 分支未直接覆盖。

## 3. 设计方案

### 3.1 核心原则

1. **行为零变化**：不修改 today/todo 的可见数据、启动入口、按钮文案、缓存语义。
2. **先收敛常量，再抽象结构**：Level 1 先消除白名单副本；Level 2 再把镜像代码改成表驱动。
3. **不抹平真实产品差异**：today 无 board 启动按钮、today 有 enqueue/memory 路由、todo 有 dedupeNotice，这些保持原样。

### 3.2 单一 scope 描述表

前后端各维护一份 `SCOPE_TABLE`，字段对齐：

```ts
interface ScopeConfig {
  scope: "today" | "todo";
  taskType: "today_plan" | "todo_plan";
  briefPointerTable: "employee_today_briefs" | "employee_todo_briefs";
  briefPath: "/api/home/today-brief" | "/api/home/todo-brief";
  planPath: "/api/home/today-brief/plan" | "/api/home/todo-brief/plan";
  tasksPath: "/api/home/today-tasks" | "/api/home/todo-tasks";
  cacheKey: "lingong:today-plan-cache" | "lingong:todo-plan-cache";
  startEvent: "today-plan-start" | "todo-plan-start";
  memoryKindCover: "task_cover" | "todo_cover";
  memoryKindResult: "task_result" | "todo_result";
  phaseCopy: Record<PlanPhase, string>;
  failedLabel: string;
  emptyCopy: { title: string; subtitle: string };
}
```

后端 `today-plan-context.ts` 的 `planTaskType()` / `briefPointerTable()` / `PLANNING_TASK_TYPES` 来源统一到此表；前端 `todayPlan.ts` 的 cache key / start event / phase copy / failed label 也读此表。

### 3.3 前端 `usePlanScope` hook

封装 `Home.tsx` 中 today/todo 重复的 useEffect 与状态：

```ts
function usePlanScope(
  scope: PlanScope,
  client: {
    getBrief: () => Promise<TodayBriefResponse>;
    startPlan: () => Promise<TodayPlanResult>;
    getDisplayTasks: () => Promise<DisplayTaskRow[]>;
  },
): {
  brief: TodayBrief | null;
  memoryTasks: Task[];
  events: TodayPlanStep[];
  phase: PlanPhase;
  prevBrief: TodayBrief | null;
  prevEvents: TodayPlanStep[];
  tick: number;
  startRef: MutableRefObject<boolean>;
  refresh: () => void;
}
```

Hook 内部统一处理：
- 加载缓存
- 监听刷新事件
- 启动 planning 轮询
- 保存缓存

`Home.tsx` 中 today/todo 的 8 组成对 state 与 2 段 effect 合并为：

```ts
const todayPlan = usePlanScope("today", {
  getBrief: api.todayBrief,
  startPlan: api.planToday,
  getDisplayTasks: fetchTodayTasks,
});
const todoPlan = usePlanScope("todo", {
  getBrief: api.todoBrief,
  startPlan: api.planTodo,
  getDisplayTasks: fetchTodoTasks,
});
```

### 3.4 后端路由循环注册

`home-today.ts` 中对 `PLAN_SCOPES` 数组循环注册三条路由：

```ts
for (const scope of PLAN_SCOPES) {
  app.get(`/home/${scope}-brief`, ...);
  app.get(`/home/${scope}-tasks`, ...);
  app.post(`/home/${scope}-brief/plan`, ...);
}
```

保持字面路径不变（不改成 `/:scope-brief`），避免与 `/today-task-memory`、enqueue 冲突，也避免 entry registry 的文本断言失效。

### 3.5 `PLANNING_TASK_TYPES` 单一来源

后端 `today-plan-context.ts` 新增：

```ts
export const PLANNING_TASK_TYPES = ["today_plan", "todo_plan", "today_analyze"] as const;
export const PLANNING_TASK_TYPES_SET = new Set(PLANNING_TASK_TYPES);
```

替换：
- `today-brief.ts:263` 的数组
- `home-board.ts:198` 的 Set
- `home-board.ts:306` / `:329` 的 SQL 字面量（用 `placeholders()` 动态拼）
- `today-plan-context.ts:184` 的 SQL 字面量
- `frontend/src/home/homeModel.ts:183` 的前端 `isPlanningTask`（从后端类型派生或共享常量）

### 3.6 catalog 过滤函数化

`today-plan-context.ts` 的 `collectSourceCatalog()` 保留框架，把 today/todo 的差异抽出：

```ts
const CATALOG_FILTERS: Record<PlanScope, (items: CatalogItem[]) => CatalogItem[]> = {
  today: (items) => items,
  todo: (items) => items.filter((i) => !isTodayWorkItem(i)),
};
```

### 3.7 测试补齐

- `backend/tests/today-plan.test.ts`：把 today 核心用例参数化成 `each(["today", "todo"])`，至少补齐 todo 的 previous-plan 与中间事件断言。
- `frontend/src/home/todayPlan.test.ts`：把 `runTodayPlanRefresh` 的测试用 `scope: "todo"` 重跑一遍，验证 cache key、事件名、API 路径参数化正确。
- `frontend/e2e`：保持 today/todo 各 3 个用例，但验证按钮文案与启动入口无变化。

## 4. 接口定义

### 4.1 后端新增/修改导出

```ts
// backend/src/host/today-plan-context.ts
export type PlanScope = "today" | "todo";
export const PLAN_SCOPES: readonly PlanScope[] = ["today", "todo"];
export const SCOPE_TABLE: Record<PlanScope, ScopeConfig>;
export const PLANNING_TASK_TYPES: readonly string[];
export const PLANNING_TASK_TYPES_SET: ReadonlySet<string>;
export function planTaskType(scope: PlanScope): "today_plan" | "todo_plan";
export function briefPointerTable(scope: PlanScope): string;
export function ownerId(c: Context): string;
export function collectSourceCatalog(owner: string, scope: PlanScope): Catalog;
```

### 4.2 前端新增/修改导出

```ts
// frontend/src/home/todayPlan.ts
export const PLAN_SCOPES: readonly PlanScope[] = ["today", "todo"];
export const SCOPE_CONFIG: Record<PlanScope, FrontendScopeConfig>;
export function planCacheKey(scope: PlanScope): string;
export function planStartEvent(scope: PlanScope): string;
export function clearPlanCaches(): void;

// frontend/src/home/usePlanScope.ts（新建）
export function usePlanScope(
  scope: PlanScope,
  client: PlanScopeClient,
): UsePlanScopeResult;

// frontend/src/api.ts
export function scopeBrief(scope: PlanScope): Promise<TodayBriefResponse>;
export function planScope(scope: PlanScope): Promise<TodayPlanResult>;
// 保留 todayBrief/planToday/todoBrief/planTodo 作为别名或迁移完成后删除
```

## 5. 文件变更清单

### 5.1 后端

| 文件 | 变更 |
|---|---|
| `backend/src/host/today-plan-context.ts` | 新增 `SCOPE_TABLE`、`PLANNING_TASK_TYPES`、`PLANNING_TASK_TYPES_SET`、统一 `ownerId`；`planTaskType` / `briefPointerTable` 查表；`collectSourceCatalog` 使用过滤函数表 |
| `backend/src/host/today-brief.ts` | `PLANNING_TASK_TYPES` 从 `today-plan-context` import；SQL 占位符动态化 |
| `backend/src/host/home-board.ts` | `PLANNING_TASK_TYPES` 与 SQL 字面量从 `today-plan-context` import；使用 `placeholders()` |
| `backend/src/host/today-plan-run.ts` | `ownerId` 从 `today-plan-context` import；`PLAN_EMPLOYEE_EVENTS` 读 `SCOPE_TABLE` |
| `backend/src/host/memory-kinds.ts` | `memoryKindForScope(scope, "cover" | "result")` 查表函数 |
| `backend/src/routers/home-today.ts` | 三条路由对 `PLAN_SCOPES` 循环注册；`ownerId` 统一来源 |

### 5.2 前端

| 文件 | 变更 |
|---|---|
| `frontend/src/home/usePlanScope.ts` | **新建**：统一 hook |
| `frontend/src/pages/Home.tsx` | 用 `usePlanScope` 替换 today/todo 的 8 组 state 与 2 段 effect；`activateTodaySkill` / `activateTodoSkill` 表驱动 |
| `frontend/src/home/todayPlan.ts` | `SCOPE_CONFIG` 表、`planCacheKey`、`planStartEvent`、`clearPlanCaches` 遍历；保留命名别名兼容 |
| `frontend/src/api.ts` | 新增 `scopeBrief` / `planScope`；保留旧函数或迁移内部使用 |
| `frontend/src/home/TaskBoard.tsx` | `planButtonState` 与启动事件读 `SCOPE_CONFIG`；修正 `data-home-entry` 按 scope 取值 |
| `frontend/src/home/homeModel.ts` | `isPlanningTask` 读共享常量 |

### 5.3 测试

| 文件 | 变更 |
|---|---|
| `backend/tests/today-plan.test.ts` | 核心 today 用例参数化到 todo；修复源码文本断言 |
| `frontend/src/home/todayPlan.test.ts` | 用 `scope: "todo"` 重跑关键用例；修复文本断言 |
| `frontend/e2e/home-todo-pane.spec.ts` | 如有需要，补齐启动路径断言 |

## 6. 测试策略

### 6.1 必须通过的验证

1. `cd backend && npm run typecheck && npm run test`
2. `cd frontend && npm run typecheck && npm run test`
3. `cd frontend && npm run e2e`（或相关 e2e 子集）

### 6.2 行为无变化证据

- 重构前后分别导出 today/todo 的 brief JSON 与 tasks JSON 快照，对比一致。
- e2e 中 today/todo 启动按钮文案、入口选择器、缓存恢复路径保持原值。

## 7. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 源码文本断言（如 `api.todayBrief()` 字符串匹配）批量变红 | 同提交修改测试，不拆分 PR |
| SQL 占位符顺序变化导致测试失败 | 测试不依赖顺序；必要时用 `expect.arrayContaining` |
| 缓存 key 或事件名误改导致状态丢失 | 保持 `SCOPE_CONFIG` 字段值与原硬编码一致 |
| 误抹平 today/todo 真实差异（如 today 无 board 按钮） | Code review 重点检查 `TaskBoard` 与 `Home.tsx` 的条件渲染 |

回滚：本次重构纯代码移动与常量收敛，无 DB 迁移，可直接 `git revert`。
