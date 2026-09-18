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
};

export const DISPLAY_GROUPS = ["重要紧急", "重要", "紧急", "其他"] as const;

export function displayGroupOf(task: Task): string {
  const group = String(task.display_group || "").trim();
  if (group) return group;
  const rank = taskPriorityRank(task);
  if (rank <= 2) return DISPLAY_GROUPS[rank];
  return "其他";
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

/** Result memory → list rows. Host tasks only supply bucket/due/id for actions. */
export function projectDisplayTasks(display: DisplayTaskRow[] | null | undefined, hostTasks: Task[] = []): Task[] {
  const hostById = new Map(hostTasks.map((task) => [task.id, task]));
  return (display || [])
    .slice()
    .sort((a, b) => Number(a.rank || 0) - Number(b.rank || 0))
    .map((row, index) => {
      const id = String(row.work_item_id || "").trim();
      const host = id ? hostById.get(id) : undefined;
      return {
        ...(host || {}),
        id: id || `display:${index}`,
        title: String(row.title || host?.title || ""),
        layout_why: row.why || undefined,
        next_action: row.next_action || row.label || host?.next_action,
        next_action_code: row.verb || host?.next_action_code,
        display_rank: row.rank || index + 1,
        display_verb: row.verb,
        display_label: row.label,
        display_icon: row.icon || undefined,
        display_group: row.group || undefined,
        memory_kind: "task_result",
      } as Task;
    })
    .filter((task) => task.title);
}
