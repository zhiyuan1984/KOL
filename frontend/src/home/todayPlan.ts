/**
 * Home Today planning chain — memory first, then think, never skip for freshness.
 *
 * Entering Home (Today or My Todo share this chain):
 * 1. memory: paged GET /api/workbench/tasks (task/raw) + GET /api/home/today-brief (summary/display)
 *    + GET /api/home/today-tasks (task/display). Today list eats display, not raw open tasks.
 * 2. think:  POST /api/home/{scope}-brief/plan (both routes attach one canonical today_plan)
 * 3. poll GET today-brief until planning=false; then reload today-tasks
 * 4. success → replace display memory only (no formal work_items rewrite)
 * 5. failure → keep previous display memory
 */
import type { Task, TaskEvent, TodayBrief, TodayBriefResponse, TodayPlanResult } from "../api";
import type { DisplayTaskRow } from "./displayTasks";
import { applyLayoutWhy, isPlanningTask } from "./homeModel";

export { applyLayoutWhy };

/** Display refresh: re-read memory only. Never starts a thinking run. */
export const TODAY_PLAN_REFRESH_EVENT = "lingong:today-plan-refresh";
/**
 * Explicit start entries. Entering a page must not POST /…/plan on its own:
 * the think run starts only because the employee pressed 启动 today / todo.
 */
export const TODAY_PLAN_START_EVENT = "lingong:today-plan-start";
export const TODO_PLAN_START_EVENT = "lingong:todo-plan-start";

/** Plan scope mirrors the backend: today = 今日规划 chain, todo = 待办规划 chain. */
export type PlanScope = "today" | "todo";

export const PLAN_SCOPES: readonly PlanScope[] = ["today", "todo"];

const PLAN_PHASE_COPY: Record<PlanScope, { "loading-memory": string; planning: string; refreshed: string; failed: string }> = {
  today: {
    "loading-memory": "正在读取当前任务",
    planning: "Lucas正在高效为你规划今天的任务",
    refreshed: "已按本轮规划刷新",
    failed: "规划失败，仍可按下面任务操作",
  },
  todo: {
    "loading-memory": "正在读取待办任务",
    planning: "Lucas正在高效为你规划待办任务",
    refreshed: "已按本轮规划刷新",
    failed: "待办规划失败，仍可按下面任务操作",
  },
};

export const TODAY_PLAN_PHASE_COPY = PLAN_PHASE_COPY.today;

export type TodayPlanActivePhase = keyof typeof TODAY_PLAN_PHASE_COPY;
export type TodayPlanPhase = TodayPlanActivePhase | "idle";

export const TODAY_PLAN_POLL_MS = 1_000;
export const TODAY_PLAN_REFRESHED_MS = 4_000;

export const TODAY_PLAN_CACHE_KEY = "lingong:today-plan-cache";
export const TODO_PLAN_CACHE_KEY = "lingong:todo-plan-cache";
/** Cache planning results for 5 minutes to avoid re-running Codex on every Home remount. */
export const PLAN_CACHE_TTL_MS = 5 * 60 * 1_000;

/**
 * Per-scope frontend config: cache key + explicit start event + pane copy.
 * Both tabs render one ScopeWorkspace, so every string that may differ lives here.
 */
export interface FrontendScopeConfig {
  scope: PlanScope;
  cacheKey: string;
  startEvent: string;
  /** Board plan button labels: idle names the action, again names the re-run. */
  boardIdleLabel: string;
  boardAgainLabel: string;
  /** Board plan button label after a failed run: names the retry, not a fresh start. */
  boardRetryLabel: string;
  /** Noun used by the plan status line ("今日计划" / "我的待办"). */
  planNoun: string;
  /** Workspace center header. */
  heroTitle: string;
  /** Right-rail board title. */
  boardTitle: string;
  /** Right-rail aria label for the region. */
  railLabel: string;
  /** Safe renderer contract for this plan scope's right rail. */
  resultType: "today_tasks" | "todo_tasks";
  /** Vertical label shown while the rail is collapsed. */
  railToggleLabel: string;
  /** Rail search placeholder + aria name. The board only searches its own rows. */
  boardSearchLabel: string;
  /** Collapsed state is remembered per scope. */
  railStorageKey: string;
  /** Board empty state (no rows at all). */
  emptyCopy: { title: string; hint: string };
  /** Plan-summary label above the brief lead. */
  planSummaryLabel: string;
  /** Center-column empty state (idle, nothing planned yet). */
  streamEmpty: { title: string; body: string };
}

