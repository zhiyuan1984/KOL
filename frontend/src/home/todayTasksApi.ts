import type { DisplayTaskRow } from "./displayTasks";

export type TodayTasksResponse = {
  memory_kind?: string;
  domain?: string;
  layer?: string;
  items?: DisplayTaskRow[];
  planned_at?: string | null;
};

export async function fetchTodayTasks(): Promise<DisplayTaskRow[]> {
  const response = await fetch("/api/home/today-tasks", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) return [];
  const body = await response.json().catch(() => null) as TodayTasksResponse | null;
  return Array.isArray(body?.items) ? body.items : [];
}
