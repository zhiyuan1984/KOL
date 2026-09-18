/**
 * Home Today planning chain — memory first, then think, never skip for freshness.
 *
 * Entering Home Today or clicking「新工作任务」:
 * 1. memory: parallel GET /api/tasks?view=open + GET /api/home/today-brief
 * 2. think:  POST /api/home/today-brief/plan (or attach a running today_plan)
 * 3. poll GET today-brief until planning=false
 * 4. success → refresh brief + layout_why only (no formal todos)
 * 5. failure → keep the memory list
 */
import type { Task, TodayBrief, TodayBriefResponse, TodayPlanResult } from "../api";
import { applyLayoutWhy, isPlanningTask } from "./homeModel";

export { applyLayoutWhy };

export const TODAY_PLAN_REFRESH_EVENT = "lingong:today-plan-refresh";

export const TODAY_PLAN_PHASE_COPY = {
  "loading-memory": "正在读取当前任务",
  planning: "正在按最新记忆规划今天",
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

  const tasksPromise = client.listOpenTasks().then((rows) => {
    tasks = memoryTasksOf(rows);
    if (!aborted(signal)) {
      const step: TodayPlanStep = { phase: "loading-memory", tasks };
      if (memory) {
        step.brief = brief;
        step.planning = Boolean(memory.planning);
      }
      onStep(step);
    }
    return tasks;
  });
  const briefPromise = client.getBrief().then((row) => {
    memory = row;
    if (row.brief !== undefined) brief = row.brief ?? null;
    if (!aborted(signal)) {
      onStep({
        phase: "loading-memory",
        tasks,
        brief,
        planning: Boolean(row.planning),
      });
    }
    return row;
  });

  await Promise.allSettled([tasksPromise, briefPromise]);
  if (aborted(signal)) return { phase: "idle" };

  onStep({
    phase: "planning",
    tasks,
    brief,
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
      const failed: TodayPlanStep = { phase: "failed", tasks, brief };
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
      if (row.planning) {
        onStep({
          phase: "planning",
          tasks,
          brief,
          planning: true,
          attached,
        });
        await sleep(pollMs);
        continue;
      }
      if (todayPlanFailedFromBrief(row)) {
        const failed: TodayPlanStep = { phase: "failed", tasks, brief };
        onStep(failed);
        return failed;
      }
      const refreshed: TodayPlanStep = { phase: "refreshed", tasks, brief };
      onStep(refreshed);
      return refreshed;
    } catch {
      errors += 1;
      if (errors >= 3) {
        const failed: TodayPlanStep = { phase: "failed", tasks, brief };
        onStep(failed);
        return failed;
      }
      await sleep(pollMs);
    }
  }
  return { phase: "idle", tasks, brief };
}
