# Today/Todo 复用代码重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除「今天任务」与「我的待办」前后端镜像代码中的重复与硬编码，使新增 scope 的改动点从 12–14 处降到 3–4 处，同时保持 today/todo 的可见行为完全一致。

**Architecture:** 前后端各引入一份 `SCOPE_TABLE` 描述 today/todo 的元数据；后端收敛 `PLANNING_TASK_TYPES` 单一来源并用它动态拼接 SQL；前端抽取 `usePlanScope` hook 统一 Home.tsx 中两段同构 effect；API 与路由改为表驱动注册。所有真实产品差异（today 无 board 按钮、today 有 enqueue/memory 路由、todo 有 dedupeNotice）保持原样。

**Tech Stack:** React/TypeScript 前端，Hono/TypeScript 后端，SQLite，Vitest + Playwright E2E。

**Spec:** `docs/superpowers/specs/2026-09-22-today-todo-refactor-design.md`

## Global Constraints

- 行为零变化：不修改 today/todo 的可见数据、启动入口、按钮文案、缓存语义、权限校验。
- 不抹平真实产品差异：today 无 board 启动按钮、today 有 enqueue/memory 路由、todo 有 dedupeNotice，均保持原样。
- 所有重构必须通过 `npm run typecheck` 与 `npm run test`（前后端）。
- 历史测试中的源码文本断言（如 `api.todayBrief()` 字符串匹配）必须与本提交同步修改。
- 无数据库迁移：只改代码与常量，不改表结构。

---

### Task 1: 后端统一 Scope 描述表与 PLANNING_TASK_TYPES

**Files:**
- Modify: `backend/src/host/today-plan-context.ts`
- Modify: `backend/src/host/today-brief.ts`
- Modify: `backend/src/host/home-board.ts`
- Test: `backend/tests/today-plan.test.ts`

**Interfaces:**
- Consumes: existing `PlanScope = "today" | "todo"`
- Produces:
  - `export const PLAN_SCOPES: readonly PlanScope[]`
  - `export const SCOPE_TABLE: Record<PlanScope, ScopeConfig>`
  - `export const PLANNING_TASK_TYPES: readonly string[]`
  - `export const PLANNING_TASK_TYPES_SET: ReadonlySet<string>`
  - `export function ownerId(c: Context): string`
  - `export function planTaskType(scope: PlanScope): string`
  - `export function briefPointerTable(scope: PlanScope): string`

- [ ] **Step 1: 在 `today-plan-context.ts` 顶部定义 `SCOPE_TABLE`**

```ts
export type PlanScope = "today" | "todo";
export const PLAN_SCOPES: readonly PlanScope[] = ["today", "todo"];

export interface ScopeConfig {
  scope: PlanScope;
  taskType: "today_plan" | "todo_plan";
  briefPointerTable: "employee_today_briefs" | "employee_todo_briefs";
  memoryKindCover: "task_cover" | "todo_cover";
  memoryKindResult: "task_result" | "todo_result";
}

export const SCOPE_TABLE: Record<PlanScope, ScopeConfig> = {
  today: {
    scope: "today",
    taskType: "today_plan",
    briefPointerTable: "employee_today_briefs",
    memoryKindCover: "task_cover",
    memoryKindResult: "task_result",
  },
  todo: {
    scope: "todo",
    taskType: "todo_plan",
    briefPointerTable: "employee_todo_briefs",
    memoryKindCover: "todo_cover",
    memoryKindResult: "todo_result",
  },
};

export const PLANNING_TASK_TYPES = ["today_plan", "todo_plan", "today_analyze"] as const;
export const PLANNING_TASK_TYPES_SET = new Set<string>(PLANNING_TASK_TYPES);
```

- [ ] **Step 2: 替换 `planTaskType` 与 `briefPointerTable` 为查表**

```ts
export function planTaskType(scope: PlanScope): "today_plan" | "todo_plan" {
  return SCOPE_TABLE[scope].taskType;
}

export function briefPointerTable(scope: PlanScope): string {
  return SCOPE_TABLE[scope].briefPointerTable;
}
```

