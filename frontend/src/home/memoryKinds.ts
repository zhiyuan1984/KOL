/** Task rows and planning results are two memories.
 *  Task list membership/order come only from GET /api/tasks.
 *  Cover copy comes only from GET /api/home/today-brief.
 *  todo_layout.why is an overlay, never written back to work_items.
 */
export const TASK_MEMORY = "task" as const;
export const TASK_RESULT_MEMORY = "task_result" as const;

export type EmployeeMemoryKind = typeof TASK_MEMORY | typeof TASK_RESULT_MEMORY;
