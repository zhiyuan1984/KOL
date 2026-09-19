/** Employee memories per plan scope. They update independently and must not upsert each other.
 *
 * task         = formal work_items (source != planning). Facts only.
 * task_result  = Codex-processed rows used to RENDER the today list.
 * task_cover   = today_brief lead/sections/primary. Not the list.
 * todo_result  = Codex-processed rows used to RENDER the todo list.
 * todo_cover   = todo brief lead/sections/primary. Not the list.
 */
export const TASK_MEMORY = "task" as const;
export const TASK_RESULT_MEMORY = "task_result" as const;
export const TASK_COVER_MEMORY = "task_cover" as const;
export const TODO_TASK_RESULT_MEMORY = "todo_result" as const;
export const TODO_TASK_COVER_MEMORY = "todo_cover" as const;

export type EmployeeMemoryKind =
  | typeof TASK_MEMORY
  | typeof TASK_RESULT_MEMORY
  | typeof TASK_COVER_MEMORY
  | typeof TODO_TASK_RESULT_MEMORY
  | typeof TODO_TASK_COVER_MEMORY;

export type TodayTaskResultRow = {
  work_item_id: string;
  rank: number;
  title?: string;
  why?: string;
  next_action?: string;
  verb?: string;
  label?: string;
  bucket?: string;
  icon?: string;
  group?: string;
};

export type TodayTaskResults = {
  items: TodayTaskResultRow[];
  planned_at?: string;
};