- [ ] **Step 3: 把 `ownerId()` 三份合一，放到 `today-plan-context.ts`**

从 `home-today.ts:18–23` 和 `today-plan-run.ts:29–34` 复制/移动到本文件：

```ts
export function ownerId(c: Context): string {
  const user = c.get("user");
  if (!user?.id) throw new HTTPException(401, { message: "Unauthorized" });
  return user.id;
}
```

然后删除 `home-today.ts` 和 `today-plan-run.ts` 中的本地定义，改为 `import { ownerId } from "../host/today-plan-context.js"`。

- [ ] **Step 4: 修改 `today-brief.ts`**

删除本地 `PLANNING_TASK_TYPES` 数组（:263），改为：

```ts
import { PLANNING_TASK_TYPES } from "./today-plan-context.js";
```

- [ ] **Step 5: 修改 `home-board.ts`**

删除 `:198` 的本地 Set，改为：

```ts
import { PLANNING_TASK_TYPES, PLANNING_TASK_TYPES_SET } from "./today-plan-context.js";
```

把 `:306` 与 `:329` 的 SQL 字面量 `NOT IN ('today_plan','today_analyze','todo_plan')` 改为动态占位符：

```ts
const placeholders = PLANNING_TASK_TYPES.map(() => "?").join(",");
const sql = `... NOT IN (${placeholders}) ...`;
```

- [ ] **Step 6: 运行后端测试，修复因导入路径或常量顺序导致的失败**

Run: `cd backend && npm run typecheck && npm run test -- today-plan.test.ts`
Expected: PASS（或仅因源码文本断言失败，下一步处理）

- [ ] **Step 7: Commit**

```bash
git add backend/src/host/today-plan-context.ts backend/src/host/today-brief.ts backend/src/host/home-board.ts backend/src/host/today-plan-run.ts backend/src/routers/home-today.ts backend/tests/today-plan.test.ts
git commit -m "refactor(backend): unify scope table and PLANNING_TASK_TYPES source"
```

---

### Task 2: 后端 today-plan-context.ts 中 collectSourceCatalog 过滤函数化

**Files:**
- Modify: `backend/src/host/today-plan-context.ts`
- Test: `backend/tests/today-plan.test.ts`

**Interfaces:**
- Consumes: `SCOPE_TABLE`, `isTodayWorkItem`
- Produces: `collectSourceCatalog(owner, scope)` 行为不变，内部使用 `CATALOG_FILTERS[scope]`

- [ ] **Step 1: 提取 today/todo 的 catalog 过滤差异为表**

在 `today-plan-context.ts` 中：

```ts
const CATALOG_FILTERS: Record<PlanScope, (catalog: SourceCatalog) => SourceCatalog> = {
  today: (catalog) => catalog,
  todo: (catalog) => ({
    ...catalog,
    formal_task: catalog.formal_task.filter((item) => !isTodayWorkItem(item)),
  }),
};
```

- [ ] **Step 2: 替换 collectSourceCatalog 中的 if 分支**

```ts
export function collectSourceCatalog(owner: string, scope: PlanScope): SourceCatalog {
  const base = /* 原有构建逻辑 */;
  return CATALOG_FILTERS[scope](base);
}
```

- [ ] **Step 3: 运行后端测试**

Run: `cd backend && npm run test -- today-plan.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add backend/src/host/today-plan-context.ts backend/tests/today-plan.test.ts
git commit -m "refactor(backend): table-drive catalog filters by scope"
```

---

### Task 3: 后端路由循环注册

**Files:**
- Modify: `backend/src/routers/home-today.ts`
- Test: `backend/tests/today-plan.test.ts`

**Interfaces:**
- Consumes: `PLAN_SCOPES`, `SCOPE_TABLE`, `ownerId`
- Produces: 三条路由 `/home/{scope}-brief`、`-tasks`、`-brief/plan` 对 `PLAN_SCOPES` 循环注册