export const SCOPE_CONFIG: Record<PlanScope, FrontendScopeConfig> = {
  today: {
    scope: "today",
    cacheKey: TODAY_PLAN_CACHE_KEY,
    startEvent: TODAY_PLAN_START_EVENT,
    boardIdleLabel: "启动今日任务",
    boardAgainLabel: "整理今日任务",
    boardRetryLabel: "重新规划今日计划",
    planNoun: "今日计划",
    heroTitle: "今天有什么工作要处理？",
    boardTitle: "今日工作计划",
    railLabel: "今日任务表",
    resultType: "today_tasks",
    railToggleLabel: "今日任务",
    boardSearchLabel: "搜索任务",
    railStorageKey: "ui:home-today-task-rail-collapsed",
    emptyCopy: {
      title: "今天没有需要处理的任务",
      hint: "逾期、今天开始或到期、进行中和高优先的任务会出现在这里。",
    },
    planSummaryLabel: "今日计划摘要",
    streamEmpty: {
      title: "从今天的工作开始",
      body: "启动今日任务后，这里会展示 Codex 的真实规划过程与结果摘要。",
    },
  },
  todo: {
    scope: "todo",
    cacheKey: TODO_PLAN_CACHE_KEY,
    startEvent: TODO_PLAN_START_EVENT,
    boardIdleLabel: "整理待办",
    boardAgainLabel: "整理待办",
    boardRetryLabel: "重新规划待办计划",
    planNoun: "我的待办",
    heroTitle: "我的待办",
    boardTitle: "我的待办",
    railLabel: "待办任务表",
    resultType: "todo_tasks",
    railToggleLabel: "我的待办",
    boardSearchLabel: "搜索任务",
    railStorageKey: "ui:home-todo-task-rail-collapsed",
    emptyCopy: {
      title: "没有待办任务",
      hint: "今日范围之外的未了结任务会出现在这里。",
    },
    planSummaryLabel: "待办计划摘要",
    streamEmpty: {
      title: "从待办开始",
      body: "启动待办任务后，这里会展示 Codex 的真实规划过程与结果摘要。",
    },
  },
};

export function planCacheKey(scope: PlanScope): string {
  return SCOPE_CONFIG[scope].cacheKey;
}

/** One browser cache for the canonical plan; today/todo are only projections. */
export function canonicalPlanCacheKey(): string {
  return SCOPE_CONFIG.today.cacheKey;
}

export function planStartEvent(scope: PlanScope): string {
  return SCOPE_CONFIG[scope].startEvent;
}

export type PlanCache = {
  timestamp: number;
  memoryTasks: Task[];
  brief: TodayBrief | null;
  events: TaskEvent[];
  snapshot?: PlanSnapshotInfo;
  phase: TodayPlanPhase;
};

export function savePlanCache(key: string, cache: PlanCache): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(cache));
  } catch {
    // Ignore quota/security errors.
  }
}

export function restorePlanCache(key: string): PlanCache | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PlanCache;
    if (!parsed.timestamp || Date.now() - parsed.timestamp > PLAN_CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearPlanCache(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Ignore.
  }
}

/** Cached plans carry task rows, so they must not survive a logout. */
export function clearPlanCaches(): void {
  for (const scope of PLAN_SCOPES) {
    clearPlanCache(planCacheKey(scope));
  }
}

export { PLANNING_TASK_TYPES, PLANNING_TASK_TYPES_SET } from "./planningTypes.js";

export type TodayPlanClient = {
  listOpenTasks: (signal?: AbortSignal) => Promise<Task[]>;
  getBrief: (signal?: AbortSignal) => Promise<TodayBriefResponse>;
  startPlan: () => Promise<TodayPlanResult>;
  getDisplayTasks?: (signal?: AbortSignal) => Promise<DisplayTaskRow[]>;
};

