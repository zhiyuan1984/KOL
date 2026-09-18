/**
 * Home Today planning chain — memory first, then think, never skip for freshness.
 *
 * Entering Home (Today or My Todo share this chain):
 * 1. memory: one GET /api/tasks?view=open (+ GET /api/home/today-brief)
 *    The open-task list feeds BOTH TodayPane and TodoPane. Tab switch does not
 *    re-fetch tasks or GET /api/home/board.
 * 2. think:  POST /api/home/today-brief/plan (or attach a running today_plan)
 * 3. poll GET today-brief until planning=false; pass events into the pane
 * 4. success → write layout_why only (no board re-fetch, no formal todos)
 * 5. failure → keep the memory list
 */
import type { Task, TaskEvent, TodayBrief, TodayBriefResponse, TodayPlanResult } from "../api";
import { applyLayoutWhy, isPlanningTask } from "./homeModel";

export { applyLayoutWhy };

export const TODAY_PLAN_REFRESH_EVENT = "lingong:today-plan-refresh";

export const TODAY_PLAN_PHASE_COPY = {
  "loading-memory": "正在读取当前任务",
  planning: "Lucas正在高效为你规划今天的任务",
  refreshed: "已按本轮规划刷新",
  failed: "规划失败，仍可按下面任务操作",
} as const;

export type TodayPlanActivePhase = keyof typeof TODAY_PLAN_PHASE_COPY;
export type TodayPlanPhase = TodayPlanActivePhase | "idle";

export const TODAY_PLAN_POLL_MS = 1_000;
export const TODAY_PLAN_REFRESHED_MS = 4_000;

export type TodayPlanClient = {
  listOpenTasks: () => Promise<Task[]>;
  getBrief: () => Promise<TodayBriefResponse>;
  startPlan: () => Promise<TodayPlanResult>;
};

export type TodayPlanStep = {
  phase: TodayPlanPhase;
  tasks?: Task[];
  brief?: TodayBrief | null;
  events?: TaskEvent[];
  planning?: boolean;
  attached?: boolean;
};

export type TodayPlanRefreshOptions = {
  pollMs?: number;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
};

export function todayPlanStatusCopy(phase: TodayPlanPhase): string {
  if (phase === "idle") return "";
  return TODAY_PLAN_PHASE_COPY[phase];
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

export function todayPlanFailedFromBrief(row: TodayBriefResponse): boolean {
  if (row.planning) return false;
  const events = Array.isArray(row.events) ? row.events : [];
  return events.some((event) => {
    const type = String(event.type || event.event_type || "").toLowerCase();
    if (type === "run.failed" || type === "failed") return true;
    const status = String(event.status || "").toLowerCase();
    if (status === "failed") return true;
    const label = String(event.label || event.title || event.summary || "");
    return /规划失败|今日规划失败|今日规划未通过/.test(label);
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function aborted(signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted);
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

  onStep({ phase: "loading-memory" });

  let tasks: Task[] | undefined;
  let brief: TodayBrief | null = null;
  let memory: TodayBriefResponse | undefined;
  let events: TaskEvent[] | undefined;

  const tasksPromise = client.listOpenTasks().then((rows) => {
    tasks = memoryTasksOf(rows);
    if (!aborted(signal)) {
      const step: TodayPlanStep = { phase: "loading-memory", tasks };
      if (memory) {
        step.brief = brief;
        step.planning = Boolean(memory.planning);
        if (events) step.events = events;
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
    if (!aborted(signal)) {
      onStep({
        phase: "loading-memory",
        tasks,
        brief,
        events,
        planning: Boolean(row.planning),
      });
    }
    return row;
  });

  await Promise.allSettled([tasksPromise, briefPromise]);
  if (aborted(signal)) return { phase: "idle", tasks, brief, events };

  onStep({
    phase: "planning",
    tasks,
    brief,
    events,
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
      const failed: TodayPlanStep = { phase: "failed", tasks, brief, events };
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
      if (row.planning) {
        onStep({
          phase: "planning",
          tasks,
          brief,
          events,
          planning: true,
          attached,
        });
        await sleep(pollMs);
        continue;
      }
      if (todayPlanFailedFromBrief(row)) {
        const failed: TodayPlanStep = { phase: "failed", tasks, brief, events };
        onStep(failed);
        return failed;
      }
      const refreshed: TodayPlanStep = { phase: "refreshed", tasks, brief, events };
      onStep(refreshed);
      return refreshed;
    } catch {
      errors += 1;
      if (errors >= 3) {
        const failed: TodayPlanStep = { phase: "failed", tasks, brief, events };
        onStep(failed);
        return failed;
      }
      await sleep(pollMs);
    }
  }
  return { phase: "idle", tasks, brief, events };
}