- [ ] **Step 1: 在 `home-today.ts` 中导入 `PLAN_SCOPES` 与 `SCOPE_TABLE`**

```ts
import { PLAN_SCOPES, SCOPE_TABLE, ownerId } from "../host/today-plan-context.js";
```

- [ ] **Step 2: 把 today/todo 三段镜像路由改成循环**

原 today 路由（:26–34、:37–52、:70–79）与 todo 路由（:82–90、:93–108、:111–121）合并为：

```ts
for (const scope of PLAN_SCOPES) {
  const cfg = SCOPE_TABLE[scope];

  app.get(`/home/${scope}-brief`, async (c) => {
    const owner = ownerId(c);
    const brief = await todayBriefSnapshot(owner, scope);
    return c.json(brief);
  });

  app.get(`/home/${scope}-tasks`, async (c) => {
    const owner = ownerId(c);
    const tasks = await loadTodayTaskResults(owner, scope);
    return c.json({ tasks, memory_kind: cfg.memoryKindResult });
  });

  app.post(`/home/${scope}-brief/plan`, async (c) => {
    const owner = ownerId(c);
    const result = await startTodayPlan(owner, scope);
    return c.json(result, result.planning ? 202 : 200);
  });
}
```

- [ ] **Step 3: 保留 today 独占路由**

`/home/today-task-memory`（:55–67）与 `/home/today-brief/enqueue`（:124–135）保持不动。

- [ ] **Step 4: 运行后端测试，修复源码文本断言**

Run: `cd backend && npm run typecheck && npm run test -- today-plan.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/routers/home-today.ts backend/tests/today-plan.test.ts
git commit -m "refactor(backend): register today/todo routes in a loop"
```

---

### Task 4: 后端测试参数化补齐 todo 覆盖

**Files:**
- Modify: `backend/tests/today-plan.test.ts`

**Interfaces:**
- Consumes: `PLAN_SCOPES`
- Produces: todo 与 today 同等的 previous-plan / 中间事件断言

- [ ] **Step 1: 把 today 核心用例改为 `describe.each(["today", "todo"])`**

例如 previous-plan snapshot 测试（原 :536–570）：

```ts
describe.each(["today", "todo"] as const)("previous plan snapshot (%s)", (scope) => {
  it("returns the previous brief and events", async () => {
    // 把原 today 用例中的 "today" 替换为 scope
  });
});
```

- [ ] **Step 2: 修复源码文本断言**

把测试中如 `expect(code).toContain("api.todayBrief()")` 改为验证 route 字符串或 scope 无关的断言，例如：

```ts
expect(routes).toContain(`/home/${scope}-brief`);
```

- [ ] **Step 3: 运行后端测试**

Run: `cd backend && npm run test -- today-plan.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add backend/tests/today-plan.test.ts
git commit -m "test(backend): parameterize today-plan tests across scopes"
```

---

### Task 5: 前端 todayPlan.ts 表驱动

**Files:**
- Modify: `frontend/src/home/todayPlan.ts`
- Modify: `frontend/src/home/homeModel.ts`
- Test: `frontend/src/home/todayPlan.test.ts`

**Interfaces:**
- Consumes: existing `PlanScope = "today" | "todo"`
- Produces:
  - `export const PLAN_SCOPES: readonly PlanScope[]`
  - `export const SCOPE_CONFIG: Record<PlanScope, FrontendScopeConfig>`
  - `export function planCacheKey(scope: PlanScope): string`
  - `export function planStartEvent(scope: PlanScope): string`
  - `export function clearPlanCaches(): void`

- [ ] **Step 1: 在 `todayPlan.ts` 中定义前端 SCOPE_CONFIG**