export type TodayPlanStep = {
  phase: TodayPlanPhase;
  tasks?: Task[];
  displayTasks?: DisplayTaskRow[];
  brief?: TodayBrief | null;
  events?: TaskEvent[];
  previousBrief?: TodayBrief | null;
  previousEvents?: TaskEvent[];
  planning?: boolean;
  attached?: boolean;
  snapshot?: PlanSnapshotInfo;
};

export type PlanSnapshotInfo = Pick<TodayBriefResponse,
  "plan_id" | "status" | "producer" | "source_revision" | "generated_at" | "stale_reason">;

export type TodayPlanRefreshOptions = {
  pollMs?: number;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
  scope?: PlanScope;
  /**
   * `false` = memory pass only: read the list / brief / display rows and stop at
   * `idle` without POSTing /…/plan. Page entry uses this so entering a tab never
   * starts a model run; the start entries pass `true`.
   */
  startPlan?: boolean;
};

export function todayPlanStatusCopy(phase: TodayPlanPhase, scope: PlanScope = "today"): string {
  if (phase === "idle") return "";
  return PLAN_PHASE_COPY[scope][phase];
}

/** Planning clock only. `7` → `0:07`, `62` → `1:02`. */
export function formatTodayPlanElapsed(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Single source of truth for the plan provenance line. Every surface that talks
 * about the plan's freshness (center status banner, rail summary) must call this
 * — a hardcoded "来源已核验" next to a stale snapshot is how the page ends up
 * contradicting itself. No snapshot → no claim.
 */
export function planSourceStatus(snapshot?: PlanSnapshotInfo | null): string {
  if (!snapshot?.generated_at) return "";
  if (snapshot.stale_reason === "source_lookup_failed") return "来源暂时无法核验，正在显示上次可用计划";
  if (snapshot.stale_reason) return "来源已变化，正在显示上次可用计划";
  return "来源已核验";
}

/**
 * The plan's real generation clock: snapshot.generated_at first, a caller
 * fallback (e.g. the last event time) second, and never "now" — rendering the
 * current time as the generation time is what makes a stale cached plan read as
 * freshly generated on re-entry.
 */
export function planGeneratedLabel(snapshot?: PlanSnapshotInfo | null, fallback = ""): string {
  const raw = String(snapshot?.generated_at || "").trim() || String(fallback || "").trim();
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw.slice(0, 5);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function todayPlanEventLabels(events: TaskEvent[] | null | undefined): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const event of events || []) {
    const label = String(event.title || event.label || event.summary || "").trim();
    if (!label || seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  return labels;
}

function eventsOf(row: TodayBriefResponse | undefined): TaskEvent[] | undefined {
  return Array.isArray(row?.events) ? row.events : undefined;
}

function snapshotOf(row: TodayBriefResponse | undefined): PlanSnapshotInfo | undefined {
  if (!row) return undefined;
  return {
    plan_id: row.plan_id,
    status: row.status,
    producer: row.producer,
    source_revision: row.source_revision,
    generated_at: row.generated_at,
    stale_reason: row.stale_reason,
  };
}

export function memoryTasksOf(rows: Task[] | null | undefined): Task[] {
  return (rows || []).filter((row) => !isPlanningTask(row));
}

const PLAN_FAILED_LABEL: Record<PlanScope, RegExp> = {
  today: /规划失败|今日规划失败|今日规划未通过/,
  todo: /待办规划失败|待办规划未通过/,
};

const PLAN_COMPLETED_LABEL: Record<PlanScope, RegExp> = {
  today: /今日规划已完成/,
  todo: /待办规划已完成/,
};

/** A persisted terminal failure wins over a stale in-flight flag from a prior poll. */
export function planFailureFromEvents(events: TaskEvent[] | null | undefined, scope: PlanScope = "today"): boolean {
  return (events || []).some((event) => {
    const type = String(event.type || event.event_type || "").toLowerCase();
    if (type === "run.failed" || type === "failed") return true;
    const status = String(event.status || "").toLowerCase();
    if (status === "failed") return true;
    const label = String(event.label || event.title || event.summary || "");
    return PLAN_FAILED_LABEL[scope].test(label);
  });
}

/** 完成行同样是终态：否则轮询慢一拍时，标题会停在「规划中」而列表里已是 ✓ 今日规划已完成。 */
export function planCompletedFromEvents(events: TaskEvent[] | null | undefined, scope: PlanScope = "today"): boolean {
  return (events || []).some((event) => {
    const type = String(event.type || event.event_type || "").toLowerCase();
    if (type === "run.completed" || type === "completed") return true;
    const label = String(event.label || event.title || event.summary || "");
    return PLAN_COMPLETED_LABEL[scope].test(label);
  });
}

export function todayPlanFailedFromBrief(row: TodayBriefResponse, scope: PlanScope = "today"): boolean {
  return planFailureFromEvents(row.events, scope);
}

/** Keeps the header, timer and trace in one terminal state when events arrive first. */
export function effectivePlanPhase(
  phase: TodayPlanPhase,
  events: TaskEvent[] | null | undefined,
  scope: PlanScope = "today",
): TodayPlanPhase {
  if (planFailureFromEvents(events, scope)) return "failed";
  if ((phase === "planning" || phase === "loading-memory") && planCompletedFromEvents(events, scope)) {
    return "refreshed";
  }
  return phase;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function aborted(signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted);
}

async function loadDisplayTasks(client: TodayPlanClient, signal?: AbortSignal): Promise<DisplayTaskRow[] | undefined> {
  if (!client.getDisplayTasks) return undefined;
  try {
    const rows = await client.getDisplayTasks(signal);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return undefined;
  }
}

/**
 * Default: memory GETs → think POST (or attach) → poll.
 * Never skip POST just because a brief already exists.
 * With `startPlan: false` it stops after the memory GETs and reports `idle`:
 * that is the page-entry pass, and it is what keeps tabs from starting a run.
 */
export async function runTodayPlanRefresh(
  client: TodayPlanClient,
  onStep: (step: TodayPlanStep) => void,
  options: TodayPlanRefreshOptions = {},
): Promise<TodayPlanStep> {
  const pollMs = options.pollMs ?? TODAY_PLAN_POLL_MS;
  const sleep = options.sleep || wait;
  const signal = options.signal;
  const scope = options.scope ?? "today";
  const startPlan = options.startPlan !== false;
  // A memory-only pass must not announce 正在启动: nothing is starting, and the
  // list still paints as each read lands.
  const memoryPhase: TodayPlanPhase = startPlan ? "loading-memory" : "idle";

  if (startPlan) onStep({ phase: memoryPhase });

  let tasks: Task[] | undefined;
  let displayTasks: DisplayTaskRow[] | undefined;
  let brief: TodayBrief | null = null;
  let memory: TodayBriefResponse | undefined;
  let events: TaskEvent[] | undefined;
  let previousBrief: TodayBrief | null | undefined;
  let previousEvents: TaskEvent[] | undefined;
  let snapshot: PlanSnapshotInfo | undefined;

  /** The previous version rides along with every brief read. */
  const absorbPrevious = (row: TodayBriefResponse) => {
    if (row.previous_brief !== undefined) previousBrief = row.previous_brief ?? null;
    if (Array.isArray(row.previous_events)) previousEvents = row.previous_events;
  };

  const tasksPromise = client.listOpenTasks(signal).then((rows) => {
    tasks = memoryTasksOf(rows);
    if (!aborted(signal)) {
      const step: TodayPlanStep = { phase: memoryPhase, tasks, displayTasks };
      if (memory) {
        step.brief = brief;
        step.planning = Boolean(memory.planning);
        if (events) step.events = events;
        if (previousBrief !== undefined) step.previousBrief = previousBrief;
        if (previousEvents) step.previousEvents = previousEvents;
        if (snapshot) step.snapshot = snapshot;
      }
      onStep(step);
    }
    return tasks;
  });
  const briefPromise = client.getBrief(signal).then((row) => {
    memory = row;
    snapshot = snapshotOf(row);
    if (row.brief !== undefined) brief = row.brief ?? null;
    const nextEvents = eventsOf(row);
    if (nextEvents) events = nextEvents;
    absorbPrevious(row);
    if (!aborted(signal)) {
      onStep({
        phase: memoryPhase,
        tasks,
        displayTasks,
        brief,
        events,
        previousBrief,
        previousEvents,
        planning: Boolean(row.planning),
        snapshot,
      });
    }
    return row;
  });
  const displayPromise = loadDisplayTasks(client, signal).then((rows) => {
    if (rows) displayTasks = rows;
    if (!aborted(signal) && rows) {
      onStep({
        phase: memoryPhase,
        tasks,
        displayTasks,
        brief,
        events,
        previousBrief,
        previousEvents,
        planning: Boolean(memory?.planning),
        snapshot,
      });
    }
    return rows;
  });

  await Promise.allSettled([tasksPromise, briefPromise, displayPromise]);
  if (aborted(signal)) return { phase: "idle", tasks, displayTasks, brief, events, previousBrief, previousEvents };

  // A run already in flight is joined, never re-posted: letting the memory-only
  // pass report `idle` here would hide a live plan behind「启动」. A last run that
  // failed stays visible as failed rather than reading as "never planned".
  if (!startPlan && !memory?.planning) {
    const settled: TodayPlanStep = {
      phase: memory && todayPlanFailedFromBrief(memory, scope) ? "failed" : "idle",
      tasks,
      displayTasks,
      brief,
      events,
      previousBrief,
      previousEvents,
      snapshot,
    };
    onStep(settled);
    return settled;
  }

  onStep({
    phase: "planning",
    tasks,
    displayTasks,
    brief,
    events,
    previousBrief,
    previousEvents,
    planning: true,
    attached: Boolean(memory?.planning),
    snapshot,
  });

  let attached = Boolean(memory?.planning);
  if (!memory?.planning) {
    try {
      const started = await client.startPlan();
      if (aborted(signal)) return { phase: "idle" };
      attached = Boolean(started.attached);
    } catch {
      const failed: TodayPlanStep = { phase: "failed", tasks, displayTasks, brief, events };
      onStep(failed);
      return failed;
    }
  }

  let errors = 0;
  while (!aborted(signal)) {
    try {
      const row = await client.getBrief(signal);
      if (aborted(signal)) return { phase: "idle" };
      errors = 0;
      snapshot = snapshotOf(row);
      if (row.brief !== undefined) brief = row.brief ?? brief;
      const nextEvents = eventsOf(row);
      if (nextEvents) events = nextEvents;
      absorbPrevious(row);
      // The events table is written atomically with the worker's terminal
      // result. It may beat the separate `planning` field by one poll.
      if (planFailureFromEvents(events, scope)) {
        const failed: TodayPlanStep = { phase: "failed", tasks, displayTasks, brief, events, previousBrief, previousEvents, snapshot };
        onStep(failed);
        return failed;
      }
      if (row.planning) {
        onStep({
          phase: "planning",
          tasks,
          displayTasks,
          brief,
          events,
          previousBrief,
          previousEvents,
          planning: true,
          attached,
          snapshot,
        });
        await sleep(pollMs);
        continue;
      }
      if (todayPlanFailedFromBrief(row, scope)) {
        const failed: TodayPlanStep = { phase: "failed", tasks, displayTasks, brief, events, previousBrief, previousEvents, snapshot };
        onStep(failed);
        return failed;
      }
      const nextDisplay = await loadDisplayTasks(client, signal);
      if (nextDisplay) displayTasks = nextDisplay;
      const refreshed: TodayPlanStep = { phase: "refreshed", tasks, displayTasks, brief, events, previousBrief, previousEvents, snapshot };
      onStep(refreshed);
      return refreshed;
    } catch {
      errors += 1;
      if (errors >= 3) {
        const failed: TodayPlanStep = { phase: "failed", tasks, displayTasks, brief, events, previousBrief, previousEvents };
        onStep(failed);
        return failed;
      }
      await sleep(pollMs);
    }
  }
  return { phase: "idle", tasks, displayTasks, brief, events };
}
