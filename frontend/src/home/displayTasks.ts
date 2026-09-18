import type { Task } from "../api";

export type DisplayTaskRow = {
  work_item_id?: string | null;
  title?: string;
  why?: string;
  rank?: number;
  verb?: string;
  label?: string;
  bucket?: string;
  next_action?: string;
};

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
        memory_kind: "task_result",
      } as Task;
    })
    .filter((task) => task.title);
}
