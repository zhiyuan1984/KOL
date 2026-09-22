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
export async function fetchScopeTasks(scope: PlanScope): Promise<DisplayTaskRow[]> {
  const response = await fetch(`/api/home/${scope}-tasks`, {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) return [];
  const body = await response.json().catch(() => null) as TodayTasksResponse | null;
  return Array.isArray(body?.items) ? body.items : [];
}

export const fetchTodayTasks = () => fetchScopeTasks("today");
export const fetchTodoTasks = () => fetchScopeTasks("todo");
