import type { Task } from "../api";
import { taskPriorityRank } from "./homeModel";

export type DisplayTaskRow = {
  work_item_id?: string | null;
  title?: string;
  why?: string;
  rank?: number;
  verb?: string;
  label?: string;
  bucket?: string;
  next_action?: string;
  icon?: string;
  group?: string;
  view?: "today" | "todo";
};

export const DISPLAY_GROUPS = ["重要紧急", "重要", "紧急", "任务明细"] as const;

export function displayGroupOf(task: Task): string {
  const group = String(task.display_group || "").trim();
  if (group) return group;
  const rank = taskPriorityRank(task);
  if (rank <= 2) return DISPLAY_GROUPS[rank];
  return "任务明细";
}

export function groupDisplayTasks(tasks: Task[]): Array<{ group: string; rows: Task[] }> {
  const order = new Map<string, number>(DISPLAY_GROUPS.map((group, index) => [group, index]));
  const groups = new Map<string, Task[]>();
  for (const task of tasks) {
    const group = displayGroupOf(task);
    groups.set(group, [...(groups.get(group) || []), task]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (order.get(a) ?? DISPLAY_GROUPS.length) - (order.get(b) ?? DISPLAY_GROUPS.length))
    .map(([group, rows]) => ({ group, rows }));
}

/** Result memory decorates current host rows; it cannot create task membership. */
const DISPLAY_CLOSED = new Set(["completed", "done", "cancelled"]);

export function projectDisplayTasks(display: DisplayTaskRow[] | null | undefined, hostTasks: Task[] = []): Task[] {
  const hostById = new Map(hostTasks.map((task) => [task.id, task]));
  const seen = new Set<string>();
  return (display || [])
    .slice()
    .sort((a, b) => Number(a.rank || 0) - Number(b.rank || 0))
    .filter((row) => {
      const id = String(row.work_item_id || "").trim();
      if (!id || !hostById.has(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map((row, index) => {
      const id = String(row.work_item_id || "").trim();
      const host = hostById.get(id)!;
      return {
        ...host,
        id,
        title: host.title,
        layout_why: row.why || undefined,
        // The current task owns its title and permitted next action. Historical
        // plan verbs/labels must not restore an obsolete operation.
        display_rank: row.rank || index + 1,
        display_icon: row.icon || undefined,
        display_group: row.group || undefined,
        // Current server membership wins over a historical plan assignment.
        plan_view: host.plan_view || row.view || undefined,
        memory_kind: "task_result",
      } as Task;
    })
    .filter((task) => task.title)
    .filter((task) => !DISPLAY_CLOSED.has(String(task.status || "")) && !task.dismissed_at);
}

/** A plan can order/annotate tasks, but a stale or partial plan cannot hide new work. */
export function displayTasksOrBase(display: DisplayTaskRow[] | null | undefined, hostTasks: Task[] = []): Task[] {
  const projected = projectDisplayTasks(display, hostTasks);
  const projectedIds = new Set(projected.map((task) => task.id));
  const remaining = hostTasks.filter((task) => !projectedIds.has(task.id)
    && !DISPLAY_CLOSED.has(String(task.status || "")) && !task.dismissed_at);
  return [...projected, ...remaining];
}