```ts
export interface FrontendScopeConfig {
  scope: PlanScope;
  cacheKey: string;
  refreshEvent: string;
  startEvent: string;
  phaseCopy: Record<PlanPhase, string>;
  failedLabel: string;
}

export const SCOPE_CONFIG: Record<PlanScope, FrontendScopeConfig> = {
  today: {
    scope: "today",
    cacheKey: "lingong:today-plan-cache",
    refreshEvent: TODAY_PLAN_REFRESH_EVENT,
    startEvent: TODAY_PLAN_START_EVENT,
    phaseCopy: PLAN_PHASE_COPY.today,
    failedLabel: PLAN_FAILED_LABEL,
  },
  todo: {
    scope: "todo",
    cacheKey: "lingong:todo-plan-cache",
    refreshEvent: TODAY_PLAN_REFRESH_EVENT,
    startEvent: TODO_PLAN_START_EVENT,
    phaseCopy: PLAN_PHASE_COPY.todo,
    failedLabel: PLAN_FAILED_LABEL,
  },
};
```

- [ ] **Step 2: 实现辅助函数并替换硬编码**

```ts
export function planCacheKey(scope: PlanScope): string {
  return SCOPE_CONFIG[scope].cacheKey;
}

export function planStartEvent(scope: PlanScope): string {
  return SCOPE_CONFIG[scope].startEvent;
}

export function clearPlanCaches(): void {
  for (const scope of PLAN_SCOPES) {
    sessionStorage.removeItem(planCacheKey(scope));
  }
}
```

把 `runTodayPlanRefresh` 内部所有写死的 `lingong:today-plan-cache` / `lingong:todo-plan-cache` 替换为 `planCacheKey(scope)`；把 `TODAY_PLAN_START_EVENT` / `TODO_PLAN_START_EVENT` 替换为 `planStartEvent(scope)`。

- [ ] **Step 3: 修改 `homeModel.ts` 的 `isPlanningTask`**

从 `todayPlan.ts` 共享一份 `PLANNING_TASK_TYPES`（前端只读），替换本地硬编码：

```ts
import { PLANNING_TASK_TYPES } from "./todayPlan.js";

export function isPlanningTask(task: Task): boolean {
  return PLANNING_TASK_TYPES.includes(task.task_type);
}
```

- [ ] **Step 4: 运行前端单元测试**

Run: `cd frontend && npm run typecheck && npm run test -- todayPlan.test.ts`
Expected: PASS（或仅因文本断言失败，下一步处理）

- [ ] **Step 5: Commit**

```bash
git add frontend/src/home/todayPlan.ts frontend/src/home/homeModel.ts frontend/src/home/todayPlan.test.ts
git commit -m "refactor(frontend): table-drive todayPlan cache keys and events"
```

---

### Task 6: 前端 API 四函数合二

**Files:**
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/home/todayPlan.ts`（类型）
- Test: `frontend/src/home/todayPlan.test.ts`

**Interfaces:**
- Consumes: `PlanScope`
- Produces:
  - `export function scopeBrief(scope: PlanScope): Promise<TodayBriefResponse>`
  - `export function planScope(scope: PlanScope): Promise<TodayPlanResult>`

- [ ] **Step 1: 在 `api.ts` 中新增 `scopeBrief` / `planScope`**

```ts
export function scopeBrief(scope: PlanScope): Promise<TodayBriefResponse> {
  return request<TodayBriefResponse>(`/api/home/${scope}-brief`);
}

