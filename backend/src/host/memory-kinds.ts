/** Two employee memories. They update independently and must not upsert each other.
 *
 * task         = formal work_items (source != planning). GET /api/tasks?view=open
 *                Writes: command / acknowledge / approval / follow.
 *                today_plan must not UPDATE these rows.
 *
 * task_result  = Codex/worker artifacts. today_brief lives in task_artifacts +
 *                employee_today_briefs. GET /api/home/today-brief
 *                Writes: only a validated Codex today_brief.
 *                acknowledge must not move the brief pointer.
 */
export const TASK_MEMORY_KIND = "task" as const;
export const TASK_RESULT_MEMORY_KIND = "task_result" as const;

export type MemoryKind = typeof TASK_MEMORY_KIND | typeof TASK_RESULT_MEMORY_KIND;
