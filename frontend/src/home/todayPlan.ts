/**
 * Home Today planning chain — memory first, then think, never skip for freshness.
 *
 * Entering Home (Today or My Todo share this chain):
 * 1. memory: GET /api/tasks?view=open (task/raw) + GET /api/home/today-brief (summary/display)
 *    + GET /api/home/today-tasks (task/display). Today list eats display, not raw open tasks.
 * 2. think:  POST /api/home/today-brief/plan (or attach a running today_plan)
 * 3. poll GET today-brief until planning=false; then reload today-tasks
 * 4. success → replace display memory only (no formal work_items rewrite)
 * 5. failure → keep previous display memory
 */
import type { Task, TaskEvent, TodayBrief, TodayBriefResponse, TodayPlanResult } from "../api";
import type { DisplayTaskRow } from "./displayTasks";
import { applyLayoutWhy, isPlanningTask } from "./homeModel";

export { applyLayoutWhy };

export const TODAY_PLAN_REFRESH_EVENT = "lingong:today-plan-refresh";

/** Plan scope mirrors the backend: today = 今日规划 chain, todo = 待办规划 chain. */
export type PlanScope = "today" | "todo";

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

export type PlanCache = {
  timestamp: number;
  memoryTasks: Task[];
  brief: TodayBrief | null;
  events: TaskEvent[];
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
  clearPlanCache(TODAY_PLAN_CACHE_KEY);
  clearPlanCache(TODO_PLAN_CACHE_KEY);
}

export type TodayPlanClient = {
  listOpenTasks: () => Promise<Task[]>;
  getBrief: () => Promise<TodayBriefResponse>;
  startPlan: () => Promise<TodayPlanResult>;
  getDisplayTasks?: () => Promise<DisplayTaskRow[]>;
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
};

export type TodayPlanRefreshOptions = {
  pollMs?: number;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
  scope?: PlanScope;
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

export function memoryTasksOf(rows: Task[] | null | undefined): Task[] {
  return (rows || []).filter((row) => !isPlanningTask(row));
}

const PLAN_FAILED_LABEL: Record<PlanScope, RegExp> = {
  today: /规划失败|今日规划失败|今日规划未通过/,
  todo: /待办规划失败|待办规划未通过/,
};

export function todayPlanFailedFromBrief(row: TodayBriefResponse, scope: PlanScope = "today"): boolean {
  if (row.planning) return false;
  const events = Array.isArray(row.events) ? row.events : [];
  return events.some((event) => {
    const type = String(event.type || event.event_type || "").toLowerCase();
    if (type === "run.failed" || type === "failed") return true;
    const status = String(event.status || "").toLowerCase();
    if (status === "failed") return true;
    const label = String(event.label || event.title || event.summary || "");
    return PLAN_FAILED_LABEL[scope].test(label);
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function aborted(signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted);
}

async function loadDisplayTasks(client: TodayPlanClient): Promise<DisplayTaskRow[] | undefined> {
  if (!client.getDisplayTasks) return undefined;
  try {
    const rows = await client.getDisplayTasks();
    return Array.isArray(rows) ? rows : [];
  } catch {
    return undefined;
  }
}

/**
 * Always: memory GETs → think POST (or attach) → poll.
 * Never skip POST just because a brief already exists.
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

  onStep({ phase: "loading-memory" });

  let tasks: Task[] | undefined;
  let displayTasks: DisplayTaskRow[] | undefined;
  let brief: TodayBrief | null = null;
  let memory: TodayBriefResponse | undefined;
  let events: TaskEvent[] | undefined;
  let previousBrief: TodayBrief | null | undefined;
  let previousEvents: TaskEvent[] | undefined;

  /** The previous version rides along with every brief read. */
  const absorbPrevious = (row: TodayBriefResponse) => {
    if (row.previous_brief !== undefined) previousBrief = row.previous_brief ?? null;
    if (Array.isArray(row.previous_events)) previousEvents = row.previous_events;
  };

  const tasksPromise = client.listOpenTasks().then((rows) => {
    tasks = memoryTasksOf(rows);
    if (!aborted(signal)) {
      const step: TodayPlanStep = { phase: "loading-memory", tasks, displayTasks };
      if (memory) {
        step.brief = brief;
        step.planning = Boolean(memory.planning);
        if (events) step.events = events;
        if (previousBrief !== undefined) step.previousBrief = previousBrief;
        if (previousEvents) step.previousEvents = previousEvents;
      }
      onStep(step);
    }
    return tasks;
  });
  const briefPromise = client.getBrief().then((row) => {
    memory = row;
    if (row.brief !== undefined) brief = row.brief ?? null;
    const nextEvents = eventsOf(row);
    if (nextEvents) events = nextEvents;
    absorbPrevious(row);
    if (!aborted(signal)) {
      onStep({
        phase: "loading-memory",
        tasks,
        displayTasks,
        brief,
        events,
        previousBrief,
        previousEvents,
        planning: Boolean(row.planning),
      });
    }
    return row;
  });
  const displayPromise = loadDisplayTasks(client).then((rows) => {
    if (rows) displayTasks = rows;
    if (!aborted(signal) && rows) {
      onStep({
        phase: "loading-memory",
        tasks,
        displayTasks,
        brief,
        events,
        previousBrief,
        previousEvents,
        planning: Boolean(memory?.planning),
      });
    }
    return rows;
  });

  await Promise.allSettled([tasksPromise, briefPromise, displayPromise]);
  if (aborted(signal)) return { phase: "idle", tasks, displayTasks, brief, events, previousBrief, previousEvents };

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
      const row = await client.getBrief();
      if (aborted(signal)) return { phase: "idle" };
      errors = 0;
      if (row.brief !== undefined) brief = row.brief ?? brief;
      const nextEvents = eventsOf(row);
      if (nextEvents) events = nextEvents;
      absorbPrevious(row);
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
        });
        await sleep(pollMs);
        continue;
      }
      if (todayPlanFailedFromBrief(row, scope)) {
        const failed: TodayPlanStep = { phase: "failed", tasks, displayTasks, brief, events, previousBrief, previousEvents };
        onStep(failed);
        return failed;
      }
      const nextDisplay = await loadDisplayTasks(client);
      if (nextDisplay) displayTasks = nextDisplay;
      const refreshed: TodayPlanStep = { phase: "refreshed", tasks, displayTasks, brief, events, previousBrief, previousEvents };
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