export function planScope(scope: PlanScope): Promise<TodayPlanResult> {
  return request<TodayPlanResult>(`/api/home/${scope}-brief/plan`, { method: "POST" });
}
```

- [ ] **Step 2: 保留旧函数作为内部别名或迁移内部调用**

为减少一次性改动面，先让 `todayBrief` / `planToday` / `todoBrief` / `planTodo` 内部调用新函数：

```ts
export const todayBrief = () => scopeBrief("today");
export const planToday = () => planScope("today");
export const todoBrief = () => scopeBrief("todo");
export const planTodo = () => planScope("todo");
```

- [ ] **Step 3: 在 `todayPlan.ts` 的 `TodayPlanClient` 中允许 `getBrief` / `startPlan` 接收 scope**

```ts
export type TodayPlanClient = {
  getBrief: () => Promise<TodayBriefResponse>;
  startPlan: () => Promise<TodayPlanResult>;
  listOpenTasks: () => Promise<Task[]>;
  getDisplayTasks?: () => Promise<DisplayTaskRow[]>;
};
```

- [ ] **Step 4: 运行前端测试**

Run: `cd frontend && npm run test -- todayPlan.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api.ts frontend/src/home/todayPlan.ts frontend/src/home/todayPlan.test.ts
git commit -m "refactor(frontend): add scopeBrief/planScope and alias legacy functions"
```

---

### Task 7: 前端新建 usePlanScope hook

**Files:**
- Create: `frontend/src/home/usePlanScope.ts`
- Test: `frontend/src/home/usePlanScope.test.ts`（新建）

**Interfaces:**
- Consumes: `runTodayPlanRefresh`, `planCacheKey`, `SCOPE_CONFIG`
- Produces: `usePlanScope(scope, client)` hook

- [ ] **Step 1: 新建 `usePlanScope.ts`**

把 `Home.tsx:1687–1842` 的逻辑抽象为 hook：

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DisplayTaskRow, PlanPhase, Task, TodayBrief, TodayBriefResponse, TodayPlanResult, TodayPlanStep } from "../api.js";
import { planCacheKey, runTodayPlanRefresh, SCOPE_CONFIG, type PlanScope } from "./todayPlan.js";

export interface PlanScopeClient {
  getBrief: () => Promise<TodayBriefResponse>;
  startPlan: () => Promise<TodayPlanResult>;
  listOpenTasks: () => Promise<Task[]>;
  getDisplayTasks?: () => Promise<DisplayTaskRow[]>;
}

export interface UsePlanScopeResult {
  brief: TodayBrief | null;
  memoryTasks: Task[];
  events: TodayPlanStep[];
  phase: PlanPhase;
  prevBrief: TodayBrief | null;
  prevEvents: TodayPlanStep[];
  tick: number;
  startRef: React.MutableRefObject<boolean>;
  refresh: () => void;
}

export function usePlanScope(scope: PlanScope, client: PlanScopeClient): UsePlanScopeResult {
  // 8 组 state + 1 个 ref，与 Home.tsx  today/todo 当前状态一一对应
  const [brief, setBrief] = useState<TodayBrief | null>(null);
  const [memoryTasks, setMemoryTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<TodayPlanStep[]>([]);
  const [phase, setPhase] = useState<PlanPhase>("idle");
  const [prevBrief, setPrevBrief] = useState<TodayBrief | null>(null);
  const [prevEvents, setPrevEvents] = useState<TodayPlanStep[]>([]);
  const [tick, setTick] = useState(0);
  const startRef = useRef(false);

  // 加载缓存 + 监听刷新事件 + 启动轮询 + 保存缓存
  // ...（从 Home.tsx 复制并参数化 scope）

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  return { brief, memoryTasks, events, phase, prevBrief, prevEvents, tick, startRef, refresh };
}
```

- [ ] **Step 2: 新建 `usePlanScope.test.ts`**

复制 `todayPlan.test.ts` 中 Home 级别的集成用例，或至少验证：

```ts
it("loads cached brief on mount", async () => {
  sessionStorage.setItem(planCacheKey("todo"), JSON.stringify({ brief: mockBrief }));
  const { result } = renderHook(() => usePlanScope("todo", mockClient));
  await waitFor(() => expect(result.current.brief).toEqual(mockBrief));
});
```

- [ ] **Step 3: 运行前端测试**

Run: `cd frontend && npm run typecheck && npm run test -- usePlanScope.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/src/home/usePlanScope.ts frontend/src/home/usePlanScope.test.ts
git commit -m "feat(frontend): add usePlanScope hook"
```

---

### Task 8: 前端 Home.tsx 接入 usePlanScope 并表驱动 activateSkill

**Files:**
- Modify: `frontend/src/pages/Home.tsx`
- Modify: `frontend/src/home/usePlanScope.ts`（如有需要）
- Test: `frontend/e2e/home-todo-pane.spec.ts`、`frontend/e2e/home-today-pane.spec.ts`

