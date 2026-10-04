import type { DisplayTaskRow } from "./displayTasks";
import type { PlanScope } from "./todayPlan";

export type TodayTasksResponse = {
  memory_kind?: string;
  domain?: string;
  layer?: string;
  items?: DisplayTaskRow[];
  planned_at?: string | null;
};

/** Display rows (result memory) for one plan scope. 今日任务 / 我的待办 differ only by path. */
export async function fetchScopeTasks(scope: PlanScope, signal?: AbortSignal): Promise<DisplayTaskRow[]> {
  const response = await fetch(`/api/home/${scope}-tasks`, {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
  });
  if (!response.ok) return [];
  const body = await response.json().catch(() => null) as TodayTasksResponse | null;
  return Array.isArray(body?.items) ? body.items : [];
}

export const fetchTodayTasks = (signal?: AbortSignal) => fetchScopeTasks("today", signal);
export const fetchTodoTasks = (signal?: AbortSignal) => fetchScopeTasks("todo", signal);