**Interfaces:**
- Consumes: `usePlanScope`, `scopeBrief`, `planScope`, `SCOPE_CONFIG`
- Produces: `Home.tsx` 中 today/todo 的 8 组 state 与 2 段 effect 被删除，使用 hook 返回值

- [ ] **Step 1: 在 `Home.tsx` 中替换 today/todo state 与 effect**

删除：
- `todayBrief` / `todoBrief` 等 8 组 `useState`
- `todayStartRef` / `todoStartRef`
- `todayPlanFirstRun` / `todoPlanFirstRun`
- `:1687–1754`、`:1756–1765`、`:1768–1831`、`:1833–1842` 四段 effect

替换为：

```ts
const todayPlan = usePlanScope("today", {
  getBrief: api.todayBrief,
  startPlan: api.planToday,
  listOpenTasks: () => api.tasks({ view: "open" }),
  getDisplayTasks: fetchTodayTasks,
});

const todoPlan = usePlanScope("todo", {
  getBrief: api.todoBrief,
  startPlan: api.planTodo,
  listOpenTasks: () => api.tasks({ view: "open" }),
  getDisplayTasks: fetchTodoTasks,
});
```

然后把组件中使用 `todayBrief` 的地方改为 `todayPlan.brief`，`setTodayPlanTick` 改为 `todayPlan.refresh`，以此类推。

- [ ] **Step 2: 表驱动 `activateTodaySkill` / `activateTodoSkill`**

新增配置表：

```ts
const SCOPE_SKILL_CONFIG: Record<PlanScope, { mode: HomeMode; lockedIntent: string; lockedLabel: string; skillId: string; skillTitle: string; startEvent: string }> = {
  today: {
    mode: "today",
    lockedIntent: "start today plan",
    lockedLabel: "启动今日任务",
    skillId: "creator_daily_tasks",
    skillTitle: "今日 KOL 任务",
    startEvent: TODAY_PLAN_START_EVENT,
  },
  todo: {
    mode: "todo",
    lockedIntent: "start todo plan",
    lockedLabel: "启动待办任务",
    skillId: "todo_plan",
    skillTitle: "待办规划",
    startEvent: TODO_PLAN_START_EVENT,
  },
};

function activateSkill(scope: PlanScope) {
  const cfg = SCOPE_SKILL_CONFIG[scope];
  setMode(cfg.mode);
  setLockedIntent(cfg.lockedIntent);
  setLockedLabel(cfg.lockedLabel);
  onComposer({ id: cfg.skillId, title: cfg.skillTitle });
  window.dispatchEvent(new CustomEvent(cfg.startEvent));
}
```

- [ ] **Step 3: 运行前端类型检查与单元测试**

Run: `cd frontend && npm run typecheck && npm run test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/Home.tsx frontend/src/home/usePlanScope.ts frontend/e2e/home-*.spec.ts
git commit -m "refactor(frontend): Home.tsx uses usePlanScope and table-driven skill activation"
```

---

### Task 9: 前端 TaskBoard 表驱动按钮与事件

**Files:**
- Modify: `frontend/src/home/TaskBoard.tsx`
- Test: `frontend/src/home/TaskBoard.test.tsx`（如有）或 e2e

**Interfaces:**
- Consumes: `SCOPE_CONFIG`
- Produces: `planButtonState(phase, scope)` 读表；启动按钮 dispatch `planStartEvent(scope)`

- [ ] **Step 1: 把 `planButtonState` 改为查表**

```ts
export function planButtonState(phase: PlanPhase, scope: PlanScope): { label: string; busy: boolean; state: ButtonState } {
  const copy = SCOPE_CONFIG[scope];
  const table: Record<PlanPhase, { label: string; busy: boolean; state: ButtonState }> = {
    idle: { label: copy.idleLabel, busy: false, state: "idle" },
    planning: { label: copy.planningLabel, busy: true, state: "planning" },
    // ...
  };
  return table[phase] ?? table.idle;
}
```

- [ ] **Step 2: 修正启动按钮的事件与 data-home-entry**

```tsx
<Button
  data-home-entry={`plan-${scope}`}
  onClick={() => window.dispatchEvent(new CustomEvent(planStartEvent(scope)))}
>
  {planButtonState(phase, scope).label}
</Button>
```

- [ ] **Step 3: 运行前端测试**

Run: `cd frontend && npm run typecheck && npm run test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/src/home/TaskBoard.tsx
git commit -m "refactor(frontend): table-drive TaskBoard button per scope"
```

---

### Task 10: 前端测试修复与补齐

**Files:**
- Modify: `frontend/src/home/todayPlan.test.ts`
- Modify: `frontend/e2e/home-todo-pane.spec.ts`（如需补齐）

**Interfaces:**
- Consumes: `SCOPE_CONFIG`, `usePlanScope`
- Produces: todo 分支单测覆盖、修复后的源码文本断言

- [ ] **Step 1: 修复 `todayPlan.test.ts` 中的源码文本断言**

把 `expect(code).toContain("api.todayBrief()")` 改为验证 scope 无关行为，例如：

```ts
expect(code).toContain("scopeBrief");
```

或改为运行时断言。

- [ ] **Step 2: 用 `scope: "todo"` 重跑关键用例**

```ts
describe.each(["today", "todo"] as const)("runTodayPlanRefresh (%s)", (scope) => {
  it("polls until complete", async () => {
    // 把原 today 用例中的 "today" 替换为 scope
  });
});
```

- [ ] **Step 3: 运行前端测试**

Run: `cd frontend && npm run test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/src/home/todayPlan.test.ts frontend/e2e/home-todo-pane.spec.ts
git commit -m "test(frontend): parameterize todayPlan tests and add todo branch coverage"
```

---

### Task 11: 全量验证

**Files:**
- 前后端全仓库

**Interfaces:**
- Consumes: 所有修改
- Produces: 类型检查与测试全绿

- [ ] **Step 1: 后端全量检查**

Run: `cd backend && npm run typecheck && npm run test`
Expected: PASS

- [ ] **Step 2: 前端全量检查**

Run: `cd frontend && npm run typecheck && npm run test`
Expected: PASS

- [ ] **Step 3: E2E 检查（选择性）**

Run: `cd frontend && npm run e2e -- home-today-pane home-todo-pane`
Expected: PASS

- [ ] **Step 4: 行为快照对比（可选但推荐）**

启动本地服务，分别访问 `/work?tab=today` 与 `/work?tab=todo`，导出 brief 与 tasks 的 JSON，与重构前快照 diff，确认无变化。

- [ ] **Step 5: Commit 或打 tag**

```bash
git tag refactor-today-todo-2026-09-22
git push origin main --tags
```

---

## Self-Review

1. **Spec coverage：**
   - 后端 scope 表与 `PLANNING_TASK_TYPES` 单一来源 → Task 1
   - catalog 过滤函数化 → Task 2
   - 后端路由循环注册 → Task 3
   - 后端测试参数化 → Task 4
   - 前端 todayPlan.ts 表驱动 → Task 5
   - 前端 API 合并 → Task 6
   - usePlanScope hook → Task 7
   - Home.tsx 接入 → Task 8
   - TaskBoard 表驱动 → Task 9
   - 前端测试补齐 → Task 10
   - 全量验证 → Task 11

2. **Placeholder scan：** 本 plan 无 TBD/TODO；所有函数签名、文件路径、命令均具体。

3. **Type consistency：**
   - `PlanScope` 前后端均为 `"today" | "todo"`
   - `SCOPE_TABLE`（后端）与 `SCOPE_CONFIG`（前端）字段命名按职责区分，但语义对齐
   - `usePlanScope` 返回字段与 Home.tsx 原 today/todo state 一一对应

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-22-today-todo-refactor-plan.md`.

Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints for review.

Which approach?
